"""Plugin marketplace, installation, and execution API."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..library import store
from ..plugins import manager
from ..providers import registry

router = APIRouter(prefix="/api/plugins", tags=["plugins"])


class ManifestInstallBody(BaseModel):
    manifest: dict


class PluginRunBody(BaseModel):
    refresh: bool = False
    provider: str | None = None
    model: str | None = None
    language: str | None = None


@router.get("")
async def list_plugins():
    return manager.marketplace_snapshot()


@router.get("/schema")
async def plugin_manifest_schema():
    return manager.PLUGIN_MANIFEST_SCHEMA


@router.get("/template")
async def plugin_manifest_template():
    return manager.PLUGIN_TEMPLATE


@router.post("/install")
async def install_manifest(body: ManifestInstallBody):
    try:
        return manager.install_manifest(body.manifest)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


@router.post("/{plugin_id}/install")
async def install_marketplace(plugin_id: str):
    try:
        return manager.install_marketplace(plugin_id)
    except ValueError as error:
        raise HTTPException(404, str(error)) from error


@router.delete("/{plugin_id}")
async def uninstall_plugin(plugin_id: str, request: Request):
    try:
        cancelled_tasks = await request.app.state.ai_tasks.cancel_plugin_tasks(
            plugin_id
        )
        manager.uninstall(plugin_id)
    except ValueError as error:
        raise HTTPException(404, str(error)) from error
    return {"ok": True, "cancelled_tasks": cancelled_tasks}


@router.post("/{plugin_id}/papers/{paper_id}/run")
async def run_plugin(plugin_id: str, paper_id: str, body: PluginRunBody):
    if not store.get_paper(paper_id):
        raise HTTPException(404, "paper not found")
    try:
        with registry.usage_context("plugin", paper_id=paper_id, plugin_id=plugin_id):
            result = await manager.run_plugin(
                paper_id,
                plugin_id,
                refresh=body.refresh,
                language=body.language,
                provider=body.provider,
                model=body.model,
            )
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    return result
