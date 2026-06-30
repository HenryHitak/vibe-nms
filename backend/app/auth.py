from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

from fastapi import HTTPException, Request

from .config import settings


def _b64_encode(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _b64_decode(payload: str) -> bytes:
    padding = "=" * (-len(payload) % 4)
    return base64.urlsafe_b64decode(payload + padding)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2_sha256$200000${_b64_encode(salt)}${_b64_encode(digest)}"


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    try:
        algorithm, iterations_text, salt_text, digest_text = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        salt = _b64_decode(salt_text)
        expected = _b64_decode(digest_text)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def create_token(payload: dict[str, Any]) -> str:
    now = int(time.time())
    body = {
        **payload,
        "iat": now,
        "exp": now + settings.token_ttl_minutes * 60,
    }
    encoded_body = _b64_encode(json.dumps(body, separators=(",", ":"), default=str).encode())
    signature = hmac.new(settings.auth_secret.encode(), encoded_body.encode(), hashlib.sha256).digest()
    return f"{encoded_body}.{_b64_encode(signature)}"


def decode_token(token: str) -> dict[str, Any]:
    try:
        encoded_body, encoded_signature = token.split(".", 1)
        expected_signature = hmac.new(settings.auth_secret.encode(), encoded_body.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64_decode(encoded_signature), expected_signature):
            raise ValueError("Bad token signature")
        payload = json.loads(_b64_decode(encoded_body))
        if int(payload.get("exp", 0)) < int(time.time()):
            raise ValueError("Token expired")
        return payload
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired login token") from exc


def bearer_token_from_request(request: Request) -> str:
    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Login required")
    return authorization.split(" ", 1)[1].strip()


def normalize_role(role: str | None) -> str:
    value = (role or "USER").strip().upper()
    if value == "VIEWER":
        return "USER"
    if value not in {"ADMIN", "USER"}:
        return "USER"
    return value

