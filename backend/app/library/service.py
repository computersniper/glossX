"""Glue: turn PDF bytes + metadata into a stored, parsed paper."""
from __future__ import annotations

import os
import re
import tempfile

from . import store
from ..pdf import ingest as pdf_ingest
from ..pdf import structure
from ..platform_support import run_in_process_with_timeout


class ImportCancelledError(RuntimeError):
    """Raised when persistence is cancelled before the paper is published."""


def _raise_if_cancelled(cancel_event) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise ImportCancelledError("paper import was cancelled")


def _parse_pdf_path(pdf_path: str) -> dict:
    parsed = pdf_ingest.ingest_pdf(pdf_path)
    parsed["sections"] = structure.detect_sections(parsed)
    return parsed


def _parse_pdf_bytes(pdf_bytes: bytes) -> dict:
    fd, temp_path = tempfile.mkstemp(prefix="gloss-import-", suffix=".pdf")
    try:
        with os.fdopen(fd, "wb") as temp_file:
            temp_file.write(pdf_bytes)
        return _parse_pdf_path(temp_path)
    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass


def parse_pdf_bytes_with_timeout(
    pdf_bytes: bytes, timeout: float, cancel_event=None
) -> dict:
    """Parse an imported PDF outside the server process so timeout is enforceable."""
    # The parent owns the temporary file. A force-terminated Windows worker
    # cannot run a child-side finally block, so child-owned files would leak.
    fd, temp_path = tempfile.mkstemp(prefix="gloss-import-", suffix=".pdf")
    try:
        with os.fdopen(fd, "wb") as temp_file:
            temp_file.write(pdf_bytes)
        return run_in_process_with_timeout(
            _parse_pdf_path,
            (temp_path,),
            timeout,
            cancel_event=cancel_event,
        )
    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass


def create_from_pdf_bytes(
    pdf_bytes: bytes,
    meta: dict,
    parsed: dict | None = None,
    cancel_event=None,
) -> dict:
    """Persist a PDF, parse it, detect structure, seed references. Returns paper dict."""
    if pdf_bytes[:5] != b"%PDF-":
        raise ValueError("Not a PDF file")

    _raise_if_cancelled(cancel_event)
    pid = store.create_paper({**meta, "n_pages": 0})
    try:
        _raise_if_cancelled(cancel_event)
        store.pdf_path(pid).write_bytes(pdf_bytes)
        _raise_if_cancelled(cancel_event)

        if parsed is None:
            parsed = pdf_ingest.ingest_pdf(store.pdf_path(pid))
            parsed["sections"] = structure.detect_sections(parsed)
        _raise_if_cancelled(cancel_event)
        store.save_parsed(pid, parsed)
        _raise_if_cancelled(cancel_event)

        # backfill title / authors if the importer didn't provide them
        fields: dict = {"n_pages": parsed["n_pages"]}
        if not meta.get("title"):
            fields["title"] = parsed["meta"].get("title") or _guess_title(parsed) or "Untitled"
        if not meta.get("authors"):
            author_str = parsed["meta"].get("author", "")
            if author_str:
                parts = re.split(r"\s*(?:,|;| and )\s*", author_str)
                fields["authors"] = [a.strip() for a in parts if a.strip()]
        store.update_paper(pid, fields)
        # keep n_pages in the papers row
        with store._conn() as con:  # noqa: SLF001 - internal helper reuse
            con.execute("UPDATE papers SET n_pages=? WHERE id=?", (parsed["n_pages"], pid))
        _raise_if_cancelled(cancel_event)

        # seed raw reference entries (resolution happens on demand)
        ref_text = structure.find_references_text(parsed)
        entries = structure.split_reference_entries(ref_text)
        if entries:
            store.set_refs(pid, [{"idx": i, "raw": e} for i, e in enumerate(entries)])

        _raise_if_cancelled(cancel_event)
        return store.get_paper(pid)
    except Exception:
        # A failed parse/write must not leave a zero-page row or orphaned PDF.
        try:
            store.delete_paper(pid)
        except Exception:
            pass
        raise


def _guess_title(parsed: dict) -> str:
    """Heuristic: the largest text block near the top of page 1."""
    pages = parsed.get("pages") or []
    if not pages:
        return ""
    blocks = pages[0]["blocks"]
    top = [b for b in blocks if b["bbox"][1] < pages[0]["height"] * 0.4]
    if not top:
        return ""
    best = max(top, key=lambda b: b["size"])
    line = best["text"].splitlines()[0] if best["text"] else ""
    return line.strip()[:200]
