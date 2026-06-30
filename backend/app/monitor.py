from __future__ import annotations

import asyncio
import platform
import re
import sqlite3
import time
from dataclasses import dataclass

from .config import settings
from .db import connect, row_to_dict
from .validation import ip_in_allowed_networks


@dataclass
class ProbeResult:
    is_online: bool
    latency_ms: float | None
    packet_loss_percent: float
    error_message: str | None = None


async def ping_device(ip_address: str) -> ProbeResult:
    if not ip_in_allowed_networks(ip_address):
        return ProbeResult(False, None, 100.0, "IP outside configured corporate network ranges")

    system = platform.system().lower()
    if "windows" in system:
        args = ["ping", "-n", "1", "-w", str(settings.collector_timeout_ms), ip_address]
    else:
        timeout_seconds = max(1, int(settings.collector_timeout_ms / 1000))
        args = ["ping", "-c", "1", "-W", str(timeout_seconds), ip_address]

    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=(settings.collector_timeout_ms / 1000) + 2)
    except asyncio.TimeoutError:
        return ProbeResult(False, None, 100.0, "Ping timed out")
    except FileNotFoundError:
        return ProbeResult(False, None, 100.0, "ping command not found")

    output = (stdout + stderr).decode(errors="ignore")
    is_online = process.returncode == 0
    latency = _parse_latency(output)
    packet_loss = 0.0 if is_online else 100.0
    parsed_loss = _parse_packet_loss(output)
    if parsed_loss is not None:
        packet_loss = parsed_loss
    error = None if is_online else output.strip()[-240:] or "Ping failed"
    return ProbeResult(is_online, latency, packet_loss, error)


def _parse_latency(output: str) -> float | None:
    patterns = [
        r"time[=<]\s*(\d+(?:\.\d+)?)\s*ms",
        r"Average\s*=\s*(\d+(?:\.\d+)?)ms",
        r"avg[/=]\s*(\d+(?:\.\d+)?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, output, flags=re.IGNORECASE)
        if match:
            return float(match.group(1))
    return None


def _parse_packet_loss(output: str) -> float | None:
    match = re.search(r"(\d+(?:\.\d+)?)%\s*loss", output, flags=re.IGNORECASE)
    if match:
        return float(match.group(1))
    return None


def status_from_probe(device: sqlite3.Row, probe: ProbeResult) -> tuple[str, int]:
    previous_failures = int(device["consecutive_failure_count"] or 0)
    criticality = (device["criticality"] or "MEDIUM").upper()

    if not probe.is_online:
        failures = previous_failures + 1
        if failures >= 5 and criticality in {"HIGH", "CRITICAL"}:
            return "CRITICAL", failures
        if failures >= 3:
            return "OFFLINE", failures
        return "WARNING", failures

    failures = 0
    if probe.packet_loss_percent >= settings.warning_packet_loss_percent:
        return "WARNING", failures
    if probe.latency_ms is not None and probe.latency_ms >= settings.critical_latency_ms and criticality in {"HIGH", "CRITICAL"}:
        return "CRITICAL", failures
    if probe.latency_ms is not None and probe.latency_ms >= settings.warning_latency_ms:
        return "WARNING", failures
    return "ONLINE", failures


def detect_flapping(conn: sqlite3.Connection, device_id: int, new_status: str) -> bool:
    rows = conn.execute(
        """
        SELECT status FROM device_metrics
        WHERE device_id = ?
        ORDER BY checked_at DESC, id DESC
        LIMIT 5
        """,
        (device_id,),
    ).fetchall()
    statuses = [new_status] + [row["status"] for row in rows]
    if len(statuses) < 5:
        return False
    groups = ["UP" if status == "ONLINE" else "DOWN" if status in {"WARNING", "OFFLINE", "CRITICAL"} else status for status in statuses]
    changes = sum(1 for index in range(1, len(groups)) if groups[index] != groups[index - 1])
    return changes >= 4


def upsert_alert_for_status(conn: sqlite3.Connection, device: sqlite3.Row, status: str, probe: ProbeResult) -> None:
    if status in {"ONLINE", "UNKNOWN", "DISABLED"}:
        conn.execute(
            """
            UPDATE alerts
            SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP, last_detected_at = CURRENT_TIMESTAMP
            WHERE device_id = ? AND status IN ('ACTIVE', 'ACKNOWLEDGED')
            """,
            (device["id"],),
        )
        return

    severity = "CRITICAL" if status == "CRITICAL" else "WARNING"
    alert_type = "LATENCY" if probe.is_online and probe.latency_ms and probe.latency_ms >= settings.warning_latency_ms else status
    message = f"{device['device_name']} ({device['ip_address']}) status is {status}"
    existing = conn.execute(
        """
        SELECT * FROM alerts
        WHERE device_id = ? AND alert_type = ? AND status IN ('ACTIVE', 'ACKNOWLEDGED')
        ORDER BY id DESC LIMIT 1
        """,
        (device["id"], alert_type),
    ).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE alerts
            SET severity = ?, message = ?, last_detected_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (severity, message, existing["id"]),
        )
    else:
        cursor = conn.execute(
            """
            INSERT INTO alerts(device_id, severity, alert_type, message, status)
            VALUES (?, ?, ?, ?, 'ACTIVE')
            """,
            (device["id"], severity, alert_type, message),
        )
        conn.execute(
            """
            INSERT INTO notifications(alert_id, recipient_role, title, message, channel)
            VALUES (?, 'ADMIN', ?, ?, 'DASHBOARD')
            """,
            (cursor.lastrowid, f"{severity} network alert", message),
        )


async def run_monitoring_cycle(conn: sqlite3.Connection | None = None) -> dict[str, int]:
    owns_connection = conn is None
    if conn is None:
        conn = connect()
    started = time.time()
    cursor = conn.execute("INSERT INTO monitoring_runs(started_at) VALUES (CURRENT_TIMESTAMP)")
    run_id = cursor.lastrowid
    counts = {"total": 0, "online": 0, "warning": 0, "offline": 0, "error": 0}

    try:
        devices = conn.execute(
            "SELECT * FROM network_devices WHERE is_deleted = 0 AND ip_address IS NOT NULL AND ip_address != '' ORDER BY id"
        ).fetchall()
        for device in devices:
            counts["total"] += 1
            try:
                probe = await ping_device(device["ip_address"])
                status, failures = status_from_probe(device, probe)
                if detect_flapping(conn, device["id"], status):
                    status = "FLAPPING"
                conn.execute(
                    """
                    INSERT INTO device_metrics(
                        device_id, check_method, is_online, status, latency_ms,
                        packet_loss_percent, consecutive_failure_count, error_message
                    )
                    VALUES (?, 'PING', ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        device["id"],
                        1 if probe.is_online else 0,
                        status,
                        probe.latency_ms,
                        probe.packet_loss_percent,
                        failures,
                        probe.error_message,
                    ),
                )
                conn.execute(
                    """
                    UPDATE network_devices
                    SET status = ?, latency_ms = ?, packet_loss_percent = ?,
                        consecutive_failure_count = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (status, probe.latency_ms, probe.packet_loss_percent, failures, device["id"]),
                )
                upsert_alert_for_status(conn, device, status, probe)
                if status == "ONLINE":
                    counts["online"] += 1
                elif status in {"WARNING", "UNCERTAIN", "FLAPPING"}:
                    counts["warning"] += 1
                elif status in {"OFFLINE", "CRITICAL"}:
                    counts["offline"] += 1
                else:
                    counts["error"] += 1
            except Exception as exc:  # pragma: no cover - collector should continue across devices
                counts["error"] += 1
                conn.execute(
                    """
                    INSERT INTO device_metrics(device_id, check_method, is_online, status, packet_loss_percent, error_message)
                    VALUES (?, 'PING', 0, 'UNKNOWN', 100, ?)
                    """,
                    (device["id"], str(exc)),
                )
        duration_ms = int((time.time() - started) * 1000)
        conn.execute(
            """
            UPDATE monitoring_runs
            SET completed_at = CURRENT_TIMESTAMP,
                total_devices_checked = ?, online_count = ?, warning_count = ?,
                offline_count = ?, error_count = ?, duration_ms = ?
            WHERE id = ?
            """,
            (counts["total"], counts["online"], counts["warning"], counts["offline"], counts["error"], duration_ms, run_id),
        )
        conn.commit()
        return counts
    finally:
        if owns_connection:
            conn.close()


async def collector_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await run_monitoring_cycle()
        except Exception:
            pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.collector_interval_seconds)
        except asyncio.TimeoutError:
            continue


def device_to_public(row: sqlite3.Row) -> dict:
    data = row_to_dict(row) or {}
    return data
