"""Shared HTTP client for EXTERNAL calls (arXiv / Crossref / Semantic Scholar).

This box reaches the internet through an HTTP proxy (HTTPS_PROXY), while ALL_PROXY
is a socks5h URL that httpx can't use without the `socksio` extra. We therefore
select the HTTP proxy explicitly and disable env auto-detection, so external calls
work and we never accidentally route localhost through a proxy.
"""
from __future__ import annotations

import os

import httpx

UA = {"User-Agent": "Gloss-Local/1.0 (research paper reader)"}


def _http_proxy() -> str | None:
    for key in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        v = os.environ.get(key)
        if v and v.startswith("http"):  # skip socks; httpx needs socksio for those
            return v
    return None


def external_client(timeout: float = 30.0, **kwargs) -> httpx.AsyncClient:
    headers = {**UA, **kwargs.pop("headers", {})}
    return httpx.AsyncClient(
        timeout=timeout,
        headers=headers,
        follow_redirects=True,
        trust_env=False,
        proxy=_http_proxy(),
        **kwargs,
    )
