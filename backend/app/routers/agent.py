"""GlossX agent API: capabilities, runs, live run events (SSE)."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from ..agent.capabilities import build_registry
from ..agent.runs import RunNotFoundError

router = APIRouter(prefix="/api/agent", tags=["agent"])


class RunCreateBody(BaseModel):
    goal: str = Field(min_length=1, max_length=4000)
    paper_ids: list[str] = Field(default_factory=list, max_length=50)
    max_rounds: int = Field(default=2, ge=1, le=3)
    provider: str | None = None

    @field_validator("goal")
    @classmethod
    def _goal_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("goal must not be empty")
        return value.strip()


def _manager(request: Request):
    return request.app.state.agent_runs


@router.get("/capabilities")
async def list_capabilities():
    return [cap.describe() for cap in build_registry().all()]


@router.post("/runs")
async def create_run(body: RunCreateBody, request: Request):
    try:
        return _manager(request).start(
            body.goal, body.paper_ids, max_rounds=body.max_rounds, provider=body.provider
        )
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error


@router.get("/runs")
async def list_runs(request: Request):
    return _manager(request).list()


@router.get("/runs/{run_id}")
async def get_run(run_id: str, request: Request):
    try:
        return _manager(request).get(run_id)
    except RunNotFoundError as error:
        raise HTTPException(404, "run not found") from error


@router.get("/runs/{run_id}/events")
async def run_events(run_id: str, request: Request):
    manager = _manager(request)
    try:
        manager.get(run_id)
    except RunNotFoundError as error:
        raise HTTPException(404, "run not found") from error

    async def stream():
        async for event in manager.subscribe(run_id):
            yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
        end = {"phase": "end", "status": manager.status_of(run_id)}
        yield f"data: {json.dumps(end)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/runs/{run_id}")
async def cancel_run(run_id: str, request: Request):
    try:
        return await _manager(request).cancel(run_id)
    except RunNotFoundError as error:
        raise HTTPException(404, "run not found") from error
