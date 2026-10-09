"""Context-aware translation.

- `translate_text`: translate an ad-hoc selection.
- Sentence-level page/range translation with a PERSISTENT per-sentence cache
  (SQLite, survives restarts). Sentences are keyed by a content hash, so a
  sentence already translated on page 3 is reused for free when you later
  translate pages 3-5. `get_translations` returns everything already translated
  (in document order) so the UI can restore state on re-entry.
"""
from __future__ import annotations

import hashlib

from ..config import load_config
from ..library import store
from ..pdf import structure
from .common import json_complete, text_complete

SYSTEM = (
    "You are Gloss's academic translator. Translate faithfully into {target}, "
    "preserving technical terminology, entity names, and inline math/LaTeX EXACTLY "
    "as written (do not translate symbols inside $...$). Keep the meaning precise; "
    "do not add or drop content. Output only the translation."
)

MAX_RANGE_PAGES = 15
_BATCH = 40  # sentences per LLM call


def _target(language: str | None) -> str:
    return language or load_config().get("target_language", "中文 (Simplified Chinese)")


def _sid(text: str) -> str:
    return hashlib.md5(" ".join(text.split()).lower().encode()).hexdigest()[:16]


def _cache_key(target: str) -> str:
    return f"senttrans:{target}"


def paper_sentences(parsed: dict) -> list[dict]:
    """Ordered sentences across the paper: {page, sid, original}."""
    out: list[dict] = []
    for page in parsed.get("pages", []):
        for b in page.get("blocks", []):
            for s in structure.split_sentences(b.get("text", "")):
                out.append({"page": page["index"], "sid": _sid(s), "original": s})
    return out


async def translate_text(
    text: str, *, language: str | None = None, provider: str | None = None, model: str | None = None
) -> str:
    tgt = _target(language)
    return await text_complete(SYSTEM.format(target=tgt), text, provider=provider, model=model)


async def translate_range(
    paper_id: str, start: int, end: int, *, language: str | None = None,
    provider: str | None = None, model: str | None = None,
) -> list[dict]:
    """Translate sentences on pages [start, end] (0-based). Reuses cached sentences."""
    parsed = store.load_parsed(paper_id)
    if not parsed:
        raise ValueError("paper not parsed")
    n = parsed["n_pages"]
    start = max(0, min(start, n - 1))
    end = max(start, min(end, n - 1))
    if end - start + 1 > MAX_RANGE_PAGES:
        raise ValueError(f"range too large — translate at most {MAX_RANGE_PAGES} pages at once")

    tgt = _target(language)
    sents = [s for s in paper_sentences(parsed) if start <= s["page"] <= end]
    cache = store.cache_get(paper_id, _cache_key(tgt)) or {}

    # collect sentences that still need translating (unique by sid)
    todo: dict[str, str] = {}
    for s in sents:
        if not cache.get(s["sid"]):
            todo.setdefault(s["sid"], s["original"])

    if todo:
        items = list(todo.items())  # [(sid, text)]
        system = (
            SYSTEM.format(target=tgt)
            + " You are given numbered sentences; translate EACH and return by index."
        )
        shape = '{"s": [{"i": 0, "t": "translation"}, ...]}'
        for i in range(0, len(items), _BATCH):
            chunk = items[i : i + _BATCH]
            numbered = "\n".join(f"[{j}] {t}" for j, (_sid_, t) in enumerate(chunk))
            result = await json_complete(system, numbered, shape, provider=provider, model=model)
            by_i = {int(x["i"]): x.get("t", "") for x in result.get("s", []) if "i" in x}
            for j, (sid, _t) in enumerate(chunk):
                cache[sid] = by_i.get(j, "")
        store.cache_set(paper_id, _cache_key(tgt), cache)

    return [
        {"page": s["page"], "original": s["original"], "translation": cache.get(s["sid"], "")}
        for s in sents
    ]


async def translate_page(
    paper_id: str, page: int, *, language: str | None = None,
    provider: str | None = None, model: str | None = None,
) -> list[dict]:
    return await translate_range(paper_id, page, page, language=language, provider=provider, model=model)


def get_translations(paper_id: str, *, language: str | None = None) -> list[dict]:
    """Return every already-translated sentence (document order) for restore-on-entry."""
    parsed = store.load_parsed(paper_id)
    if not parsed:
        return []
    tgt = _target(language)
    cache = store.cache_get(paper_id, _cache_key(tgt)) or {}
    out = []
    for s in paper_sentences(parsed):
        t = cache.get(s["sid"])
        if t:
            out.append({"page": s["page"], "original": s["original"], "translation": t})
    return out


def translated_pages(paper_id: str, *, language: str | None = None) -> list[int]:
    """Pages that have at least one translated sentence."""
    return sorted({s["page"] for s in get_translations(paper_id, language=language)})


# --------------------------------------------------------------------------
# LaTeX-source translation (arXiv): translate from the exact source text so
# nothing is missed by PDF extraction. Reuses the SAME per-sentence cache, so a
# sentence already translated from the PDF is free here (and vice-versa).
# --------------------------------------------------------------------------
import re  # noqa: E402


async def _get_tex_files(paper_id: str) -> list[dict]:
    cached = store.cache_get(paper_id, "tex")
    if cached and cached.get("files"):
        return cached["files"]
    paper = store.get_paper(paper_id)
    aid = (paper or {}).get("arxiv_id")
    if not aid:
        return []
    from ..library import importers

    res = await importers.fetch_arxiv_tex(aid)
    if res.get("files"):
        store.cache_set(paper_id, "tex", {"available": True, "main": res["main"], "files": res["files"]})
    return res.get("files", [])


def _build_document(files: list[dict]) -> str:
    """Concatenate the source, inlining \\input/\\include and stripping comments."""
    by_name: dict[str, str] = {}
    for f in files:
        by_name[f["name"]] = f["tex"]
        by_name.setdefault(f["name"].rsplit("/", 1)[-1], f["tex"])
        if f["name"].endswith(".tex"):
            by_name.setdefault(f["name"][:-4], f["tex"])
    seen: set[str] = set()

    def expand(name: str, depth: int = 0) -> str:
        tex = by_name.get(name)
        if tex is None:
            tex = by_name.get(name + ".tex")
        if tex is None or name in seen or depth > 12:
            return ""
        seen.add(name)
        tex = re.sub(r"(?<!\\)%.*", "", tex)  # drop comments
        return re.sub(r"\\(?:input|include)\{([^}]+)\}", lambda m: expand(m.group(1).strip(), depth + 1), tex)

    return expand(files[0]["name"]) if files else ""


_DROP_ENVS = ["figure", "figure*", "table", "table*", "wrapfigure", "tikzpicture",
              "algorithm", "algorithmic", "tabular", "lstlisting", "verbatim", "thebibliography"]


def _clean_body(text: str) -> str:
    """Strip LaTeX markup from a chunk (keeps inline math); no \\section handling."""
    body = text
    for env in _DROP_ENVS:
        body = re.sub(r"\\begin\{" + re.escape(env) + r"\}.*?\\end\{" + re.escape(env) + r"\}", " ", body, flags=re.S)
    body = re.sub(r"\\(?:sub){1,2}section\*?\{([^}]*)\}", r"\n\n\1.\n\n", body)  # subsections → inline headings
    body = re.sub(r"\\(?:paragraph|subparagraph)\*?\{([^}]*)\}", r"\n\n\1. ", body)
    body = re.sub(r"\\(?:label|ref|eqref|pageref|autoref|cref|Cref)\{[^}]*\}", "", body)
    body = re.sub(r"\\(?:cite|citep|citet|citealp|citeauthor|citeyear)\*?(?:\[[^\]]*\])?\{[^}]*\}", "", body)
    for _ in range(4):
        body = re.sub(r"\\(?:textbf|textit|emph|texttt|textrm|textsc|textsf|underline|mbox|text)\{([^{}]*)\}", r"\1", body)
    body = re.sub(r"\\footnote\{[^{}]*\}", "", body)
    body = re.sub(r"\\begin\{(?:itemize|enumerate|description)\}", "", body)
    body = re.sub(r"\\end\{(?:itemize|enumerate|description)\}", "", body)
    body = re.sub(r"\\item\b", "\n- ", body)
    body = re.sub(
        r"\\(?:maketitle|newpage|clearpage|noindent|centering|bigskip|medskip|smallskip|par|linebreak"
        r"|newline|tableofcontents|appendix)\b",
        " ",
        body,
    )
    body = re.sub(r"\\(?:bibliographystyle|bibliography|vspace\*?|hspace\*?)\{[^}]*\}", " ", body)
    return body


def _sentences_of(text: str) -> list[str]:
    out: list[str] = []
    for p in re.split(r"\n\s*\n", _clean_body(text)):
        t = re.sub(r"\s+", " ", p).strip()
        if len(t) >= 4 and re.search(r"[A-Za-z]{2,}", t):
            for s in structure.split_sentences(t):
                s = s.strip()
                if s:
                    out.append(s)
    return out


def _parse_sections(doc: str) -> list[dict]:
    """Split the LaTeX into [{title, sentences}] — abstract + each \\section."""
    m = re.search(r"\\begin\{document\}(.*?)\\end\{document\}", doc, re.S)
    body = m.group(1) if m else doc
    raw: list[tuple[str, str]] = []
    mabs = re.search(r"\\begin\{abstract\}(.*?)\\end\{abstract\}", body, re.S)
    if mabs:
        raw.append(("Abstract", mabs.group(1)))
        body = body[: mabs.start()] + body[mabs.end():]
    parts = re.split(r"\\section\*?\{((?:[^{}]|\{[^{}]*\})*)\}", body)
    for i in range(1, len(parts), 2):
        title = re.sub(r"\\[a-zA-Z]+\*?", "", parts[i])  # drop macros in the title
        title = re.sub(r"[{}]", "", title)
        title = re.sub(r"\s+", " ", title).strip() or f"Section {i // 2 + 1}"
        raw.append((title, parts[i + 1] if i + 1 < len(parts) else ""))
    out = []
    for title, content in raw:
        sents = _sentences_of(content)
        if sents:
            out.append({"title": title, "sentences": sents})
    return out


async def ensure_tex_sections(paper_id: str) -> list[dict]:
    cached = store.cache_get(paper_id, "texsections")
    if cached:
        return cached
    files = await _get_tex_files(paper_id)
    if not files:
        return []
    secs = _parse_sections(_build_document(files))
    if secs:
        store.cache_set(paper_id, "texsections", secs)
    return secs


def _sections_view(secs: list[dict], paper_id: str, tgt: str) -> list[dict]:
    cache = store.cache_get(paper_id, _cache_key(tgt)) or {}
    view = []
    for s in secs:
        units = [{"original": t, "translation": cache.get(_sid(t), "")} for t in s["sentences"]]
        view.append({
            "title": s["title"],
            "count": len(units),
            "done": sum(1 for u in units if u["translation"]),
            "units": units,
        })
    return view


async def tex_sections(paper_id: str, *, language: str | None = None) -> list[dict]:
    """Parsed LaTeX sections with any cached translations filled in (no LLM call)."""
    secs = await ensure_tex_sections(paper_id)
    return _sections_view(secs, paper_id, _target(language))


async def translate_tex(
    paper_id: str, *, section: int | None = None, language: str | None = None,
    provider: str | None = None, model: str | None = None,
) -> list[dict]:
    """Translate one section (by index) or all sections; returns the sections view."""
    secs = await ensure_tex_sections(paper_id)
    if not secs:
        raise ValueError("no LaTeX source for this paper")
    tgt = _target(language)
    if section is None:
        chosen = secs
    elif 0 <= section < len(secs):
        chosen = [secs[section]]
    else:
        chosen = []

    cache = store.cache_get(paper_id, _cache_key(tgt)) or {}
    todo: dict[str, str] = {}
    for s in chosen:
        for t in s["sentences"]:
            if not cache.get(_sid(t)):
                todo.setdefault(_sid(t), t)
    if todo:
        items = list(todo.items())
        system = (
            SYSTEM.format(target=tgt)
            + " You are given numbered sentences (may contain LaTeX/math); translate the prose of "
            "EACH and return by index, preserving any $...$ math verbatim."
        )
        shape = '{"s": [{"i": 0, "t": "translation"}, ...]}'
        for i in range(0, len(items), _BATCH):
            chunk = items[i : i + _BATCH]
            numbered = "\n".join(f"[{j}] {t}" for j, (_sid_, t) in enumerate(chunk))
            result = await json_complete(system, numbered, shape, provider=provider, model=model)
            by_i = {int(x["i"]): x.get("t", "") for x in result.get("s", []) if "i" in x}
            for j, (sid, _t) in enumerate(chunk):
                cache[sid] = by_i.get(j, "")
            store.cache_set(paper_id, _cache_key(tgt), cache)  # incremental save

    return _sections_view(secs, paper_id, tgt)
