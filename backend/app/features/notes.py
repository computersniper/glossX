"""Study notes: a polished, faithful structured Markdown note for a paper."""
from __future__ import annotations

from ..config import output_language
from ..library import store
from .common import text_complete, truncate_to_tokens

SYSTEM = (
    "You are Gloss, an expert researcher writing polished, faithful study "
    "notes for an academic paper. Be concrete; never hallucinate; only use the "
    "paper. Cite section/figure names when useful, and render math with $...$. "
    "Write ENTIRELY in {lang}. Use Markdown with clear ## headings in this order: "
    "一句话概述 / 背景与动机 / 要解决的问题 / 核心方法(附直觉解释) / 关键公式与符号 / "
    "实验设置 / 主要结果(含关键数字) / 创新点 / 局限与不足 / 对我的启发(可复用点) / "
    "待深入的问题. (Translate these heading names into {lang} if {lang} is not Chinese.)"
)


async def build_notes(
    paper_id: str, *, language: str | None = None, refresh: bool = False,
    provider: str | None = None, model: str | None = None,
) -> str:
    lang = language or output_language()
    cache_key = f"notes:{lang}"
    if not refresh:
        cached = store.cache_get(paper_id, cache_key)
        if cached:
            return cached

    parsed = store.load_parsed(paper_id)
    if not parsed:
        raise ValueError("paper not parsed")
    text = truncate_to_tokens(parsed["full_text"], 60000)
    system = SYSTEM.format(lang=lang)
    user = (
        f"Write structured study notes for this paper, in {lang}.\n\n"
        f"=== PAPER ===\n{text}"
    )
    md = await text_complete(system, user, provider=provider, model=model)
    store.cache_set(paper_id, cache_key, md)
    return md
