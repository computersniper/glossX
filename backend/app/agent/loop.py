"""The GlossX agent loop: plan -> execute -> synthesize -> verify -> reflect.

One call to :func:`run_agent` drives a goal to a grounded answer. Every claim
in the answer cites evidence spans (``[S:<paper_id>#<chunk>]``) collected while
executing capabilities, and a verifier grades each claim against its spans.
Step failures become observations; only an unrecoverable synthesis failure in
the first round fails the run.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any, Callable

from ..config import output_language
from ..features.common import json_complete
from ..library import store
from ..providers import registry as providers
from .capabilities import CapabilityRegistry, RunContext
from .context import SpanStore, WorkingContext

MAX_PLAN_STEPS = 8
MAX_STEP_EXECUTIONS = 16
STEP_TIMEOUT = 180.0
MAX_CLAIMS = 10
MAX_EVIDENCE_SPANS = 24
EVIDENCE_TOKENS = 3500
VERDICTS = {"supported", "partial", "unsupported"}

_CITE = re.compile(r"\[S:([^\]\s]+)\]")

Emit = Callable[[dict[str, Any]], None]

PLAN_SYSTEM = (
    "You are the planner of GlossX, a research agent over a local library of "
    "academic papers. Break the goal into sub-questions and choose a short plan "
    "of capability calls that gathers the evidence needed to answer it. Use only "
    "the listed capabilities and their argument names. Prefer cheap capabilities "
    "(cost free) and paper.search_spans for factual questions; use LLM or network "
    "capabilities only when they add something the evidence cannot. Steps without "
    "dependencies run in parallel; arguments are static (no references to other "
    "steps' outputs)."
)
PLAN_SHAPE = (
    '{"sub_questions": ["..."], "steps": [{"id": "s1", "capability": "<name>", '
    '"args": {}, "purpose": "why this step", "depends_on": []}]}'
)

SYNTH_SYSTEM = (
    "You are GlossX, a careful research agent. Answer the goal using ONLY the "
    "evidence spans provided. Cite inline after each supported statement with the "
    "exact markers given, e.g. [S:abc#12]. Cite only span ids that appear in the "
    "EVIDENCE section; never invent ids. If the evidence is insufficient, say so "
    "plainly rather than guessing. List the answer's key factual claims separately, "
    "each with the span ids that support it."
)
SYNTH_SHAPE = (
    '{"answer": "<markdown with inline citations like [S:<span_id>]>", '
    '"claims": [{"text": "...", "span_ids": ["..."]}]}'
)

VERIFY_SYSTEM = (
    "You are a strict fact checker. For each numbered claim decide whether its "
    "cited evidence spans support it: 'supported' (fully entailed), 'partial' "
    "(some parts supported, or only loosely), or 'unsupported'. Judge only from "
    "the given spans, not from outside knowledge."
)
VERIFY_SHAPE = (
    '{"verdicts": [{"i": 0, "verdict": "supported|partial|unsupported", '
    '"confidence": 0.0, "note": "short reason"}]}'
)

REFLECT_SYSTEM = (
    "You are the reflection step of GlossX, a research agent. Decide whether the "
    "current answer adequately covers every sub-question with supported claims. "
    "Choose 'stop' if it does, or if more work is unlikely to help. Choose "
    "'replan' only when specific additional capability calls would close a "
    "concrete gap (uncovered sub-question, unsupported claim, failed step), and "
    "give those calls as new_steps."
)
REFLECT_SHAPE = (
    '{"decision": "stop|replan", "reason": "...", "new_steps": [{"id": "r1", '
    '"capability": "<name>", "args": {}, "purpose": "...", "depends_on": []}]}'
)


class _Budget:
    def __init__(self) -> None:
        self.executions = 0
        self.exhausted = False

    @property
    def remaining(self) -> int:
        return max(0, MAX_STEP_EXECUTIONS - self.executions)


def _event(
    phase: str,
    status: str,
    detail: str,
    *,
    step_id: str | None = None,
    capability: str | None = None,
) -> dict[str, Any]:
    ev: dict[str, Any] = {"ts": time.time(), "phase": phase, "status": status, "detail": detail}
    if step_id is not None:
        ev["step_id"] = step_id
    if capability is not None:
        ev["capability"] = capability
    return ev


def _err(error: BaseException) -> str:
    text = str(error) or type(error).__name__
    return text[:500]


def _cards_text(registry: CapabilityRegistry, query: str) -> str:
    lines = []
    for c in registry.cards(query, k=16):
        schema = json.dumps(c["input_schema"], ensure_ascii=False)
        lines.append(f"- {c['name']} ({c['kind']}, cost {c['cost']}): {c['card']} args: {schema}")
    return "\n".join(lines)


def _scope_text(paper_ids: list[str]) -> str:
    if not paper_ids:
        return "(no scope papers selected; the whole library and external search are available)"
    lines = []
    for pid in paper_ids[:20]:
        paper = store.get_paper(pid) or {}
        lines.append(f"- {pid}: {paper.get('title') or '(untitled)'} ({paper.get('year') or 'n.d.'})")
    return "\n".join(lines)


def _normalize_steps(
    raw: Any,
    registry: CapabilityRegistry,
    *,
    prefix: str,
    taken: set[str],
    emit: Emit,
    phase: str,
) -> list[dict]:
    """Validate planner output: known capabilities, unique ids, sane deps."""
    steps: list[dict] = []
    if not isinstance(raw, list):
        return steps
    ids_in_plan: set[str] = set()
    for i, s in enumerate(raw):
        if len(steps) >= MAX_PLAN_STEPS:
            emit(_event(phase, "info", f"plan truncated to {MAX_PLAN_STEPS} steps"))
            break
        if not isinstance(s, dict):
            continue
        name = str(s.get("capability") or "").strip()
        if not registry.get(name):
            emit(_event(phase, "info", f"dropped step with unknown capability '{name}'",
                        capability=name or None))
            continue
        sid = str(s.get("id") or "").strip()[:32]
        if not sid or sid in taken or sid in ids_in_plan:
            sid = f"{prefix}{i + 1}"
            n = i + 1
            while sid in taken or sid in ids_in_plan:
                n += 1
                sid = f"{prefix}{n}"
        args = s.get("args") if isinstance(s.get("args"), dict) else {}
        deps = s.get("depends_on") if isinstance(s.get("depends_on"), list) else []
        steps.append({
            "id": sid,
            "capability": name,
            "args": args,
            "purpose": str(s.get("purpose") or "")[:300],
            "depends_on": [str(d) for d in deps],
            "status": "pending",
        })
        ids_in_plan.add(sid)
    # keep only dependencies on steps of this plan (earlier rounds are already done)
    for st in steps:
        st["depends_on"] = [d for d in st["depends_on"] if d in ids_in_plan and d != st["id"]]
    return steps


def _summarize_result(result: Any) -> str:
    if isinstance(result, dict):
        for key in ("spans", "papers", "results", "references"):
            if isinstance(result.get(key), list):
                return f"{len(result[key])} {key}"
        if "status" in result:
            return f"status {result['status']}"
        return ", ".join(list(result.keys())[:6])
    if isinstance(result, list):
        return f"{len(result)} items"
    return " ".join(str(result).split())[:160]


async def _run_step(
    step: dict,
    registry: CapabilityRegistry,
    ctx: RunContext,
    wc: WorkingContext,
    emit: Emit,
) -> None:
    cap = registry.get(step["capability"])
    step["status"] = "running"
    emit(_event("execute", "started", step.get("purpose") or step["capability"],
                step_id=step["id"], capability=step["capability"]))
    try:
        if cap is None:
            raise ValueError("unknown capability")
        result = await asyncio.wait_for(cap.handler(step["args"], ctx), STEP_TIMEOUT)
    except asyncio.CancelledError:
        raise
    except Exception as error:
        message = (
            f"timed out after {int(STEP_TIMEOUT)}s"
            if isinstance(error, (asyncio.TimeoutError, TimeoutError))
            else _err(error)
        )
        step["status"] = "failed"
        step["error"] = message
        wc.observe(step["id"], step["capability"], "failed", error=message)
        emit(_event("execute", "failed", message, step_id=step["id"],
                    capability=step["capability"]))
        return
    step["status"] = "completed"
    wc.observe(step["id"], step["capability"], "completed", result=result)
    emit(_event("execute", "completed", _summarize_result(result),
                step_id=step["id"], capability=step["capability"]))


async def _execute(
    steps: list[dict],
    registry: CapabilityRegistry,
    ctx: RunContext,
    wc: WorkingContext,
    budget: _Budget,
    emit: Emit,
) -> int:
    """Run steps in dependency waves; return how many completed successfully."""
    pending = {s["id"]: s for s in steps}
    finished: set[str] = set()
    ok = 0
    while pending:
        ready = [s for s in pending.values() if all(d in finished for d in s["depends_on"])]
        if not ready:
            for s in pending.values():
                s["status"] = "skipped"
                emit(_event("execute", "info", "skipped: unresolvable dependencies",
                            step_id=s["id"], capability=s["capability"]))
            break
        if budget.remaining <= 0:
            budget.exhausted = True
            for s in pending.values():
                s["status"] = "skipped"
            emit(_event("execute", "info",
                        f"step budget exhausted ({MAX_STEP_EXECUTIONS}); skipped {len(pending)} step(s)"))
            break
        ready = ready[: budget.remaining]
        budget.executions += len(ready)
        await asyncio.gather(*(_run_step(s, registry, ctx, wc, emit) for s in ready))
        for s in ready:
            finished.add(s["id"])
            pending.pop(s["id"], None)
            ok += s["status"] == "completed"
    return ok


async def _plan(
    run: Any,
    registry: CapabilityRegistry,
    spans: SpanStore,
    ctx: RunContext,
    wc: WorkingContext,
    emit: Emit,
) -> list[dict]:
    emit(_event("plan", "started", "planning and routing"))
    user = (
        f"GOAL:\n{wc.goal}\n\nSCOPE PAPERS:\n{_scope_text(ctx.paper_ids)}\n\n"
        f"CAPABILITIES:\n{_cards_text(registry, wc.goal)}\n\n"
        f"WHAT IS KNOWN SO FAR:\n{wc.render(max_tokens=2000)}\n\n"
        f"Produce at most {MAX_PLAN_STEPS} steps. Use paper ids exactly as listed."
    )
    try:
        out = await json_complete(PLAN_SYSTEM, user, PLAN_SHAPE, provider=run.provider)
    except Exception as error:
        emit(_event("plan", "failed", f"planner failed, continuing with seed evidence: {_err(error)}"))
        return []
    out = out if isinstance(out, dict) else {}
    subs = out.get("sub_questions")
    wc.sub_questions = [str(q)[:300] for q in subs if str(q).strip()][:8] if isinstance(subs, list) else []
    taken = {s["id"] for s in wc.plan}
    steps = _normalize_steps(out.get("steps"), registry, prefix="s", taken=taken,
                             emit=emit, phase="plan")
    emit(_event("plan", "completed",
                f"{len(wc.sub_questions)} sub-question(s), {len(steps)} step(s)"))
    return steps


def _provided_ids(evidence: str) -> list[str]:
    return list(dict.fromkeys(_CITE.findall(evidence)))


def _evidence_block(spans: SpanStore, wc: WorkingContext) -> tuple[str, set[str]]:
    # most recent evidence is usually the most targeted; keep seed spans too
    ids = wc.evidence_ids
    if len(ids) > MAX_EVIDENCE_SPANS:
        ids = ids[:8] + ids[-(MAX_EVIDENCE_SPANS - 8):]
    text = spans.materialize(ids, max_tokens=EVIDENCE_TOKENS)
    return text, set(_provided_ids(text))


async def _synthesize(
    run: Any, spans: SpanStore, wc: WorkingContext, emit: Emit, round_no: int
) -> dict:
    emit(_event("synthesize", "started", f"round {round_no}: writing grounded answer"))
    evidence, provided = _evidence_block(spans, wc)
    user = (
        f"{wc.render(max_tokens=5000)}\n\n"
        f"EVIDENCE (cite only these ids):\n{evidence or '(no evidence spans were found)'}\n\n"
        f"Write the answer in: {output_language()}."
    )
    out = await json_complete(SYNTH_SYSTEM, user, SYNTH_SHAPE, provider=run.provider)
    out = out if isinstance(out, dict) else {}
    answer = str(out.get("answer") or "").strip()

    def keep(match: re.Match) -> str:
        return match.group(0) if match.group(1) in provided else ""

    cleaned = _CITE.sub(keep, answer)
    if cleaned != answer:
        # tidy whitespace left where an invalid citation was removed
        cleaned = re.sub(r"[ \t]+([.,;:!?)])", r"\1", cleaned)
    answer = cleaned
    claims = []
    raw_claims = out.get("claims") if isinstance(out.get("claims"), list) else []
    for c in raw_claims[:MAX_CLAIMS]:
        if not isinstance(c, dict) or not str(c.get("text") or "").strip():
            continue
        ids = c.get("span_ids") if isinstance(c.get("span_ids"), list) else []
        claims.append({
            "text": str(c["text"]).strip()[:1000],
            "span_ids": [str(s) for s in dict.fromkeys(ids) if str(s) in provided],
        })
    emit(_event("synthesize", "completed",
                f"{len(claims)} claim(s) over {len(provided)} evidence span(s)"))
    return {"answer": answer, "claims": claims}


async def _verify(
    run: Any, spans: SpanStore, draft: dict, emit: Emit
) -> list[dict]:
    claims = [dict(c) for c in draft["claims"]]
    emit(_event("verify", "started", f"checking {len(claims)} claim(s)"))
    for c in claims:
        c.update(verdict="unsupported", confidence=0.0, note="no valid citation")
    checkable = [i for i, c in enumerate(claims) if c["span_ids"]]
    if not checkable:
        emit(_event("verify", "completed", "no cited claims to check"))
        return claims
    per_claim = max(300, 6000 // len(checkable))
    blocks = []
    for i in checkable:
        c = claims[i]
        blocks.append(
            f"CLAIM {i}: {c['text']}\nSPANS:\n{spans.materialize(c['span_ids'], max_tokens=per_claim)}"
        )
    try:
        out = await json_complete(VERIFY_SYSTEM, "\n\n".join(blocks), VERIFY_SHAPE,
                                  provider=run.provider)
    except Exception as error:
        for i in checkable:
            claims[i].update(verdict="partial", confidence=0.0,
                             note=f"verification unavailable: {_err(error)[:200]}")
        emit(_event("verify", "failed", f"verifier failed: {_err(error)}"))
        return claims
    rows = out.get("verdicts") if isinstance(out, dict) else None
    by_i: dict[int, dict] = {}
    for row in rows if isinstance(rows, list) else []:
        try:
            by_i[int(row.get("i"))] = row
        except (TypeError, ValueError, AttributeError):
            continue
    for i in checkable:
        row = by_i.get(i)
        if not row:
            claims[i].update(verdict="partial", confidence=0.0, note="not graded by verifier")
            continue
        verdict = str(row.get("verdict") or "").strip().lower()
        try:
            confidence = max(0.0, min(1.0, float(row.get("confidence", 0.0))))
        except (TypeError, ValueError):
            confidence = 0.0
        claims[i].update(
            verdict=verdict if verdict in VERDICTS else "partial",
            confidence=confidence,
            note=str(row.get("note") or "")[:300],
        )
    tally = {v: sum(c["verdict"] == v for c in claims) for v in ("supported", "partial", "unsupported")}
    emit(_event("verify", "completed",
                f"{tally['supported']} supported, {tally['partial']} partial, "
                f"{tally['unsupported']} unsupported"))
    return claims


async def _reflect(
    run: Any,
    registry: CapabilityRegistry,
    wc: WorkingContext,
    claims: list[dict],
    rounds_left: int,
    budget_left: int,
    emit: Emit,
) -> tuple[str, str, Any]:
    emit(_event("reflect", "started", "checking coverage"))
    claim_lines = "\n".join(
        f"- [{c['verdict']}] {c['text']}" for c in claims
    ) or "(no claims)"
    user = (
        f"{wc.render(max_tokens=4000)}\n\nCURRENT CLAIMS AND VERDICTS:\n{claim_lines}\n\n"
        f"ROUNDS LEFT: {rounds_left}\nSTEP EXECUTIONS LEFT: {budget_left} "
        f"(at most {min(MAX_PLAN_STEPS, budget_left)} new steps).\n\nCAPABILITIES:\n{_cards_text(registry, wc.goal)}"
    )
    out = await json_complete(REFLECT_SYSTEM, user, REFLECT_SHAPE, provider=run.provider)
    out = out if isinstance(out, dict) else {}
    decision = str(out.get("decision") or "stop").strip().lower()
    reason = str(out.get("reason") or "")[:500]
    return ("replan" if decision == "replan" else "stop"), reason, out.get("new_steps")


def _plan_snapshot(wc: WorkingContext) -> dict:
    return {"sub_questions": list(wc.sub_questions), "steps": [dict(s) for s in wc.plan]}


def _final(spans: SpanStore, draft: dict, claims: list[dict], wc: WorkingContext,
           stop_reason: str, rounds: int) -> dict:
    cited = list(dict.fromkeys(
        [sid for c in claims for sid in c["span_ids"]] + _CITE.findall(draft["answer"])
    ))
    citations = [s for s in (spans.get(sid) for sid in cited) if s]
    return {
        "answer": draft["answer"],
        "claims": claims,
        "citations": citations,
        "sub_questions": list(wc.sub_questions),
        "stop_reason": stop_reason,
        "rounds": rounds,
    }


async def run_agent(
    run: Any,
    registry: CapabilityRegistry,
    spans: SpanStore,
    emit: Emit,
) -> dict:
    """Drive one goal to a verified, cited answer.

    ``run`` needs ``id``, ``goal``, ``paper_ids``, ``max_rounds``, ``provider``
    and ``import_jobs`` attributes; ``run.plan`` is updated as the plan evolves.
    """
    ctx = RunContext(
        run_id=run.id,
        paper_ids=list(run.paper_ids),
        spans=spans,
        import_jobs=getattr(run, "import_jobs", None),
        provider=run.provider,
    )
    first_paper = ctx.paper_ids[0] if ctx.paper_ids else None
    with providers.usage_context("agent", paper_id=first_paper):
        return await _drive(run, registry, spans, ctx, emit)


async def _drive(
    run: Any,
    registry: CapabilityRegistry,
    spans: SpanStore,
    ctx: RunContext,
    emit: Emit,
) -> dict:
    wc = WorkingContext(run.goal, ctx.paper_ids)
    budget = _Budget()
    max_rounds = max(1, int(run.max_rounds or 1))

    def publish_plan() -> None:
        run.plan = _plan_snapshot(wc)

    # Seed evidence with a direct search for the goal over the scope.
    if ctx.paper_ids:
        seed = {
            "id": "s0",
            "capability": "paper.search_spans",
            "args": {"query": wc.goal, "k": 8},
            "purpose": "seed evidence for the goal",
            "depends_on": [],
            "status": "pending",
            "round": 1,
        }
        wc.plan.append(seed)
        publish_plan()
        await _execute([seed], registry, ctx, wc, budget, emit)

    steps = await _plan(run, registry, spans, ctx, wc, emit)
    for s in steps:
        s["round"] = 1
    wc.plan.extend(steps)
    publish_plan()
    await _execute(steps, registry, ctx, wc, budget, emit)
    publish_plan()

    try:
        draft = await _synthesize(run, spans, wc, emit, 1)
    except asyncio.CancelledError:
        raise
    except Exception as error:
        emit(_event("synthesize", "failed", _err(error)))
        raise RuntimeError(f"synthesis failed: {_err(error)}") from error
    claims = await _verify(run, spans, draft, emit)

    rounds = 1
    stop_reason = "goal_met"
    while True:
        if budget.exhausted or budget.remaining <= 0:
            stop_reason = "budget"
            emit(_event("reflect", "info", "step budget exhausted; stopping"))
            break
        if rounds >= max_rounds:
            stop_reason = "max_rounds"
            emit(_event("reflect", "info", f"reached max rounds ({max_rounds}); stopping"))
            break
        try:
            decision, reason, raw_steps = await _reflect(
                run, registry, wc, claims, max_rounds - rounds, budget.remaining, emit
            )
        except asyncio.CancelledError:
            raise
        except Exception as error:
            stop_reason = "error"
            emit(_event("reflect", "failed", f"reflection failed: {_err(error)}"))
            break
        if decision == "stop":
            stop_reason = "goal_met"
            emit(_event("reflect", "completed", f"stop: {reason}"))
            break
        taken = {s["id"] for s in wc.plan}
        new_steps = _normalize_steps(raw_steps, registry, prefix=f"r{rounds + 1}-",
                                     taken=taken, emit=emit, phase="reflect")
        if not new_steps:
            stop_reason = "no_progress"
            emit(_event("reflect", "completed", f"replan requested without usable steps: {reason}"))
            break
        rounds += 1
        emit(_event("reflect", "completed", f"replan (round {rounds}): {reason}"))
        for s in new_steps:
            s["round"] = rounds
        wc.plan.extend(new_steps)
        publish_plan()
        evidence_before = len(wc.evidence_ids)
        ok = await _execute(new_steps, registry, ctx, wc, budget, emit)
        publish_plan()
        if ok == 0:
            stop_reason = "no_progress"
            emit(_event("reflect", "info", "no new step succeeded; keeping previous answer"))
            break
        try:
            draft_next = await _synthesize(run, spans, wc, emit, rounds)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            stop_reason = "error"
            emit(_event("synthesize", "failed", f"keeping previous answer: {_err(error)}"))
            break
        draft = draft_next
        claims = await _verify(run, spans, draft, emit)
        if len(wc.evidence_ids) == evidence_before:
            emit(_event("reflect", "info", "replan added no new evidence spans"))

    result = _final(spans, draft, claims, wc, stop_reason, rounds)
    emit(_event("final", "completed",
                f"stop_reason={stop_reason}, {len(result['claims'])} claim(s), "
                f"{len(result['citations'])} citation(s)"))
    return result
