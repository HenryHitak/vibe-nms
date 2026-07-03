from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import hmac
import json
import os
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .alert_settings import (
    AP_ALERT_SETTING_BY_TYPE,
    NETWORK_ALERT_SETTING_BY_TYPE,
    bool_value,
    disabled_alert_types,
    notification_mute_key,
    notification_muted,
)
from .ap_client_discovery_worker import AP_CLIENT_ALERT_TYPES, ap_client_discovery_loop, run_ap_client_discovery_cycle
from .audit import changed_fields, write_audit_log
from .auth import bearer_token_from_request, create_token, decode_token, hash_password, normalize_role, verify_password
from .config import settings
from .db import DEVICE_COLUMNS, connect, init_db, mssql_connection_string, row_to_dict, rows_to_dicts, transaction
from .import_export import (
    access_points_rows,
    audit_logs_workbook,
    build_template_workbook,
    commit_import_job,
    create_import_job,
    devices_rows,
    devices_workbook,
    export_job,
    full_backup_zip,
    migration_payload,
    plants_rows,
    simple_rows_workbook,
    validate_import_rows,
    workbook_from_rows,
)
from .monitor import (
    MONITORING_INTERVAL_OPTIONS,
    collector_loop,
    get_monitoring_interval_seconds,
    normalize_monitoring_interval_seconds,
    run_monitoring_cycle,
)
from .schemas import (
    APClientRegistrationPatch,
    APClientRegistrationPayload,
    BulkSettingsPayload,
    DatabaseConfigPayload,
    DevicePatch,
    DevicePayload,
    DisplayDashboardRequest,
    ImportCommitRequest,
    LoginRequest,
    NotificationMutePayload,
    PasswordResetPayload,
    SelectedDevicesExportRequest,
    TrafficConfigPayload,
    TrafficObservationIngestRequest,
    UserCreatePayload,
    UserUpdatePayload,
)
from .security import Actor, actor_from_request, require_admin
from .traffic_monitoring_worker import traffic_collection_loop, run_traffic_collection_cycle
from .timezone import local_datetime_filter_to_utc_storage, utc_storage_to_local_label
from .validation import (
    VALID_CRITICALITY,
    VALID_DEVICE_TYPES,
    normalize_upper,
    trim_strings,
    trim_text,
    validate_ip,
    validate_mac,
)


collector_stop_event: asyncio.Event | None = None
collector_task: asyncio.Task | None = None
ap_discovery_stop_event: asyncio.Event | None = None
ap_discovery_task: asyncio.Task | None = None
traffic_stop_event: asyncio.Event | None = None
traffic_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global collector_stop_event, collector_task, ap_discovery_stop_event, ap_discovery_task, traffic_stop_event, traffic_task
    init_db()
    if settings.collector_enabled:
        collector_stop_event = asyncio.Event()
        collector_task = asyncio.create_task(collector_loop(collector_stop_event))
    if settings.ap_client_discovery_enabled:
        ap_discovery_stop_event = asyncio.Event()
        ap_discovery_task = asyncio.create_task(ap_client_discovery_loop(ap_discovery_stop_event))
    if settings.traffic_collection_enabled:
        traffic_stop_event = asyncio.Event()
        traffic_task = asyncio.create_task(traffic_collection_loop(traffic_stop_event))
    yield
    if collector_stop_event:
        collector_stop_event.set()
    if ap_discovery_stop_event:
        ap_discovery_stop_event.set()
    if traffic_stop_event:
        traffic_stop_event.set()
    if collector_task:
        await collector_task
    if ap_discovery_task:
        await ap_discovery_task
    if traffic_task:
        await traffic_task


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_actor(request: Request) -> Actor:
    actor = getattr(request.state, "actor", None)
    if actor:
        return actor
    return actor_from_request(request)


def _public_user(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row.get("id"),
        "username": row.get("username"),
        "display_name": row.get("display_name"),
        "email": row.get("email"),
        "role": normalize_role(row.get("role")),
        "is_active": bool(row.get("is_active", 1)),
        "last_login_at": row.get("last_login_at"),
        "last_login_ip": row.get("last_login_ip"),
        "created_by": row.get("created_by"),
        "created_at": row.get("created_at"),
        "updated_by": row.get("updated_by"),
        "updated_at": row.get("updated_at"),
    }


@app.middleware("http")
async def require_login_middleware(request: Request, call_next):
    path = request.url.path
    if (
        request.method == "OPTIONS"
        or path == "/health"
        or path == "/api/auth/login"
        or path.startswith("/api/display/")
        or not path.startswith("/api")
    ):
        return await call_next(request)
    try:
        token = bearer_token_from_request(request)
        payload = decode_token(token)
        with transaction() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (payload.get("sub"),)).fetchone()
            user = row_to_dict(row)
        if not user or not user.get("is_active"):
            return JSONResponse(status_code=401, content={"detail": "Login required"})
        request.state.actor = Actor(
            user_id=str(user["id"]),
            username=user["username"],
            display_name=user.get("display_name") or user["username"],
            role=normalize_role(user.get("role")),
            ip_address=actor_from_request(request).ip_address,
            user_agent=request.headers.get("user-agent", ""),
            request_id=request.headers.get("x-request-id") or actor_from_request(request).request_id,
        )
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return await call_next(request)


def _stream_bytes(payload: bytes, filename: str, media_type: str) -> StreamingResponse:
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(iter([payload]), media_type=media_type, headers=headers)


def _audit_failure(actor: Actor, action_type: str, entity_type: str, error: Exception, target_ip: str | None = None) -> None:
    with transaction() as conn:
        write_audit_log(
            conn,
            actor,
            action_type,
            entity_type,
            target_ip_address=target_ip,
            result="FAILED",
            error_message=str(error),
        )


def _validate_device_data(data: dict[str, Any], partial: bool = False) -> dict[str, Any]:
    data = trim_strings(data, empty_to_none=True)
    if data.get("plant_name") and not data.get("plant_code"):
        data["plant_code"] = data["plant_name"]
    if data.get("line_name") and not data.get("line_code"):
        data["line_code"] = data["line_name"]
    if data.get("plant_code") and not data.get("plant_name"):
        data["plant_name"] = data["plant_code"]
    if data.get("line_code") and not data.get("line_name"):
        data["line_name"] = data["line_code"]
    required = ["plant_name", "line_name", "device_name", "device_type", "ip_address"]
    if not partial:
        for field in required:
            if not data.get(field):
                raise HTTPException(status_code=422, detail=f"{field} is required")
    if "ip_address" in data and data.get("ip_address") and not validate_ip(data["ip_address"]):
        raise HTTPException(status_code=422, detail="Invalid IP address")
    if "connected_ap_ip" in data and data.get("connected_ap_ip") and not validate_ip(data["connected_ap_ip"]):
        raise HTTPException(status_code=422, detail="Invalid connected AP IP")
    if "mac_address" in data and data.get("mac_address"):
        mac_address = data["mac_address"].upper().replace("-", ":")
        if not validate_mac(mac_address):
            raise HTTPException(status_code=422, detail="Invalid MAC address")
        data["mac_address"] = mac_address
    if "device_type" in data and data.get("device_type"):
        data["device_type"] = normalize_upper(data["device_type"])
        if data["device_type"] not in VALID_DEVICE_TYPES:
            raise HTTPException(status_code=422, detail="Invalid device type")
    if "criticality" in data and data.get("criticality"):
        data["criticality"] = normalize_upper(data["criticality"])
        if data["criticality"] not in VALID_CRITICALITY:
            raise HTTPException(status_code=422, detail="Invalid criticality")
    if "monitoring_enabled" in data:
        data["monitoring_enabled"] = 1 if data["monitoring_enabled"] else 0
    return data


def _get_device(conn: sqlite3.Connection, device_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM network_devices WHERE id = ?", (device_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Device not found")
    return row_to_dict(row) or {}


SELECTED_DEVICE_EXPORT_COLUMNS = [
    ("Status", "status"),
    ("Device", "device_name"),
    ("Device Type", "device_type"),
    ("IP Address", "ip_address"),
    ("MAC Address", "mac_address"),
    ("Hostname", "hostname"),
    ("Plant", "plant_display"),
    ("Line", "line_display"),
    ("Location", "location_path"),
    ("Detailed Location", "detailed_location"),
    ("Connected AP Name", "connected_ap_name"),
    ("Connected AP IP", "connected_ap_ip"),
    ("AP Vendor", "ap_vendor"),
    ("AP Controller Type", "ap_controller_type"),
    ("AP Controller ID", "ap_controller_id"),
    ("Switch Name", "switch_name"),
    ("Switch Port", "switch_port"),
    ("VLAN", "vlan"),
    ("Owner Department", "owner_department"),
    ("Criticality", "criticality"),
    ("Monitoring Enabled", "monitoring_enabled_text"),
    ("Latest Check Method", "latest_check_method"),
    ("Latency Ms", "latency_ms"),
    ("Packet Loss Percent", "packet_loss_percent"),
    ("Consecutive Failure Count", "consecutive_failure_count"),
    ("Latest Checked At Mexico Tijuana", "latest_checked_at_local"),
    ("Active Alert Count", "active_alert_count"),
    ("Latest Monitoring Reason", "latest_monitoring_reason"),
    ("Notes", "notes"),
    ("Created By", "created_by"),
    ("Created At Mexico Tijuana", "created_at_local"),
    ("Updated By", "updated_by"),
    ("Updated At Mexico Tijuana", "updated_at_local"),
    ("Deleted", "is_deleted_text"),
]


def _selected_device_export_rows(conn: sqlite3.Connection, requested_ids: list[int]) -> list[dict[str, Any]]:
    device_ids: list[int] = []
    seen: set[int] = set()
    for raw_id in requested_ids:
        device_id = int(raw_id)
        if device_id <= 0 or device_id in seen:
            continue
        device_ids.append(device_id)
        seen.add(device_id)
    if not device_ids:
        raise HTTPException(status_code=422, detail="Select at least one valid device")

    placeholders = ", ".join(["?"] * len(device_ids))
    rows = rows_to_dicts(
        conn.execute(
            f"""
            SELECT d.*,
                   (SELECT COUNT(*) FROM alerts a WHERE a.device_id = d.id AND a.status = 'ACTIVE') AS active_alert_count,
                   latest.check_method AS latest_check_method,
                   latest.error_message AS latest_monitoring_reason,
                   latest.checked_at AS latest_checked_at
            FROM network_devices d
            LEFT JOIN (
                SELECT device_id, check_method, error_message, checked_at
                FROM (
                    SELECT device_id, check_method, error_message, checked_at,
                           ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY checked_at DESC, id DESC) AS rn
                    FROM device_metrics
                ) ranked_metrics
                WHERE rn = 1
            ) latest ON latest.device_id = d.id
            WHERE d.id IN ({placeholders}) AND d.is_deleted = 0
            """,
            device_ids,
        ).fetchall()
    )

    by_id = {int(row["id"]): row for row in rows}
    ordered_rows = [by_id[device_id] for device_id in device_ids if device_id in by_id]
    for row in ordered_rows:
        row["plant_display"] = row.get("plant_name") or row.get("plant_code")
        row["line_display"] = row.get("line_name") or row.get("line_code")
        row["location_path"] = " / ".join(
            str(value)
            for value in [row.get("building"), row.get("floor"), row.get("area"), row.get("zone")]
            if value
        )
        row["monitoring_enabled_text"] = "Yes" if row.get("monitoring_enabled") else "No"
        row["is_deleted_text"] = "Yes" if row.get("is_deleted") else "No"
        row["latest_checked_at_local"] = utc_storage_to_local_label(row.get("latest_checked_at")) or ""
        row["created_at_local"] = utc_storage_to_local_label(row.get("created_at")) or ""
        row["updated_at_local"] = utc_storage_to_local_label(row.get("updated_at")) or ""
    return ordered_rows


def _get_user_or_404(conn: sqlite3.Connection, user_id: int) -> dict[str, Any]:
    user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _guard_user_removal(conn: sqlite3.Connection, user: dict[str, Any], actor: Actor, action: str) -> None:
    if str(user.get("id")) == str(actor.user_id):
        raise HTTPException(status_code=422, detail=f"Admin cannot {action} their own active session")
    if user.get("username") == settings.bootstrap_admin_username:
        raise HTTPException(status_code=422, detail=f"Bootstrap admin account cannot be {action}d")
    if normalize_role(user.get("role")) == "ADMIN" and bool(user.get("is_active", 1)):
        active_admin_count = conn.execute(
            "SELECT COUNT(*) FROM users WHERE UPPER(role) = 'ADMIN' AND is_active = 1"
        ).fetchone()[0]
        if active_admin_count <= 1:
            raise HTTPException(status_code=422, detail=f"Cannot {action} the last active ADMIN account")


def _display_token_from_request(request: Request) -> str:
    return request.headers.get("x-nms-display-token") or request.query_params.get("token") or ""


def _require_display_access(request: Request) -> None:
    expected_token = settings.display_api_token.strip()
    if expected_token and not hmac.compare_digest(_display_token_from_request(request), expected_token):
        raise HTTPException(status_code=401, detail="Display API token required")


DATABASE_CONFIG_KEYS = [
    "NMS_DATABASE_ENGINE",
    "NMS_DATABASE_PATH",
    "NMS_MSSQL_SERVER",
    "NMS_MSSQL_PORT",
    "NMS_MSSQL_DATABASE",
    "NMS_MSSQL_AUTH",
    "NMS_MSSQL_USERNAME",
    "NMS_MSSQL_PASSWORD",
    "NMS_MSSQL_DRIVER",
    "NMS_MSSQL_ENCRYPT",
    "NMS_MSSQL_TRUST_SERVER_CERTIFICATE",
]

TRAFFIC_CONFIG_KEYS = [
    "NMS_TRAFFIC_COLLECTION_ENABLED",
    "NMS_TRAFFIC_COLLECTION_INTERVAL_SECONDS",
    "NMS_TRAFFIC_DEFAULT_PROVIDER",
    "NMS_TRAFFIC_GENERIC_API_URL",
    "NMS_TRAFFIC_GENERIC_API_TOKEN",
    "NMS_CISCO_WLC_CONTROLLER_URL",
    "NMS_CISCO_WLC_API_TOKEN",
    "NMS_GENERIC_SNMP_COMMUNITY",
]


def _database_env_path() -> Path:
    explicit = os.getenv("NMS_ENV_PATH")
    return Path(explicit) if explicit else Path.cwd() / ".env"


def _read_env_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def _write_env_values(path: Path, updates: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []
    updated: set[str] = set()
    next_lines: list[str] = []
    for raw_line in lines:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            next_lines.append(raw_line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in updates:
            next_lines.append(f"{key}={updates[key]}")
            updated.add(key)
        else:
            next_lines.append(raw_line)
    for key, value in updates.items():
        if key not in updated:
            next_lines.append(f"{key}={value}")
    path.write_text("\n".join(next_lines) + "\n", encoding="utf-8")


def _bool_text(value: bool) -> str:
    return "true" if value else "false"


def _mssql_target(server: str, port: str | int | None) -> str:
    port_text = str(port or "").strip()
    return f"{server},{port_text}" if port_text and port_text != "0" else server


def _mask_database_config(data: dict[str, Any], password_configured: bool) -> dict[str, Any]:
    masked = dict(data)
    masked.pop("mssql_password", None)
    masked["mssql_password_configured"] = password_configured
    masked["mssql_target"] = _mssql_target(masked.get("mssql_server", ""), masked.get("mssql_port"))
    masked["sql_server_profile"] = "SQL Server 2025 Express"
    return masked


def _runtime_database_config() -> dict[str, Any]:
    data = {
        "database_engine": settings.database_engine,
        "database_path": str(settings.database_path),
        "mssql_server": settings.mssql_server,
        "mssql_port": settings.mssql_port,
        "mssql_database": settings.mssql_database,
        "mssql_auth": settings.mssql_auth,
        "mssql_username": settings.mssql_username,
        "mssql_driver": settings.mssql_driver,
        "mssql_encrypt": settings.mssql_encrypt,
        "mssql_trust_server_certificate": settings.mssql_trust_server_certificate,
    }
    return _mask_database_config(data, bool(settings.mssql_password))


def _pending_database_config(env_values: dict[str, str]) -> dict[str, Any]:
    data = {
        "database_engine": env_values.get("NMS_DATABASE_ENGINE", settings.database_engine),
        "database_path": env_values.get("NMS_DATABASE_PATH", str(settings.database_path)),
        "mssql_server": env_values.get("NMS_MSSQL_SERVER", settings.mssql_server),
        "mssql_port": env_values.get("NMS_MSSQL_PORT", settings.mssql_port),
        "mssql_database": env_values.get("NMS_MSSQL_DATABASE", settings.mssql_database),
        "mssql_auth": env_values.get("NMS_MSSQL_AUTH", settings.mssql_auth),
        "mssql_username": env_values.get("NMS_MSSQL_USERNAME", settings.mssql_username),
        "mssql_driver": env_values.get("NMS_MSSQL_DRIVER", settings.mssql_driver),
        "mssql_encrypt": str(env_values.get("NMS_MSSQL_ENCRYPT", _bool_text(settings.mssql_encrypt))).lower() in {"1", "true", "yes", "on"},
        "mssql_trust_server_certificate": str(env_values.get("NMS_MSSQL_TRUST_SERVER_CERTIFICATE", _bool_text(settings.mssql_trust_server_certificate))).lower() in {"1", "true", "yes", "on"},
    }
    password_configured = bool(env_values.get("NMS_MSSQL_PASSWORD") or settings.mssql_password)
    return _mask_database_config(data, password_configured)


def _available_odbc_drivers() -> list[str]:
    try:
        import pyodbc

        return [driver for driver in pyodbc.drivers() if "SQL Server" in driver]
    except Exception:
        return []


def _normalized_database_payload(payload: DatabaseConfigPayload, *, for_test: bool = False) -> dict[str, Any]:
    data = payload.model_dump()
    data["database_engine"] = str(data.get("database_engine") or "mssql").strip().lower()
    if data["database_engine"] not in {"sqlite", "mssql"}:
        raise HTTPException(status_code=422, detail="Database engine must be sqlite or mssql")

    data["database_path"] = str(data.get("database_path") or settings.database_path).strip()
    data["mssql_server"] = str(data.get("mssql_server") or "localhost\\SQLEXPRESS").strip()
    data["mssql_port"] = str(data.get("mssql_port") or "").strip()
    data["mssql_database"] = str(data.get("mssql_database") or "vibe_nms").strip()
    data["mssql_auth"] = str(data.get("mssql_auth") or "sql").strip().lower()
    data["mssql_username"] = str(data.get("mssql_username") or "").strip()
    data["mssql_driver"] = str(data.get("mssql_driver") or "ODBC Driver 18 for SQL Server").strip()
    data["mssql_password"] = data.get("mssql_password") or settings.mssql_password

    if data["database_engine"] == "sqlite":
        return data
    if not data["mssql_server"]:
        raise HTTPException(status_code=422, detail="SQL Server is required")
    if not data["mssql_database"]:
        raise HTTPException(status_code=422, detail="Database name is required")
    if data["mssql_auth"] not in {"sql", "windows"}:
        raise HTTPException(status_code=422, detail="Authentication must be sql or windows")
    if data["mssql_auth"] == "sql" and not data["mssql_username"]:
        raise HTTPException(status_code=422, detail="SQL username is required")
    if for_test and data["mssql_auth"] == "sql" and not data["mssql_password"]:
        raise HTTPException(status_code=422, detail="SQL password is required for connection test")
    if not data["mssql_driver"]:
        raise HTTPException(status_code=422, detail="ODBC driver is required")
    return data


def _database_env_updates(data: dict[str, Any], payload: DatabaseConfigPayload) -> dict[str, str]:
    updates = {
        "NMS_DATABASE_ENGINE": data["database_engine"],
        "NMS_DATABASE_PATH": data["database_path"],
        "NMS_MSSQL_SERVER": data["mssql_server"],
        "NMS_MSSQL_PORT": data["mssql_port"],
        "NMS_MSSQL_DATABASE": data["mssql_database"],
        "NMS_MSSQL_AUTH": data["mssql_auth"],
        "NMS_MSSQL_USERNAME": data["mssql_username"],
        "NMS_MSSQL_DRIVER": data["mssql_driver"],
        "NMS_MSSQL_ENCRYPT": _bool_text(bool(data.get("mssql_encrypt"))),
        "NMS_MSSQL_TRUST_SERVER_CERTIFICATE": _bool_text(bool(data.get("mssql_trust_server_certificate"))),
    }
    if payload.mssql_password:
        updates["NMS_MSSQL_PASSWORD"] = payload.mssql_password
    return updates


def _traffic_config_from_values(env_values: dict[str, str] | None = None) -> dict[str, Any]:
    values = env_values or {}
    return {
        "traffic_collection_enabled": str(values.get("NMS_TRAFFIC_COLLECTION_ENABLED", _bool_text(settings.traffic_collection_enabled))).lower() in {"1", "true", "yes", "on"},
        "traffic_collection_interval_seconds": int(values.get("NMS_TRAFFIC_COLLECTION_INTERVAL_SECONDS", settings.traffic_collection_interval_seconds) or 60),
        "traffic_default_provider": values.get("NMS_TRAFFIC_DEFAULT_PROVIDER", settings.traffic_default_provider),
        "traffic_generic_api_url": values.get("NMS_TRAFFIC_GENERIC_API_URL", settings.traffic_generic_api_url),
        "traffic_generic_api_token_configured": bool(values.get("NMS_TRAFFIC_GENERIC_API_TOKEN") or settings.traffic_generic_api_token),
        "cisco_wlc_controller_url": values.get("NMS_CISCO_WLC_CONTROLLER_URL", settings.cisco_wlc_controller_url),
        "cisco_wlc_api_token_configured": bool(values.get("NMS_CISCO_WLC_API_TOKEN") or settings.cisco_wlc_api_token),
        "generic_snmp_community_configured": bool(values.get("NMS_GENERIC_SNMP_COMMUNITY") or settings.generic_snmp_community),
    }


def _normalized_traffic_payload(payload: TrafficConfigPayload, env_values: dict[str, str] | None = None) -> dict[str, Any]:
    data = payload.model_dump()
    values = env_values or {}
    provider = str(data.get("traffic_default_provider") or "not-configured").strip().lower().replace("_", "-")
    if provider not in {"not-configured", "demo", "generic-api", "cisco-wlc", "generic-snmp", "auto"}:
        raise HTTPException(status_code=422, detail="Traffic provider must be not-configured, generic-api, cisco-wlc, generic-snmp, auto, or demo")
    data["traffic_default_provider"] = provider
    data["traffic_collection_interval_seconds"] = min(max(int(data.get("traffic_collection_interval_seconds") or 60), 10), 3600)
    for key in ("traffic_generic_api_url", "traffic_generic_api_token", "cisco_wlc_controller_url", "cisco_wlc_api_token", "generic_snmp_community"):
        data[key] = str(data.get(key) or "").strip()
    if provider == "generic-api" and not data["traffic_generic_api_url"]:
        raise HTTPException(status_code=422, detail="Generic API URL is required")
    if provider == "cisco-wlc" and not data["cisco_wlc_controller_url"]:
        raise HTTPException(status_code=422, detail="Cisco WLC controller URL is required")
    existing_snmp_community = values.get("NMS_GENERIC_SNMP_COMMUNITY") or settings.generic_snmp_community
    if provider == "generic-snmp" and not data["generic_snmp_community"] and not existing_snmp_community:
        raise HTTPException(status_code=422, detail="SNMP community is required")
    return data


def _traffic_env_updates(data: dict[str, Any], payload: TrafficConfigPayload) -> dict[str, str]:
    updates = {
        "NMS_TRAFFIC_COLLECTION_ENABLED": _bool_text(bool(data["traffic_collection_enabled"])),
        "NMS_TRAFFIC_COLLECTION_INTERVAL_SECONDS": str(data["traffic_collection_interval_seconds"]),
        "NMS_TRAFFIC_DEFAULT_PROVIDER": data["traffic_default_provider"],
        "NMS_TRAFFIC_GENERIC_API_URL": data["traffic_generic_api_url"],
        "NMS_CISCO_WLC_CONTROLLER_URL": data["cisco_wlc_controller_url"],
    }
    if payload.traffic_generic_api_token:
        updates["NMS_TRAFFIC_GENERIC_API_TOKEN"] = payload.traffic_generic_api_token
    if payload.cisco_wlc_api_token:
        updates["NMS_CISCO_WLC_API_TOKEN"] = payload.cisco_wlc_api_token
    if payload.generic_snmp_community:
        updates["NMS_GENERIC_SNMP_COMMUNITY"] = payload.generic_snmp_community
    return updates


def _apply_traffic_runtime_config(data: dict[str, Any]) -> None:
    settings.traffic_collection_enabled = bool(data["traffic_collection_enabled"])
    settings.traffic_collection_interval_seconds = int(data["traffic_collection_interval_seconds"])
    settings.traffic_default_provider = data["traffic_default_provider"]
    settings.traffic_generic_api_url = data["traffic_generic_api_url"]
    if data.get("traffic_generic_api_token"):
        settings.traffic_generic_api_token = data["traffic_generic_api_token"]
    settings.cisco_wlc_controller_url = data["cisco_wlc_controller_url"]
    if data.get("cisco_wlc_api_token"):
        settings.cisco_wlc_api_token = data["cisco_wlc_api_token"]
    if data.get("generic_snmp_community"):
        settings.generic_snmp_community = data["generic_snmp_community"]


def _traffic_rollup(values: list[Any]) -> tuple[float | None, float | None, float | None]:
    clean = [_number(value) for value in values]
    numbers = [value for value in clean if value is not None]
    if not numbers:
        return None, None, None
    return min(numbers), max(numbers), round(sum(numbers) / len(numbers), 2)


def _device_filter_clauses(filters: dict[str, Any], alias: str = "d", include_deleted_clause: bool = True) -> tuple[list[str], list[Any]]:
    filters = trim_strings(filters, empty_to_none=True)
    clauses: list[str] = []
    params: list[Any] = []
    if include_deleted_clause:
        clauses.append(f"{alias}.is_deleted = 0")
    if filters.get("plant"):
        clauses.append(f"COALESCE({alias}.plant_name, {alias}.plant_code) = ?")
        params.append(filters["plant"])
    if filters.get("line"):
        clauses.append(f"COALESCE({alias}.line_name, {alias}.line_code) = ?")
        params.append(filters["line"])
    if filters.get("status"):
        clauses.append(f"{alias}.status = ?")
        params.append(str(filters["status"]).upper())
    return clauses, params


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _traffic_bucket(value: Any, bucket: str) -> str:
    return utc_storage_to_local_label(value, bucket)


def _traffic_filter_clauses(filters: dict[str, Any]) -> tuple[list[str], list[Any]]:
    filters = trim_strings(filters, empty_to_none=True)
    clauses, params = _device_filter_clauses(filters)
    if str(settings.traffic_default_provider or "").strip().lower().replace("_", "-") not in {"demo", "local-demo"}:
        clauses.append("LOWER(COALESCE(t.source, '')) NOT IN ('demo', 'local-demo')")
    if filters.get("device_id"):
        clauses.append("d.id = ?")
        params.append(int(filters["device_id"]))
    if filters.get("date_from"):
        clauses.append("t.collected_at >= ?")
        params.append(local_datetime_filter_to_utc_storage(str(filters["date_from"])))
    if filters.get("date_to"):
        clauses.append("t.collected_at <= ?")
        date_to = str(filters["date_to"]).strip()
        if len(date_to) == 16:
            date_to = f"{date_to}:59"
        params.append(local_datetime_filter_to_utc_storage(date_to))
    return clauses, params


def _traffic_summary_payload(conn: sqlite3.Connection, filters: dict[str, Any]) -> dict[str, Any]:
    filters = trim_strings(filters, empty_to_none=True)
    point_limit = min(max(int(filters.get("point_limit") or 240), 10), 2000)
    device_limit = min(max(int(filters.get("device_limit") or 200), 1), 1000)
    bucket = str(filters.get("bucket") or "minute").strip().lower()
    if bucket not in {"minute", "hour"}:
        bucket = "minute"
    clauses, params = _traffic_filter_clauses(filters)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    latest_rows = rows_to_dicts(
        conn.execute(
            f"""
            SELECT *
            FROM (
                SELECT t.id, t.device_id, t.collected_at, t.interface_name,
                       t.rx_bps, t.tx_bps, t.rx_min_bps, t.rx_max_bps, t.rx_avg_bps,
                       t.tx_min_bps, t.tx_max_bps, t.tx_avg_bps, t.utilization_percent,
                       t.source, t.raw_data_json,
                       d.device_name, d.device_type, d.ip_address,
                       COALESCE(d.plant_name, d.plant_code) AS plant_name,
                       COALESCE(d.line_name, d.line_code) AS line_name,
                       d.connected_ap_name, d.connected_ap_ip, d.switch_name, d.switch_port,
                       ROW_NUMBER() OVER (PARTITION BY t.device_id ORDER BY t.collected_at DESC, t.id DESC) AS rn
                FROM network_traffic_metrics t
                JOIN network_devices d ON d.id = t.device_id
                {where}
            ) ranked
            WHERE rn = 1
            ORDER BY COALESCE(rx_bps, 0) + COALESCE(tx_bps, 0) DESC, device_name
            LIMIT ?
            """,
            params + [device_limit],
        ).fetchall()
    )
    range_rows = rows_to_dicts(
        conn.execute(
            f"""
            SELECT t.device_id,
                   d.device_name, d.device_type, d.ip_address,
                   COALESCE(d.plant_name, d.plant_code) AS plant_name,
                   COALESCE(d.line_name, d.line_code) AS line_name,
                   d.connected_ap_name, d.connected_ap_ip, d.switch_name, d.switch_port,
                   MIN(t.rx_bps) AS rx_min_bps,
                   MAX(t.rx_bps) AS rx_max_bps,
                   AVG(t.rx_bps) AS rx_avg_bps,
                   MIN(t.tx_bps) AS tx_min_bps,
                   MAX(t.tx_bps) AS tx_max_bps,
                   AVG(t.tx_bps) AS tx_avg_bps,
                   COUNT(*) AS sample_count,
                   MAX(t.collected_at) AS last_collected_at
            FROM network_traffic_metrics t
            JOIN network_devices d ON d.id = t.device_id
            {where}
            GROUP BY t.device_id, d.device_name, d.device_type, d.ip_address,
                     COALESCE(d.plant_name, d.plant_code), COALESCE(d.line_name, d.line_code),
                     d.connected_ap_name, d.connected_ap_ip, d.switch_name, d.switch_port
            ORDER BY COALESCE(AVG(t.rx_bps), 0) + COALESCE(AVG(t.tx_bps), 0) DESC, d.device_name
            LIMIT ?
            """,
            params + [device_limit],
        ).fetchall()
    )
    range_by_device = {row.get("device_id"): row for row in range_rows}
    for row in latest_rows:
        stats = range_by_device.get(row.get("device_id"))
        if not stats:
            continue
        for key in ("rx_min_bps", "rx_max_bps", "rx_avg_bps", "tx_min_bps", "tx_max_bps", "tx_avg_bps", "sample_count"):
            row[key] = stats.get(key)
    recent_rows = rows_to_dicts(
        conn.execute(
            f"""
            SELECT t.id, t.device_id, t.collected_at, t.interface_name,
                   t.rx_bps, t.tx_bps, t.rx_min_bps, t.rx_max_bps, t.rx_avg_bps,
                   t.tx_min_bps, t.tx_max_bps, t.tx_avg_bps, t.utilization_percent,
                   t.source,
                   d.device_name, d.device_type, d.ip_address,
                   COALESCE(d.plant_name, d.plant_code) AS plant_name,
                   COALESCE(d.line_name, d.line_code) AS line_name,
                   d.connected_ap_name, d.connected_ap_ip, d.switch_name, d.switch_port
            FROM network_traffic_metrics t
            JOIN network_devices d ON d.id = t.device_id
            {where}
            ORDER BY t.collected_at DESC, t.id DESC
            LIMIT ?
            """,
            params + [point_limit],
        ).fetchall()
    )
    buckets: dict[str, dict[str, Any]] = {}
    for row in reversed(recent_rows):
        bucket_key = _traffic_bucket(row.get("collected_at"), bucket)
        if not bucket_key:
            continue
        item = buckets.setdefault(
            bucket_key,
            {
                "time": bucket_key,
                "rx_bps": 0.0,
                "tx_bps": 0.0,
                "rx_max_bps": 0.0,
                "tx_max_bps": 0.0,
                "sample_count": 0,
            },
        )
        rx = _number(row.get("rx_bps")) or 0.0
        tx = _number(row.get("tx_bps")) or 0.0
        item["rx_bps"] += rx
        item["tx_bps"] += tx
        item["rx_max_bps"] = max(item["rx_max_bps"], _number(row.get("rx_max_bps")) or rx)
        item["tx_max_bps"] = max(item["tx_max_bps"], _number(row.get("tx_max_bps")) or tx)
        item["sample_count"] += 1
    current_rx_values = [_number(row.get("rx_bps")) for row in latest_rows]
    current_tx_values = [_number(row.get("tx_bps")) for row in latest_rows]
    range_rx_avg_values = [_number(row.get("rx_avg_bps")) for row in range_rows]
    range_tx_avg_values = [_number(row.get("tx_avg_bps")) for row in range_rows]
    range_rx_max_values = [_number(row.get("rx_max_bps")) for row in range_rows]
    range_tx_max_values = [_number(row.get("tx_max_bps")) for row in range_rows]
    latest_times = [str(row.get("collected_at")) for row in latest_rows if row.get("collected_at")]
    source_counts: dict[str, int] = {}
    for row in latest_rows:
        source = row.get("source") or "unknown"
        source_counts[source] = source_counts.get(source, 0) + 1
    return {
        "filters": {
            "plant": filters.get("plant"),
            "line": filters.get("line"),
            "device_id": filters.get("device_id"),
            "date_from": filters.get("date_from"),
            "date_to": filters.get("date_to"),
            "bucket": bucket,
            "point_limit": point_limit,
            "device_limit": device_limit,
        },
        "settings": {
            "traffic_collection_enabled": settings.traffic_collection_enabled,
            "traffic_collection_interval_seconds": settings.traffic_collection_interval_seconds,
            "traffic_default_provider": settings.traffic_default_provider,
        },
        "summary": {
            "device_count": len(latest_rows),
            "current_rx_bps": round(sum(value or 0 for value in current_rx_values), 2),
            "current_tx_bps": round(sum(value or 0 for value in current_tx_values), 2),
            "max_rx_bps": max([value or 0 for value in current_rx_values], default=0),
            "max_tx_bps": max([value or 0 for value in current_tx_values], default=0),
            "avg_rx_bps": round(sum(value or 0 for value in current_rx_values) / len(latest_rows), 2) if latest_rows else 0,
            "avg_tx_bps": round(sum(value or 0 for value in current_tx_values) / len(latest_rows), 2) if latest_rows else 0,
            "last_collected_at": max(latest_times) if latest_times else None,
            "source_counts": source_counts,
            "range_avg_rx_bps": round(sum(value or 0 for value in range_rx_avg_values), 2),
            "range_avg_tx_bps": round(sum(value or 0 for value in range_tx_avg_values), 2),
            "range_max_rx_bps": max([value or 0 for value in range_rx_max_values], default=0),
            "range_max_tx_bps": max([value or 0 for value in range_tx_max_values], default=0),
        },
        "timeseries": list(buckets.values()),
        "latest": latest_rows,
        "top_devices": [
            {
                **row,
                "rx_bps": row.get("rx_avg_bps"),
                "tx_bps": row.get("tx_avg_bps"),
            }
            for row in range_rows[:10]
        ],
    }


def _dashboard_display_payload(conn: sqlite3.Connection, filters: dict[str, Any]) -> dict[str, Any]:
    filters = trim_strings(filters, empty_to_none=True)
    device_clauses, device_params = _device_filter_clauses(filters)
    device_where = f"WHERE {' AND '.join(device_clauses)}" if device_clauses else ""
    device_limit = int(filters.get("device_limit") or 200)
    alert_limit = int(filters.get("alert_limit") or 20)
    metric_limit = int(filters.get("metric_limit") or 60)

    total_devices = conn.execute(
        f"SELECT COUNT(*) FROM network_devices d {device_where}",
        device_params,
    ).fetchone()[0]
    status_counts = {
        row["status"]: row["count"]
        for row in conn.execute(
            f"""
            SELECT d.status, COUNT(*) AS count
            FROM network_devices d
            {device_where}
            GROUP BY d.status
            """,
            device_params,
        ).fetchall()
    }
    devices = rows_to_dicts(
        conn.execute(
            f"""
            SELECT d.id, d.device_name, d.device_type, d.ip_address, d.mac_address, d.hostname,
                   COALESCE(d.plant_name, d.plant_code) AS plant_name,
                   COALESCE(d.line_name, d.line_code) AS line_name,
                   d.building, d.floor, d.area, d.zone, d.connected_ap_name, d.connected_ap_ip,
                   d.switch_name, d.switch_port, d.vlan, d.owner_department, d.criticality,
                   d.status, d.latency_ms, d.packet_loss_percent, d.consecutive_failure_count,
                   latest.check_method AS latest_check_method,
                   latest.error_message AS latest_monitoring_reason,
                   (SELECT COUNT(*) FROM alerts a WHERE a.device_id = d.id AND a.status = 'ACTIVE') AS active_alert_count
            FROM network_devices d
            LEFT JOIN (
                SELECT device_id, check_method, error_message
                FROM (
                    SELECT device_id, check_method, error_message,
                           ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY checked_at DESC, id DESC) AS rn
                    FROM device_metrics
                ) ranked_metrics
                WHERE rn = 1
            ) latest ON latest.device_id = d.id
            {device_where}
            ORDER BY CASE d.status WHEN 'CRITICAL' THEN 0 WHEN 'OFFLINE' THEN 1 WHEN 'WARNING' THEN 2 WHEN 'FLAPPING' THEN 3 ELSE 4 END,
                     COALESCE(d.plant_name, d.plant_code), COALESCE(d.line_name, d.line_code), d.device_name
            LIMIT ?
            """,
            device_params + [device_limit],
        ).fetchall()
    )

    alert_clauses = ["a.status IN ('ACTIVE', 'ACKNOWLEDGED')"]
    alert_params: list[Any] = []
    if filters.get("plant") or filters.get("line") or filters.get("status"):
        filtered_alert_clauses, filtered_alert_params = _device_filter_clauses(filters)
        alert_clauses.extend(filtered_alert_clauses)
        alert_params.extend(filtered_alert_params)
    alert_where = f"WHERE {' AND '.join(alert_clauses)}"
    recent_alerts = rows_to_dicts(
        conn.execute(
            f"""
            SELECT a.id, a.severity, a.alert_type, a.message, a.status,
                   a.first_detected_at AS created_at, a.last_detected_at,
                   d.device_name, d.ip_address,
                   COALESCE(d.plant_name, d.plant_code) AS plant_name,
                   COALESCE(d.line_name, d.line_code) AS line_name
            FROM alerts a
            LEFT JOIN network_devices d ON d.id = a.device_id
            {alert_where}
            ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 0 ELSE 1 END, a.last_detected_at DESC, a.id DESC
            LIMIT ?
            """,
            alert_params + [alert_limit],
        ).fetchall()
    )

    recent_metrics = rows_to_dicts(
        conn.execute(
            f"""
            SELECT m.checked_at, m.status, m.latency_ms, m.packet_loss_percent, m.check_method,
                   d.device_name, d.ip_address,
                   COALESCE(d.plant_name, d.plant_code) AS plant_name,
                   COALESCE(d.line_name, d.line_code) AS line_name
            FROM device_metrics m
            JOIN network_devices d ON d.id = m.device_id
            {device_where}
            ORDER BY m.checked_at DESC, m.id DESC
            LIMIT ?
            """,
            device_params + [metric_limit],
        ).fetchall()
    )

    active_alert_clauses = ["a.status = 'ACTIVE'"]
    active_alert_params: list[Any] = []
    if filters.get("plant") or filters.get("line") or filters.get("status"):
        filtered_active_clauses, filtered_active_params = _device_filter_clauses(filters)
        active_alert_clauses.extend(filtered_active_clauses)
        active_alert_params.extend(filtered_active_params)
    active_alert_where = f"WHERE {' AND '.join(active_alert_clauses)}"
    active_alerts = conn.execute(
        f"""
        SELECT COUNT(*)
        FROM alerts a
        LEFT JOIN network_devices d ON d.id = a.device_id
        {active_alert_where}
        """,
        active_alert_params,
    ).fetchone()[0]
    critical_alerts = conn.execute(
        f"""
        SELECT COUNT(*)
        FROM alerts a
        LEFT JOIN network_devices d ON d.id = a.device_id
        {active_alert_where} AND a.severity = 'CRITICAL'
        """,
        active_alert_params,
    ).fetchone()[0]

    by_ap: list[dict[str, Any]] = []
    if filters.get("include_ap", True):
        ap_clauses, ap_params = _device_filter_clauses(filters)
        ap_clauses.append("UPPER(d.device_type) = 'AP'")
        ap_where = f"WHERE {' AND '.join(ap_clauses)}"
        aps = rows_to_dicts(
            conn.execute(
                f"""
                SELECT d.*
                FROM network_devices d
                {ap_where}
                ORDER BY COALESCE(d.plant_name, d.plant_code), COALESCE(d.line_name, d.line_code), d.device_name
                LIMIT 50
                """,
                ap_params,
            ).fetchall()
        )
        by_ap = [_ap_summary(conn, ap) for ap in aps]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "filters": {
            "plant": filters.get("plant"),
            "line": filters.get("line"),
            "status": filters.get("status"),
            "device_limit": device_limit,
            "alert_limit": alert_limit,
            "metric_limit": metric_limit,
            "include_ap": bool(filters.get("include_ap", True)),
        },
        "summary": {
            "total_devices": total_devices,
            "status_counts": status_counts,
            "active_alerts": active_alerts,
            "critical_alerts": critical_alerts,
        },
        "devices": devices,
        "recent_alerts": recent_alerts,
        "recent_metrics": recent_metrics,
        "traffic": _traffic_summary_payload(
            conn,
            {
                "plant": filters.get("plant"),
                "line": filters.get("line"),
                "status": filters.get("status"),
                "point_limit": metric_limit,
                "device_limit": device_limit,
            },
        ),
        "by_ap": by_ap,
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/backend/runtime")
def backend_runtime(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    ping_interval_seconds = get_monitoring_interval_seconds()
    database: dict[str, Any]
    if settings.database_engine == "mssql":
        database = {
            "engine": "mssql",
            "server": settings.mssql_server,
            "port": settings.mssql_port,
            "database": settings.mssql_database,
            "auth": settings.mssql_auth,
            "username": settings.mssql_username if settings.mssql_auth == "sql" else "",
            "driver": settings.mssql_driver,
            "encrypt": settings.mssql_encrypt,
            "trust_server_certificate": settings.mssql_trust_server_certificate,
            "target": _mssql_target(settings.mssql_server, settings.mssql_port),
            "profile": "SQL Server 2025 Express",
        }
    else:
        database = {
            "engine": "sqlite",
            "path": str(settings.database_path),
            "exists": settings.database_path.exists(),
        }
    return {
        "app_name": settings.app_name,
        "time_zone": settings.time_zone,
        "process": {
            "pid": os.getpid(),
            "host": os.getenv("NMS_HOST", "0.0.0.0"),
            "port": int(os.getenv("NMS_PORT", "8080")),
        },
        "database": database,
        "frontend": {
            "dist_path": str(settings.frontend_dist_path),
            "exists": settings.frontend_dist_path.exists(),
        },
        "workers": {
            "ping_collector_enabled": settings.collector_enabled,
            "ping_interval_seconds": ping_interval_seconds,
            "ping_interval_options": MONITORING_INTERVAL_OPTIONS,
            "ping_count": settings.ping_count,
            "tcp_fallback_ports": settings.tcp_fallback_ports,
            "ap_client_discovery_enabled": settings.ap_client_discovery_enabled,
            "ap_client_discovery_interval_seconds": settings.ap_client_discovery_interval_seconds,
            "traffic_collection_enabled": settings.traffic_collection_enabled,
            "traffic_collection_interval_seconds": settings.traffic_collection_interval_seconds,
            "traffic_default_provider": settings.traffic_default_provider,
        },
        "api": {
            "docs": "/docs",
            "dashboard_get": "/api/display/dashboard",
            "dashboard_post": "/api/display/dashboard",
            "display_page": "/display",
            "database_config": "/api/database/config",
            "traffic_summary": "/api/traffic/summary",
        },
    }


@app.get("/api/database/config")
def get_database_config(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    env_path = _database_env_path()
    env_values = _read_env_values(env_path)
    runtime = _runtime_database_config()
    pending = _pending_database_config(env_values)
    return {
        "env_path": str(env_path),
        "runtime": runtime,
        "pending": pending,
        "drivers": _available_odbc_drivers(),
        "restart_required": pending != runtime,
        "restart": {
            "task_name": "VibeNMS",
            "stop": "Stop-ScheduledTask -TaskName VibeNMS",
            "start": "Start-ScheduledTask -TaskName VibeNMS",
        },
        "recommended": {
            "database_engine": "mssql",
            "mssql_server": "localhost\\SQLEXPRESS",
            "mssql_port": "",
            "mssql_database": "vibe_nms",
            "mssql_auth": "sql",
            "mssql_username": "sa",
            "mssql_driver": "ODBC Driver 18 for SQL Server",
            "mssql_encrypt": True,
            "mssql_trust_server_certificate": True,
            "profile": "SQL Server 2025 Express",
        },
    }


@app.post("/api/database/config/test")
def test_database_config(payload: DatabaseConfigPayload, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    data = _normalized_database_payload(payload, for_test=True)
    if data["database_engine"] == "sqlite":
        path = Path(data["database_path"])
        return {
            "ok": True,
            "engine": "sqlite",
            "message": f"SQLite path is valid. Parent: {path.parent}",
            "database_path": str(path),
        }

    try:
        import pyodbc

        connection_string = mssql_connection_string(
            server=data["mssql_server"],
            port=data["mssql_port"],
            database="master",
            auth=data["mssql_auth"],
            username=data["mssql_username"],
            password=data["mssql_password"],
            driver=data["mssql_driver"],
            encrypt=bool(data["mssql_encrypt"]),
            trust_server_certificate=bool(data["mssql_trust_server_certificate"]),
        )
        raw = pyodbc.connect(connection_string, timeout=5, autocommit=True)
        cursor = raw.cursor()
        version = cursor.execute("SELECT CONVERT(NVARCHAR(4000), @@VERSION)").fetchone()[0]
        info = cursor.execute(
            """
            SELECT
                CONVERT(NVARCHAR(200), SERVERPROPERTY('Edition')) AS edition,
                CONVERT(NVARCHAR(80), SERVERPROPERTY('ProductVersion')) AS product_version,
                DB_ID(?) AS database_id
            """,
            data["mssql_database"],
        ).fetchone()
        raw.close()
        edition = str(info[0] or "")
        return {
            "ok": True,
            "engine": "mssql",
            "target": _mssql_target(data["mssql_server"], data["mssql_port"]),
            "database": data["mssql_database"],
            "database_exists": info[2] is not None,
            "edition": edition,
            "product_version": str(info[1] or ""),
            "version": version,
            "is_express": "express" in edition.lower(),
            "message": "Connection succeeded. Vibe NMS can create the database on restart if it does not exist.",
        }
    except Exception as exc:
        return {
            "ok": False,
            "engine": "mssql",
            "target": _mssql_target(data["mssql_server"], data["mssql_port"]),
            "database": data["mssql_database"],
            "message": str(exc),
        }


@app.put("/api/database/config")
def update_database_config(payload: DatabaseConfigPayload, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    data = _normalized_database_payload(payload)
    env_path = _database_env_path()
    env_values = _read_env_values(env_path)
    if (
        data["database_engine"] == "mssql"
        and data["mssql_auth"] == "sql"
        and not payload.mssql_password
        and not env_values.get("NMS_MSSQL_PASSWORD")
        and not settings.mssql_password
    ):
        raise HTTPException(status_code=422, detail="SQL password is required before saving SQL Login config")
    before = _pending_database_config(env_values)
    _write_env_values(env_path, _database_env_updates(data, payload))
    after = _pending_database_config(_read_env_values(env_path))
    with transaction() as conn:
        write_audit_log(
            conn,
            actor,
            "UPDATE",
            "DATABASE_CONFIG",
            before_data=before,
            after_data=after,
            changed=changed_fields(before, after),
        )
    return {
        "status": "saved",
        "env_path": str(env_path),
        "runtime": _runtime_database_config(),
        "pending": after,
        "restart_required": True,
        "restart": {
            "task_name": "VibeNMS",
            "stop": "Stop-ScheduledTask -TaskName VibeNMS",
            "start": "Start-ScheduledTask -TaskName VibeNMS",
        },
    }


@app.get("/api/display/dashboard")
def display_dashboard_get(
    request: Request,
    plant: str | None = None,
    line: str | None = None,
    status: str | None = None,
    device_limit: int = Query(200, ge=1, le=1000),
    alert_limit: int = Query(20, ge=1, le=100),
    metric_limit: int = Query(60, ge=1, le=500),
    include_ap: bool = True,
) -> dict[str, Any]:
    _require_display_access(request)
    with transaction() as conn:
        return _dashboard_display_payload(
            conn,
            {
                "plant": plant,
                "line": line,
                "status": status,
                "device_limit": device_limit,
                "alert_limit": alert_limit,
                "metric_limit": metric_limit,
                "include_ap": include_ap,
            },
        )


@app.post("/api/display/dashboard")
def display_dashboard_post(payload: DisplayDashboardRequest, request: Request) -> dict[str, Any]:
    _require_display_access(request)
    with transaction() as conn:
        return _dashboard_display_payload(conn, payload.model_dump())


@app.post("/api/auth/login")
def login(payload: LoginRequest, request: Request) -> dict[str, Any]:
    request_actor = actor_from_request(request)
    login_failed = False
    response_payload: dict[str, Any] | None = None
    with transaction() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (payload.username,)).fetchone()
        user = row_to_dict(row)
        if not user or not user.get("is_active") or not verify_password(payload.password, user.get("password_hash")):
            failed_actor = Actor(
                user_id=None,
                username=payload.username,
                display_name=payload.username,
                role="USER",
                ip_address=request_actor.ip_address,
                user_agent=request_actor.user_agent,
                request_id=request_actor.request_id,
            )
            write_audit_log(
                conn,
                failed_actor,
                "LOGIN",
                "USER",
                entity_id=payload.username,
                result="FAILED",
                error_message="Invalid username or password",
            )
            login_failed = True
        else:
            conn.execute(
                "UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ? WHERE id = ?",
                (request_actor.ip_address, user["id"]),
            )
            actor = Actor(
                user_id=str(user["id"]),
                username=user["username"],
                display_name=user.get("display_name") or user["username"],
                role=normalize_role(user.get("role")),
                ip_address=request_actor.ip_address,
                user_agent=request_actor.user_agent,
                request_id=request_actor.request_id,
            )
            write_audit_log(conn, actor, "LOGIN", "USER", entity_id=user["id"])
            refreshed_user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()) or user
            public = _public_user(refreshed_user) or {}
            token = create_token({"sub": user["id"], "username": user["username"], "role": public["role"]})
            response_payload = {"token": token, "user": public}
    if login_failed or response_payload is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return response_payload


@app.get("/api/auth/me")
def me(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    with transaction() as conn:
        user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (actor.user_id,)).fetchone())
        return {"user": _public_user(user)}


def _parse_utc_storage_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip().replace("T", " ")
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


@app.get("/api/dashboard/summary")
def dashboard_summary() -> dict[str, Any]:
    with transaction() as conn:
        status_counts = {
            row["status"]: row["count"]
            for row in conn.execute(
                """
                SELECT status, COUNT(*) AS count
                FROM network_devices
                WHERE is_deleted = 0
                GROUP BY status
                """
            ).fetchall()
        }
        total_devices = conn.execute("SELECT COUNT(*) FROM network_devices WHERE is_deleted = 0").fetchone()[0]
        active_alerts = conn.execute("SELECT COUNT(*) FROM alerts WHERE status = 'ACTIVE'").fetchone()[0]
        critical_alerts = conn.execute(
            "SELECT COUNT(*) FROM alerts WHERE status = 'ACTIVE' AND severity = 'CRITICAL'"
        ).fetchone()[0]
        unread_notifications = conn.execute("SELECT COUNT(*) FROM notifications WHERE read_at IS NULL").fetchone()[0]
        by_plant = rows_to_dicts(
            conn.execute(
                """
                SELECT COALESCE(plant_name, plant_code) AS plant_name, status, COUNT(*) AS count
                FROM network_devices
                WHERE is_deleted = 0
                GROUP BY COALESCE(plant_name, plant_code), status
                ORDER BY COALESCE(plant_name, plant_code), status
                """
            ).fetchall()
        )
        recent_alerts = rows_to_dicts(
            conn.execute(
                """
                SELECT a.*, d.device_name, d.ip_address,
                       COALESCE(d.plant_name, d.plant_code) AS plant_name,
                       COALESCE(d.line_name, d.line_code) AS line_name
                FROM alerts a
                LEFT JOIN network_devices d ON d.id = a.device_id
                WHERE a.status IN ('ACTIVE', 'ACKNOWLEDGED')
                ORDER BY a.last_detected_at DESC
                LIMIT 10
                """
            ).fetchall()
        )
        recent_metrics = rows_to_dicts(
            conn.execute(
                """
                SELECT m.checked_at, m.status, m.latency_ms, m.packet_loss_percent,
                       d.device_name, d.ip_address,
                       COALESCE(d.plant_name, d.plant_code) AS plant_name,
                       COALESCE(d.line_name, d.line_code) AS line_name
                FROM device_metrics m
                JOIN network_devices d ON d.id = m.device_id
                ORDER BY m.checked_at DESC, m.id DESC
                LIMIT 50
                """
            ).fetchall()
        )
        latest_run = row_to_dict(conn.execute("SELECT * FROM monitoring_runs ORDER BY started_at DESC, id DESC LIMIT 1").fetchone())
        interval_seconds = get_monitoring_interval_seconds(conn)
        latest_run_at = _parse_utc_storage_datetime((latest_run or {}).get("completed_at") or (latest_run or {}).get("started_at"))
        next_run_at = latest_run_at + timedelta(seconds=interval_seconds) if latest_run_at else None
        seconds_remaining = max(0, int((next_run_at - datetime.now(timezone.utc)).total_seconds())) if next_run_at else 0
        return {
            "total_devices": total_devices,
            "status_counts": status_counts,
            "active_alerts": active_alerts,
            "critical_alerts": critical_alerts,
            "unread_notifications": unread_notifications,
            "status_by_plant": by_plant,
            "recent_alerts": recent_alerts,
            "recent_metrics": recent_metrics,
            "monitoring": {
                "interval_seconds": interval_seconds,
                "latest_run": latest_run,
                "next_run_at": next_run_at.isoformat().replace("+00:00", "Z") if next_run_at else None,
                "seconds_remaining": seconds_remaining,
            },
        }


@app.get("/api/traffic/summary")
def traffic_summary(
    plant: str | None = None,
    line: str | None = None,
    device_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    bucket: str = Query("minute", pattern="^(minute|hour)$"),
    point_limit: int = Query(240, ge=10, le=2000),
    device_limit: int = Query(200, ge=1, le=1000),
) -> dict[str, Any]:
    try:
        with transaction() as conn:
            return _traffic_summary_payload(
                conn,
                {
                    "plant": plant,
                    "line": line,
                    "device_id": device_id,
                    "date_from": date_from,
                    "date_to": date_to,
                    "bucket": bucket,
                    "point_limit": point_limit,
                    "device_limit": device_limit,
                },
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid traffic date range") from exc


@app.get("/api/traffic/config")
def get_traffic_config(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    env_path = _database_env_path()
    env_values = _read_env_values(env_path)
    return {
        "env_path": str(env_path),
        "runtime": _traffic_config_from_values({}),
        "pending": _traffic_config_from_values(env_values),
        "providers": ["not-configured", "generic-api", "cisco-wlc", "generic-snmp", "auto", "demo"],
        "token_fields": {
            "traffic_generic_api_token": "stored in backend env only",
            "cisco_wlc_api_token": "stored in backend env only",
            "generic_snmp_community": "stored in backend env only",
        },
        "generic_api_contract": {
            "method": "GET",
            "path": "/devices/{device_identifier}/traffic",
            "response_fields": ["rx_bps", "tx_bps", "interface_name", "utilization_percent"],
        },
    }


@app.put("/api/traffic/config")
def update_traffic_config(payload: TrafficConfigPayload, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    env_path = _database_env_path()
    env_values = _read_env_values(env_path)
    data = _normalized_traffic_payload(payload, env_values)
    before = _traffic_config_from_values(env_values)
    _write_env_values(env_path, _traffic_env_updates(data, payload))
    _apply_traffic_runtime_config(data)
    after = _traffic_config_from_values(_read_env_values(env_path))
    with transaction() as conn:
        write_audit_log(
            conn,
            actor,
            "UPDATE",
            "TRAFFIC_CONFIG",
            before_data=before,
            after_data=after,
            changed=changed_fields(before, after),
        )
    return {
        "saved": True,
        "env_path": str(env_path),
        "runtime": _traffic_config_from_values({}),
        "pending": after,
        "message": "Traffic config saved and applied to the running backend.",
    }


@app.post("/api/traffic/observations")
def ingest_traffic_observations(payload: TrafficObservationIngestRequest, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    inserted = 0
    skipped = 0
    errors: list[dict[str, Any]] = []
    with transaction() as conn:
        for index, observation in enumerate(payload.observations):
            data = trim_strings(observation.model_dump(), empty_to_none=True)
            if data.get("rx_bps") is None and data.get("tx_bps") is None:
                skipped += 1
                errors.append({"index": index, "error": "rx_bps or tx_bps is required"})
                continue
            device = None
            if data.get("device_id"):
                device = conn.execute("SELECT * FROM network_devices WHERE id = ? AND is_deleted = 0", (data["device_id"],)).fetchone()
            elif data.get("ip_address"):
                device = conn.execute("SELECT * FROM network_devices WHERE ip_address = ? AND is_deleted = 0", (data["ip_address"],)).fetchone()
            elif data.get("device_name"):
                device = conn.execute("SELECT * FROM network_devices WHERE device_name = ? AND is_deleted = 0", (data["device_name"],)).fetchone()
            if not device:
                skipped += 1
                errors.append({"index": index, "error": "matching device not found"})
                continue
            recent_rows = conn.execute(
                """
                SELECT rx_bps, tx_bps
                FROM network_traffic_metrics
                WHERE device_id = ?
                ORDER BY collected_at DESC, id DESC
                LIMIT 29
                """,
                (device["id"],),
            ).fetchall()
            rx_min, rx_max, rx_avg = _traffic_rollup([data.get("rx_bps"), *[row["rx_bps"] for row in recent_rows]])
            tx_min, tx_max, tx_avg = _traffic_rollup([data.get("tx_bps"), *[row["tx_bps"] for row in recent_rows]])
            columns = [
                "device_id",
                "interface_name",
                "rx_bps",
                "tx_bps",
                "rx_min_bps",
                "rx_max_bps",
                "rx_avg_bps",
                "tx_min_bps",
                "tx_max_bps",
                "tx_avg_bps",
                "utilization_percent",
                "source",
                "raw_data_json",
            ]
            values: list[Any] = [
                device["id"],
                data.get("interface_name"),
                data.get("rx_bps"),
                data.get("tx_bps"),
                rx_min,
                rx_max,
                rx_avg,
                tx_min,
                tx_max,
                tx_avg,
                data.get("utilization_percent"),
                data.get("source") or "api-ingest",
                json.dumps(data.get("raw_data") or {}, default=str),
            ]
            if data.get("collected_at"):
                columns.insert(1, "collected_at")
                values.insert(1, local_datetime_filter_to_utc_storage(str(data["collected_at"])))
            placeholders = ", ".join(["?"] * len(columns))
            conn.execute(
                f"INSERT INTO network_traffic_metrics({', '.join(columns)}) VALUES ({placeholders})",
                values,
            )
            inserted += 1
        write_audit_log(
            conn,
            actor,
            "IMPORT",
            "TRAFFIC",
            after_data={"inserted": inserted, "skipped": skipped, "errors": errors[:20]},
            result="SUCCESS" if not errors else "PARTIAL",
        )
    return {"inserted": inserted, "skipped": skipped, "errors": errors[:20]}


@app.post("/api/traffic/run")
async def run_traffic_collection_once(actor: Actor = Depends(get_actor)) -> dict[str, int]:
    require_admin(actor)
    return await run_traffic_collection_cycle()


@app.get("/api/devices")
def list_devices(
    include_deleted: bool = False,
    status: str | None = None,
    plant: str | None = None,
    line: str | None = None,
    q: str | None = None,
) -> list[dict[str, Any]]:
    status = trim_text(status, empty_to_none=True)
    plant = trim_text(plant, empty_to_none=True)
    line = trim_text(line, empty_to_none=True)
    q = trim_text(q, empty_to_none=True)
    clauses = []
    params: list[Any] = []
    if not include_deleted:
        clauses.append("is_deleted = 0")
    if status:
        clauses.append("status = ?")
        params.append(status.upper())
    if plant:
        clauses.append("COALESCE(plant_name, plant_code) = ?")
        params.append(plant)
    if line:
        clauses.append("COALESCE(line_name, line_code) = ?")
        params.append(line)
    if q:
        clauses.append("(device_name LIKE ? OR ip_address LIKE ? OR hostname LIKE ? OR connected_ap_name LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like, like])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with transaction() as conn:
        rows = conn.execute(
            f"""
            SELECT d.*,
                   (SELECT COUNT(*) FROM alerts a WHERE a.device_id = d.id AND a.status = 'ACTIVE') AS active_alert_count,
                   latest.check_method AS latest_check_method,
                   latest.error_message AS latest_monitoring_reason,
                   latest.checked_at AS latest_checked_at
            FROM network_devices d
            LEFT JOIN (
                SELECT device_id, check_method, error_message, checked_at
                FROM (
                    SELECT device_id, check_method, error_message, checked_at,
                           ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY checked_at DESC, id DESC) AS rn
                    FROM device_metrics
                ) ranked_metrics
                WHERE rn = 1
            ) latest ON latest.device_id = d.id
            {where}
            ORDER BY COALESCE(latest.checked_at, d.updated_at, d.created_at) DESC, d.device_name
            """,
            params,
        ).fetchall()
        return rows_to_dicts(rows)


@app.get("/api/devices/{device_id}")
def get_device_detail(device_id: int, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    with transaction() as conn:
        row = conn.execute(
            """
            SELECT d.*,
                   (SELECT COUNT(*) FROM alerts a WHERE a.device_id = d.id AND a.status = 'ACTIVE') AS active_alert_count,
                   latest.check_method AS latest_check_method,
                   latest.error_message AS latest_monitoring_reason,
                   latest.checked_at AS latest_checked_at
            FROM network_devices d
            LEFT JOIN (
                SELECT device_id, check_method, error_message, checked_at
                FROM (
                    SELECT device_id, check_method, error_message, checked_at,
                           ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY checked_at DESC, id DESC) AS rn
                    FROM device_metrics
                ) ranked_metrics
                WHERE rn = 1
            ) latest ON latest.device_id = d.id
            WHERE d.id = ?
            """,
            (device_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Device not found")
        return row_to_dict(row) or {}


@app.post("/api/devices", status_code=201)
def create_device(payload: DevicePayload, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    data = _validate_device_data(payload.model_dump())
    try:
        with transaction() as conn:
            columns = DEVICE_COLUMNS + ["created_by", "created_from_ip"]
            values = [data.get(column) for column in DEVICE_COLUMNS] + [actor.username, actor.ip_address]
            placeholders = ", ".join(["?"] * len(columns))
            cursor = conn.execute(
                f"INSERT INTO network_devices({', '.join(columns)}) VALUES ({placeholders})",
                values,
            )
            created = _get_device(conn, cursor.lastrowid)
            write_audit_log(
                conn,
                actor,
                "CREATE",
                "DEVICE",
                entity_id=cursor.lastrowid,
                target_ip_address=created["ip_address"],
                after_data=created,
                changed={},
            )
            return created
    except Exception as exc:
        _audit_failure(actor, "CREATE", "DEVICE", exc, data.get("ip_address"))
        if isinstance(exc, sqlite3.IntegrityError):
            raise HTTPException(status_code=409, detail="Device IP already exists") from exc
        raise


@app.put("/api/devices/{device_id}")
def update_device(device_id: int, payload: DevicePatch, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    patch = _validate_device_data(payload.model_dump(exclude_none=True), partial=True)
    if not patch:
        raise HTTPException(status_code=422, detail="No fields to update")
    try:
        with transaction() as conn:
            before = _get_device(conn, device_id)
            assignments = ", ".join([f"{field} = ?" for field in patch])
            values = list(patch.values()) + [actor.username, actor.ip_address, device_id]
            conn.execute(
                f"""
                UPDATE network_devices
                SET {assignments}, updated_by = ?, updated_from_ip = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                values,
            )
            after = _get_device(conn, device_id)
            write_audit_log(
                conn,
                actor,
                "UPDATE",
                "DEVICE",
                entity_id=device_id,
                target_ip_address=after.get("ip_address"),
                before_data=before,
                after_data=after,
                changed=changed_fields(before, after),
            )
            return after
    except Exception as exc:
        _audit_failure(actor, "UPDATE", "DEVICE", exc, patch.get("ip_address"))
        if isinstance(exc, sqlite3.IntegrityError):
            raise HTTPException(status_code=409, detail="Device IP already exists") from exc
        raise


@app.delete("/api/devices/{device_id}")
def delete_device(device_id: int, actor: Actor = Depends(get_actor)) -> dict[str, str]:
    require_admin(actor)
    try:
        with transaction() as conn:
            before = _get_device(conn, device_id)
            conn.execute(
                """
                UPDATE network_devices
                SET is_deleted = 1, deleted_by = ?, deleted_from_ip = ?, deleted_at = CURRENT_TIMESTAMP,
                    updated_by = ?, updated_from_ip = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (actor.username, actor.ip_address, actor.username, actor.ip_address, device_id),
            )
            after = _get_device(conn, device_id)
            write_audit_log(
                conn,
                actor,
                "DELETE",
                "DEVICE",
                entity_id=device_id,
                target_ip_address=before.get("ip_address"),
                before_data=before,
                after_data=after,
                changed=changed_fields(before, after),
            )
            return {"status": "deleted"}
    except Exception as exc:
        _audit_failure(actor, "DELETE", "DEVICE", exc)
        raise


@app.post("/api/devices/{device_id}/restore")
def restore_device(device_id: int, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    with transaction() as conn:
        before = _get_device(conn, device_id)
        conn.execute(
            """
            UPDATE network_devices
            SET is_deleted = 0, deleted_by = NULL, deleted_from_ip = NULL, deleted_at = NULL,
                updated_by = ?, updated_from_ip = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (actor.username, actor.ip_address, device_id),
        )
        after = _get_device(conn, device_id)
        write_audit_log(
            conn,
            actor,
            "UPDATE",
            "DEVICE",
            entity_id=device_id,
            target_ip_address=after.get("ip_address"),
            before_data=before,
            after_data=after,
            changed=changed_fields(before, after),
        )
        return after


@app.get("/api/users")
def list_users(actor: Actor = Depends(get_actor)) -> list[dict[str, Any]]:
    require_admin(actor)
    with transaction() as conn:
        rows = conn.execute(
            """
            SELECT * FROM users
            ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END, username
            """
        ).fetchall()
        return [_public_user(row_to_dict(row)) for row in rows if _public_user(row_to_dict(row))]


@app.post("/api/users", status_code=201)
def create_user(payload: UserCreatePayload, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    data = trim_strings(payload.model_dump(), empty_to_none=True)
    role = normalize_role(data.get("role"))
    username = data.get("username") or ""
    if not username:
        raise HTTPException(status_code=422, detail="Username is required")
    try:
        with transaction() as conn:
            cursor = conn.execute(
                """
                INSERT INTO users(username, display_name, email, role, password_hash, is_active, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    username,
                    data.get("display_name") or username,
                    data.get("email"),
                    role,
                    hash_password(data.get("password") or ""),
                    1 if data.get("is_active") else 0,
                    actor.username,
                ),
            )
            user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()) or {}
            public = _public_user(user) or {}
            write_audit_log(
                conn,
                actor,
                "CREATE",
                "USER",
                entity_id=public.get("id"),
                after_data=public,
                changed={},
            )
            return public
    except Exception as exc:
        _audit_failure(actor, "CREATE", "USER", exc)
        if isinstance(exc, sqlite3.IntegrityError):
            raise HTTPException(status_code=409, detail="Username already exists") from exc
        raise


@app.put("/api/users/{user_id}")
def update_user(user_id: int, payload: UserUpdatePayload, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    patch = trim_strings(payload.model_dump(exclude_none=True), empty_to_none=True)
    if "role" in patch:
        patch["role"] = normalize_role(patch["role"])
    if "is_active" in patch:
        patch["is_active"] = 1 if patch["is_active"] else 0
    if not patch:
        raise HTTPException(status_code=422, detail="No fields to update")
    with transaction() as conn:
        before = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
        if not before:
            raise HTTPException(status_code=404, detail="User not found")
        assignments = ", ".join([f"{field} = ?" for field in patch])
        conn.execute(
            f"UPDATE users SET {assignments}, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            list(patch.values()) + [actor.username, user_id],
        )
        after = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()) or {}
        before_public = _public_user(before) or {}
        after_public = _public_user(after) or {}
        write_audit_log(
            conn,
            actor,
            "UPDATE",
            "USER",
            entity_id=user_id,
            before_data=before_public,
            after_data=after_public,
            changed=changed_fields(before_public, after_public),
        )
        return after_public


@app.post("/api/users/{user_id}/reset-password")
def reset_user_password(user_id: int, payload: PasswordResetPayload, actor: Actor = Depends(get_actor)) -> dict[str, str]:
    require_admin(actor)
    with transaction() as conn:
        before = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
        if not before:
            raise HTTPException(status_code=404, detail="User not found")
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (hash_password(payload.password), actor.username, user_id),
        )
        write_audit_log(
            conn,
            actor,
            "UPDATE",
            "USER",
            entity_id=user_id,
            before_data={"id": user_id, "password": "unchanged"},
            after_data={"id": user_id, "password": "reset"},
            changed={"password": {"before": "unchanged", "after": "reset"}},
        )
        return {"status": "password_reset"}


@app.post("/api/users/{user_id}/deactivate")
def deactivate_user(user_id: int, actor: Actor = Depends(get_actor)) -> dict[str, str]:
    require_admin(actor)
    with transaction() as conn:
        before = _get_user_or_404(conn, user_id)
        _guard_user_removal(conn, before, actor, "deactivate")
        conn.execute(
            "UPDATE users SET is_active = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (actor.username, user_id),
        )
        after = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()) or {}
        before_public = _public_user(before) or {}
        after_public = _public_user(after) or {}
        write_audit_log(
            conn,
            actor,
            "UPDATE",
            "USER",
            entity_id=user_id,
            before_data=before_public,
            after_data=after_public,
            changed=changed_fields(before_public, after_public),
        )
        return {"status": "disabled"}


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, actor: Actor = Depends(get_actor)) -> dict[str, str]:
    require_admin(actor)
    with transaction() as conn:
        before = _get_user_or_404(conn, user_id)
        _guard_user_removal(conn, before, actor, "delete")
        before_public = _public_user(before) or {}
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        write_audit_log(
            conn,
            actor,
            "DELETE",
            "USER",
            entity_id=user_id,
            before_data=before_public,
            after_data={"id": user_id, "deleted": True},
            changed={"deleted": {"before": False, "after": True}},
        )
        return {"status": "deleted"}


@app.get("/api/audit-logs")
def audit_logs(
    date_from: str | None = None,
    date_to: str | None = None,
    username: str | None = None,
    source_ip: str | None = None,
    action_type: str | None = None,
    entity_type: str | None = None,
    target_ip: str | None = None,
    result: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> list[dict[str, Any]]:
    date_from = trim_text(date_from, empty_to_none=True)
    date_to = trim_text(date_to, empty_to_none=True)
    username = trim_text(username, empty_to_none=True)
    source_ip = trim_text(source_ip, empty_to_none=True)
    action_type = trim_text(action_type, empty_to_none=True)
    entity_type = trim_text(entity_type, empty_to_none=True)
    target_ip = trim_text(target_ip, empty_to_none=True)
    result = trim_text(result, empty_to_none=True)
    clauses = []
    params: list[Any] = []
    try:
        if date_from:
            clauses.append("created_at >= ?")
            params.append(local_datetime_filter_to_utc_storage(date_from))
        if date_to:
            clauses.append("created_at <= ?")
            params.append(local_datetime_filter_to_utc_storage(date_to))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid audit log date filter") from exc
    if username:
        clauses.append("actor_username LIKE ?")
        params.append(f"%{username}%")
    if source_ip:
        clauses.append("actor_ip_address LIKE ?")
        params.append(f"%{source_ip}%")
    if action_type:
        clauses.append("action_type = ?")
        params.append(action_type.upper())
    if entity_type:
        clauses.append("entity_type = ?")
        params.append(entity_type.upper())
    if target_ip:
        clauses.append("target_ip_address LIKE ?")
        params.append(f"%{target_ip}%")
    if result:
        clauses.append("result = ?")
        params.append(result.upper())
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    with transaction() as conn:
        rows = conn.execute(f"SELECT * FROM audit_logs {where} ORDER BY created_at DESC, id DESC LIMIT ?", params).fetchall()
        return rows_to_dicts(rows)


@app.get("/api/monitoring-logs")
def monitoring_logs(
    device_id: int | None = None,
    status: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> dict[str, Any]:
    status = trim_text(status, empty_to_none=True)
    clauses = []
    params: list[Any] = []
    if device_id:
        clauses.append("m.device_id = ?")
        params.append(device_id)
    if status:
        clauses.append("m.status = ?")
        params.append(status.upper())
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    with transaction() as conn:
        rows = conn.execute(
            f"""
            SELECT m.*, d.device_name, d.ip_address,
                   COALESCE(d.plant_name, d.plant_code) AS plant_name,
                   COALESCE(d.line_name, d.line_code) AS line_name
            FROM device_metrics m
            JOIN network_devices d ON d.id = m.device_id
            {where}
            ORDER BY m.checked_at DESC, m.id DESC
            LIMIT ?
            """,
            params,
        ).fetchall()
        runs = conn.execute("SELECT * FROM monitoring_runs ORDER BY started_at DESC, id DESC LIMIT 50").fetchall()
        return {
            "logs": rows_to_dicts(rows),
            "runs": rows_to_dicts(runs),
            "thresholds": {
                "ping_count": settings.ping_count,
                "tcp_fallback_ports": settings.tcp_fallback_ports,
                "collector_timeout_ms": settings.collector_timeout_ms,
                "warning_latency_ms": settings.warning_latency_ms,
                "critical_latency_ms": settings.critical_latency_ms,
                "warning_packet_loss_percent": settings.warning_packet_loss_percent,
            },
        }


@app.post("/api/monitoring/run-once")
async def run_monitoring_once(actor: Actor = Depends(get_actor)) -> dict[str, int]:
    require_admin(actor)
    return await run_monitoring_cycle()


def _get_access_point(conn: sqlite3.Connection, ap_id: int) -> dict[str, Any]:
    ap = row_to_dict(conn.execute("SELECT * FROM network_devices WHERE id = ?", (ap_id,)).fetchone())
    if not ap or str(ap.get("device_type") or "").upper() != "AP":
        raise HTTPException(status_code=404, detail="Access point not found")
    return ap


def _ap_client_scope_clause() -> str:
    return """
        d.is_deleted = 0
        AND UPPER(d.device_type) != 'AP'
        AND (
            (d.connected_ap_ip IS NOT NULL AND d.connected_ap_ip = ?)
            OR (d.connected_ap_name IS NOT NULL AND UPPER(d.connected_ap_name) = UPPER(?))
        )
    """


def _get_registered_ap_client(conn: sqlite3.Connection, ap: dict[str, Any], device_id: int) -> dict[str, Any]:
    row = conn.execute(
        f"""
        SELECT d.*
        FROM network_devices d
        WHERE d.id = ? AND {_ap_client_scope_clause()}
        """,
        (device_id, ap.get("ip_address"), ap.get("device_name")),
    ).fetchone()
    client = row_to_dict(row)
    if not client:
        raise HTTPException(status_code=404, detail="Registered AP client not found")
    return client


def _ap_client_device_data(ap: dict[str, Any], payload: dict[str, Any], partial: bool = False) -> dict[str, Any]:
    data = {key: value for key, value in payload.items() if value is not None}
    plant_value = ap.get("plant_name") or ap.get("plant_code") or "UNKNOWN"
    line_value = ap.get("line_name") or ap.get("line_code") or "UNKNOWN"
    if not partial:
        data["plant_name"] = plant_value
        data["line_name"] = line_value
        data["device_type"] = data.get("device_type") or "OTHER"
        data["criticality"] = data.get("criticality") or "MEDIUM"
        data["monitoring_enabled"] = data.get("monitoring_enabled", True)
    data.update(
        {
            "plant_code": plant_value,
            "plant_name": plant_value,
            "building": ap.get("building"),
            "floor": ap.get("floor"),
            "area": ap.get("area"),
            "zone": ap.get("zone"),
            "line_code": line_value,
            "line_name": line_value,
            "connected_ap_name": ap.get("device_name"),
            "connected_ap_ip": ap.get("ip_address"),
        }
    )
    if str(data.get("device_type") or "").upper() == "AP":
        raise HTTPException(status_code=422, detail="AP client device type cannot be AP")
    return _validate_device_data(data, partial=partial)


def _ap_summary(conn: sqlite3.Connection, ap: dict[str, Any]) -> dict[str, Any]:
    clients = rows_to_dicts(
        conn.execute(
            """
            SELECT c.*, d.device_name AS matched_device_name, d.criticality AS matched_device_criticality
            FROM ap_connected_clients_current c
            LEFT JOIN network_devices d ON d.id = c.matched_device_id
            WHERE c.ap_id = ?
            ORDER BY c.status, c.client_ip_address, c.client_hostname
            """,
            (ap["id"],),
        ).fetchall()
    )
    known_count = sum(1 for client in clients if client.get("is_known_device"))
    unknown_count = len(clients) - known_count
    return {
        "ap": ap,
        "connected_client_count": len(clients),
        "known_device_count": known_count,
        "unknown_device_count": unknown_count,
        "connected_ip_addresses": [client["client_ip_address"] for client in clients if client.get("client_ip_address")],
        "clients": clients,
    }


@app.get("/api/access-points/{ap_id}/clients")
def access_point_clients(ap_id: int) -> list[dict[str, Any]]:
    with transaction() as conn:
        _get_access_point(conn, ap_id)
        rows = conn.execute(
            """
            SELECT c.*, d.device_name AS matched_device_name, d.criticality AS matched_device_criticality,
                   d.connected_ap_name AS expected_ap_name, d.connected_ap_ip AS expected_ap_ip
            FROM ap_connected_clients_current c
            LEFT JOIN network_devices d ON d.id = c.matched_device_id
            WHERE c.ap_id = ?
            ORDER BY CASE c.status
                WHEN 'IP_CONFLICT' THEN 0
                WHEN 'WRONG_AP' THEN 1
                WHEN 'UNKNOWN_DEVICE' THEN 2
                WHEN 'NO_IP' THEN 3
                WHEN 'WEAK_SIGNAL' THEN 4
                ELSE 5 END,
                c.client_ip_address, c.client_hostname
            """,
            (ap_id,),
        ).fetchall()
        return rows_to_dicts(rows)


@app.get("/api/access-points/{ap_id}/registered-clients")
def list_registered_ap_clients(ap_id: int) -> list[dict[str, Any]]:
    with transaction() as conn:
        ap = _get_access_point(conn, ap_id)
        rows = conn.execute(
            f"""
            SELECT d.*
            FROM network_devices d
            WHERE {_ap_client_scope_clause()}
            ORDER BY d.device_name
            """,
            (ap.get("ip_address"), ap.get("device_name")),
        ).fetchall()
        return rows_to_dicts(rows)


@app.post("/api/access-points/{ap_id}/registered-clients", status_code=201)
def create_registered_ap_client(
    ap_id: int,
    payload: APClientRegistrationPayload,
    actor: Actor = Depends(get_actor),
) -> dict[str, Any]:
    require_admin(actor)
    with transaction() as conn:
        ap = _get_access_point(conn, ap_id)
        data = _ap_client_device_data(ap, payload.model_dump(), partial=False)
        try:
            columns = DEVICE_COLUMNS + ["created_by", "created_from_ip"]
            values = [data.get(column) for column in DEVICE_COLUMNS] + [actor.username, actor.ip_address]
            cursor = conn.execute(
                f"INSERT INTO network_devices({', '.join(columns)}) VALUES ({', '.join(['?'] * len(columns))})",
                values,
            )
            created = row_to_dict(conn.execute("SELECT * FROM network_devices WHERE id = ?", (cursor.lastrowid,)).fetchone()) or {}
            write_audit_log(
                conn,
                actor,
                "CREATE",
                "AP_CLIENT",
                entity_id=cursor.lastrowid,
                target_ip_address=created.get("ip_address"),
                after_data=created,
                changed={},
            )
            return created
        except Exception as exc:
            _audit_failure(actor, "CREATE", "AP_CLIENT", exc, data.get("ip_address"))
            if isinstance(exc, sqlite3.IntegrityError):
                raise HTTPException(status_code=409, detail="Client IP already exists in Device Master") from exc
            raise


@app.put("/api/access-points/{ap_id}/registered-clients/{device_id}")
def update_registered_ap_client(
    ap_id: int,
    device_id: int,
    payload: APClientRegistrationPatch,
    actor: Actor = Depends(get_actor),
) -> dict[str, Any]:
    require_admin(actor)
    with transaction() as conn:
        ap = _get_access_point(conn, ap_id)
        before = _get_registered_ap_client(conn, ap, device_id)
        patch = _ap_client_device_data(ap, payload.model_dump(exclude_none=True), partial=True)
        if not patch:
            raise HTTPException(status_code=422, detail="No fields to update")
        try:
            assignments = ", ".join([f"{field} = ?" for field in patch])
            conn.execute(
                f"""
                UPDATE network_devices
                SET {assignments}, updated_by = ?, updated_from_ip = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                list(patch.values()) + [actor.username, actor.ip_address, device_id],
            )
            after = _get_registered_ap_client(conn, ap, device_id)
            write_audit_log(
                conn,
                actor,
                "UPDATE",
                "AP_CLIENT",
                entity_id=device_id,
                target_ip_address=after.get("ip_address"),
                before_data=before,
                after_data=after,
                changed=changed_fields(before, after),
            )
            return after
        except Exception as exc:
            _audit_failure(actor, "UPDATE", "AP_CLIENT", exc, patch.get("ip_address"))
            if isinstance(exc, sqlite3.IntegrityError):
                raise HTTPException(status_code=409, detail="Client IP already exists in Device Master") from exc
            raise


@app.delete("/api/access-points/{ap_id}/registered-clients/{device_id}")
def delete_registered_ap_client(
    ap_id: int,
    device_id: int,
    actor: Actor = Depends(get_actor),
) -> dict[str, str]:
    require_admin(actor)
    with transaction() as conn:
        ap = _get_access_point(conn, ap_id)
        before = _get_registered_ap_client(conn, ap, device_id)
        conn.execute(
            """
            UPDATE network_devices
            SET is_deleted = 1, deleted_by = ?, deleted_from_ip = ?, deleted_at = CURRENT_TIMESTAMP,
                updated_by = ?, updated_from_ip = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (actor.username, actor.ip_address, actor.username, actor.ip_address, device_id),
        )
        after = row_to_dict(conn.execute("SELECT * FROM network_devices WHERE id = ?", (device_id,)).fetchone()) or {}
        write_audit_log(
            conn,
            actor,
            "DELETE",
            "AP_CLIENT",
            entity_id=device_id,
            target_ip_address=before.get("ip_address"),
            before_data=before,
            after_data=after,
            changed=changed_fields(before, after),
        )
        return {"status": "deleted"}


@app.get("/api/access-points/{ap_id}/clients/history")
def access_point_client_history(
    ap_id: int,
    limit: int = Query(200, ge=1, le=1000),
) -> list[dict[str, Any]]:
    with transaction() as conn:
        _get_access_point(conn, ap_id)
        rows = conn.execute(
            """
            SELECT *
            FROM ap_client_observations
            WHERE ap_id = ?
            ORDER BY last_seen DESC, id DESC
            LIMIT ?
            """,
            (ap_id, limit),
        ).fetchall()
        return rows_to_dicts(rows)


@app.get("/api/access-points/{ap_id}/summary")
def access_point_summary(ap_id: int) -> dict[str, Any]:
    with transaction() as conn:
        ap = _get_access_point(conn, ap_id)
        return _ap_summary(conn, ap)


@app.get("/api/dashboard/by-ap")
def dashboard_by_ap() -> list[dict[str, Any]]:
    with transaction() as conn:
        aps = rows_to_dicts(
            conn.execute(
                """
                SELECT *
                FROM network_devices
                WHERE is_deleted = 0 AND UPPER(device_type) = 'AP'
                ORDER BY COALESCE(plant_name, plant_code), COALESCE(line_name, line_code), device_name
                """
            ).fetchall()
        )
        return [_ap_summary(conn, ap) for ap in aps]


@app.post("/api/discovery/ap-clients/run")
async def run_ap_client_discovery_once(actor: Actor = Depends(get_actor)) -> dict[str, int]:
    require_admin(actor)
    try:
        result = await run_ap_client_discovery_cycle(actor=actor)
        with transaction() as conn:
            write_audit_log(
                conn,
                actor,
                "DISCOVERY_RUN",
                "AP_CLIENTS",
                after_data=result,
            )
        return result
    except Exception as exc:
        _audit_failure(actor, "DISCOVERY_RUN", "AP_CLIENTS", exc)
        raise


@app.get("/api/alerts/ap-client-issues")
def ap_client_issue_alerts(status: str | None = None) -> list[dict[str, Any]]:
    status = trim_text(status, empty_to_none=True)
    params: list[Any] = list(AP_CLIENT_ALERT_TYPES)
    placeholders = ", ".join(["?"] * len(params))
    clauses = [f"a.alert_type IN ({placeholders})"]
    if status:
        clauses.append("a.status = ?")
        params.append(status.upper())
    where = f"WHERE {' AND '.join(clauses)}"
    with transaction() as conn:
        rows = conn.execute(
            f"""
            SELECT a.*, d.device_name, d.ip_address,
                   COALESCE(d.plant_name, d.plant_code) AS plant_name,
                   COALESCE(d.line_name, d.line_code) AS line_name,
                   d.connected_ap_name
            FROM alerts a
            LEFT JOIN network_devices d ON d.id = a.device_id
            {where}
            ORDER BY CASE a.status WHEN 'ACTIVE' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END,
                     a.last_detected_at DESC
            """,
            params,
        ).fetchall()
        return rows_to_dicts(rows)


@app.get("/api/alerts")
def list_alerts(status: str | None = None) -> list[dict[str, Any]]:
    status = trim_text(status, empty_to_none=True)
    params: list[Any] = []
    where = ""
    if status:
        where = "WHERE a.status = ?"
        params.append(status.upper())
    with transaction() as conn:
        rows = conn.execute(
            f"""
            SELECT a.*, d.device_name, d.ip_address,
                   COALESCE(d.plant_name, d.plant_code) AS plant_name,
                   COALESCE(d.line_name, d.line_code) AS line_name,
                   d.connected_ap_name
            FROM alerts a
            LEFT JOIN network_devices d ON d.id = a.device_id
            {where}
            ORDER BY CASE a.status WHEN 'ACTIVE' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END,
                     a.last_detected_at DESC
            """,
            params,
        ).fetchall()
        return rows_to_dicts(rows)


def _change_alert_status(alert_id: int, actor: Actor, status: str) -> dict[str, Any]:
    require_admin(actor)
    with transaction() as conn:
        before = row_to_dict(conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone())
        if not before:
            raise HTTPException(status_code=404, detail="Alert not found")
        if status == "ACKNOWLEDGED":
            conn.execute(
                """
                UPDATE alerts
                SET status = 'ACKNOWLEDGED', acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP,
                    last_detected_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (actor.username, alert_id),
            )
            action = "ACK_ALERT"
        else:
            conn.execute(
                """
                UPDATE alerts
                SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP, last_detected_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (alert_id,),
            )
            action = "RESOLVE_ALERT"
        after = row_to_dict(conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()) or {}
        write_audit_log(
            conn,
            actor,
            action,
            "ALERT",
            entity_id=alert_id,
            before_data=before,
            after_data=after,
            changed=changed_fields(before, after),
        )
        return after


@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    return _change_alert_status(alert_id, actor, "ACKNOWLEDGED")


@app.post("/api/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: int, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    return _change_alert_status(alert_id, actor, "RESOLVED")


@app.get("/api/notifications")
def list_notifications(unread_only: bool = False) -> list[dict[str, Any]]:
    where = "WHERE read_at IS NULL" if unread_only else ""
    with transaction() as conn:
        notifications = rows_to_dicts(
            conn.execute(
                f"""
                SELECT n.*, a.alert_type, a.severity, a.status AS alert_status,
                       d.device_name, d.ip_address
                FROM notifications n
                LEFT JOIN alerts a ON a.id = n.alert_id
                LEFT JOIN network_devices d ON d.id = a.device_id
                {where}
                ORDER BY n.created_at DESC
                LIMIT 100
                """
            ).fetchall()
        )
        for notification in notifications:
            notification["notification_muted"] = notification_muted(conn, notification.get("alert_type") or "")
        return notifications


def _known_notification_alert_types(conn: sqlite3.Connection) -> list[str]:
    known = set(NETWORK_ALERT_SETTING_BY_TYPE) | set(AP_ALERT_SETTING_BY_TYPE)
    rows = conn.execute("SELECT DISTINCT alert_type FROM alerts WHERE alert_type IS NOT NULL").fetchall()
    known.update(str(row["alert_type"]).upper() for row in rows if row["alert_type"])
    return sorted(known)


@app.get("/api/notification-mutes")
def list_notification_mutes() -> list[dict[str, Any]]:
    with transaction() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT key, value, updated_by, updated_from_ip, updated_at
                FROM system_settings
                WHERE key LIKE 'notification_mute_%'
                ORDER BY key
                """
            ).fetchall()
        )
        by_key = {row["key"]: row for row in rows}
        result: list[dict[str, Any]] = []
        for alert_type in _known_notification_alert_types(conn):
            key = notification_mute_key(alert_type)
            row = by_key.get(key, {})
            result.append(
                {
                    "alert_type": alert_type,
                    "muted": bool_value(row.get("value")) if row else False,
                    "key": key,
                    "updated_by": row.get("updated_by"),
                    "updated_from_ip": row.get("updated_from_ip"),
                    "updated_at": row.get("updated_at"),
                }
            )
        return result


@app.post("/api/notification-mutes/{alert_type}")
def set_notification_mute(alert_type: str, payload: NotificationMutePayload, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    normalized_type = str(trim_text(alert_type, empty_to_none=True) or "").upper()
    key = notification_mute_key(normalized_type)
    value = "true" if payload.muted else "false"
    with transaction() as conn:
        before = row_to_dict(conn.execute("SELECT * FROM system_settings WHERE key = ?", (key,)).fetchone())
        if before:
            conn.execute(
                """
                UPDATE system_settings
                SET value = ?, updated_by = ?, updated_from_ip = ?, updated_at = CURRENT_TIMESTAMP
                WHERE key = ?
                """,
                (value, actor.username, actor.ip_address, key),
            )
        else:
            conn.execute(
                """
                INSERT INTO system_settings(key, value, updated_by, updated_from_ip)
                VALUES (?, ?, ?, ?)
                """,
                (key, value, actor.username, actor.ip_address),
            )
        after = row_to_dict(conn.execute("SELECT * FROM system_settings WHERE key = ?", (key,)).fetchone()) or {}
        write_audit_log(
            conn,
            actor,
            "MUTE_NOTIFICATION" if payload.muted else "UNMUTE_NOTIFICATION",
            "NOTIFICATION",
            entity_id=normalized_type,
            before_data=before,
            after_data=after,
            changed=changed_fields(before or {}, after),
        )
        return {
            "alert_type": normalized_type,
            "muted": payload.muted,
            "key": key,
            "updated_by": actor.username,
            "updated_from_ip": actor.ip_address,
        }


@app.post("/api/notifications/{notification_id}/read")
def read_notification(notification_id: int) -> dict[str, str]:
    with transaction() as conn:
        conn.execute("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ?", (notification_id,))
        return {"status": "read"}


@app.get("/api/import/template/devices.xlsx")
def download_import_template(actor: Actor = Depends(get_actor)) -> StreamingResponse:
    require_admin(actor)
    return _stream_bytes(
        build_template_workbook(),
        "devices-template.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.post("/api/import/devices/preview")
async def preview_import(file: UploadFile = File(...), actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    payload = await file.read()
    with transaction() as conn:
        results = validate_import_rows(conn, payload)
        job = create_import_job(conn, file.filename or "devices.xlsx", actor, results)
        write_audit_log(
            conn,
            actor,
            "IMPORT",
            "DEVICE",
            entity_id=job["id"],
            after_data={
                "file_name": job["file_name"],
                "total_rows": job["total_rows"],
                "valid_rows": job["valid_rows"],
                "warning_rows": job["warning_rows"],
                "error_rows": job["error_rows"],
            },
            changed={},
        )
        return job


@app.post("/api/import/devices/commit")
def commit_import(payload: ImportCommitRequest, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    with transaction() as conn:
        return commit_import_job(conn, payload.import_job_id, actor)


@app.get("/api/export/devices.xlsx")
def export_devices(actor: Actor = Depends(get_actor)) -> StreamingResponse:
    require_admin(actor)
    with transaction() as conn:
        rows = devices_rows(conn, include_deleted=True)
        payload = devices_workbook(conn, include_deleted=True)
        export_job(conn, actor, "devices", "devices.xlsx", len(rows))
    return _stream_bytes(payload, "devices.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.post("/api/export/selected-devices.xlsx")
def export_selected_devices(payload: SelectedDevicesExportRequest, actor: Actor = Depends(get_actor)) -> StreamingResponse:
    with transaction() as conn:
        rows = _selected_device_export_rows(conn, payload.device_ids)
        workbook_payload = workbook_from_rows("selected_devices", SELECTED_DEVICE_EXPORT_COLUMNS, rows)
        export_job(conn, actor, "selected-devices", "selected-devices.xlsx", len(rows))
    return _stream_bytes(workbook_payload, "selected-devices.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/export/plants.xlsx")
def export_plants(actor: Actor = Depends(get_actor)) -> StreamingResponse:
    require_admin(actor)
    with transaction() as conn:
        rows = plants_rows(conn)
        payload = simple_rows_workbook("plants", rows)
        export_job(conn, actor, "plants", "plants.xlsx", len(rows))
    return _stream_bytes(payload, "plants.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/export/access-points.xlsx")
def export_access_points(actor: Actor = Depends(get_actor)) -> StreamingResponse:
    require_admin(actor)
    with transaction() as conn:
        rows = access_points_rows(conn)
        payload = simple_rows_workbook("access_points", rows)
        export_job(conn, actor, "access-points", "access-points.xlsx", len(rows))
    return _stream_bytes(payload, "access-points.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/export/audit-logs.xlsx")
def export_audit_logs(actor: Actor = Depends(get_actor)) -> StreamingResponse:
    require_admin(actor)
    with transaction() as conn:
        row_count = conn.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0]
        payload = audit_logs_workbook(conn)
        export_job(conn, actor, "audit-logs", "audit-logs.xlsx", row_count)
    return _stream_bytes(payload, "audit-logs.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/export/full-backup.zip")
def export_full_backup(actor: Actor = Depends(get_actor)) -> StreamingResponse:
    require_admin(actor)
    with transaction() as conn:
        payload = full_backup_zip(conn)
        row_count = conn.execute("SELECT COUNT(*) FROM network_devices").fetchone()[0]
        export_job(conn, actor, "full-backup", "full-backup.zip", row_count)
    return _stream_bytes(payload, "full-backup.zip", "application/zip")


@app.get("/api/export/migration.json")
def export_migration(actor: Actor = Depends(get_actor)) -> JSONResponse:
    require_admin(actor)
    with transaction() as conn:
        payload = migration_payload(conn)
        export_job(conn, actor, "migration", "migration.json", len(payload["tables"].get("network_devices", [])))
        return JSONResponse(payload)


@app.get("/api/system-settings")
def get_system_settings() -> dict[str, str]:
    with transaction() as conn:
        rows = conn.execute("SELECT key, value FROM system_settings ORDER BY key").fetchall()
        values = {row["key"]: row["value"] for row in rows}
        values["monitoring_interval_seconds"] = str(
            normalize_monitoring_interval_seconds(values.get("monitoring_interval_seconds"))
        )
        return values


def _clear_disabled_alarm_state(conn: sqlite3.Connection, settings_values: dict[str, Any]) -> None:
    alert_types = sorted(disabled_alert_types(settings_values))
    if not alert_types:
        return
    placeholders = ", ".join(["?"] * len(alert_types))
    conn.execute(
        f"""
        UPDATE alerts
        SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP, last_detected_at = CURRENT_TIMESTAMP
        WHERE alert_type IN ({placeholders}) AND status IN ('ACTIVE', 'ACKNOWLEDGED')
        """,
        alert_types,
    )
    conn.execute(
        f"""
        UPDATE notifications
        SET read_at = CURRENT_TIMESTAMP
        WHERE read_at IS NULL
          AND alert_id IN (SELECT id FROM alerts WHERE alert_type IN ({placeholders}))
        """,
        alert_types,
    )


def _normalize_system_setting_value(key: str, value: Any) -> str:
    value_text = "" if value is None else str(value).strip()
    if key == "monitoring_interval_seconds":
        return str(normalize_monitoring_interval_seconds(value_text))
    return value_text


@app.put("/api/system-settings")
def update_system_settings(payload: BulkSettingsPayload, actor: Actor = Depends(get_actor)) -> dict[str, str]:
    require_admin(actor)
    incoming_settings = trim_strings(payload.settings, empty_to_none=False)
    with transaction() as conn:
        before = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM system_settings").fetchall()}
        for raw_key, value in incoming_settings.items():
            key = str(raw_key or "").strip()
            if not key:
                continue
            value = _normalize_system_setting_value(key, value)
            exists = conn.execute("SELECT COUNT(*) FROM system_settings WHERE key = ?", (key,)).fetchone()[0]
            if exists:
                conn.execute(
                    """
                    UPDATE system_settings
                    SET value = ?, updated_by = ?, updated_from_ip = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE key = ?
                    """,
                    (str(value), actor.username, actor.ip_address, key),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO system_settings(key, value, updated_by, updated_from_ip, updated_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    (key, str(value), actor.username, actor.ip_address),
                )
        after = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM system_settings").fetchall()}
        settings.collector_interval_seconds = normalize_monitoring_interval_seconds(after.get("monitoring_interval_seconds"))
        _clear_disabled_alarm_state(conn, after)
        write_audit_log(
            conn,
            actor,
            "SETTINGS_CHANGE",
            "SYSTEM_SETTING",
            before_data=before,
            after_data=after,
            changed=changed_fields(before, after),
        )
        return after


@app.get("/api/reference")
def reference_data() -> dict[str, list[dict[str, Any]]]:
    with transaction() as conn:
        return {
            "plants": plants_rows(conn),
            "access_points": access_points_rows(conn),
            "device_types": [{"value": value} for value in sorted(VALID_DEVICE_TYPES)],
            "criticality": [{"value": value} for value in sorted(VALID_CRITICALITY)],
        }


def _count_table(conn: sqlite3.Connection, table_name: str) -> int:
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0])
    except Exception:
        return 0


def _json_or_none(value: Any) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return None


def _latest_one(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    return row_to_dict(conn.execute(sql, params).fetchone())


def _source_map_sections(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    provider = settings.traffic_default_provider or "not-configured"
    ap_provider = settings.ap_client_default_provider or "not-configured"
    return [
        {
            "name": "Device Master",
            "purpose": "Base inventory: device name, IP, MAC, Plant, Line, AP, Switch, location, owner, criticality.",
            "table": "network_devices",
            "records": _count_table(conn, "network_devices"),
            "writes": ["Device Master UI", "Excel Import", "POST /api/devices", "PUT /api/devices/{id}"],
            "reads": ["Dashboard", "Device Master", "Traffic Graphs", "AP Clients matching", "Display Dashboard API"],
        },
        {
            "name": "Ping Monitoring",
            "purpose": "ONLINE/WARNING/OFFLINE/CRITICAL status, latency, ICMP loss, TCP fallback result.",
            "table": "device_metrics",
            "records": _count_table(conn, "device_metrics"),
            "worker": "ping monitoring worker",
            "source": "Backend server inside company network",
            "settings": {
                "interval_seconds": settings.collector_interval_seconds,
                "ping_count": settings.ping_count,
                "timeout_ms": settings.collector_timeout_ms,
                "tcp_fallback_ports": settings.tcp_fallback_ports,
                "corporate_networks": settings.corporate_networks,
            },
        },
        {
            "name": "AP Client Discovery",
            "purpose": "Wireless clients currently seen by each AP/controller: IP, MAC, hostname, SSID, VLAN, RSSI, AP association.",
            "tables": ["ap_client_observations", "ap_connected_clients_current", "ap_client_discovery_runs"],
            "records": {
                "observations": _count_table(conn, "ap_client_observations"),
                "current": _count_table(conn, "ap_connected_clients_current"),
                "runs": _count_table(conn, "ap_client_discovery_runs"),
            },
            "worker": "ap_client_discovery_worker.py",
            "provider": ap_provider,
            "tokens_exposed_to_frontend": False,
        },
        {
            "name": "Traffic",
            "purpose": "RX/TX current, min, avg, max, utilization, interface and source.",
            "table": "network_traffic_metrics",
            "records": _count_table(conn, "network_traffic_metrics"),
            "worker": "traffic monitoring worker or POST /api/traffic/observations",
            "provider": provider,
            "real_data_inputs": ["generic-api", "cisco-wlc", "generic-snmp", "POST /api/traffic/observations"],
            "demo_hidden_when_not_selected": provider not in {"demo", "local-demo"},
            "tokens_exposed_to_frontend": False,
        },
        {
            "name": "Alerts and Notifications",
            "purpose": "Network/AP/traffic issues surfaced to Dashboard, notification bell, and Alert Center.",
            "tables": ["alerts", "notifications"],
            "records": {
                "alerts": _count_table(conn, "alerts"),
                "notifications": _count_table(conn, "notifications"),
            },
            "writes": ["Ping worker", "AP client discovery worker", "Alert Center actions", "Alarm Settings"],
        },
        {
            "name": "Audit and Import/Export",
            "purpose": "Who changed or imported data, source IP, action type, target IP, before/after data.",
            "tables": ["audit_logs", "import_jobs", "import_job_rows", "export_jobs"],
            "records": {
                "audit_logs": _count_table(conn, "audit_logs"),
                "import_jobs": _count_table(conn, "import_jobs"),
                "export_jobs": _count_table(conn, "export_jobs"),
            },
            "writes": ["Login", "Device CRUD", "User CRUD", "Excel Import", "Exports", "Manual runs", "Settings changes"],
        },
        {
            "name": "Dashboard/API Consumers",
            "purpose": "Screens and external displays read normalized data through backend APIs.",
            "endpoints": [
                "GET /api/dashboard/summary",
                "GET /api/devices",
                "GET /api/traffic/summary",
                "GET /api/dashboard/by-ap",
                "GET /api/display/dashboard",
                "GET /api/source-map",
            ],
        },
    ]


def _device_source_map(conn: sqlite3.Connection, device_id: int | None, ip_address: str | None) -> dict[str, Any]:
    ip_address = trim_text(ip_address, empty_to_none=True)
    device = None
    if device_id:
        device = row_to_dict(conn.execute("SELECT * FROM network_devices WHERE id = ?", (device_id,)).fetchone())
    elif ip_address:
        device = row_to_dict(conn.execute("SELECT * FROM network_devices WHERE ip_address = ?", (ip_address,)).fetchone())
    if not device and (device_id or ip_address):
        raise HTTPException(status_code=404, detail="Source map target not found")
    if not device:
        return {
            "target": None,
            "latest_monitoring": None,
            "latest_traffic": None,
            "ap_current": [],
            "ap_observations": [],
            "alerts": [],
            "audit_logs": [],
            "import_rows": [],
        }

    device_ip = device.get("ip_address")
    device_mac = device.get("mac_address")
    latest_traffic = _latest_one(
        conn,
        """
        SELECT *
        FROM network_traffic_metrics
        WHERE device_id = ?
        ORDER BY collected_at DESC, id DESC
        LIMIT 1
        """,
        (device["id"],),
    )
    if latest_traffic:
        latest_traffic["raw_data"] = _json_or_none(latest_traffic.pop("raw_data_json", None))
    latest_monitoring = _latest_one(
        conn,
        """
        SELECT *
        FROM device_metrics
        WHERE device_id = ?
        ORDER BY checked_at DESC, id DESC
        LIMIT 1
        """,
        (device["id"],),
    )
    ap_current = rows_to_dicts(
        conn.execute(
            """
            SELECT c.*, ap.device_name AS ap_name, ap.ip_address AS ap_ip_address
            FROM ap_connected_clients_current c
            LEFT JOIN network_devices ap ON ap.id = c.ap_id
            WHERE c.matched_device_id = ?
               OR (? IS NOT NULL AND c.client_ip_address = ?)
               OR (? IS NOT NULL AND UPPER(c.client_mac_address) = UPPER(?))
            ORDER BY c.last_seen DESC, c.id DESC
            LIMIT 20
            """,
            (device["id"], device_ip, device_ip, device_mac, device_mac),
        ).fetchall()
    )
    ap_observations = rows_to_dicts(
        conn.execute(
            """
            SELECT *
            FROM ap_client_observations
            WHERE (? IS NOT NULL AND client_ip_address = ?)
               OR (? IS NOT NULL AND UPPER(client_mac_address) = UPPER(?))
            ORDER BY last_seen DESC, id DESC
            LIMIT 20
            """,
            (device_ip, device_ip, device_mac, device_mac),
        ).fetchall()
    )
    for row in ap_observations:
        row["raw_data"] = _json_or_none(row.pop("raw_data_json", None))
    alerts = rows_to_dicts(
        conn.execute(
            """
            SELECT *
            FROM alerts
            WHERE device_id = ?
            ORDER BY last_detected_at DESC, id DESC
            LIMIT 20
            """,
            (device["id"],),
        ).fetchall()
    )
    audit_logs = rows_to_dicts(
        conn.execute(
            """
            SELECT id, actor_username, actor_role, actor_ip_address, action_type, entity_type,
                   entity_id, target_ip_address, result, error_message, created_at
            FROM audit_logs
            WHERE entity_id = ? OR target_ip_address = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 20
            """,
            (str(device["id"]), device_ip),
        ).fetchall()
    )
    import_rows = rows_to_dicts(
        conn.execute(
            """
            SELECT r.id, r.import_job_id, r.row_number, r.validation_status, r.validation_message,
                   j.file_name, j.uploaded_by, j.uploaded_from_ip, j.created_at
            FROM import_job_rows r
            JOIN import_jobs j ON j.id = r.import_job_id
            WHERE r.row_data_json LIKE ?
            ORDER BY j.created_at DESC, r.id DESC
            LIMIT 20
            """,
            (f"%{device_ip}%",),
        ).fetchall()
    )
    return {
        "target": device,
        "latest_monitoring": latest_monitoring,
        "latest_traffic": latest_traffic,
        "ap_current": ap_current,
        "ap_observations": ap_observations,
        "alerts": alerts,
        "audit_logs": audit_logs,
        "import_rows": import_rows,
    }


@app.get("/api/source-map")
def source_map(
    device_id: int | None = None,
    ip_address: str | None = None,
    actor: Actor = Depends(get_actor),
) -> dict[str, Any]:
    require_admin(actor)
    ip_address = trim_text(ip_address, empty_to_none=True)
    with transaction() as conn:
        device_map = _device_source_map(conn, device_id, ip_address)
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "requested_by": {
                "username": actor.username,
                "role": actor.role,
                "ip_address": actor.ip_address,
            },
            "database": {
                "engine": settings.database_engine,
                "target": settings.mssql_server if settings.database_engine == "mssql" else str(settings.database_path),
            },
            "runtime": {
                "traffic_provider": settings.traffic_default_provider or "not-configured",
                "ap_client_provider": settings.ap_client_default_provider or "not-configured",
                "collector_enabled": settings.collector_enabled,
                "ap_client_discovery_enabled": settings.ap_client_discovery_enabled,
                "traffic_collection_enabled": settings.traffic_collection_enabled,
            },
            "sections": _source_map_sections(conn),
            "device": device_map,
        }


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/display")
@app.get("/display/{_path:path}")
def display_page() -> FileResponse:
    index_path = settings.frontend_dist_path / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend dashboard is not built")
    return FileResponse(index_path)


if settings.frontend_dist_path.exists():
    app.mount("/", StaticFiles(directory=settings.frontend_dist_path, html=True), name="frontend")
