"""Scholar deep search endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..search import scholar

router = APIRouter(prefix="/api/scholar", tags=["scholar"])


@router.get("/search")
async def search(q: str, k: int = 10):
    if not q.strip():
        raise HTTPException(400, "empty query")
    return {"results": await scholar.search(q, k)}


@router.get("/recommend")
async def recommend(paper_id: str, k: int = 10):
    try:
        return {"results": await scholar.recommend(paper_id, k)}
    except ValueError as e:
        raise HTTPException(404, str(e))
