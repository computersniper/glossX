"""User highlights + annotations (markup tools) and chat-history CRUD."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..library import store

router = APIRouter(prefix="/api", tags=["annotations"])


class HighlightBody(BaseModel):
    page: int
    rects: list[list[float]]
    text: str = ""
    color: str = "#ffd54f"
    note: str = ""
    category: str = ""


class HighlightPatch(BaseModel):
    color: str | None = None
    note: str | None = None
    category: str | None = None


class DrawingBody(BaseModel):
    page: int = Field(ge=0)
    points: list[list[float]] = Field(min_length=2, max_length=5000)
    color: str = Field(default="#ef6b6b", max_length=32)
    width: float = Field(default=3, ge=1, le=36)
    tool: Literal["pencil", "pen", "highlighter"] = "pen"
    note: str = Field(default="", max_length=2000)

    @field_validator("points")
    @classmethod
    def validate_points(cls, points: list[list[float]]) -> list[list[float]]:
        for point in points:
            if len(point) != 2:
                raise ValueError("each drawing point must contain x and y")
            if not all(-10000 <= float(value) <= 100000 for value in point):
                raise ValueError("drawing point is outside the supported range")
        return points


class PersonalNoteBody(BaseModel):
    content: str = Field(default="", max_length=1_000_000)


@router.get("/papers/{paper_id}/highlights")
async def list_highlights(paper_id: str, kind: str | None = None):
    if not store.get_paper(paper_id):
        raise HTTPException(404, "paper not found")
    return {"highlights": store.list_highlights(paper_id, kind=kind)}


@router.post("/papers/{paper_id}/highlights")
async def add_highlight(paper_id: str, body: HighlightBody):
    if not store.get_paper(paper_id):
        raise HTTPException(404, "paper not found")
    h = store.add_highlight(paper_id, {**body.model_dump(), "kind": "user"})
    return h


@router.patch("/highlights/{hid}")
async def patch_highlight(hid: str, body: HighlightPatch):
    h = store.update_highlight(hid, body.model_dump(exclude_none=True))
    if not h:
        raise HTTPException(404, "highlight not found")
    return h


@router.delete("/highlights/{hid}")
async def delete_highlight(hid: str):
    store.delete_highlight(hid)
    return {"ok": True}


@router.get("/papers/{paper_id}/drawings")
async def list_drawings(paper_id: str):
    if not store.get_paper(paper_id):
        raise HTTPException(404, "paper not found")
    return {"drawings": store.list_drawings(paper_id)}


@router.post("/papers/{paper_id}/drawings")
async def add_drawing(paper_id: str, body: DrawingBody):
    if not store.get_paper(paper_id):
        raise HTTPException(404, "paper not found")
    return store.add_drawing(paper_id, body.model_dump())


@router.delete("/drawings/{drawing_id}")
async def delete_drawing(drawing_id: str):
    store.delete_drawing(drawing_id)
    return {"ok": True}


@router.get("/papers/{paper_id}/personal-note")
async def get_personal_note(paper_id: str):
    if not store.get_paper(paper_id):
        raise HTTPException(404, "paper not found")
    return store.get_personal_note(paper_id)


@router.put("/papers/{paper_id}/personal-note")
async def save_personal_note(paper_id: str, body: PersonalNoteBody):
    if not store.get_paper(paper_id):
        raise HTTPException(404, "paper not found")
    return store.save_personal_note(paper_id, body.content)


# ---- chat history ----
class ChatCreate(BaseModel):
    title: str = "Chat"


class ChatPatch(BaseModel):
    title: str = Field(min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def validate_title(cls, title: str) -> str:
        normalized = " ".join(title.split())
        if not normalized:
            raise ValueError("title cannot be blank")
        return normalized


@router.get("/papers/{paper_id}/chats")
async def list_chats(paper_id: str):
    return {"chats": store.list_chats(paper_id)}


@router.post("/papers/{paper_id}/chats")
async def create_chat(paper_id: str, body: ChatCreate):
    if not store.get_paper(paper_id):
        raise HTTPException(404, "paper not found")
    return store.create_chat(paper_id, body.title)


@router.get("/chats/{chat_id}/messages")
async def chat_messages(chat_id: str):
    return {"messages": store.list_messages(chat_id)}


@router.patch("/chats/{chat_id}")
async def update_chat(chat_id: str, body: ChatPatch):
    chat = store.update_chat_title(chat_id, body.title)
    if not chat:
        raise HTTPException(404, "chat not found")
    return {
        "id": chat["id"],
        "paper_id": chat["paper_id"],
        "title": chat["title"],
        "created_at": chat["created_at"],
    }


@router.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str):
    store.delete_chat(chat_id)
    return {"ok": True}
