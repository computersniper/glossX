"""URL admission checks. Call for *every* intercepted request/redirect, not just open.

DNS admission alone cannot prevent rebinding between this check and Chromium's
resolver. The engine must additionally enforce the network policy (and disable
WebRTC/non-HTTP protocols) before exposing browsing tools.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit


class BrowserSecurityError(ValueError):
    pass


def _public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global


async def validate_url(url: str, *, allow_private: bool = False) -> str:
    if not isinstance(url, str) or len(url) > 8192 or not url:
        raise BrowserSecurityError("Expected a nonempty URL (at most 8192 characters)")
    if any(ord(char) < 32 for char in url) or "\\" in url:
        raise BrowserSecurityError("URL contains invalid characters")
    if url == "about:blank":
        return url
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as error:
        raise BrowserSecurityError("Invalid URL") from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise BrowserSecurityError("Only http, https and about:blank are allowed")
    if parsed.username is not None or parsed.password is not None:
        raise BrowserSecurityError("Credentials in browser URLs are not allowed")
    if port == 0:
        raise BrowserSecurityError("Invalid URL port")
    if allow_private:
        return url
    host = parsed.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")) or "." not in host and ":" not in host:
        raise BrowserSecurityError("Local/private network URLs are blocked (browser.allow_private is off)")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        addresses = [str(literal)]
    else:
        try:
            results = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(
                host, port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM,
            ), timeout=5)
        except (OSError, asyncio.TimeoutError) as error:
            raise BrowserSecurityError("Could not safely resolve browser URL") from error
        addresses = [item[4][0] for item in results]
    if not addresses or any(not _public(address) for address in addresses):
        raise BrowserSecurityError("Local/private network URLs are blocked (browser.allow_private is off)")
    return url
