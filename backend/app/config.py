from __future__ import annotations

import os
from pathlib import Path


def _csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _csv_ints(value: str | None) -> list[int]:
    values: list[int] = []
    for item in _csv(value):
        try:
            port = int(item)
        except ValueError:
            continue
        if 1 <= port <= 65535:
            values.append(port)
    return values


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    app_name = os.getenv("NMS_APP_NAME", "Vibe NMS")
    database_engine = os.getenv("NMS_DATABASE_ENGINE", "sqlite").strip().lower()
    database_path = Path(os.getenv("NMS_DATABASE_PATH", "./data/nms.sqlite"))
    frontend_dist_path = Path(os.getenv("NMS_FRONTEND_DIST", "./frontend/dist"))
    mssql_server = os.getenv("NMS_MSSQL_SERVER", "localhost\\SQLEXPRESS")
    mssql_port = os.getenv("NMS_MSSQL_PORT", "").strip()
    mssql_database = os.getenv("NMS_MSSQL_DATABASE", "vibe_nms")
    mssql_auth = os.getenv("NMS_MSSQL_AUTH", "sql").strip().lower()
    mssql_username = os.getenv("NMS_MSSQL_USERNAME", "sa")
    mssql_password = os.getenv("NMS_MSSQL_PASSWORD", "")
    mssql_driver = os.getenv("NMS_MSSQL_DRIVER", "ODBC Driver 18 for SQL Server")
    mssql_encrypt = _bool(os.getenv("NMS_MSSQL_ENCRYPT"), True)
    mssql_trust_server_certificate = _bool(os.getenv("NMS_MSSQL_TRUST_SERVER_CERTIFICATE"), True)
    allowed_origins = _csv(os.getenv("NMS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5177"))
    trusted_proxy_ips = set(_csv(os.getenv("NMS_TRUSTED_PROXY_IPS", "")))
    corporate_networks = _csv(os.getenv("NMS_CORPORATE_NETWORKS", "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"))
    collector_enabled = _bool(os.getenv("NMS_COLLECTOR_ENABLED"), True)
    collector_interval_seconds = int(os.getenv("NMS_COLLECTOR_INTERVAL_SECONDS", "30"))
    collector_timeout_ms = int(os.getenv("NMS_COLLECTOR_TIMEOUT_MS", "1000"))
    ping_count = max(1, int(os.getenv("NMS_PING_COUNT", "3")))
    tcp_fallback_ports = _csv_ints(os.getenv("NMS_TCP_FALLBACK_PORTS", "445,3389,80,443"))
    warning_latency_ms = float(os.getenv("NMS_WARNING_LATENCY_MS", "150"))
    critical_latency_ms = float(os.getenv("NMS_CRITICAL_LATENCY_MS", "500"))
    warning_packet_loss_percent = float(os.getenv("NMS_WARNING_PACKET_LOSS_PERCENT", "5"))
    traffic_collection_enabled = _bool(os.getenv("NMS_TRAFFIC_COLLECTION_ENABLED"), True)
    traffic_collection_interval_seconds = int(os.getenv("NMS_TRAFFIC_COLLECTION_INTERVAL_SECONDS", "60"))
    traffic_default_provider = os.getenv("NMS_TRAFFIC_DEFAULT_PROVIDER", "demo").strip().lower()
    traffic_generic_api_url = os.getenv("NMS_TRAFFIC_GENERIC_API_URL", "")
    traffic_generic_api_token = os.getenv("NMS_TRAFFIC_GENERIC_API_TOKEN", "")
    ap_client_discovery_enabled = _bool(os.getenv("NMS_AP_CLIENT_DISCOVERY_ENABLED"), True)
    ap_client_discovery_interval_seconds = int(os.getenv("NMS_AP_CLIENT_DISCOVERY_INTERVAL_SECONDS", "60"))
    ap_client_default_provider = os.getenv("NMS_AP_CLIENT_DEFAULT_PROVIDER", "demo").strip().lower()
    ap_client_count_drop_percent = float(os.getenv("NMS_AP_CLIENT_COUNT_DROP_PERCENT", "50"))
    meraki_api_base_url = os.getenv("NMS_MERAKI_API_BASE_URL", "https://api.meraki.com/api/v1")
    meraki_api_token = os.getenv("NMS_MERAKI_API_TOKEN", "")
    aruba_central_base_url = os.getenv("NMS_ARUBA_CENTRAL_BASE_URL", "")
    aruba_central_api_token = os.getenv("NMS_ARUBA_CENTRAL_API_TOKEN", "")
    unifi_controller_url = os.getenv("NMS_UNIFI_CONTROLLER_URL", "")
    unifi_api_token = os.getenv("NMS_UNIFI_API_TOKEN", "")
    cisco_wlc_controller_url = os.getenv("NMS_CISCO_WLC_CONTROLLER_URL", "")
    cisco_wlc_api_token = os.getenv("NMS_CISCO_WLC_API_TOKEN", "")
    generic_snmp_community = os.getenv("NMS_GENERIC_SNMP_COMMUNITY", "")
    generic_api_controller_url = os.getenv("NMS_GENERIC_API_CONTROLLER_URL", "")
    generic_api_token = os.getenv("NMS_GENERIC_API_TOKEN", "")
    default_role = os.getenv("NMS_DEFAULT_ROLE", "USER").upper()
    seed_sample_data = _bool(os.getenv("NMS_SEED_SAMPLE_DATA"), True)
    auth_secret = os.getenv("NMS_AUTH_SECRET", "change-this-local-development-secret")
    token_ttl_minutes = int(os.getenv("NMS_TOKEN_TTL_MINUTES", "720"))
    display_api_token = os.getenv("NMS_DISPLAY_API_TOKEN", "")
    time_zone = os.getenv("NMS_TIME_ZONE", "America/Tijuana")
    bootstrap_admin_username = os.getenv("NMS_BOOTSTRAP_ADMIN_USERNAME", "admin")
    bootstrap_admin_password = os.getenv("NMS_BOOTSTRAP_ADMIN_PASSWORD", "admin")
    bootstrap_admin_email = os.getenv("NMS_BOOTSTRAP_ADMIN_EMAIL", "admin@example.internal")


settings = Settings()
