from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import hmac
import json
import os
import sqlite3
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .ap_client_discovery_worker import AP_CLIENT_ALERT_TYPES, ap_client_discovery_loop, run_ap_client_discovery_cycle
from .audit import changed_fields, write_audit_log
from .auth import bearer_token_from_request, create_token, decode_token, hash_password, normalize_role, verify_password
from .config import settings
from .db import DEVICE_COLUMNS, connect, init_db, row_to_dict, rows_to_dicts, transaction
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
)
from .monitor import collector_loop, run_monitoring_cycle
from .schemas import (
    APClientRegistrationPatch,
    APClientRegistrationPayload,
    BulkSettingsPayload,
    DevicePatch,
    DevicePayload,
    DisplayDashboardRequest,
    ImportCommitRequest,
    LoginRequest,
    PasswordResetPayload,
    UserCreatePayload,
    UserUpdatePayload,
)
from .security import Actor, actor_from_request, require_admin
from .timezone import local_datetime_filter_to_utc_storage
from .validation import VALID_CRITICALITY, VALID_DEVICE_TYPES, normalize_upper, validate_ip, validate_mac


collector_stop_event: asyncio.Event | None = None
collector_task: asyncio.Task | None = None
ap_discovery_stop_event: asyncio.Event | None = None
ap_discovery_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global collector_stop_event, collector_task, ap_discovery_stop_event, ap_discovery_task
    init_db()
    if settings.collector_enabled:
        collector_stop_event = asyncio.Event()
        collector_task = asyncio.create_task(collector_loop(collector_stop_event))
    if settings.ap_client_discovery_enabled:
        ap_discovery_stop_event = asyncio.Event()
        ap_discovery_task = asyncio.create_task(ap_client_discovery_loop(ap_discovery_stop_event))
    yield
    if collector_stop_event:
        collector_stop_event.set()
    if ap_discovery_stop_event:
        ap_discovery_stop_event.set()
    if collector_task:
        await collector_task
    if ap_discovery_task:
        await ap_discovery_task


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


def _device_filter_clauses(filters: dict[str, Any], alias: str = "d", include_deleted_clause: bool = True) -> tuple[list[str], list[Any]]:
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


def _dashboard_display_payload(conn: sqlite3.Connection, filters: dict[str, Any]) -> dict[str, Any]:
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
        "by_ap": by_ap,
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/backend/runtime")
def backend_runtime(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
    require_admin(actor)
    database: dict[str, Any]
    if settings.database_engine == "mssql":
        database = {
            "engine": "mssql",
            "server": settings.mssql_server,
            "port": settings.mssql_port,
            "database": settings.mssql_database,
            "driver": settings.mssql_driver,
            "trust_server_certificate": settings.mssql_trust_server_certificate,
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
            "ping_interval_seconds": settings.collector_interval_seconds,
            "ping_count": settings.ping_count,
            "tcp_fallback_ports": settings.tcp_fallback_ports,
            "ap_client_discovery_enabled": settings.ap_client_discovery_enabled,
            "ap_client_discovery_interval_seconds": settings.ap_client_discovery_interval_seconds,
        },
        "api": {
            "docs": "/docs",
            "dashboard_get": "/api/display/dashboard",
            "dashboard_post": "/api/display/dashboard",
            "display_page": "/display",
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
        return {
            "total_devices": total_devices,
            "status_counts": status_counts,
            "active_alerts": active_alerts,
            "critical_alerts": critical_alerts,
            "unread_notifications": unread_notifications,
            "status_by_plant": by_plant,
            "recent_alerts": recent_alerts,
            "recent_metrics": recent_metrics,
        }


@app.get("/api/devices")
def list_devices(
    include_deleted: bool = False,
    status: str | None = None,
    plant: str | None = None,
    line: str | None = None,
    q: str | None = None,
) -> list[dict[str, Any]]:
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
                   latest.error_message AS latest_monitoring_reason
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
            {where}
            ORDER BY COALESCE(d.plant_name, d.plant_code), COALESCE(d.line_name, d.line_code), d.device_name
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
                   latest.error_message AS latest_monitoring_reason
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
    role = normalize_role(payload.role)
    username = payload.username.strip()
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
                    payload.display_name or username,
                    payload.email,
                    role,
                    hash_password(payload.password),
                    1 if payload.is_active else 0,
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
    patch = payload.model_dump(exclude_none=True)
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
        return rows_to_dicts(
            conn.execute(f"SELECT * FROM notifications {where} ORDER BY created_at DESC LIMIT 100").fetchall()
        )


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
        return {row["key"]: row["value"] for row in rows}


@app.put("/api/system-settings")
def update_system_settings(payload: BulkSettingsPayload, actor: Actor = Depends(get_actor)) -> dict[str, str]:
    require_admin(actor)
    with transaction() as conn:
        before = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM system_settings").fetchall()}
        for key, value in payload.settings.items():
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
