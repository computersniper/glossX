"""Explain a selected passage / equation / table / term, with paper context."""
from __future__ import annotations

from ..config import output_language
from ..library import store
from .common import text_complete, truncate_to_tokens

SYSTEM = (
    "You are Gloss, an expert research colleague. Explain the selected excerpt "
    "from a paper clearly and concretely, grounded in the surrounding context. "
    "If it is an equation, explain every symbol and the intuition. If it is a table "
    "or figure caption, explain what it shows and why it matters. Define jargon. "
    "Use Markdown; render math with $...$ / $$...$$. Reply in the user's language "
    "(default: the language of the selection). Be concise but complete."
)


async def explain_selection(
    paper_id: str | None,
    selection: str,
    *,
    context: str | None = None,
    language: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> str:
    ctx_parts = []
    if paper_id:
        p = store.get_paper(paper_id)
        if p:
            ctx_parts.append(f"Paper title: {p.get('title','')}")
            if p.get("abstract"):
                ctx_parts.append(f"Abstract: {p['abstract'][:1500]}")
    if context:
        ctx_parts.append(f"Surrounding text:\n{truncate_to_tokens(context, 3000)}")
    ctx = "\n\n".join(ctx_parts)
    lang = f"\nAnswer in: {language or output_language()}."
    user = (
        f"{ctx}\n\n=== SELECTED EXCERPT TO EXPLAIN ===\n{selection}\n\n"
        f"Explain the selected excerpt.{lang}"
    )
    return await text_complete(SYSTEM, user, provider=provider, model=model)
