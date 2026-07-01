from __future__ import annotations

from typing import Any


ALERT_SETTING_DEFAULTS = {
    "alert_network_warning_enabled": "true",
    "alert_network_offline_enabled": "true",
    "alert_network_packet_loss_enabled": "true",
    "alert_network_latency_enabled": "true",
    "alert_network_flapping_enabled": "true",
    "alert_ap_unknown_client_enabled": "true",
    "alert_ap_wrong_ap_enabled": "true",
    "alert_ap_duplicate_ip_enabled": "true",
    "alert_ap_critical_missing_enabled": "true",
    "alert_ap_client_count_drop_enabled": "true",
}


NETWORK_ALERT_SETTING_BY_TYPE = {
    "WARNING": "alert_network_warning_enabled",
    "OFFLINE": "alert_network_offline_enabled",
    "CRITICAL": "alert_network_offline_enabled",
    "PACKET_LOSS": "alert_network_packet_loss_enabled",
    "LATENCY": "alert_network_latency_enabled",
    "FLAPPING": "alert_network_flapping_enabled",
}


AP_ALERT_SETTING_BY_TYPE = {
    "AP_UNKNOWN_CLIENT": "alert_ap_unknown_client_enabled",
    "AP_WRONG_AP": "alert_ap_wrong_ap_enabled",
    "AP_DUPLICATE_IP": "alert_ap_duplicate_ip_enabled",
    "AP_CRITICAL_MISSING": "alert_ap_critical_missing_enabled",
    "AP_CLIENT_COUNT_DROP": "alert_ap_client_count_drop_enabled",
}


def setting_enabled(conn: Any, key: str) -> bool:
    row = conn.execute("SELECT value FROM system_settings WHERE key = ?", (key,)).fetchone()
    value = row["value"] if row else ALERT_SETTING_DEFAULTS.get(key, "true")
    return str(value).strip().lower() in {"1", "true", "yes", "on", "enabled"}


def network_alert_enabled(conn: Any, alert_type: str) -> bool:
    key = NETWORK_ALERT_SETTING_BY_TYPE.get(str(alert_type or "").upper())
    return True if not key else setting_enabled(conn, key)


def ap_alert_enabled(conn: Any, alert_type: str) -> bool:
    key = AP_ALERT_SETTING_BY_TYPE.get(str(alert_type or "").upper())
    return True if not key else setting_enabled(conn, key)
