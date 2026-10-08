"""Agent run lifecycle: start, observe (SSE), cancel, persist.

Each run is one asyncio task driving :func:`loop.run_agent`. Every event the
loop emits is appended to the run's trace and fanned out to live subscribers.
Finished runs are written to ``<data dir>/agent_runs/<id>.json`` and reloaded
on startup, which gives the agent a durable run memory.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator

from .. import config
from ..library import store
from ..providers import registry as providers
from .capabilities import build_registry
from .context import SpanStore
from .loop import run_agent

logger = logging.getLogger(__name__)

RUNS_DIR = config.DATA_DIR / "agent_runs"
TERMINAL = {"completed", "failed", "cancelled"}
MAX_LOADED_RUNS = 500


class RunNotFoundError(KeyError):
    pass


@dataclass
class AgentRun:
    id: str
    goal: str
    paper_ids: list[str]
    max_rounds: int = 2
    provider: str | None = None
    status: str = "running"
    phase: str = "plan"
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    trace: list[dict[str, Any]] = field(default_factory=list)
    plan: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    import_jobs: Any | None = field(default=None, repr=False)
    task: asyncio.Task | None = field(default=None, repr=False)
    subscribers: list[asyncio.Queue] = field(default_factory=list, repr=False)

    def snapshot(self, *, trace: bool = True) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "goal": self.goal,
            "paper_ids": list(self.paper_ids),
            "status": self.status,
            "phase": self.phase,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
            "plan": self.plan,
            "result": self.result,
            "error": self.error,
        }
        if trace:
            out["trace"] = list(self.trace)
        return out

    @classmethod
    def from_snapshot(cls, data: dict[str, Any]) -> "AgentRun":
        status = data.get("status") if data.get("status") in TERMINAL else "failed"
        return cls(
            id=str(data["id"]),
            goal=str(data.get("goal") or ""),
            paper_ids=[str(p) for p in data.get("paper_ids") or []],
            status=status,
            phase=str(data.get("phase") or "final"),
            created_at=float(data.get("created_at") or 0.0),
            finished_at=data.get("finished_at"),
            trace=list(data.get("trace") or []),
            plan=data.get("plan"),
            result=data.get("result"),
            error=data.get("error"),
        )


class AgentRunManager:
    """Own agent runs for one local Gloss process."""

    def __init__(self, *, import_jobs: Any | None = None, runs_dir: Path | None = None) -> None:
        self.import_jobs = import_jobs
        self.runs_dir = runs_dir or RUNS_DIR
        self._runs: dict[str, AgentRun] = {}
        self._accepting = True
        self._load_persisted()

    # -- persistence -------------------------------------------------------
    def _load_persisted(self) -> None:
        try:
            self.runs_dir.mkdir(parents=True, exist_ok=True)
            files = sorted(
                self.runs_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True
            )[:MAX_LOADED_RUNS]
        except OSError:
            logger.exception("could not read agent run directory")
            return
        for path in files:
            try:
                run = AgentRun.from_snapshot(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError, KeyError, TypeError):
                logger.warning("skipping unreadable agent run %s", path.name)
                continue
            self._runs[run.id] = run

    def _persist(self, run: AgentRun) -> None:
        try:
            self.runs_dir.mkdir(parents=True, exist_ok=True)
            target = self.runs_dir / f"{run.id}.json"
            tmp = target.with_suffix(".json.tmp")
            tmp.write_text(
                json.dumps(run.snapshot(), ensure_ascii=False, default=str), encoding="utf-8"
            )
            os.replace(tmp, target)
        except OSError:
            logger.exception("could not persist agent run %s", run.id)

    # -- public API ---------------------------------------------------------
    def start(
        self,
        goal: str,
        paper_ids: list[str],
        max_rounds: int = 2,
        provider: str | None = None,
    ) -> dict[str, Any]:
        if not self._accepting:
            raise RuntimeError("agent is shutting down")
        goal = (goal or "").strip()
        if not goal:
            raise ValueError("goal must not be empty")
        if not 1 <= int(max_rounds) <= 3:
            raise ValueError("max_rounds must be between 1 and 3")
        if provider and provider not in providers.available():
            raise ValueError(f"unknown provider: {provider}")
        scope = list(dict.fromkeys(str(p) for p in paper_ids))
        for pid in scope:
            if not store.get_paper(pid):
                raise LookupError(f"paper not found: {pid}")

        run = AgentRun(
            id=uuid.uuid4().hex,
            goal=goal[:4000],
            paper_ids=scope,
            max_rounds=int(max_rounds),
            provider=provider or None,
            import_jobs=self.import_jobs,
        )
        self._runs[run.id] = run
        run.task = asyncio.create_task(self._drive(run), name=f"glossx-run-{run.id[:8]}")
        return run.snapshot()

    def get(self, run_id: str) -> dict[str, Any]:
        return self._get(run_id).snapshot()

    def list(self) -> list[dict[str, Any]]:
        runs = sorted(self._runs.values(), key=lambda r: r.created_at, reverse=True)
        return [r.snapshot(trace=False) for r in runs]

    async def cancel(self, run_id: str) -> dict[str, Any]:
        run = self._get(run_id)
        task = run.task
        if run.status == "running" and task and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=10)
            except (asyncio.CancelledError, TimeoutError, asyncio.TimeoutError):
                pass
            self._mark_cancelled_if_stuck(run)
        return run.snapshot()

    async def subscribe(self, run_id: str) -> AsyncIterator[dict[str, Any]]:
        """Replay the trace so far, then stream live events until the run ends."""
        run = self._get(run_id)
        queue: asyncio.Queue = asyncio.Queue()
        # no await between copying the trace and registering: no gaps, no dupes
        backlog = list(run.trace)
        finished = run.status in TERMINAL
        if not finished:
            run.subscribers.append(queue)
        try:
            for event in backlog:
                yield event
            if finished:
                return
            while True:
                event = await queue.get()
                if event is None:
                    return
                yield event
        finally:
            if queue in run.subscribers:
                run.subscribers.remove(queue)

    def status_of(self, run_id: str) -> str:
        return self._get(run_id).status

    async def shutdown(self) -> None:
        self._accepting = False
        tasks = [r.task for r in self._runs.values() if r.task and not r.task.done()]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.wait(tasks, timeout=15)
        for run in self._runs.values():
            self._mark_cancelled_if_stuck(run)

    # -- internals ----------------------------------------------------------
    def _get(self, run_id: str) -> AgentRun:
        run = self._runs.get(run_id)
        if run is None:
            raise RunNotFoundError(run_id)
        return run

    def _emit(self, run: AgentRun, event: dict[str, Any]) -> None:
        run.trace.append(event)
        if event.get("phase") in {"plan", "execute", "synthesize", "verify", "reflect", "final", "error"}:
            run.phase = event["phase"]
        for q in list(run.subscribers):
            q.put_nowait(event)

    async def _drive(self, run: AgentRun) -> None:
        try:
            spans = SpanStore()
            registry = build_registry()
            run.result = await run_agent(run, registry, spans, lambda ev: self._emit(run, ev))
            run.status = "completed"
            run.phase = "final"
        except asyncio.CancelledError:
            run.status = "cancelled"
            run.error = "cancelled"
            self._emit(run, {"ts": time.time(), "phase": "final", "status": "info",
                             "detail": "run cancelled"})
        except Exception as error:  # the loop already degrades; this is a last resort
            logger.exception("agent run %s failed", run.id)
            run.status = "failed"
            run.error = (str(error) or type(error).__name__)[:1000]
            self._emit(run, {"ts": time.time(), "phase": "error", "status": "failed",
                             "detail": run.error})
        finally:
            self._finish(run)

    def _finish(self, run: AgentRun) -> None:
        run.finished_at = time.time()
        self._persist(run)
        for q in list(run.subscribers):
            q.put_nowait(None)
        run.subscribers.clear()

    def _mark_cancelled_if_stuck(self, run: AgentRun) -> None:
        # A task cancelled before its first step never reaches _drive's handlers.
        if run.status == "running" and run.task is not None and run.task.done():
            run.status = "cancelled"
            run.error = "cancelled"
            self._emit(run, {"ts": time.time(), "phase": "final", "status": "info",
                             "detail": "run cancelled"})
            self._finish(run)
