"""Tolerant JSON extraction from LLM text output.

LLMs (especially the claude CLI used as a plain text endpoint) tend to wrap JSON
in prose or ```json fences. This mirrors the brace-matching scan used by the
paperbench claude_proxy so we can reliably pull a single JSON value back out.
"""
from __future__ import annotations

import json
import re
from typing import Any

_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def extract_json(text: str) -> Any | None:
    """Return the first balanced JSON object/array parsed from ``text``, or None."""
    if not text:
        return None
    # 1) try a fenced block first
    m = _FENCE.search(text)
    candidates = []
    if m:
        candidates.append(m.group(1))
    candidates.append(text)

    for cand in candidates:
        val = _scan_balanced(cand)
        if val is not None:
            return val
    return None


def _scan_balanced(text: str) -> Any | None:
    start = None
    opener = None
    for i, ch in enumerate(text):
        if ch in "{[":
            start = i
            opener = ch
            break
    if start is None:
        return None
    closer = "}" if opener == "{" else "]"
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                blob = text[start : i + 1]
                try:
                    return json.loads(blob)
                except json.JSONDecodeError:
                    # keep scanning for a later balanced region
                    return _scan_balanced(text[i + 1 :])
    return None
