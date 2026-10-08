"""Builtin capabilities: thin, defensive wrappers over existing Gloss features.

Every handler validates its own args (raising ``ValueError`` with a short
message the planner can learn from), returns JSON-serialisable data and
truncates long outputs so observations stay cheap.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from ..features.citations import _ensure_raw_refs, resolve_references
from ..features.explain import explain_selection
from ..features.summarize import summarize_paper
from ..library import store
from ..pdf import structure
from ..search import scholar
from .capabilities import Capability, CapabilityRegistry, RunContext

IMPORT_WAIT_SECONDS = 170.0  # stays under the loop's per-step timeout


def _str_arg(args: dict[str, Any], key: str, *, required: bool = True) -> str:
    value = args.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise ValueError(f"'{key}' is required")
        return ""
    if not isinstance(value, (str, int, float)):
        raise ValueError(f"'{key}' must be a string")
    return str(value).strip()


def _int_arg(args: dict[str, Any], key: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(args.get(key, default))
    except (TypeError, ValueError):
        value = default
    return max(lo, min(hi, value))


def _paper_arg(args: dict[str, Any], ctx: RunContext) -> str:
    paper_id = _str_arg(args, "paper_id", required=False)
    if not paper_id:
        if not ctx.paper_ids:
            raise ValueError("'paper_id' is required (run has no scope papers)")
        paper_id = ctx.paper_ids[0]
    if not store.get_paper(paper_id):
        raise ValueError(f"paper not found: {paper_id}")
    return paper_id


def _brief(paper: dict) -> dict:
    return {
        "id": paper.get("id"),
        "title": paper.get("title", ""),
        "year": paper.get("year", ""),
        "authors": list(paper.get("authors") or [])[:3],
    }


async def _library_list(args: dict[str, Any], ctx: RunContext) -> Any:
    papers = store.list_papers()
    return {"count": len(papers), "papers": [_brief(p) for p in papers[:100]]}


async def _paper_read(args: dict[str, Any], ctx: RunContext) -> Any:
    paper_id = _paper_arg(args, ctx)
    max_chars = _int_arg(args, "max_chars", 3000, 200, 12000)
    paper = store.get_paper(paper_id) or {}
    parsed = store.load_parsed(paper_id) or {}
    sections = parsed.get("sections")
    if not sections and parsed.get("pages"):
        try:
            sections = structure.detect_sections(parsed)
        except Exception:
            sections = []
    outline = [
        {"title": s.get("title", ""), "page": s.get("page"), "level": s.get("level")}
        for s in (sections or [])[:60]
    ]
    return {
        "paper_id": paper_id,
        "title": paper.get("title", ""),
        "authors": list(paper.get("authors") or [])[:8],
        "year": paper.get("year", ""),
        "abstract": (paper.get("abstract") or "")[:2000],
        "n_pages": parsed.get("n_pages") or paper.get("n_pages"),
        "outline": outline,
        "opening_text": (parsed.get("full_text") or "")[:max_chars],
    }


async def _paper_search_spans(args: dict[str, Any], ctx: RunContext) -> Any:
    query = _str_arg(args, "query")
    k = _int_arg(args, "k", 6, 1, 12)
    paper_ids = args.get("paper_ids")
    if isinstance(paper_ids, str):
        paper_ids = [paper_ids]
    if not isinstance(paper_ids, list) or not paper_ids:
        paper_ids = list(ctx.paper_ids)
    if not paper_ids:
        # no run scope: search the whole library
        paper_ids = [p["id"] for p in store.list_papers()[:50]]
    paper_ids = [str(p) for p in paper_ids if isinstance(p, (str, int))]
    spans = ctx.spans.search(query, paper_ids, k=k)
    return {"query": query, "spans": spans}


async def _paper_summary(args: dict[str, Any], ctx: RunContext) -> Any:
    paper_id = _paper_arg(args, ctx)
    # summarize_paper consults its own cache before calling a provider
    return await summarize_paper(paper_id, provider=ctx.provider)


async def _paper_explain(args: dict[str, Any], ctx: RunContext) -> Any:
    paper_id = _paper_arg(args, ctx)
    text = _str_arg(args, "text")[:4000]
    nearby = ctx.spans.search(text, [paper_id], k=3)
    context = "\n\n".join(s["text"] for s in nearby) or None
    explanation = await explain_selection(
        paper_id, text, context=context, provider=ctx.provider
    )
    return {"paper_id": paper_id, "explanation": explanation[:5000]}


def _ref_brief(r: dict) -> dict:
    return {
        "idx": r.get("idx"),
        "title": r.get("title", ""),
        "authors": list(r.get("authors") or [])[:3],
        "year": r.get("year", ""),
        "doi": r.get("doi", ""),
        "arxiv_id": r.get("arxiv_id", ""),
        "raw": (r.get("raw") or "")[:300],
    }


async def _paper_references(args: dict[str, Any], ctx: RunContext) -> Any:
    paper_id = _paper_arg(args, ctx)
    refs = store.get_refs(paper_id)
    resolved = bool(refs) and all(r.get("resolved") for r in refs)
    note = None
    if not resolved:
        try:
            refs = await resolve_references(paper_id, provider=ctx.provider)
            resolved = True
        except Exception as error:  # network / provider failure: fall back to raw refs
            note = f"resolution failed, raw references only: {error}"[:300]
            try:
                refs = await _ensure_raw_refs(paper_id)
            except Exception:
                refs = []
    return {
        "paper_id": paper_id,
        "resolved": resolved,
        "count": len(refs),
        "references": [_ref_brief(r) for r in refs[:60]],
        "note": note,
    }


async def _scholar_search(args: dict[str, Any], ctx: RunContext) -> Any:
    query = _str_arg(args, "query")
    k = _int_arg(args, "k", 8, 1, 10)
    results = await scholar.search(query, k)
    return {
        "query": query,
        "results": [
            {
                "title": r.get("title", ""),
                "year": r.get("year"),
                "authors": list(r.get("authors") or [])[:3],
                "abstract": (r.get("abstract") or "")[:400],
                "arxiv_id": r.get("arxiv_id", ""),
                "doi": r.get("doi", ""),
                "url": r.get("url", ""),
                "citations": r.get("citations"),
            }
            for r in results[:k]
        ],
    }


async def _library_import(args: dict[str, Any], ctx: RunContext) -> Any:
    source = _str_arg(args, "source")[:500]
    if ctx.import_jobs is None:
        raise ValueError("import queue is not available in this process")
    job = await ctx.import_jobs.submit({"query": source})
    deadline = time.monotonic() + IMPORT_WAIT_SECONDS
    while job.get("status") not in {"completed", "failed", "cancelled"}:
        if time.monotonic() > deadline:
            return {"status": "pending", "job_id": job["id"], "detail": job.get("stage_detail")}
        await asyncio.sleep(1.0)
        job = await ctx.import_jobs.get(job["id"]) or {**job, "status": "failed",
                                                       "error": "import job disappeared"}
    paper_id = job.get("paper_id")
    if job["status"] == "completed" and paper_id and paper_id not in ctx.paper_ids:
        # newly imported papers join the run scope so later steps can cite them
        ctx.paper_ids.append(paper_id)
    return {
        "status": job["status"],
        "job_id": job.get("id"),
        "paper_id": paper_id,
        "title": job.get("title", ""),
        "error": job.get("error"),
    }


BUILTINS: list[Capability] = [
    Capability(
        name="library.list",
        kind="source",
        card="List papers in the local library with id, title, year and first authors.",
        input_schema={},
        handler=_library_list,
        permissions=["library:read"],
    ),
    Capability(
        name="paper.read",
        kind="tool",
        card="Read a paper's metadata, abstract, section outline and opening text.",
        input_schema={
            "paper_id": "str: library paper id",
            "max_chars": "int (optional, default 3000): opening text length",
        },
        handler=_paper_read,
        permissions=["library:read"],
    ),
    Capability(
        name="paper.search_spans",
        kind="tool",
        card="Find citable evidence passages (with page) in scope papers by keyword search; use for any factual question about paper content.",
        input_schema={
            "query": "str: keywords or question",
            "paper_ids": "list[str] (optional): defaults to the run scope",
            "k": "int (optional, default 6, max 12)",
        },
        handler=_paper_search_spans,
        permissions=["library:read"],
    ),
    Capability(
        name="paper.summary",
        kind="agent",
        card="Structured summary of one paper: TL;DR, problem, method, results, contributions, limitations.",
        input_schema={"paper_id": "str: library paper id"},
        handler=_paper_summary,
        permissions=["library:read", "llm"],
        cost="llm",
    ),
    Capability(
        name="paper.explain",
        kind="agent",
        card="Explain a passage, equation, table or term from a paper in plain language.",
        input_schema={
            "paper_id": "str: library paper id",
            "text": "str: the passage or term to explain",
        },
        handler=_paper_explain,
        permissions=["library:read", "llm"],
        cost="llm",
    ),
    Capability(
        name="paper.references",
        kind="tool",
        card="List a paper's bibliography, resolved to title/authors/year/DOI/arXiv when possible.",
        input_schema={"paper_id": "str: library paper id"},
        handler=_paper_references,
        permissions=["library:read", "network"],
        cost="network",
    ),
    Capability(
        name="scholar.search",
        kind="source",
        card="Search Semantic Scholar / arXiv for papers outside the library.",
        input_schema={"query": "str: search query", "k": "int (optional, default 8, max 10)"},
        handler=_scholar_search,
        permissions=["network"],
        cost="network",
    ),
    Capability(
        name="library.import",
        kind="tool",
        card="Import a paper into the library by arXiv id, DOI or PDF URL and add it to the run scope.",
        input_schema={"source": "str: arXiv id, DOI or URL"},
        handler=_library_import,
        permissions=["library:write", "network"],
        cost="network",
    ),
]


def register_builtins(registry: CapabilityRegistry) -> None:
    for cap in BUILTINS:
        registry.register(cap)
