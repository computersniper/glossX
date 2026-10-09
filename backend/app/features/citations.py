"""Parse reference entries with the LLM, then best-effort enrich via Crossref/arXiv."""
from __future__ import annotations

import asyncio

import httpx  # noqa: F401  (kept for type parity in helpers)

from ..library import store
from ..net import external_client
from ..pdf import structure
from .common import json_complete

PARSE_SYSTEM = (
    "You parse academic reference list entries into structured metadata. For each "
    "numbered raw entry, extract the fields. If a field is unknown, use an empty "
    "string. Do not invent DOIs or arXiv ids."
)
PARSE_SHAPE = (
    '{"refs": [{"i": 0, "title": "", "authors": ["Last, First"], '
    '"year": "", "doi": "", "arxiv_id": ""}]}'
)


async def _ensure_raw_refs(paper_id: str) -> list[dict]:
    refs = store.get_refs(paper_id)
    if refs:
        return refs
    parsed = store.load_parsed(paper_id)
    if not parsed:
        return []
    entries = structure.split_reference_entries(structure.find_references_text(parsed))
    if entries:
        store.set_refs(paper_id, [{"idx": i, "raw": e} for i, e in enumerate(entries)])
    return store.get_refs(paper_id)


async def _crossref_enrich(client: httpx.AsyncClient, ref: dict) -> None:
    query = ref.get("title") or ref.get("raw", "")[:200]
    if not query:
        return
    try:
        r = await client.get(
            "https://api.crossref.org/works",
            params={"query.bibliographic": query, "rows": 1},
        )
        r.raise_for_status()
        items = r.json().get("message", {}).get("items", [])
        if not items:
            return
        it = items[0]
        if not ref.get("title"):
            ref["title"] = (it.get("title") or [""])[0]
        if not ref.get("doi"):
            ref["doi"] = it.get("DOI", "")
        if not ref.get("url"):
            ref["url"] = it.get("URL", "")
        if not ref.get("abstract"):
            import re as _re
            ref["abstract"] = _re.sub(r"<[^>]+>", "", it.get("abstract", "") or "")[:1200]
    except Exception:
        return


async def resolve_references(
    paper_id: str, *, enrich: bool = True, provider: str | None = None, model: str | None = None
) -> list[dict]:
    refs = await _ensure_raw_refs(paper_id)
    if not refs:
        return []

    # 1) LLM-parse raw -> structured (batched)
    numbered = "\n".join(f"[{i}] {r['raw']}" for i, r in enumerate(refs))
    try:
        parsed = await json_complete(
            PARSE_SYSTEM, numbered, PARSE_SHAPE, provider=provider, model=model
        )
        by_i = {int(x["i"]): x for x in parsed.get("refs", []) if "i" in x}
    except Exception:
        by_i = {}

    merged = []
    for i, r in enumerate(refs):
        pj = by_i.get(i, {})
        merged.append({
            "idx": r.get("idx", i),
            "raw": r["raw"],
            "title": pj.get("title", "") or r.get("title", ""),
            "authors": pj.get("authors", []) or r.get("authors", []),
            "year": pj.get("year", "") or r.get("year", ""),
            "doi": pj.get("doi", "") or r.get("doi", ""),
            "arxiv_id": pj.get("arxiv_id", "") or r.get("arxiv_id", ""),
            "url": r.get("url", ""),
            "abstract": r.get("abstract", ""),
            "resolved": 1,
        })

    # 2) best-effort external enrichment (parallel, network-tolerant)
    if enrich:
        try:
            async with external_client(timeout=20) as client:
                sem = asyncio.Semaphore(5)

                async def _one(ref):
                    async with sem:
                        await _crossref_enrich(client, ref)

                await asyncio.gather(*(_one(r) for r in merged), return_exceptions=True)
        except Exception:
            pass

    store.set_refs(paper_id, merged)
    return store.get_refs(paper_id)
