"""Project workspaces (``<DATA_DIR>/workspaces/<project_id|default>/``) and checkpoints.

Every write made through the harness (``fs_write``, ``fs_edit``, the file PUT
endpoint, and files changed by ``shell_run`` / ``python_run`` / delegates)
records a **checkpoint** with the previous and new content under
``<DATA_DIR>/checkpoints/<workspace key>/<id>.json``, outside the workspace so
tools cannot tamper with them. A checkpoint can be reverted (restores the
previous content, or deletes a file that did not exist before).
"""
from __future__ import annotations

import difflib
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from .. import config
from ..platform_support import read_utf8_text

_KEY = re.compile(r"^(default|[a-f0-9]{8,32})$")
_CP_ID = re.compile(r"^[a-f0-9]{12,32}$")
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache",
             ".pytest_cache", ".ipynb_checkpoints"}
MAX_TEXT_BYTES = 2_000_000
SNAPSHOT_FILE_BYTES = 256_000
SNAPSHOT_TOTAL_BYTES = 20_000_000
SNAPSHOT_MAX_FILES = 2_000
MAX_CHECKPOINTS = 2_000
_lock = threading.RLock()


class WorkspaceError(ValueError):
    """Invalid workspace path or content (shown to the model / API caller)."""


def key_for(project_id: str | None) -> str:
    key = project_id or "default"
    if not _KEY.fullmatch(key):
        raise WorkspaceError("invalid workspace id")
    return key


def root_for(project_id: str | None) -> Path:
    base = config.WORKSPACES_DIR.resolve()
    path = (base / key_for(project_id)).resolve()
    if path.parent != base:
        raise WorkspaceError("workspace escapes the workspaces directory")
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve(root: Path, rel: Any) -> Path:
    """Resolve ``rel`` inside ``root``; refuse traversal and symlink escapes."""
    text = str(rel if rel is not None else "").strip().replace("\\", "/")
    if "\0" in text or len(text) > 1000:
        raise WorkspaceError("invalid path")
    if text in {"", ".", "./"}:
        return root
    if text.startswith("~"):
        raise WorkspaceError("path must be inside the workspace")
    candidate: Path
    if PurePosixPath(text).is_absolute() or PureWindowsPath(text).drive:
        candidate = Path(text)
    else:
        candidate = root / Path(*PurePosixPath(text).parts)
    try:
        target = candidate.resolve()
    except (OSError, RuntimeError) as error:
        raise WorkspaceError(f"invalid path: {error}") from error
    if target != root and root not in target.parents:
        raise WorkspaceError(f"path escapes the workspace: {rel}")
    return target


def relpath(root: Path, path: Path) -> str:
    if path == root:
        return "."
    return path.relative_to(root).as_posix()


def read_text(path: Path, limit: int = MAX_TEXT_BYTES) -> str:
    if not path.is_file():
        raise WorkspaceError(f"not a file: {path.name}")
    size = path.stat().st_size
    if size > limit:
        raise WorkspaceError(f"file is too large ({size} bytes, limit {limit})")
    data = path.read_bytes()
    if b"\0" in data[:8192]:
        raise WorkspaceError("binary file")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return read_utf8_text(path)


def _maybe_text(path: Path, limit: int) -> str | None:
    try:
        if not path.is_file() or path.stat().st_size > limit:
            return None
        data = path.read_bytes()
        if b"\0" in data[:8192]:
            return None
        return data.decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def walk(root: Path, start: Path | None = None, *, max_entries: int = 5000,
         max_depth: int = 12, include_hidden: bool = True) -> tuple[list[dict[str, Any]], bool]:
    """Files and directories under ``start`` (sorted, dirs first per level)."""
    start = start or root
    out: list[dict[str, Any]] = []
    truncated = False

    def visit(directory: Path, depth: int) -> None:
        nonlocal truncated
        if depth > max_depth or truncated:
            return
        try:
            children = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            return
        for child in children:
            if len(out) >= max_entries:
                truncated = True
                return
            if child.is_dir() and child.name in SKIP_DIRS:
                continue
            if not include_hidden and child.name.startswith("."):
                continue
            try:
                resolved = child.resolve()
            except OSError:
                continue
            if resolved != root and root not in resolved.parents:
                continue  # symlink pointing outside the workspace
            try:
                st = child.stat()
            except OSError:
                continue
            is_dir = child.is_dir()
            out.append({
                "path": relpath(root, child),
                "type": "dir" if is_dir else "file",
                "size": 0 if is_dir else st.st_size,
                "mtime": st.st_mtime,
            })
            if is_dir:
                visit(child, depth + 1)

    visit(start, 0)
    return out, truncated


# -- checkpoints --------------------------------------------------------------
def _cp_dir(key: str) -> Path:
    path = config.CHECKPOINTS_DIR / key_for(key)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_json(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _stats(before: str | None, after: str | None) -> dict[str, int]:
    a = (before or "").splitlines()
    b = (after or "").splitlines()
    added = removed = 0
    for line in difflib.unified_diff(a, b, lineterm="", n=0):
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            added += 1
        elif line.startswith("-"):
            removed += 1
    return {"lines_added": added, "lines_removed": removed}


def record_checkpoint(
    key: str,
    path: str,
    before: str | None,
    after: str | None,
    *,
    source: str,
    session_id: str | None = None,
    tool_call_id: str | None = None,
) -> dict[str, Any]:
    cp = {
        "id": uuid.uuid4().hex[:16],
        "workspace": key_for(key),
        "path": path,
        "source": source,
        "session_id": session_id,
        "tool_call_id": tool_call_id,
        "created_at": time.time(),
        "existed_before": before is not None,
        "exists_after": after is not None,
        "before": before,
        "after": after,
        "status": "applied",
        **_stats(before, after),
    }
    with _lock:
        directory = _cp_dir(key)
        _write_json(directory / f"{cp['id']}.json", cp)
        files = sorted(directory.glob("*.json"), key=lambda p: p.stat().st_mtime)
        for old in files[:-MAX_CHECKPOINTS]:
            try:
                old.unlink()
            except OSError:
                pass
    return public_checkpoint(cp)


def public_checkpoint(cp: dict[str, Any], *, content: bool = False) -> dict[str, Any]:
    out = {k: v for k, v in cp.items() if k not in {"before", "after"}}
    if content:
        out["before"] = cp.get("before")
        out["after"] = cp.get("after")
        out["diff"] = "\n".join(difflib.unified_diff(
            (cp.get("before") or "").splitlines(), (cp.get("after") or "").splitlines(),
            fromfile=f"a/{cp['path']}", tofile=f"b/{cp['path']}", lineterm="",
        ))
    return out


def _load_cp(key: str, cp_id: str) -> dict[str, Any]:
    if not _CP_ID.fullmatch(str(cp_id or "")):
        raise KeyError(cp_id)
    path = _cp_dir(key) / f"{cp_id}.json"
    if not path.is_file():
        raise KeyError(cp_id)
    return json.loads(read_utf8_text(path))


def list_checkpoints(key: str, *, session_id: str | None = None, path: str | None = None,
                     limit: int = 500) -> list[dict[str, Any]]:
    out = []
    with _lock:
        for file in _cp_dir(key).glob("*.json"):
            try:
                cp = json.loads(read_utf8_text(file))
            except (OSError, ValueError):
                continue
            if session_id and cp.get("session_id") != session_id:
                continue
            if path and cp.get("path") != path:
                continue
            out.append(public_checkpoint(cp))
    out.sort(key=lambda c: c.get("created_at") or 0, reverse=True)
    return out[:limit]


def get_checkpoint(key: str, cp_id: str) -> dict[str, Any]:
    with _lock:
        return public_checkpoint(_load_cp(key, cp_id), content=True)


def revert_checkpoint(key: str, cp_id: str) -> dict[str, Any]:
    """Restore the content before checkpoint ``cp_id``; records a new checkpoint."""
    with _lock:
        cp = _load_cp(key, cp_id)
        if cp.get("status") == "reverted":
            raise ValueError("checkpoint was already reverted")
        root = root_for(None if key == "default" else key)
        target = resolve(root, cp["path"])
        current = _maybe_text(target, MAX_TEXT_BYTES * 2)
        conflict = current != cp.get("after")
        if cp.get("before") is None:
            if target.is_file():
                target.unlink()
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(cp["before"], encoding="utf-8")
        cp["status"] = "reverted"
        cp["reverted_at"] = time.time()
        _write_json(_cp_dir(key) / f"{cp['id']}.json", cp)
    revert = record_checkpoint(key, cp["path"], current, cp.get("before"), source="revert",
                               session_id=cp.get("session_id"))
    return {"checkpoint": public_checkpoint(cp), "revert_checkpoint": revert, "conflict": conflict}


# -- writes -------------------------------------------------------------------
def write_text(
    key: str,
    root: Path,
    rel: Any,
    content: str,
    *,
    source: str,
    session_id: str | None = None,
    tool_call_id: str | None = None,
) -> dict[str, Any]:
    if not isinstance(content, str):
        raise WorkspaceError("content must be a string")
    data = content.encode("utf-8")
    if len(data) > MAX_TEXT_BYTES:
        raise WorkspaceError(f"content is larger than {MAX_TEXT_BYTES} bytes")
    target = resolve(root, rel)
    if target == root or target.is_dir():
        raise WorkspaceError("path is a directory")
    before = None
    if target.exists():
        before = _maybe_text(target, MAX_TEXT_BYTES * 2)
        if before is None:
            raise WorkspaceError("refusing to overwrite a binary or very large file")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return record_checkpoint(key, relpath(root, target), before, content, source=source,
                             session_id=session_id, tool_call_id=tool_call_id)


def snapshot(root: Path) -> dict[str, Any]:
    """Text contents of small workspace files (for change detection after exec)."""
    files: dict[str, str] = {}
    stats: dict[str, tuple[int, int]] = {}
    total = 0
    for entry_root, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            path = Path(entry_root) / name
            try:
                st = path.stat()
            except OSError:
                continue
            rel = path.relative_to(root).as_posix()
            stats[rel] = (st.st_size, st.st_mtime_ns)
            if (len(files) < SNAPSHOT_MAX_FILES and st.st_size <= SNAPSHOT_FILE_BYTES
                    and total + st.st_size <= SNAPSHOT_TOTAL_BYTES):
                text = _maybe_text(path, SNAPSHOT_FILE_BYTES)
                if text is not None:
                    files[rel] = text
                    total += st.st_size
    return {"files": files, "stats": stats}


def record_changes(
    key: str,
    root: Path,
    before: dict[str, Any],
    *,
    source: str,
    session_id: str | None = None,
    tool_call_id: str | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Checkpoint files changed since ``before``; returns (checkpoints, untracked)."""
    after = snapshot(root)
    changed = sorted(
        {p for p, st in after["stats"].items() if before["stats"].get(p) != st}
        | {p for p in before["stats"] if p not in after["stats"]}
    )
    checkpoints: list[dict[str, Any]] = []
    untracked: list[str] = []
    for rel in changed[:200]:
        old = before["files"].get(rel)
        new = after["files"].get(rel)
        old_known = rel in before["files"] or rel not in before["stats"]
        new_known = rel in after["files"] or rel not in after["stats"]
        if not (old_known and new_known):
            untracked.append(rel)
            continue
        if old == new:
            continue
        checkpoints.append(record_checkpoint(key, rel, old, new, source=source,
                                             session_id=session_id, tool_call_id=tool_call_id))
    return checkpoints, untracked
