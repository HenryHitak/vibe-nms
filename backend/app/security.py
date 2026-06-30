from __future__ import annotations

from dataclasses import dataclass
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
    return direct_client or "unknown"


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
