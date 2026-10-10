"""Model suggestions, not an account entitlement or validation allow-list.

Source: https://learn.chatgpt.com/docs/models (checked 2026-10-10).
Custom providers and saved model ids remain valid even if not listed here.
"""
from __future__ import annotations

_EFFORTS = ["low", "medium", "high", "xhigh", "max"]
_CURRENT = [
    ("gpt-6.1-sol", "GPT-6.1 Sol"),
    ("gpt-6-astra", "GPT-6 Astra"),
    ("gpt-6-luna", "GPT-6 Luna"),
    ("gpt-6-sol", "GPT-6 Sol"),
]
_COMPATIBLE = [
    ("gpt-5.6-sol", "GPT-5.6 Sol"),
    ("gpt-5.6-terra", "GPT-5.6 Terra"),
    ("gpt-5.6-luna", "GPT-5.6 Luna"),
]


def suggestions() -> dict:
    entries = [
        {"id": model_id, "label": label, "reasoning_efforts": list(_EFFORTS)}
        for model_id, label in _CURRENT + _COMPATIBLE
    ]
    return {
        "models": {"local_codex": entries, "openai": entries},
        "source": "https://learn.chatgpt.com/docs/models",
        "checked_on": "2026-10-10",
        "availability": "depends_on_account_and_endpoint",
        "custom_models_allowed": True,
    }
