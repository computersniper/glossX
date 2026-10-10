"""Settings: view/update provider config (secrets masked on read)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import config
from ..providers import registry
from ..model_catalog import suggestions

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/models")
async def get_model_suggestions():
    """Current suggestions; choosing a model does not grant account access."""
    return suggestions()


class SettingsPatch(BaseModel):
    confirm_exit: bool | None = None
    provider: str | None = None
    output_language: str | None = None
    target_language: str | None = None
    providers: dict | None = None
    feature_settings: dict | None = None


@router.get("")
async def get_settings():
    return {
        "config": config.public_config(),
        # available = switched on; all = every provider, for the on/off switches
        "available_providers": registry.available(),
        "all_providers": registry.all_providers(),
        "provider_statuses": registry.provider_statuses(),
    }


@router.get("/status")
async def get_provider_statuses():
    return {"provider_statuses": registry.provider_statuses()}


@router.post("")
async def update_settings(body: SettingsPatch):
    patch: dict = {}
    if body.confirm_exit is not None:
        patch["confirm_exit"] = body.confirm_exit
    if body.provider:
        patch["provider"] = body.provider
    if body.output_language:
        patch["output_language"] = body.output_language
    if body.target_language:
        patch["target_language"] = body.target_language
    if body.providers:
        # ignore masked api_key sentinel so we don't overwrite real keys with "set"
        cleaned = {}
        for name, p in body.providers.items():
            pc = dict(p)
            if pc.get("api_key") in ("set", ""):
                pc.pop("api_key", None)
            cleaned[name] = pc
        patch["providers"] = cleaned
        for name in cleaned:
            registry.reset_status(name)
    if body.feature_settings is not None:
        patch["feature_settings"] = body.feature_settings
    _keep_an_enabled_active_provider(patch)
    config.save_config(patch)
    return {"config": config.public_config()}


def _keep_an_enabled_active_provider(patch: dict) -> None:
    """Apply provider on/off switches safely.

    At least one provider must stay on, and the active provider is moved to the
    first enabled one when the user switches the active provider off.
    """
    current = config.load_config()
    switches = {
        name: (current.get("providers", {}).get(name) or {}).get("enabled", True) is not False
        for name in registry.all_providers()
    }
    for name, values in (patch.get("providers") or {}).items():
        if name in switches and isinstance(values, dict) and "enabled" in values:
            values["enabled"] = bool(values["enabled"])
            switches[name] = values["enabled"]
    enabled = [name for name, on in switches.items() if on]
    if not enabled:
        raise HTTPException(status_code=400, detail="At least one model provider must stay on.")
    active = patch.get("provider") or current.get("provider")
    if active not in enabled:
        patch["provider"] = enabled[0]


class TestBody(BaseModel):
    provider: str | None = None


@router.post("/test")
async def test_provider(body: TestBody):
    """Check connectivity; local CLIs use their fast login-status command."""
    provider = body.provider or config.load_config().get("provider")
    if provider in registry.all_providers() and not registry.is_enabled(provider):
        return {"ok": False, "provider": provider, "disabled": True,
                "error": f"The '{provider}' model provider is turned off in Settings."}
    return await registry.test_connection(provider)
