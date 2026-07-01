from __future__ import annotations

import asyncio
import time
from collections import Counter
from typing import Any

from .alert_settings import ap_alert_enabled
from .ap_client_providers import APClientObservation, normalize_mac, provider_for_ap, utc_now_iso
from .config import settings
from .db import connect, row_to_dict, rows_to_dicts


AP_CLIENT_ALERT_TYPES = {
    "AP_UNKNOWN_CLIENT",
    "AP_WRONG_AP",
    "AP_DUPLICATE_IP",
    "AP_CRITICAL_MISSING",
    "AP_CLIENT_COUNT_DROP",
}


def _device_key_by_mac(devices: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        normalized: device
        for device in devices
        if (normalized := normalize_mac(device.get("mac_address")))
    }


def _device_key_by_ip(devices: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(device.get("ip_address")).strip(): device
        for device in devices
        if device.get("ip_address")
    }


def _expected_on_ap(device: dict[str, Any], ap: dict[str, Any]) -> bool:
    expected_name = (device.get("connected_ap_name") or "").strip().lower()
    expected_ip = (device.get("connected_ap_ip") or "").strip()
    ap_name = (ap.get("device_name") or "").strip().lower()
    ap_ip = (ap.get("ip_address") or "").strip()
    return bool((expected_name and expected_name == ap_name) or (expected_ip and expected_ip == ap_ip))


def _wrong_ap_reason(device: dict[str, Any] | None, ap: dict[str, Any]) -> str | None:
    if not device:
        return None
    expected_name = (device.get("connected_ap_name") or "").strip()
    expected_ip = (device.get("connected_ap_ip") or "").strip()
    if not expected_name and not expected_ip:
        return None
    if _expected_on_ap(device, ap):
        return None
    expected = " / ".join(part for part in (expected_name, expected_ip) if part)
    actual = " / ".join(part for part in (ap.get("device_name"), ap.get("ip_address")) if part)
    return f"Expected AP {expected}; observed on {actual}"


def _signal_quality(rssi: int | None) -> str:
    if rssi is None:
        return "UNKNOWN"
    if rssi >= -60:
        return "GOOD"
    if rssi >= -75:
        return "WEAK"
    return "POOR"


def _client_status(
    observation: APClientObservation,
    matched_device: dict[str, Any] | None,
    mismatch_reason: str | None,
    duplicate_ip: bool,
) -> str:
    if duplicate_ip:
        return "IP_CONFLICT"
    if mismatch_reason:
        return "WRONG_AP"
    if not observation.client_ip_address:
        return "NO_IP"
    if not matched_device:
        return "UNKNOWN_DEVICE"
    if observation.rssi is not None and observation.rssi < -75:
        return "WEAK_SIGNAL"
    return "HEALTHY"


def _status_issue(status: str) -> bool:
    return status in {"IP_CONFLICT", "WRONG_AP", "NO_IP", "UNKNOWN_DEVICE", "WEAK_SIGNAL"}


def _resolve_ip_by_mac(mac_address: str | None, devices_by_mac: dict[str, dict[str, Any]]) -> str | None:
    # MVP resolver: use the registered device table as a local DHCP/ARP stand-in.
    normalized = normalize_mac(mac_address)
    if not normalized:
        return None
    device = devices_by_mac.get(normalized)
    return device.get("ip_address") if device else None


def _upsert_alert(conn: Any, device_id: int, alert_type: str, severity: str, message: str) -> None:
    if not ap_alert_enabled(conn, alert_type):
        _resolve_alert(conn, device_id, alert_type)
        return
    existing = conn.execute(
        """
        SELECT * FROM alerts
        WHERE device_id = ? AND alert_type = ? AND status IN ('ACTIVE', 'ACKNOWLEDGED')
        ORDER BY id DESC LIMIT 1
        """,
        (device_id, alert_type),
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
        return
    cursor = conn.execute(
        """
        INSERT INTO alerts(device_id, severity, alert_type, message, status)
        VALUES (?, ?, ?, ?, 'ACTIVE')
        """,
        (device_id, severity, alert_type, message),
    )
    conn.execute(
        """
        INSERT INTO notifications(alert_id, recipient_role, title, message, channel)
        VALUES (?, 'ADMIN', ?, ?, 'DASHBOARD')
        """,
        (cursor.lastrowid, f"{severity} AP client issue", message),
    )


def _resolve_alert(conn: Any, device_id: int, alert_type: str) -> None:
    conn.execute(
        """
        UPDATE alerts
        SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP, last_detected_at = CURRENT_TIMESTAMP
        WHERE device_id = ? AND alert_type = ? AND status IN ('ACTIVE', 'ACKNOWLEDGED')
        """,
        (device_id, alert_type),
    )


async def run_ap_client_discovery_cycle(actor: Any | None = None, conn: Any | None = None) -> dict[str, int]:
    owns_connection = conn is None
    if conn is None:
        conn = connect()

    started = time.time()
    actor_username = getattr(actor, "username", None)
    actor_ip = getattr(actor, "ip_address", None)
    cursor = conn.execute(
        """
        INSERT INTO ap_client_discovery_runs(started_at, status, triggered_by, triggered_from_ip)
        VALUES (CURRENT_TIMESTAMP, 'RUNNING', ?, ?)
        """,
        (actor_username, actor_ip),
    )
    run_id = cursor.lastrowid
    counts = {"total_aps": 0, "total_clients": 0, "known": 0, "unknown": 0, "issues": 0}

    try:
        devices = rows_to_dicts(
            conn.execute("SELECT * FROM network_devices WHERE is_deleted = 0 ORDER BY id").fetchall()
        )
        aps = [
            device for device in devices
            if str(device.get("device_type") or "").upper() == "AP" and device.get("monitoring_enabled")
        ]
        devices_by_mac = _device_key_by_mac(devices)
        devices_by_ip = _device_key_by_ip(devices)

        collected: list[tuple[dict[str, Any], APClientObservation, str]] = []
        provider_names: set[str] = set()
        for ap in aps:
            counts["total_aps"] += 1
            provider = provider_for_ap(ap, devices)
            provider_names.add(provider.name)
            for observation in await provider.get_connected_clients(ap):
                observation.source = observation.source or provider.name
                if not observation.last_seen:
                    observation.last_seen = utc_now_iso()
                if not observation.first_seen:
                    observation.first_seen = observation.last_seen
                if not observation.signal_quality:
                    observation.signal_quality = _signal_quality(observation.rssi)
                observation.client_mac_address = normalize_mac(observation.client_mac_address)
                if not observation.client_ip_address:
                    observation.client_ip_address = _resolve_ip_by_mac(observation.client_mac_address, devices_by_mac)
                collected.append((ap, observation, provider.name))

        duplicate_ips = {
            ip for ip, total in Counter(
                observation.client_ip_address for _, observation, _ in collected if observation.client_ip_address
            ).items()
            if total > 1
        }

        rows_by_ap: dict[int, list[APClientObservation]] = {}
        for ap, observation, _provider_name in collected:
            rows_by_ap.setdefault(int(ap["id"]), []).append(observation)

        for ap in aps:
            ap_id = int(ap["id"])
            previous_count = conn.execute(
                "SELECT COUNT(*) FROM ap_connected_clients_current WHERE ap_id = ?",
                (ap_id,),
            ).fetchone()[0]
            observations = rows_by_ap.get(ap_id, [])
            observed_device_ids: set[int] = set()
            wrong_ap_seen = False
            unknown_seen = False
            duplicate_seen = False

            conn.execute("DELETE FROM ap_connected_clients_current WHERE ap_id = ?", (ap_id,))
            for observation in observations:
                counts["total_clients"] += 1
                matched_device = None
                normalized_mac = normalize_mac(observation.client_mac_address)
                if normalized_mac:
                    matched_device = devices_by_mac.get(normalized_mac)
                if not matched_device and observation.client_ip_address:
                    matched_device = devices_by_ip.get(str(observation.client_ip_address).strip())
                if matched_device:
                    observed_device_ids.add(int(matched_device["id"]))
                    counts["known"] += 1
                else:
                    counts["unknown"] += 1

                mismatch_reason = _wrong_ap_reason(matched_device, ap)
                duplicate_ip = bool(observation.client_ip_address and observation.client_ip_address in duplicate_ips)
                status = _client_status(observation, matched_device, mismatch_reason, duplicate_ip)
                if _status_issue(status):
                    counts["issues"] += 1

                if not matched_device and observation.client_ip_address:
                    unknown_seen = True
                if mismatch_reason and matched_device:
                    wrong_ap_seen = True
                    _upsert_alert(
                        conn,
                        int(matched_device["id"]),
                        "AP_WRONG_AP",
                        "WARNING",
                        f"{matched_device['device_name']} is connected to wrong AP {ap['device_name']}",
                    )
                elif matched_device:
                    _resolve_alert(conn, int(matched_device["id"]), "AP_WRONG_AP")
                if duplicate_ip:
                    duplicate_seen = True

                db_payload = observation.to_db_payload()
                conn.execute(
                    """
                    INSERT INTO ap_client_observations(
                        ap_id, ap_name, ap_ip_address, client_mac_address, client_ip_address,
                        client_hostname, username, ssid, vlan, rssi, signal_quality,
                        connection_status, first_seen, last_seen, source, confidence, raw_data_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        ap_id,
                        ap.get("device_name"),
                        ap.get("ip_address"),
                        db_payload.get("client_mac_address"),
                        db_payload.get("client_ip_address"),
                        db_payload.get("client_hostname"),
                        db_payload.get("username"),
                        db_payload.get("ssid"),
                        db_payload.get("vlan"),
                        db_payload.get("rssi"),
                        db_payload.get("signal_quality"),
                        db_payload.get("connection_status"),
                        db_payload.get("first_seen"),
                        db_payload.get("last_seen"),
                        db_payload.get("source"),
                        db_payload.get("confidence"),
                        db_payload.get("raw_data_json"),
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO ap_connected_clients_current(
                        ap_id, client_mac_address, client_ip_address, client_hostname,
                        ssid, vlan, rssi, status, last_seen, is_known_device,
                        matched_device_id, mismatch_reason
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        ap_id,
                        db_payload.get("client_mac_address"),
                        db_payload.get("client_ip_address"),
                        db_payload.get("client_hostname"),
                        db_payload.get("ssid"),
                        db_payload.get("vlan"),
                        db_payload.get("rssi"),
                        status,
                        db_payload.get("last_seen"),
                        1 if matched_device else 0,
                        matched_device.get("id") if matched_device else None,
                        mismatch_reason,
                    ),
                )

            if unknown_seen:
                _upsert_alert(
                    conn,
                    ap_id,
                    "AP_UNKNOWN_CLIENT",
                    "WARNING",
                    f"{ap['device_name']} has unknown wireless clients",
                )
            else:
                _resolve_alert(conn, ap_id, "AP_UNKNOWN_CLIENT")

            if duplicate_seen:
                _upsert_alert(
                    conn,
                    ap_id,
                    "AP_DUPLICATE_IP",
                    "CRITICAL",
                    f"{ap['device_name']} has duplicate client IP addresses",
                )
            else:
                _resolve_alert(conn, ap_id, "AP_DUPLICATE_IP")

            if previous_count:
                drop_percent = ((previous_count - len(observations)) / previous_count) * 100
                if drop_percent >= settings.ap_client_count_drop_percent:
                    _upsert_alert(
                        conn,
                        ap_id,
                        "AP_CLIENT_COUNT_DROP",
                        "WARNING",
                        f"{ap['device_name']} client count dropped from {previous_count} to {len(observations)}",
                    )
                else:
                    _resolve_alert(conn, ap_id, "AP_CLIENT_COUNT_DROP")

            for device in devices:
                if not _expected_on_ap(device, ap):
                    continue
                criticality = str(device.get("criticality") or "").upper()
                if criticality not in {"HIGH", "CRITICAL"} or not device.get("monitoring_enabled"):
                    continue
                device_id = int(device["id"])
                if device_id not in observed_device_ids:
                    counts["issues"] += 1
                    _upsert_alert(
                        conn,
                        device_id,
                        "AP_CRITICAL_MISSING",
                        "CRITICAL",
                        f"Critical device {device['device_name']} is missing from AP {ap['device_name']}",
                    )
                else:
                    _resolve_alert(conn, device_id, "AP_CRITICAL_MISSING")

        duration_ms = int((time.time() - started) * 1000)
        conn.execute(
            """
            UPDATE ap_client_discovery_runs
            SET completed_at = CURRENT_TIMESTAMP, status = 'COMPLETED', provider = ?,
                total_aps = ?, total_clients = ?, known_count = ?, unknown_count = ?,
                issue_count = ?, duration_ms = ?
            WHERE id = ?
            """,
            (
                ",".join(sorted(provider_names)) or settings.ap_client_default_provider,
                counts["total_aps"],
                counts["total_clients"],
                counts["known"],
                counts["unknown"],
                counts["issues"],
                duration_ms,
                run_id,
            ),
        )
        conn.commit()
        return counts
    except Exception as exc:
        conn.execute(
            """
            UPDATE ap_client_discovery_runs
            SET completed_at = CURRENT_TIMESTAMP, status = 'FAILED', error_message = ?
            WHERE id = ?
            """,
            (str(exc), run_id),
        )
        conn.commit()
        raise
    finally:
        if owns_connection:
            conn.close()


async def ap_client_discovery_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await run_ap_client_discovery_cycle()
        except Exception:
            pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.ap_client_discovery_interval_seconds)
        except asyncio.TimeoutError:
            continue


def current_client_to_public(row: Any) -> dict[str, Any]:
    return row_to_dict(row) or {}
