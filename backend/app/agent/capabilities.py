"""Capability ABI and registry for the GlossX agent.

A capability is anything the planner may call: a builtin tool wrapping an
existing Gloss feature, a sub-agent, or an external source. The planner only
ever sees the short ``card`` plus the input schema, so cards must stay terse.
Installed v1 marketplace plugins are adapted into ``plugin.<id>`` capabilities
so the agent can reuse them without any manifest change.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from ..features.retrieval import _tok

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .context import SpanStore

logger = logging.getLogger(__name__)

KINDS = {"tool", "agent", "source"}
COSTS = {"free", "llm", "network"}


@dataclass
class RunContext:
    """Per-run state handed to every capability handler."""

    run_id: str
    paper_ids: list[str]
    spans: "SpanStore"
    import_jobs: Any | None = None
    provider: str | None = None


Handler = Callable[[dict[str, Any], RunContext], Awaitable[Any]]


@dataclass
class Capability:
    name: str
    kind: str
    card: str
    input_schema: dict[str, str]
    handler: Handler
    permissions: list[str] = field(default_factory=list)
    cost: str = "free"
    source: str = "builtin"

    def describe(self) -> dict[str, Any]:
        """Public, JSON-serialisable description (no handler)."""
        return {
            "name": self.name,
            "kind": self.kind,
            "card": self.card,
            "input_schema": dict(self.input_schema),
            "source": self.source,
        }


class CapabilityRegistry:
    def __init__(self) -> None:
        self._caps: dict[str, Capability] = {}

    def register(self, cap: Capability) -> None:
        if cap.kind not in KINDS:
            raise ValueError(f"unknown capability kind: {cap.kind}")
        if cap.cost not in COSTS:
            raise ValueError(f"unknown capability cost: {cap.cost}")
        self._caps[cap.name] = cap

    def get(self, name: str) -> Capability | None:
        return self._caps.get(name)

    def all(self) -> list[Capability]:
        return list(self._caps.values())

    def cards(self, query: str | None = None, k: int = 16) -> list[dict[str, Any]]:
        """Planner-facing cards; ranked by token overlap with ``query`` if given."""
        caps = self.all()
        if query:
            q = set(_tok(query))

            def score(cap: Capability) -> int:
                words = set(_tok(f"{cap.name} {cap.card}"))
                return len(q & words)

            # stable sort keeps builtins ahead of plugins on ties
            caps = sorted(caps, key=score, reverse=True)
        out = []
        for cap in caps[:k]:
            d = cap.describe()
            d["cost"] = cap.cost
            out.append(d)
        return out


def _plugin_capability(manifest: dict[str, Any]) -> Capability:
    """Adapt a v1 plugin manifest into a v2 capability."""
    plugin_id = manifest["id"]

    async def handler(args: dict[str, Any], ctx: RunContext) -> Any:
        from ..plugins import manager
        from ..providers import registry as providers

        paper_id = str(args.get("paper_id") or (ctx.paper_ids[0] if ctx.paper_ids else ""))
        if not paper_id:
            raise ValueError("paper_id is required")
        with providers.usage_context("agent", paper_id=paper_id, plugin_id=plugin_id):
            result = await manager.run_plugin(paper_id, plugin_id, provider=ctx.provider)
        if result.get("status") != "ready":
            return {"status": result.get("status"), "reason": result.get("reason")}
        return {"status": "ready", "markdown": (result.get("markdown") or "")[:6000]}

    description = " ".join(str(manifest.get("description") or manifest.get("name") or "").split())
    words = description.split()
    card = " ".join(words[:30]) or f"Run the {plugin_id} plugin on a paper."
    permissions = manifest.get("permissions")
    return Capability(
        name=f"plugin.{plugin_id}",
        kind="agent",
        card=card,
        input_schema={"paper_id": "str: library paper id to run the plugin on"},
        handler=handler,
        permissions=[str(p) for p in permissions] if isinstance(permissions, list) else [],
        cost="llm",
        source="plugin",
    )


def build_registry() -> CapabilityRegistry:
    """Builtins plus one adapted capability per installed plugin."""
    from ..plugins import manager
    from .builtin import register_builtins

    reg = CapabilityRegistry()
    register_builtins(reg)
    try:
        manifests = manager.list_installed()
    except Exception:  # plugin dir problems must not break the agent
        logger.exception("could not list installed plugins for the agent")
        manifests = []
    for manifest in manifests:
        try:
            reg.register(_plugin_capability(manifest))
        except Exception:
            logger.exception("skipping plugin %s", manifest.get("id"))
    return reg
