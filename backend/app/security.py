from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import ipaddress
import os
import re
import socket
import subprocess
from uuid import uuid4

from fastapi import HTTPException, Request

from .auth import normalize_role
from .config import settings


@dataclass
class Actor:
    user_id: str | None
    username: str
    display_name: str
    role: str
    ip_address: str
    user_agent: str
    request_id: str


def _source_ip_from_request(request: Request) -> str:
    direct_client = request.client.host if request.client else ""
    trusted = direct_client in settings.trusted_proxy_ips
    if trusted:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
    if _is_loopback(direct_client):
        return _server_lan_ipv4() or direct_client or "unknown"
    return direct_client or "unknown"


def _is_loopback(value: str) -> bool:
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return value.lower() == "localhost"


def _usable_lan_ipv4(value: str) -> str | None:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return None
    if address.version != 4 or address.is_loopback or address.is_link_local or address.is_multicast:
        return None
    return str(address)


@lru_cache(maxsize=1)
def _server_lan_ipv4() -> str | None:
    candidates: list[str] = []
    if os.name == "nt":
        try:
            result = subprocess.run(
                ["ipconfig"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
                timeout=5,
                check=False,
            )
            candidates.extend(re.findall(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])", result.stdout))
        except Exception:
            pass

    try:
        candidates.extend(socket.gethostbyname_ex(socket.gethostname())[2])
    except Exception:
        pass

    private_candidates: list[str] = []
    public_candidates: list[str] = []
    for candidate in candidates:
        usable = _usable_lan_ipv4(candidate)
        if not usable:
            continue
        address = ipaddress.ip_address(usable)
        if address.is_private:
            private_candidates.append(usable)
        else:
            public_candidates.append(usable)
    for group in (private_candidates, public_candidates):
        if group:
            return group[0]
    return None


def actor_from_request(request: Request) -> Actor:
    username = request.headers.get("x-username") or request.headers.get("x-user") or "local-admin"
    role = normalize_role(request.headers.get("x-role") or settings.default_role or "USER")
    return Actor(
        user_id=request.headers.get("x-user-id"),
        username=username,
        display_name=request.headers.get("x-display-name") or username,
        role=role,
        ip_address=_source_ip_from_request(request),
        user_agent=request.headers.get("user-agent", ""),
        request_id=request.headers.get("x-request-id") or str(uuid4()),
    )


def require_admin(actor: Actor) -> None:
    if actor.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin role required")
