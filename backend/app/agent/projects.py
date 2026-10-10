"""Research projects with long-term memory, persisted under ``<DATA_DIR>/projects``.

Each project is one JSON file::

    {id, name, description, created_at, kind: "paper" | "research",
     paper_ids: [...], source_paper_id: <the paper a "paper" project was made for>,
     memory: [{id, text, source_run, ts, span_ids}], run_ids: [...]}

Every project has a workspace directory ``<DATA_DIR>/workspaces/<id>/``. A
``paper`` project is created automatically, exactly once, for each paper added
to the library (``ensure_paper_project``); a ``research`` project is made by
the user and may hold several papers. Memory notes are mirrored to
``<workspace>/.glossx/memory.json`` (this JSON stays the source of truth).

At plan time a run recalls the top-k memory notes (BM25 against its goal);
when a run completes, its supported claims are appended as notes.
"""
from __future__ import annotations

import json
import logging
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
MAX_PAPERS = 500
KINDS = ("paper", "research")
_lock = threading.RLock()
_names: dict[str, tuple[int, str, Any]] = {}
logger = logging.getLogger(__name__)


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
    data.setdefault("kind", "research")
    data.setdefault("paper_ids", [])
    # projects saved before papers had workspaces
    if data.get("kind") not in KINDS:
        data["kind"] = "research"
    if not isinstance(data.get("paper_ids"), list):
        data["paper_ids"] = []
    data.setdefault("source_paper_id", None)
    return data


def _write(project: dict[str, Any]) -> None:
    path = _path(project["id"])
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    from ..harness import home, workspace
    home.write_memory(workspace.root_for(project["id"]), project.get("memory", []))


def exists(project_id: str | None) -> bool:
    if not project_id:
        return False
    try:
        return _path(project_id).is_file()
    except ProjectNotFoundError:
        return False


def _paper_list(paper_ids: Any) -> list[str]:
    if paper_ids is None:
        return []
    if not isinstance(paper_ids, (list, tuple)) or len(paper_ids) > MAX_PAPERS:
        raise ValueError(f"paper_ids must be a list of at most {MAX_PAPERS} paper ids")
    out = []
    for pid in paper_ids:
        if not isinstance(pid, str) or not pid.strip() or len(pid) > 64:
            raise ValueError("paper_ids must contain paper ids")
        out.append(pid.strip())
    return list(dict.fromkeys(out))


def create(name: str, description: str = "", *, kind: str = "research",
           paper_ids: Any = None, source_paper_id: str | None = None) -> dict[str, Any]:
    name = " ".join(str(name or "").split())
    if not name:
        raise ValueError("project name must not be empty")
    if kind not in KINDS:
        raise ValueError(f"kind must be one of: {', '.join(KINDS)}")
    project = {
        "id": uuid.uuid4().hex[:16],
        "name": name[:120],
        "description": str(description or "").strip()[:2000],
        "created_at": time.time(),
        "kind": kind,
        "paper_ids": _paper_list(paper_ids),
        "source_paper_id": source_paper_id,
        "memory": [],
        "run_ids": [],
        "kind": kind,
        "paper_ids": list(dict.fromkeys(paper_ids or [])),
    }
    with _lock:
        _write(project)
    return project


def ref(project_id: str | None) -> dict[str, Any] | None:
    """``{id, name}`` for session summaries (cached by file mtime); ``None`` for
    no project ("General")."""
    if not project_id:
        return None
    try:
        path = _path(project_id)
        stamp = path.stat().st_mtime_ns
    except (ProjectNotFoundError, OSError):
        return {"id": project_id, "name": "(deleted project)", "kind": None}
    hit = _names.get(project_id)
    if hit is None or hit[0] != stamp:
        try:
            data = _read(project_id)
        except ProjectNotFoundError:
            return {"id": project_id, "name": "(deleted project)", "kind": None}
        hit = (stamp, str(data.get("name") or project_id), data.get("kind"))
        _names[project_id] = hit
    return {"id": project_id, "name": hit[1], "kind": hit[2]}


# -- papers -----------------------------------------------------------------------------
def for_paper(paper_id: str) -> list[dict[str, Any]]:
    """Projects that hold ``paper_id`` (the paper's own project first)."""
    hits = [p for p in list_projects() if paper_id in p.get("paper_ids", [])]
    hits.sort(key=lambda p: (p.get("source_paper_id") != paper_id, p.get("kind") != "paper"))
    return hits


def link_paper(project_id: str, paper_id: str) -> dict[str, Any]:
    paper_id = _paper_list([paper_id])[0]
    with _lock:
        project = _read(project_id)
        if paper_id not in project["paper_ids"]:
            if len(project["paper_ids"]) >= MAX_PAPERS:
                raise ValueError(f"a project holds at most {MAX_PAPERS} papers")
            project["paper_ids"].append(paper_id)
            _write(project)
    return project


def unlink_paper(project_id: str, paper_id: str) -> dict[str, Any]:
    """Remove a paper from a project (the project and its files stay)."""
    with _lock:
        project = _read(project_id)
        if paper_id not in project["paper_ids"]:
            raise KeyError(paper_id)
        project["paper_ids"] = [p for p in project["paper_ids"] if p != paper_id]
        _write(project)
    return project


def forget_paper(paper_id: str) -> int:
    """A paper was deleted from the library: unlink it everywhere. Projects,
    workspaces and notes are kept. Returns the number of projects touched."""
    touched = 0
    with _lock:
        for project in list_projects():
            if paper_id in project.get("paper_ids", []):
                project["paper_ids"] = [p for p in project["paper_ids"] if p != paper_id]
                _write(project)
                touched += 1
    return touched


def _paper_title(paper: dict[str, Any]) -> str:
    title = " ".join(str(paper.get("title") or "").split())
    return (title or "Untitled paper")[:120]


def paper_instructions(paper: dict[str, Any]) -> str:
    """``GLOSSX.md`` seeded at the root of a paper's workspace."""
    pid = str(paper.get("id") or "")
    authors = [str(a) for a in (paper.get("authors") or []) if str(a).strip()]
    lines = [f"# {_paper_title(paper)}", ""]
    lines.append(f"- Authors: {', '.join(authors[:12]) + (' et al.' if len(authors) > 12 else '') or 'unknown'}")
    lines.append(f"- Year: {paper.get('year') or 'unknown'}")
    lines.append(f"- Paper id: `{pid}`")
    if paper.get("arxiv_id"):
        lines.append(f"- arXiv: {paper['arxiv_id']}")
    if paper.get("doi"):
        lines.append(f"- DOI: {paper['doi']}")
    lines += [
        "",
        "This workspace belongs to the paper above. Notes, summaries, code and data for it",
        "live here; `notes/` is the place for reading notes.",
        "",
        "## Reading the paper",
        "",
        f"Use the paper tools with paper id `{pid}`: `paper_read` (outline, a section by",
        "title, or pages), `paper_search_spans` (find evidence passages), `paper_summary`,",
        "`paper_references`.",
        "",
        "## Citing",
        "",
        "Back every claim about the paper with an evidence span and cite it with the marker",
        f"`[S:{pid}#<n>]`, copied exactly as the paper tools return it (for example",
        f"`[S:{pid}#12]`). The reader turns these markers into links that open the paper at",
        "that passage. Never invent span ids; search for the passage first.",
        "",
        "## Conventions",
        "",
        "- Write notes in Markdown under `notes/`; one file per topic.",
        "- Say what is the paper's claim and what is your own comment.",
        "",
    ]
    return "\n".join(lines)


NOTES_README = """# Notes

Reading notes for this paper. One Markdown file per topic works well, for
example `summary.md`, `questions.md`, `method.md`.

Cite the paper with span markers such as `[S:<paper_id>#<n>]` (see `GLOSSX.md`
in the workspace root) so every note links back to the passage it is about.
"""


def seed_paper_workspace(project_id: str, paper: dict[str, Any]) -> None:
    """Create ``GLOSSX.md`` and ``notes/README.md`` (never overwrites)."""
    from ..harness import home, workspace

    root = workspace.root_for(project_id)
    home.write_if_missing(root / "GLOSSX.md", paper_instructions(paper))
    home.write_if_missing(root / "notes" / "README.md", NOTES_README)


def ensure_paper_project(paper: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """The paper's own project, created (with its workspace) the first time.

    Returns ``(project, created)``. Exactly one project is ever made for a
    paper: the lookup and the creation happen under one lock, and the project
    remembers its paper in ``source_paper_id`` even if the paper is unlinked.
    """
    paper_id = str(paper.get("id") or "").strip()
    if not paper_id:
        raise ValueError("paper has no id")
    with _lock:
        own = next((p for p in list_projects() if p.get("source_paper_id") == paper_id), None)
        if own is not None:
            if paper_id not in own["paper_ids"]:
                own["paper_ids"].append(paper_id)
                _write(own)
            return own, False
        project = create(_paper_title(paper), kind="paper", paper_ids=[paper_id],
                         source_paper_id=paper_id)
        try:
            seed_paper_workspace(project["id"], paper)
        except Exception:  # the project exists; its files can be created later
            logger.exception("could not seed the workspace of project %s", project["id"])
        return project, True


def ensure_paper_project_quietly(paper: dict[str, Any] | None) -> dict[str, Any] | None:
    """``ensure_paper_project`` for import paths: never raises, and the git
    repository of a new workspace is created in the background."""
    if not paper or not paper.get("id"):
        return None
    try:
        project, created = ensure_paper_project(paper)
    except Exception:
        logger.exception("could not create the project of paper %s", paper.get("id"))
        return None
    if created:
        try:
            from ..harness import vcs

            vcs.ensure_repo_in_background(project["id"])
        except Exception:
            logger.exception("could not start the repository of project %s", project["id"])
    return project


def mirror_memory(project: dict[str, Any]) -> None:
    """Write the notes to ``<workspace>/.glossx/memory.json`` (best effort)."""
    try:
        from ..harness import home, workspace

        home.write_memory(workspace.root_for(project["id"]), project.get("memory") or [])
    except Exception:
        logger.warning("could not mirror the memory of project %s", project.get("id"),
                       exc_info=True)


def get(project_id: str) -> dict[str, Any]:
    with _lock:
        return workspace_detail(_read(project_id))


def list_projects(paper_id: str | None = None) -> list[dict[str, Any]]:
    out = []
    with _lock:
        for path in _dir().glob("*.json"):
            try:
                project = _read(path.stem)
                if paper_id is None or paper_id in project["paper_ids"]:
                    out.append(workspace_detail(project))
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
        mirror_memory(project)
    return note


def delete_memory(project_id: str, memory_id: str) -> None:
    with _lock:
        project = _read(project_id)
        kept = [n for n in project["memory"] if n.get("id") != memory_id]
        if len(kept) == len(project["memory"]):
            raise KeyError(memory_id)
        project["memory"] = kept
        _write(project)
        mirror_memory(project)


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


def workspace_detail(project: dict[str, Any]) -> dict[str, Any]:
    from ..harness import workspace, vcs
    key = project["id"]
    root = workspace.root_for(key)
    project["workspace"] = {"key": key, "path": str(root), "vcs": vcs.brief(key)}
    return project


def ensure_paper_project(paper_id: str) -> dict[str, Any]:
    """Create exactly one dedicated workspace per paper, including legacy papers."""
    from ..library import store
    from ..harness import workspace, vcs
    paper = store.get_paper(paper_id)
    if not paper:
        raise LookupError(f"paper not found: {paper_id}")
    with _lock:
        for path in _dir().glob("*.json"):
            try:
                p = _read(path.stem)
            except ProjectNotFoundError:
                continue
            if p.get("source_paper_id") == paper_id:
                return workspace_detail(p)
        # Do not initialize until the seed files are written.
        p = {"id": uuid.uuid4().hex[:16], "name": str(paper.get("title") or paper_id)[:120],
             "description": "", "kind": "paper", "paper_ids": [paper_id],
             "source_paper_id": paper_id, "created_at": time.time(), "memory": [], "run_ids": []}
        _write(p)
        root = workspace.root_for(p["id"])
        instructions = root / "GLOSSX.md"
        if not instructions.exists():
            instructions.write_text(f"# {p['name']}\n\nAuthors: {paper.get('authors') or []}\nYear: {paper.get('year') or ''}\nPaper ID: {paper_id}\n\nUse paper_read and evidence search. Cite exact evidence span IDs, never invent citations. Save reading notes in notes/.\n", encoding="utf-8")
        notes = root / "notes"
        notes.mkdir(exist_ok=True)
        if not (notes / "README.md").exists():
            (notes / "README.md").write_text(f"# Reading notes\n\nNotes for {p['name']}.\n", encoding="utf-8")
        vcs.ensure_repo_in_background(p["id"])
        return workspace_detail(p)


def link_paper(project_id: str, paper_id: str) -> dict[str, Any]:
    from ..library import store
    if not store.get_paper(paper_id):
        raise LookupError(f"paper not found: {paper_id}")
    with _lock:
        p = _read(project_id)
        if paper_id not in p["paper_ids"]:
            p["paper_ids"].append(paper_id)
            _write(p)
        return workspace_detail(p)


def unlink_paper(project_id: str, paper_id: str) -> dict[str, Any]:
    with _lock:
        p = _read(project_id)
        p["paper_ids"] = [i for i in p["paper_ids"] if i != paper_id]
        _write(p)
        return workspace_detail(p)


def unlink_deleted_paper(paper_id: str) -> None:
    for p in list_projects(paper_id):
        unlink_paper(p["id"], paper_id)

