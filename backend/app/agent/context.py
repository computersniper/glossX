"""Evidence store and working context for one agent run.

``SpanStore`` turns parsed papers into addressable evidence spans
(``<paper_id>#<chunk_index>``) with page/bbox provenance, so every claim the
agent makes can point back to a place in a PDF. ``WorkingContext`` holds the
goal, plan and compacted step observations the planner and synthesizer see.
"""
from __future__ import annotations

import json
from typing import Any

from ..features import retrieval
from ..features.common import count_tokens, truncate_to_tokens
from ..library import store

OBSERVATION_CHARS = 1200


class SpanStore:
    """Lazily chunked papers addressable by stable span ids."""

    def __init__(self) -> None:
        self._chunks: dict[str, list[dict]] = {}
        self._titles: dict[str, str] = {}

    def _load(self, paper_id: str) -> list[dict]:
        if paper_id in self._chunks:
            return self._chunks[paper_id]
        chunks: list[dict] = []
        title = ""
        try:
            paper = store.get_paper(paper_id)
            title = (paper or {}).get("title") or ""
            parsed = store.load_parsed(paper_id) if paper else None
            if parsed:
                chunks = retrieval.build_chunks(parsed)
        except Exception:
            chunks = []
        for i, c in enumerate(chunks):
            c["span_index"] = i
        self._chunks[paper_id] = chunks
        self._titles[paper_id] = title
        return chunks

    def _span(self, paper_id: str, chunk: dict) -> dict[str, Any]:
        bbox = chunk.get("bbox")
        return {
            "id": f"{paper_id}#{chunk['span_index']}",
            "paper_id": paper_id,
            "title": self._titles.get(paper_id, ""),
            "page": chunk.get("page"),
            "bbox": list(bbox) if isinstance(bbox, (list, tuple)) else None,
            "text": chunk.get("text", ""),
        }

    def search(self, query: str, paper_ids: list[str], k: int = 6) -> list[dict]:
        """BM25 over the union of the given papers' chunks."""
        pool: list[tuple[str, dict]] = []
        for pid in paper_ids:
            pool.extend((pid, c) for c in self._load(pid))
        if not pool:
            return []
        owner = {id(c): pid for pid, c in pool}
        hits = retrieval.retrieve(query, [c for _, c in pool], k=k)
        return [self._span(owner[id(c)], c) for c in hits]

    def get(self, span_id: str) -> dict | None:
        paper_id, sep, idx = str(span_id).rpartition("#")
        if not sep or not paper_id or not idx.isdigit():
            return None
        chunks = self._load(paper_id)
        i = int(idx)
        if i >= len(chunks):
            return None
        return self._span(paper_id, chunks[i])

    def materialize(self, span_ids: list[str], max_tokens: int = 2500) -> str:
        """Render spans as ``[S:<id>] (p.<page>) <text>`` within a token budget."""
        lines: list[str] = []
        used = 0
        seen: set[str] = set()
        for sid in span_ids:
            if sid in seen:
                continue
            seen.add(sid)
            span = self.get(sid)
            if not span:
                continue
            page = span["page"] + 1 if isinstance(span["page"], int) else "?"
            line = f"[S:{span['id']}] (p.{page}) {' '.join(span['text'].split())}"
            cost = count_tokens(line)
            if used + cost > max_tokens:
                remaining = max_tokens - used
                if remaining > 40:
                    lines.append(truncate_to_tokens(line, remaining))
                break
            lines.append(line)
            used += cost
        return "\n".join(lines)


def _compact(value: Any) -> str:
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            text = str(value)
    if len(text) > OBSERVATION_CHARS:
        text = text[:OBSERVATION_CHARS] + " ...[truncated]"
    return text


def span_ids_in(value: Any) -> list[str]:
    """Collect span ids from a handler result (lists of span dicts)."""
    ids: list[str] = []
    if isinstance(value, dict):
        if isinstance(value.get("id"), str) and "#" in value["id"] and "text" in value:
            ids.append(value["id"])
        for v in value.values():
            if isinstance(v, (dict, list)):
                ids.extend(span_ids_in(v))
    elif isinstance(value, list):
        for v in value:
            ids.extend(span_ids_in(v))
    return ids


class WorkingContext:
    """Goal, scope, plan and compacted observations for one run."""

    def __init__(self, goal: str, paper_ids: list[str]) -> None:
        self.goal = goal
        self.paper_ids = list(paper_ids)
        self.sub_questions: list[str] = []
        self.plan: list[dict] = []
        self.observations: list[dict] = []
        self.evidence_ids: list[str] = []

    def add_evidence(self, ids: list[str]) -> None:
        for sid in ids:
            if sid not in self.evidence_ids:
                self.evidence_ids.append(sid)

    def observe(
        self,
        step_id: str,
        capability: str,
        status: str,
        result: Any = None,
        error: str | None = None,
    ) -> dict:
        ids = span_ids_in(result) if result is not None else []
        self.add_evidence(ids)
        obs = {
            "step_id": step_id,
            "capability": capability,
            "status": status,
            "summary": _compact(result) if status == "completed" else "",
            "error": (error or "")[:500] or None,
            "span_ids": ids,
        }
        self.observations.append(obs)
        return obs

    def render(self, max_tokens: int = 6000) -> str:
        parts = [f"GOAL: {self.goal}"]
        if self.sub_questions:
            parts.append("SUB-QUESTIONS:\n" + "\n".join(f"- {q}" for q in self.sub_questions))
        obs_lines = []
        for o in self.observations:
            head = f"[{o['step_id']}] {o['capability']} -> {o['status']}"
            body = o["summary"] if o["status"] == "completed" else f"error: {o['error']}"
            obs_lines.append(f"{head}\n{body}")
        if obs_lines:
            parts.append("OBSERVATIONS:\n" + "\n\n".join(obs_lines))
        return truncate_to_tokens("\n\n".join(parts), max_tokens)
