"""Local AI usage history and per-task token averages."""
from __future__ import annotations

from fastapi import APIRouter, Query

from ..library import store

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("")
async def get_ai_usage(
    paper_id: str | None = None,
    task_type: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    """Report local usage, grouped by task type and including recent calls.

    ``estimated_tasks`` tells clients exactly how many entries used a local
    tokenizer fallback instead of provider-supplied token accounting.
    """
    return store.ai_usage_summary(paper_id=paper_id, task_type=task_type, limit=limit)
