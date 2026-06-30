from __future__ import annotations

import json
import sqlite3
from typing import Any

from .security import Actor


def _json(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, default=str)


def changed_fields(before: dict[str, Any] | None, after: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not before or not after:
        return {}
    changes: dict[str, dict[str, Any]] = {}
    for key in sorted(set(before) | set(after)):
        if before.get(key) != after.get(key):
            changes[key] = {"before": before.get(key), "after": after.get(key)}
    return changes


def write_audit_log(
    conn: sqlite3.Connection,
    actor: Actor,
    action_type: str,
    entity_type: str,
    *,
    entity_id: str | int | None = None,
    target_ip_address: str | None = None,
    before_data: dict[str, Any] | None = None,
    after_data: dict[str, Any] | None = None,
    changed: dict[str, Any] | None = None,
    result: str = "SUCCESS",
    error_message: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO audit_logs(
            actor_user_id, actor_username, actor_display_name, actor_role,
            actor_ip_address, actor_user_agent, action_type, entity_type, entity_id,
            target_ip_address, before_data_json, after_data_json, changed_fields_json,
            result, error_message, request_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            actor.user_id,
            actor.username,
            actor.display_name,
            actor.role,
            actor.ip_address,
            actor.user_agent,
            action_type,
            entity_type,
            str(entity_id) if entity_id is not None else None,
            target_ip_address,
            _json(before_data),
            _json(after_data),
            _json(changed if changed is not None else changed_fields(before_data, after_data)),
            result,
            error_message,
            actor.request_id,
        ),
    )

