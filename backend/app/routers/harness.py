"""GlossX harness API: tools, commands, subagent types, settings, mentions and
project workspaces with checkpoints (docs/glossx-harness.md section 7)."""
from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..agent import connections as conn_mod
from ..agent import projects
from ..harness import extensions, workspace
from ..harness import settings as settings_mod
from ..harness.tools import build_table, harness_registry
from ..library import store

router = APIRouter(prefix="/api/harness", tags=["harness"])
workspace_router = APIRouter(prefix="/api/workspace", tags=["workspace"])


# -- helpers ----------------------------------------------------------------------------
def _project(project_id: str | None) -> str | None:
    """``default`` / empty -> the default workspace; else an existing project id."""
    if project_id in (None, "", "default"):
        return None
    if not projects.exists(project_id):
        raise HTTPException(404, "project not found")
    return project_id


def _root(project_id: str | None):
    try:
        return workspace.root_for(_project(project_id))
    except workspace.WorkspaceError as error:
        raise HTTPException(400, str(error)) from error


def _session_scope(request: Request, session_id: str | None, project_id: str | None,
                   mode: str | None) -> tuple[str | None, str | None]:
    """Resolve ``(project_id, mode)`` from an optional session."""
    if session_id:
        manager = getattr(request.app.state, "sessions", None)
        try:
            session = manager.get(session_id) if manager else None
        except LookupError as error:
            raise HTTPException(404, "session not found") from error
        if session:
            return session.get("project_id"), mode or session.get("mode")
    return _project(project_id), mode


# -- tools / commands / agents ------------------------------------------------------------
@router.get("/tools")
async def list_tools(request: Request, mode: Literal["ask", "agent", "auto", "plan"] | None = None,
                     project_id: str | None = None, session_id: str | None = None):
    """Every harness tool with its permission state in ``mode`` (default: the
    session's mode, else ``default_mode``)."""
    project, mode = _session_scope(request, session_id, project_id, mode)
    settings = settings_mod.load()
    mode = mode or settings["default_mode"]
    registry = await harness_registry(settings)
    table = build_table(registry, mode=mode, has_project=bool(project), include_unavailable=True)
    auto = conn_mod.auto_approve()
    return {"mode": mode, "tools": [spec.describe(mode, settings, auto) for spec in table.values()]}


@router.get("/commands")
async def list_commands(request: Request, project_id: str | None = None,
                        session_id: str | None = None):
    project, _ = _session_scope(request, session_id, project_id, None)
    root = workspace.root_for(project)
    return [extensions.public_command(c) for c in extensions.list_commands(root)]


@router.get("/agents")
async def list_agents(request: Request, project_id: str | None = None,
                      session_id: str | None = None):
    project, _ = _session_scope(request, session_id, project_id, None)
    root = workspace.root_for(project)
    return [extensions.public_agent(a) for a in extensions.list_agents(root)]


# -- settings -----------------------------------------------------------------------------
@router.get("/settings")
async def get_settings():
    return settings_mod.load()


@router.put("/settings")
async def put_settings(body: dict[str, Any]):
    """Partial update: keys that are present replace the stored value."""
    try:
        unknown = set(body) - set(settings_mod.DEFAULT_SETTINGS)
        if unknown:
            raise ValueError(f"unknown settings field: {', '.join(sorted(unknown))}")
        return settings_mod.save(body)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


# -- mentions -----------------------------------------------------------------------------
@router.get("/mentions")
async def mentions(request: Request, q: str = "", project_id: str | None = None,
                   session_id: str | None = None, limit: int = 8):
    """Papers, workspace files and runs matching ``q`` (for the ``@`` picker)."""
    if len(q) > 200:
        raise HTTPException(400, "q is too long")
    limit = max(1, min(30, limit))
    project, _ = _session_scope(request, session_id, project_id, None)
    needle = q.strip().lower()
    papers = []
    for paper in store.list_papers():
        hay = " ".join([str(paper.get("title") or ""), " ".join(paper.get("authors") or []),
                        str(paper.get("id") or "")]).lower()
        if needle and needle not in hay:
            continue
        authors = list(paper.get("authors") or [])
        detail = ", ".join(authors[:2]) + (" et al." if len(authors) > 2 else "")
        if paper.get("year"):
            detail = f"{detail} · {paper['year']}".strip(" ·")
        papers.append({"kind": "paper", "ref": paper["id"], "label": paper.get("title") or paper["id"],
                       "detail": detail, "insert": f"@paper:{paper['id']}"})
        if len(papers) >= limit:
            break
    root = workspace.root_for(project)
    entries, _ = await asyncio.to_thread(workspace.walk, root, None, max_entries=4000,
                                         include_hidden=False)
    files = []
    for entry in entries:
        if entry["type"] != "file" or (needle and needle not in entry["path"].lower()):
            continue
        files.append({"kind": "file", "ref": entry["path"], "label": entry["path"].rsplit("/", 1)[-1],
                      "detail": entry["path"], "insert": f"@file:{entry['path']}",
                      "mtime": entry["mtime"]})
    files.sort(key=lambda f: f["mtime"], reverse=True)
    files = files[:limit]
    runs = []
    agent_runs = getattr(request.app.state, "agent_runs", None)
    for run in (agent_runs.list() if agent_runs else []):
        if project and run.get("project_id") != project:
            continue
        if needle and needle not in str(run.get("goal") or "").lower() and needle not in run["id"]:
            continue
        runs.append({"kind": "run", "ref": run["id"], "label": str(run.get("goal") or run["id"])[:120],
                     "detail": str(run.get("status") or ""), "insert": f"@run:{run['id']}"})
        if len(runs) >= limit:
            break
    return {"query": q, "papers": papers, "files": files, "runs": runs,
            "items": papers + files + runs}


# -- workspace ----------------------------------------------------------------------------
class FileBody(BaseModel):
    content: str = Field(max_length=4_000_000)


def _ws_error(error: Exception) -> HTTPException:
    text = str(error)
    if "not a file" in text or "not a directory" in text:
        return HTTPException(404, text)
    if "too large" in text or "larger than" in text:
        return HTTPException(413, text)
    return HTTPException(400, text)


@workspace_router.get("/{project_id}/tree")
async def workspace_tree(project_id: str, path: str = "", depth: int = 12, hidden: bool = True):
    root = _root(project_id)
    try:
        start = workspace.resolve(root, path or ".")
    except workspace.WorkspaceError as error:
        raise _ws_error(error) from error
    if not start.is_dir():
        raise HTTPException(404, "not a directory")
    entries, truncated = await asyncio.to_thread(
        workspace.walk, root, start, max_entries=5000, max_depth=max(0, min(32, depth)),
        include_hidden=hidden)
    return {"project_id": project_id, "key": workspace.key_for(_project(project_id)),
            "root": str(root), "path": workspace.relpath(root, start), "entries": entries,
            "truncated": truncated}


@workspace_router.get("/{project_id}/file")
async def read_workspace_file(project_id: str, path: str):
    root = _root(project_id)
    try:
        target = workspace.resolve(root, path)
        if not target.is_file():
            raise HTTPException(404, "file not found")
        content = workspace.read_text(target)
    except workspace.WorkspaceError as error:
        raise _ws_error(error) from error
    stat = target.stat()
    return {"path": workspace.relpath(root, target), "content": content, "size": stat.st_size,
            "mtime": stat.st_mtime}


@workspace_router.put("/{project_id}/file")
async def write_workspace_file(project_id: str, path: str, body: FileBody):
    """Create or overwrite a text file; records a checkpoint (source ``user``)."""
    root = _root(project_id)
    key = workspace.key_for(_project(project_id))
    try:
        checkpoint = workspace.write_text(key, root, path, body.content, source="user")
        target = workspace.resolve(root, path)
    except workspace.WorkspaceError as error:
        raise _ws_error(error) from error
    stat = target.stat()
    return {"path": checkpoint["path"], "size": stat.st_size, "mtime": stat.st_mtime,
            "checkpoint": checkpoint}


@workspace_router.get("/{project_id}/checkpoints")
async def list_checkpoints(project_id: str, session_id: str | None = None,
                           path: str | None = None, limit: int = 200):
    _root(project_id)
    key = workspace.key_for(_project(project_id))
    return workspace.list_checkpoints(key, session_id=session_id or None, path=path or None,
                                      limit=max(1, min(2000, limit)))


@workspace_router.get("/{project_id}/checkpoints/{checkpoint_id}")
async def get_checkpoint(project_id: str, checkpoint_id: str):
    """One checkpoint with ``before`` / ``after`` content and a unified ``diff``."""
    _root(project_id)
    key = workspace.key_for(_project(project_id))
    try:
        return workspace.get_checkpoint(key, checkpoint_id)
    except KeyError as error:
        raise HTTPException(404, "checkpoint not found") from error


@workspace_router.post("/{project_id}/checkpoints/{checkpoint_id}/revert")
async def revert_checkpoint(project_id: str, checkpoint_id: str):
    _root(project_id)
    key = workspace.key_for(_project(project_id))
    try:
        return workspace.revert_checkpoint(key, checkpoint_id)
    except KeyError as error:
        raise HTTPException(404, "checkpoint not found") from error
    except workspace.WorkspaceError as error:
        raise _ws_error(error) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
