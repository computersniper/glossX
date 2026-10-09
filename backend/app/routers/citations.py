"""Reference / citation endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..features import citations as cit
from ..library import store
from ..providers import registry

router = APIRouter(prefix="/api", tags=["citations"])


class ResolveBody(BaseModel):
    enrich: bool = True
    provider: str | None = None
    model: str | None = None


@router.get("/papers/{paper_id}/references")
async def get_references(paper_id: str):
    if not store.get_paper(paper_id):
        raise HTTPException(404, "paper not found")
    return {"references": store.get_refs(paper_id)}


@router.post("/papers/{paper_id}/references/resolve")
async def resolve_references(paper_id: str, body: ResolveBody):
    if not store.get_paper(paper_id):
        raise HTTPException(404, "paper not found")
    with registry.usage_context("references", paper_id=paper_id):
        refs = await cit.resolve_references(
            paper_id, enrich=body.enrich, provider=body.provider, model=body.model
        )
    return {"references": refs}
