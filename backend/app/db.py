from __future__ import annotations

import json
import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable

from .auth import hash_password
from .config import settings


DEVICE_COLUMNS = [
    "plant_code",
    "plant_name",
    "building",
    "floor",
    "area",
    "zone",
    "line_code",
    "line_name",
    "detailed_location",
    "device_name",
    "device_type",
    "ip_address",
    "mac_address",
    "hostname",
    "connected_ap_name",
    "connected_ap_ip",
    "switch_name",
    "switch_port",
    "vlan",
    "owner_department",
    "criticality",
    "monitoring_enabled",
    "notes",
]


class RowAdapter:
    def __init__(self, keys: list[str], values: tuple[Any, ...]):
        self._keys = keys
        self._values = values
        self._data = {key: values[index] for index, key in enumerate(keys)}

    def __getitem__(self, key: int | str) -> Any:
        if isinstance(key, int):
            return self._values[key]
        return self._data[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def keys(self):
        return self._data.keys()

    def items(self):
        return self._data.items()

    def to_dict(self) -> dict[str, Any]:
        return dict(self._data)


class ResultAdapter:
    def __init__(self, cursor: Any, lastrowid: int | None = None):
        self.cursor = cursor
        self.lastrowid = lastrowid if lastrowid is not None else getattr(cursor, "lastrowid", None)
        self._keys = [column[0] for column in cursor.description] if getattr(cursor, "description", None) else []

    def fetchone(self) -> RowAdapter | None:
        row = self.cursor.fetchone()
        if row is None:
            return None
        return RowAdapter(self._keys, tuple(row))

    def fetchall(self) -> list[RowAdapter]:
        return [RowAdapter(self._keys, tuple(row)) for row in self.cursor.fetchall()]


class DbConnection:
    def __init__(self, raw: Any, engine: str):
        self.raw = raw
        self.engine = engine

    def execute(self, sql: str, params: Iterable[Any] | None = None) -> ResultAdapter:
        params_list = list(params or [])
        sql_to_run = sql
        if self.engine == "mssql":
            sql_to_run, params_list = self._translate_for_mssql(sql_to_run, params_list)
        cursor = self.raw.cursor()
        if self.engine == "sqlite":
            cursor.execute(sql_to_run, params_list)
            return ResultAdapter(cursor)
        cursor.execute(sql_to_run, *params_list)
        lastrowid = None
        if sql_to_run.lstrip().upper().startswith("INSERT "):
            try:
                identity_cursor = self.raw.cursor()
                identity_cursor.execute("SELECT CONVERT(INT, @@IDENTITY)")
                identity = identity_cursor.fetchone()
                lastrowid = int(identity[0]) if identity and identity[0] is not None else None
            except Exception:
                lastrowid = None
        return ResultAdapter(cursor, lastrowid=lastrowid)

    def executescript(self, script: str) -> None:
        if self.engine == "sqlite":
            self.raw.executescript(script)
            return
        for batch in re.split(r"^\s*GO\s*$", script, flags=re.IGNORECASE | re.MULTILINE):
            statement = batch.strip()
            if statement:
                self.execute(statement)

    def commit(self) -> None:
        self.raw.commit()

    def rollback(self) -> None:
        self.raw.rollback()

    def close(self) -> None:
        self.raw.close()

    def _translate_for_mssql(self, sql: str, params: list[Any]) -> tuple[str, list[Any]]:
        translated = sql.strip()
        if "system_settings" in translated.lower():
            translated = re.sub(r"\bkey\b", "[key]", translated, flags=re.IGNORECASE)
            translated = re.sub(r"\bvalue\b", "[value]", translated, flags=re.IGNORECASE)
        translated = re.sub(
            r"\s+LIMIT\s+\?$",
            lambda _match: f" OFFSET 0 ROWS FETCH NEXT {int(params.pop())} ROWS ONLY",
            translated,
            flags=re.IGNORECASE,
        )
        translated = re.sub(
            r"\s+LIMIT\s+(\d+)\s*$",
            lambda match: f" OFFSET 0 ROWS FETCH NEXT {int(match.group(1))} ROWS ONLY",
            translated,
            flags=re.IGNORECASE,
        )
        return translated, params


def _mssql_connection_string(database: str | None = None) -> str:
    trust = "yes" if settings.mssql_trust_server_certificate else "no"
    return (
        f"DRIVER={{{settings.mssql_driver}}};"
        f"SERVER={settings.mssql_server},{settings.mssql_port};"
        f"DATABASE={database or settings.mssql_database};"
        f"UID={settings.mssql_username};"
        f"PWD={settings.mssql_password};"
        "Encrypt=yes;"
        f"TrustServerCertificate={trust};"
    )


def _connect_mssql(database: str | None = None) -> DbConnection:
    import pyodbc

    raw = pyodbc.connect(_mssql_connection_string(database), autocommit=False)
    return DbConnection(raw, "mssql")


def ensure_mssql_database() -> None:
    import pyodbc

    last_error: Exception | None = None
    raw = None
    for _attempt in range(30):
        try:
            raw = pyodbc.connect(_mssql_connection_string("master"), autocommit=True)
            break
        except Exception as exc:
            last_error = exc
            time.sleep(2)
    if raw is None:
        raise RuntimeError(f"Could not connect to SQL Server: {last_error}")
    cursor = raw.cursor()
    database = settings.mssql_database.replace("]", "]]")
    cursor.execute(f"IF DB_ID(N'{settings.mssql_database}') IS NULL CREATE DATABASE [{database}]")
    raw.close()


def connect() -> DbConnection:
    if settings.database_engine == "mssql":
        return _connect_mssql()
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return DbConnection(conn, "sqlite")


@contextmanager
def transaction() -> Iterable[DbConnection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_to_dict(row: Any | None) -> dict[str, Any] | None:
    if row is None:
        return None
    data = row.to_dict() if hasattr(row, "to_dict") else dict(row)
    for key in ("before_data_json", "after_data_json", "changed_fields_json", "row_data_json", "permissions_json"):
        if key in data and isinstance(data[key], str) and data[key]:
            try:
                data[key] = json.loads(data[key])
            except json.JSONDecodeError:
                pass
    return data


def rows_to_dicts(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
    return [row_to_dict(row) or {} for row in rows]


def init_db() -> None:
    if settings.database_engine == "mssql":
        ensure_mssql_database()
    with transaction() as conn:
        if conn.engine == "mssql":
            schema_path = Path(__file__).resolve().parent.parent / "mssql" / "schema.sql"
            schema_sql = schema_path.read_text(encoding="utf-8").replace("vibe_nms", settings.mssql_database)
            conn.executescript(schema_sql)
        else:
            Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
            conn.executescript(
                """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                display_name TEXT,
                email TEXT,
                role TEXT NOT NULL DEFAULT 'USER',
                password_hash TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                last_login_at TEXT,
                last_login_ip TEXT,
                created_by TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_by TEXT,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role_name TEXT NOT NULL UNIQUE,
                permissions_json TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS network_devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plant_code TEXT,
                plant_name TEXT,
                building TEXT,
                floor TEXT,
                area TEXT,
                zone TEXT,
                line_code TEXT,
                line_name TEXT,
                detailed_location TEXT,
                device_name TEXT NOT NULL,
                device_type TEXT NOT NULL,
                ip_address TEXT NOT NULL UNIQUE,
                mac_address TEXT,
                hostname TEXT,
                connected_ap_name TEXT,
                connected_ap_ip TEXT,
                switch_name TEXT,
                switch_port TEXT,
                vlan INTEGER,
                owner_department TEXT,
                criticality TEXT NOT NULL DEFAULT 'MEDIUM',
                monitoring_enabled INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'UNKNOWN',
                latency_ms REAL,
                packet_loss_percent REAL,
                consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
                notes TEXT,
                created_by TEXT,
                created_from_ip TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_by TEXT,
                updated_from_ip TEXT,
                updated_at TEXT,
                deleted_by TEXT,
                deleted_from_ip TEXT,
                deleted_at TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_user_id TEXT,
                actor_username TEXT,
                actor_display_name TEXT,
                actor_role TEXT,
                actor_ip_address TEXT,
                actor_user_agent TEXT,
                action_type TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT,
                target_ip_address TEXT,
                before_data_json TEXT,
                after_data_json TEXT,
                changed_fields_json TEXT,
                result TEXT NOT NULL,
                error_message TEXT,
                request_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS import_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name TEXT NOT NULL,
                uploaded_by TEXT,
                uploaded_from_ip TEXT,
                status TEXT NOT NULL,
                total_rows INTEGER NOT NULL DEFAULT 0,
                valid_rows INTEGER NOT NULL DEFAULT 0,
                warning_rows INTEGER NOT NULL DEFAULT 0,
                error_rows INTEGER NOT NULL DEFAULT 0,
                inserted_rows INTEGER NOT NULL DEFAULT 0,
                updated_rows INTEGER NOT NULL DEFAULT 0,
                failed_rows INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS import_job_rows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                import_job_id INTEGER NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
                row_number INTEGER NOT NULL,
                row_data_json TEXT NOT NULL,
                validation_status TEXT NOT NULL,
                validation_message TEXT
            );

            CREATE TABLE IF NOT EXISTS export_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                export_type TEXT NOT NULL,
                requested_by TEXT,
                requested_from_ip TEXT,
                file_name TEXT,
                row_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS monitoring_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT,
                total_devices_checked INTEGER NOT NULL DEFAULT 0,
                online_count INTEGER NOT NULL DEFAULT 0,
                warning_count INTEGER NOT NULL DEFAULT 0,
                offline_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS device_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
                checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                check_method TEXT NOT NULL,
                is_online INTEGER NOT NULL,
                status TEXT NOT NULL,
                latency_ms REAL,
                packet_loss_percent REAL,
                consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
                error_message TEXT
            );

            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER REFERENCES network_devices(id) ON DELETE SET NULL,
                severity TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                first_detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                acknowledged_by TEXT,
                acknowledged_at TEXT,
                resolved_at TEXT
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_id INTEGER REFERENCES alerts(id) ON DELETE CASCADE,
                recipient_role TEXT NOT NULL DEFAULT 'ADMIN',
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                channel TEXT NOT NULL DEFAULT 'DASHBOARD',
                read_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_by TEXT,
                updated_from_ip TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_devices_status ON network_devices(status);
            CREATE INDEX IF NOT EXISTS idx_devices_plant_line ON network_devices(plant_code, line_code);
            CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_audit_filters ON audit_logs(actor_username, action_type, entity_type, target_ip_address);
            CREATE INDEX IF NOT EXISTS idx_metrics_device_checked ON device_metrics(device_id, checked_at);
            CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, severity);
            """
            )
            migrate_sqlite_users(conn)
        seed_reference_data(conn)
        if settings.seed_sample_data:
            seed_sample_devices(conn)


def migrate_sqlite_users(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    additions = {
        "password_hash": "TEXT",
        "is_active": "INTEGER DEFAULT 1",
        "created_by": "TEXT",
        "created_at": "TEXT",
        "updated_by": "TEXT",
        "updated_at": "TEXT",
    }
    for column, definition in additions.items():
        if column not in columns:
            conn.execute(f"ALTER TABLE users ADD COLUMN {column} {definition}")
    conn.execute("UPDATE users SET role = UPPER(role)")
    conn.execute("UPDATE users SET role = 'USER' WHERE role = 'VIEWER'")
    conn.execute("DELETE FROM roles WHERE role_name IN ('viewer', 'VIEWER')")
    conn.execute("UPDATE roles SET role_name = UPPER(role_name)")


def seed_reference_data(conn: sqlite3.Connection) -> None:
    for role_name, permissions in (("ADMIN", {"all": True}), ("USER", {"read": True})):
        exists = conn.execute("SELECT COUNT(*) FROM roles WHERE role_name = ?", (role_name,)).fetchone()[0]
        if not exists:
            conn.execute(
                "INSERT INTO roles(role_name, permissions_json) VALUES (?, ?)",
                (role_name, json.dumps(permissions)),
            )
    admin_hash = hash_password(settings.bootstrap_admin_password)
    admin_exists = conn.execute("SELECT COUNT(*) FROM users WHERE username = ?", (settings.bootstrap_admin_username,)).fetchone()[0]
    if not admin_exists:
        conn.execute(
            """
            INSERT INTO users(username, display_name, email, role, password_hash, is_active, created_by)
            VALUES (?, 'Administrator', ?, 'ADMIN', ?, 1, 'system')
            """,
            (settings.bootstrap_admin_username, settings.bootstrap_admin_email, admin_hash),
        )
    conn.execute(
        "UPDATE users SET password_hash = ? WHERE username = ? AND (password_hash IS NULL OR password_hash = '')",
        (admin_hash, settings.bootstrap_admin_username),
    )
    default_settings = {
        "monitoring_interval_seconds": str(settings.collector_interval_seconds),
        "warning_latency_ms": str(settings.warning_latency_ms),
        "critical_latency_ms": str(settings.critical_latency_ms),
        "warning_packet_loss_percent": str(settings.warning_packet_loss_percent),
        "corporate_networks": ",".join(settings.corporate_networks),
    }
    for key, value in default_settings.items():
        exists = conn.execute("SELECT COUNT(*) FROM system_settings WHERE key = ?", (key,)).fetchone()[0]
        if not exists:
            conn.execute(
                "INSERT INTO system_settings(key, value) VALUES (?, ?)",
                (key, value),
            )


def seed_sample_devices(conn: sqlite3.Connection) -> None:
    count = conn.execute("SELECT COUNT(*) FROM network_devices").fetchone()[0]
    if count:
        return
    samples = [
        {
            "plant_code": "MX01",
            "plant_name": "Main Plant",
            "building": "A",
            "floor": "1",
            "area": "Assembly",
            "zone": "A1",
            "line_code": "LINE-01",
            "line_name": "Assembly Line 1",
            "detailed_location": "Scanner station",
            "device_name": "LINE1_SCANNER_03",
            "device_type": "SCANNER",
            "ip_address": "10.10.1.55",
            "mac_address": "00:11:22:33:44:55",
            "hostname": "line1-scanner-03",
            "connected_ap_name": "AP_LINE1_A",
            "connected_ap_ip": "10.10.1.10",
            "switch_name": "SW_LINE1",
            "switch_port": "Gi1/0/12",
            "vlan": 110,
            "owner_department": "Production",
            "criticality": "HIGH",
            "monitoring_enabled": 1,
            "status": "ONLINE",
            "latency_ms": 18.0,
            "packet_loss_percent": 0.0,
            "consecutive_failure_count": 0,
            "notes": "Sample device",
        },
        {
            "plant_code": "MX01",
            "plant_name": "Main Plant",
            "building": "A",
            "floor": "1",
            "area": "Assembly",
            "zone": "A2",
            "line_code": "LINE-01",
            "line_name": "Assembly Line 1",
            "detailed_location": "PLC cabinet",
            "device_name": "LINE1_PLC_01",
            "device_type": "PLC",
            "ip_address": "10.10.1.21",
            "mac_address": "00:11:22:33:44:66",
            "hostname": "line1-plc-01",
            "connected_ap_name": "AP_LINE1_A",
            "connected_ap_ip": "10.10.1.10",
            "switch_name": "SW_LINE1",
            "switch_port": "Gi1/0/4",
            "vlan": 110,
            "owner_department": "Controls",
            "criticality": "CRITICAL",
            "monitoring_enabled": 1,
            "status": "WARNING",
            "latency_ms": 245.0,
            "packet_loss_percent": 8.0,
            "consecutive_failure_count": 1,
            "notes": "Sample warning state",
        },
        {
            "plant_code": "MX02",
            "plant_name": "Paint Plant",
            "building": "C",
            "floor": "2",
            "area": "Paint",
            "zone": "P2",
            "line_code": "LINE-03",
            "line_name": "Paint Line 3",
            "detailed_location": "Vision inspection",
            "device_name": "LINE3_CAMERA_02",
            "device_type": "CAMERA",
            "ip_address": "10.20.3.44",
            "mac_address": "00:11:22:33:44:77",
            "hostname": "line3-camera-02",
            "connected_ap_name": "AP_LINE3_B",
            "connected_ap_ip": "10.20.3.10",
            "switch_name": "SW_LINE3",
            "switch_port": "Gi1/0/18",
            "vlan": 230,
            "owner_department": "Quality",
            "criticality": "MEDIUM",
            "monitoring_enabled": 1,
            "status": "OFFLINE",
            "latency_ms": None,
            "packet_loss_percent": 100.0,
            "consecutive_failure_count": 3,
            "notes": "Sample offline state",
        },
    ]
    for sample in samples:
        columns = list(sample.keys())
        placeholders = ", ".join(["?"] * len(columns))
        conn.execute(
            f"INSERT INTO network_devices({', '.join(columns)}, created_by, created_from_ip) VALUES ({placeholders}, 'system', '127.0.0.1')",
            [sample[column] for column in columns],
        )
