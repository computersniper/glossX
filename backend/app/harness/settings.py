"""Harness settings (``config.json`` key ``glossx_harness``).

Shape (also the contract of ``GET/PUT /api/harness/settings``)::

    {
      "permissions": {"allow": [pattern], "deny": [pattern], "ask": [pattern]},
      "hooks": {"pre_tool_use": [{"matcher", "command", "timeout"}], "post_tool_use": [...],
                "session_start": [...], "stop": [...]},
      "context_limit": 120000,
      "default_mode": "agent",
      "max_tool_rounds": 25,
      "mention_budget": 12000,
      "trusted_plugins": [plugin id],      # lets plugin hooks / MCP servers run
      "allow_private_network": false       # web_fetch to localhost / LAN hosts
    }

A permission pattern is a tool name (``fs_write``), a glob over tool names
(``mcp_*``, ``fs_write:*``) or a tool with an argument glob
(``shell_run(git status*)``, ``fs_write(notes/*)``).
"""
from __future__ import annotations

import copy
import re
from typing import Any

from .. import config

CONFIG_KEY = "glossx_harness"
MODES = ("ask", "agent", "auto", "plan")
HOOK_EVENTS = ("pre_tool_use", "post_tool_use", "session_start", "stop")
MAX_RULES = 200
_PATTERN = re.compile(r"^[A-Za-z0-9_.*:-]{1,120}(\(.{0,400}\))?$", re.S)
_PLUGIN_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{1,63}$")

DEFAULT_SETTINGS: dict[str, Any] = {
    "permissions": {"allow": [], "deny": [], "ask": []},
    "hooks": {event: [] for event in HOOK_EVENTS},
    "context_limit": 120_000,
    "default_mode": "agent",
    "max_tool_rounds": 25,
    "mention_budget": 12_000,
    "trusted_plugins": [],
    "allow_private_network": False,
}
_KEYS = set(DEFAULT_SETTINGS)


def _int(raw: Any, key: str, lo: int, hi: int) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise ValueError(f"{key} must be an integer")
    if not lo <= raw <= hi:
        raise ValueError(f"{key} must be between {lo} and {hi}")
    return raw


def normalize_pattern(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text or not _PATTERN.fullmatch(text):
        raise ValueError(f"invalid permission pattern: {raw!r}")
    return text


def _rules(raw: Any, key: str) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_RULES:
        raise ValueError(f"permissions.{key} must be a list of at most {MAX_RULES} patterns")
    return list(dict.fromkeys(normalize_pattern(p) for p in raw))


def _hooks(raw: Any) -> dict[str, list[dict[str, Any]]]:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError("hooks must be an object")
    unknown = set(raw) - set(HOOK_EVENTS)
    if unknown:
        raise ValueError(f"unknown hook event: {', '.join(sorted(unknown))}")
    out: dict[str, list[dict[str, Any]]] = {}
    for event in HOOK_EVENTS:
        items = raw.get(event) or []
        if not isinstance(items, list) or len(items) > 32:
            raise ValueError(f"hooks.{event} must be a list of at most 32 hooks")
        clean = []
        for item in items:
            if not isinstance(item, dict):
                raise ValueError(f"each hooks.{event} entry must be an object")
            command = str(item.get("command") or "").strip()
            if not command or len(command) > 2000:
                raise ValueError(f"hooks.{event} entries need a command (<= 2000 chars)")
            matcher = str(item.get("matcher") or "*").strip() or "*"
            if matcher != "*":
                matcher = normalize_pattern(matcher)
            timeout = item.get("timeout", 30)
            clean.append({
                "matcher": matcher,
                "command": command,
                "timeout": _int(timeout, f"hooks.{event}.timeout", 1, 600),
            })
        out[event] = clean
    return out


def normalize(raw: Any) -> dict[str, Any]:
    """Validate a full settings object; raise ``ValueError`` with a short message."""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError("settings must be an object")
    unknown = set(raw) - _KEYS
    if unknown:
        raise ValueError(f"unknown settings field: {', '.join(sorted(unknown))}")
    out = copy.deepcopy(DEFAULT_SETTINGS)
    perms = raw.get("permissions") or {}
    if not isinstance(perms, dict):
        raise ValueError("permissions must be an object")
    bad = set(perms) - {"allow", "deny", "ask"}
    if bad:
        raise ValueError(f"unknown permissions field: {', '.join(sorted(bad))}")
    out["permissions"] = {k: _rules(perms.get(k), k) for k in ("allow", "deny", "ask")}
    out["hooks"] = _hooks(raw.get("hooks"))
    if raw.get("context_limit") is not None:
        out["context_limit"] = _int(raw["context_limit"], "context_limit", 4_000, 2_000_000)
    if raw.get("max_tool_rounds") is not None:
        out["max_tool_rounds"] = _int(raw["max_tool_rounds"], "max_tool_rounds", 1, 200)
    if raw.get("mention_budget") is not None:
        out["mention_budget"] = _int(raw["mention_budget"], "mention_budget", 500, 200_000)
    mode = raw.get("default_mode")
    if mode is not None:
        if mode not in MODES:
            raise ValueError(f"default_mode must be one of: {', '.join(MODES)}")
        out["default_mode"] = mode
    trusted = raw.get("trusted_plugins") or []
    if not isinstance(trusted, list) or len(trusted) > 200:
        raise ValueError("trusted_plugins must be a list of plugin ids")
    trusted = list(dict.fromkeys(str(t).strip() for t in trusted))
    if any(not _PLUGIN_ID.fullmatch(t) for t in trusted):
        raise ValueError("trusted_plugins must contain plugin ids")
    out["trusted_plugins"] = trusted
    private = raw.get("allow_private_network")
    if private is not None:
        if not isinstance(private, bool):
            raise ValueError("allow_private_network must be a boolean")
        out["allow_private_network"] = private
    return out


def load() -> dict[str, Any]:
    raw = config.load_config().get(CONFIG_KEY)
    try:
        return normalize(raw)
    except ValueError:
        out = copy.deepcopy(DEFAULT_SETTINGS)
        if isinstance(raw, dict):
            for key in DEFAULT_SETTINGS:
                try:
                    out[key] = normalize({key: raw.get(key)})[key]
                except ValueError:
                    pass
        return out


def save(raw: Any) -> dict[str, Any]:
    """Merge a (possibly partial) settings object over the current one and save."""
    if not isinstance(raw, dict):
        raise ValueError("settings must be an object")
    merged = {**load(), **raw}
    clean = normalize(merged)
    # save_config deep-merges dicts; every list is replaced, every key is present
    config.save_config({CONFIG_KEY: clean})
    return load()


def add_rule(kind: str, pattern: str) -> dict[str, Any]:
    """Append ``pattern`` to ``permissions.<kind>`` (no-op if present)."""
    current = load()
    rules = list(current["permissions"].get(kind) or [])
    pattern = normalize_pattern(pattern)
    if pattern not in rules:
        rules.append(pattern)
    perms = {**current["permissions"], kind: rules[-MAX_RULES:]}
    return save({"permissions": perms})
