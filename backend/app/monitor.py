from __future__ import annotations

import asyncio
import platform
import re
import sqlite3
import time
from dataclasses import dataclass

from .alert_settings import network_alert_enabled, notification_muted
from .config import settings
from .db import connect, row_to_dict
from .validation import ip_in_allowed_networks


@dataclass
class ProbeResult:
    is_online: bool
    latency_ms: float | None
    packet_loss_percent: float
    error_message: str | None = None
    tcp_fallback_port: int | None = None
    tcp_fallback_latency_ms: float | None = None
    tcp_fallback_result: str | None = None


async def ping_device(ip_address: str) -> ProbeResult:
    if not ip_in_allowed_networks(ip_address):
        return ProbeResult(False, None, 100.0, "IP outside configured corporate network ranges")

    system = platform.system().lower()
    if "windows" in system:
        args = ["ping", "-n", str(settings.ping_count), "-w", str(settings.collector_timeout_ms), ip_address]
    else:
        timeout_seconds = max(1, int(settings.collector_timeout_ms / 1000))
        args = ["ping", "-c", str(settings.ping_count), "-W", str(timeout_seconds), ip_address]

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
    if not is_online and settings.tcp_fallback_ports:
        tcp_port, tcp_latency, tcp_result = await _tcp_fallback_probe(ip_address)
        if tcp_port is not None:
            return ProbeResult(
                True,
                tcp_latency,
                packet_loss,
                f"ICMP ping did not reply, but TCP port {tcp_port} {tcp_result}. Device is treated as ONLINE.",
                tcp_port,
                tcp_latency,
                tcp_result,
            )
    return ProbeResult(is_online, latency, packet_loss, error)


async def _tcp_fallback_probe(ip_address: str) -> tuple[int | None, float | None, str | None]:
    timeout_seconds = max(0.5, settings.collector_timeout_ms / 1000)
    for port in settings.tcp_fallback_ports:
        started = time.perf_counter()
        try:
            _reader, writer = await asyncio.wait_for(asyncio.open_connection(ip_address, port), timeout=timeout_seconds)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            latency_ms = round((time.perf_counter() - started) * 1000, 1)
            return port, latency_ms, "accepted a connection"
        except ConnectionRefusedError:
            latency_ms = round((time.perf_counter() - started) * 1000, 1)
            return port, latency_ms, "refused the connection, which confirms the host is reachable"
        except Exception:
            continue
    return None, None, None


def _parse_latency(output: str) -> float | None:
    patterns = [
        r"time[=<]\s*(\d+(?:\.\d+)?)\s*ms",
        r"Average\s*=\s*(\d+(?:\.\d+)?)ms",
        r"평균\s*=\s*(\d+(?:\.\d+)?)ms",
        r"avg[/=]\s*(\d+(?:\.\d+)?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, output, flags=re.IGNORECASE)
        if match:
            return float(match.group(1))
    return None


def _parse_packet_loss(output: str) -> float | None:
    match = re.search(r"(\d+(?:\.\d+)?)%\s*(?:loss|손실)", output, flags=re.IGNORECASE)
    if match:
        return float(match.group(1))
    return None


def status_reason(device: sqlite3.Row, status: str, failures: int, probe: ProbeResult) -> str:
    criticality = (device["criticality"] or "MEDIUM").upper()
    latency = "-" if probe.latency_ms is None else f"{probe.latency_ms:g} ms"
    loss = f"{probe.packet_loss_percent:g}%"

    if status == "FLAPPING":
        return "Status changed repeatedly in the last checks. Check unstable cable, switch port, Wi-Fi roaming, or intermittent ICMP response."
    if probe.tcp_fallback_port is not None:
        tcp_latency = "-" if probe.tcp_fallback_latency_ms is None else f"{probe.tcp_fallback_latency_ms:g} ms"
        tcp_result = probe.tcp_fallback_result or "responded"
        return (
            f"ICMP ping loss is {loss}, but TCP port {probe.tcp_fallback_port} {tcp_result} "
            f"({tcp_latency}). Device is reachable and marked ONLINE. If ICMP Loss should be 0%, allow ping in Windows Firewall or endpoint security."
        )
    if not probe.is_online:
        base = probe.error_message or "Ping did not receive a reply"
        if "outside configured corporate network ranges" in base:
            return (
                f"{device['ip_address']} is outside NMS_CORPORATE_NETWORKS, so the backend did not probe it. "
                "Add the company IP range in C:\\Program Files\\Vibe NMS\\.env, then restart the VibeNMS scheduled task."
            )
        if failures < 3:
            return f"Ping failed {failures} time(s). Device may still be powered on if Windows firewall or endpoint security blocks ICMP ping. Raw: {base}"
        if status == "CRITICAL":
            return f"Ping failed {failures} consecutive times on a {criticality} device. Marked CRITICAL. Raw: {base}"
        return f"Ping failed {failures} consecutive times. Marked {status}. Raw: {base}"
    if probe.packet_loss_percent >= settings.warning_packet_loss_percent:
        return f"Ping replies were received, but packet loss is {loss}, above warning threshold {settings.warning_packet_loss_percent:g}%."
    if probe.latency_ms is not None and probe.latency_ms >= settings.critical_latency_ms and criticality in {"HIGH", "CRITICAL"}:
        return f"Ping replies were received, but latency is {latency}, above critical threshold {settings.critical_latency_ms:g} ms for a {criticality} device."
    if probe.latency_ms is not None and probe.latency_ms >= settings.warning_latency_ms:
        return f"Ping replies were received, but latency is {latency}, above warning threshold {settings.warning_latency_ms:g} ms."
    return f"Ping OK. Latency {latency}, packet loss {loss}."


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
    if probe.tcp_fallback_port is not None:
        return "ONLINE", failures
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


def upsert_alert_for_status(
    conn: sqlite3.Connection,
    device: sqlite3.Row,
    status: str,
    probe: ProbeResult,
    failures: int,
    reason: str,
) -> None:
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
    if probe.is_online and probe.packet_loss_percent >= settings.warning_packet_loss_percent:
        alert_type = "PACKET_LOSS"
    elif probe.is_online and probe.latency_ms and probe.latency_ms >= settings.warning_latency_ms:
        alert_type = "LATENCY"
    elif status == "FLAPPING":
        alert_type = "FLAPPING"
    else:
        alert_type = status
    message = f"{device['device_name']} ({device['ip_address']}) status is {status}. {reason}"
    if not network_alert_enabled(conn, alert_type):
        conn.execute(
            """
            UPDATE alerts
            SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP, last_detected_at = CURRENT_TIMESTAMP
            WHERE device_id = ? AND alert_type = ? AND status IN ('ACTIVE', 'ACKNOWLEDGED')
            """,
            (device["id"], alert_type),
        )
        return
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
        if not notification_muted(conn, alert_type):
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
                reason = status_reason(device, status, failures, probe)
                conn.execute(
                    """
                    INSERT INTO device_metrics(
                        device_id, check_method, is_online, status, latency_ms,
                        packet_loss_percent, consecutive_failure_count, error_message
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        device["id"],
                        "PING+TCP" if probe.tcp_fallback_port is not None else "PING",
                        1 if probe.is_online else 0,
                        status,
                        probe.latency_ms,
                        probe.packet_loss_percent,
                        failures,
                        reason,
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
                upsert_alert_for_status(conn, device, status, probe, failures, reason)
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
