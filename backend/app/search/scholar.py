"""Scholar deep search: related-paper recommendations + search (Semantic Scholar / arXiv)."""
from __future__ import annotations

import re

from ..library import store
from ..net import external_client

S2_SEARCH = "https://api.semanticscholar.org/graph/v1/paper/search"
S2_FIELDS = "title,abstract,year,authors,url,externalIds,citationCount"


async def search_semantic_scholar(query: str, k: int = 10) -> list[dict]:
    async with external_client(timeout=25) as client:
        r = await client.get(
            S2_SEARCH, params={"query": query, "limit": k, "fields": S2_FIELDS}
        )
        r.raise_for_status()
        data = r.json().get("data", [])
    out = []
    for it in data:
        ext = it.get("externalIds") or {}
        out.append({
            "title": it.get("title", ""),
            "abstract": (it.get("abstract") or "")[:600],
            "year": it.get("year"),
            "authors": [a.get("name", "") for a in it.get("authors", [])][:8],
            "url": it.get("url", ""),
            "arxiv_id": ext.get("ArXiv", ""),
            "doi": ext.get("DOI", ""),
            "citations": it.get("citationCount"),
            "source": "semanticscholar",
        })
    return out


async def search_arxiv(query: str, k: int = 10) -> list[dict]:
    import feedparser

    async with external_client(timeout=25) as client:
        r = await client.get(
            "http://export.arxiv.org/api/query",
            params={"search_query": f"all:{query}", "max_results": k},
        )
        feed = feedparser.parse(r.text)
    out = []
    for e in feed.entries:
        aid = ""
        m = re.search(r"(\d{4}\.\d{4,5})", e.get("id", ""))
        if m:
            aid = m.group(1)
        out.append({
            "title": re.sub(r"\s+", " ", e.get("title", "")).strip(),
            "abstract": re.sub(r"\s+", " ", e.get("summary", "")).strip()[:600],
            "year": e.get("published", "")[:4],
            "authors": [a.get("name", "") for a in e.get("authors", [])][:8],
            "url": e.get("id", ""),
            "arxiv_id": aid,
            "doi": "",
            "source": "arxiv",
        })
    return out


async def search(query: str, k: int = 10) -> list[dict]:
    """Prefer Semantic Scholar; fall back to arXiv on failure."""
    try:
        res = await search_semantic_scholar(query, k)
        if res:
            return res
    except Exception:
        pass
    try:
        return await search_arxiv(query, k)
    except Exception:
        return []


async def recommend(paper_id: str, k: int = 10) -> list[dict]:
    """Recommend related papers using this paper's title + abstract."""
    p = store.get_paper(paper_id)
    if not p:
        raise ValueError("paper not found")
    query = p.get("title", "")
    if not query:
        parsed = store.load_parsed(paper_id)
        query = (parsed["full_text"][:200] if parsed else "")
    results = await search(query, k + 3)
    title_l = (p.get("title") or "").lower().strip()
    filtered = [r for r in results if r.get("title", "").lower().strip() != title_l]
    return filtered[:k]
