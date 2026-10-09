"""Research projects with long-term memory, persisted under ``<DATA_DIR>/projects``.

Each project is one JSON file::

    {id, name, description, created_at,
     memory: [{id, text, source_run, ts, span_ids}], run_ids: [...]}

At plan time a run recalls the top-k memory notes (BM25 against its goal);
when a run completes, its supported claims are appended as notes.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .. import config
from ..platform_support import read_utf8_text
from .capabilities import bm25_rank

_ID = re.compile(r"^[a-f0-9]{8,32}$")
MAX_NOTES = 1000
MAX_NOTE_CHARS = 4000
_lock = threading.RLock()


class ProjectNotFoundError(LookupError):
    pass


def _dir() -> Path:
    path = config.PROJECTS_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _path(project_id: str) -> Path:
    if not isinstance(project_id, str) or not _ID.fullmatch(project_id):
        raise ProjectNotFoundError(project_id)
    return _dir() / f"{project_id}.json"


def _read(project_id: str) -> dict[str, Any]:
    path = _path(project_id)
    if not path.is_file():
        raise ProjectNotFoundError(project_id)
    try:
        data = json.loads(read_utf8_text(path))
    except (OSError, ValueError) as error:
        raise ProjectNotFoundError(project_id) from error
    data.setdefault("memory", [])
    data.setdefault("run_ids", [])
    data.setdefault("description", "")
    return data


def _write(project: dict[str, Any]) -> None:
    path = _path(project["id"])
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def exists(project_id: str | None) -> bool:
    if not project_id:
        return False
    try:
        return _path(project_id).is_file()
    except ProjectNotFoundError:
        return False


def create(name: str, description: str = "") -> dict[str, Any]:
    name = " ".join(str(name or "").split())
    if not name:
        raise ValueError("project name must not be empty")
    project = {
        "id": uuid.uuid4().hex[:16],
        "name": name[:120],
        "description": str(description or "").strip()[:2000],
        "created_at": time.time(),
        "memory": [],
        "run_ids": [],
    }
    with _lock:
        _write(project)
    return project


def get(project_id: str) -> dict[str, Any]:
    with _lock:
        return _read(project_id)


def list_projects() -> list[dict[str, Any]]:
    out = []
    with _lock:
        for path in _dir().glob("*.json"):
            try:
                out.append(_read(path.stem))
            except ProjectNotFoundError:
                continue
    return sorted(out, key=lambda p: p.get("created_at") or 0, reverse=True)


def add_memory(
    project_id: str,
    text: str,
    *,
    source_run: str | None = None,
    span_ids: list[str] | None = None,
) -> dict[str, Any]:
    text = str(text or "").strip()
    if not text:
        raise ValueError("memory text must not be empty")
    note = {
        "id": uuid.uuid4().hex[:12],
        "text": text[:MAX_NOTE_CHARS],
        "source_run": source_run,
        "ts": time.time(),
        "span_ids": [str(s) for s in (span_ids or [])][:20],
    }
    with _lock:
        project = _read(project_id)
        project["memory"].append(note)
        project["memory"] = project["memory"][-MAX_NOTES:]
        _write(project)
    return note


def delete_memory(project_id: str, memory_id: str) -> None:
    with _lock:
        project = _read(project_id)
        kept = [n for n in project["memory"] if n.get("id") != memory_id]
        if len(kept) == len(project["memory"]):
            raise KeyError(memory_id)
        project["memory"] = kept
        _write(project)


def add_run(project_id: str, run_id: str) -> None:
    with _lock:
        project = _read(project_id)
        if run_id not in project["run_ids"]:
            project["run_ids"].append(run_id)
            _write(project)


def recall(project_id: str, query: str, k: int = 5) -> list[dict[str, Any]]:
    """Top-k memory notes by BM25 against ``query`` (most recent first on ties)."""
    try:
        notes = list(reversed(get(project_id)["memory"]))
    except ProjectNotFoundError:
        return []
    if not notes:
        return []
    ranked = bm25_rank(query, [n.get("text", "") for n in notes])
    hits = [notes[i] for i, score in ranked if score > 0][:k]
    return hits


def remember_claims(project_id: str, run_id: str, claims: list[dict[str, Any]]) -> int:
    """Append a finished run's supported claims as memory notes."""
    added = 0
    try:
        existing = {n.get("text") for n in get(project_id)["memory"]}
    except ProjectNotFoundError:
        return 0
    for claim in claims:
        if claim.get("verdict") != "supported":
            continue
        text = str(claim.get("text") or "").strip()
        if not text or text in existing:
            continue
        add_memory(project_id, text, source_run=run_id, span_ids=list(claim.get("span_ids") or []))
        existing.add(text)
        added += 1
    return added
