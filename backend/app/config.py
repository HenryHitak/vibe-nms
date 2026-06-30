from __future__ import annotations

import os
from pathlib import Path


def _csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    app_name = os.getenv("NMS_APP_NAME", "Vibe NMS")
    database_engine = os.getenv("NMS_DATABASE_ENGINE", "sqlite").strip().lower()
    database_path = Path(os.getenv("NMS_DATABASE_PATH", "./data/nms.sqlite"))
    mssql_server = os.getenv("NMS_MSSQL_SERVER", "mssql")
    mssql_port = int(os.getenv("NMS_MSSQL_PORT", "1433"))
    mssql_database = os.getenv("NMS_MSSQL_DATABASE", "vibe_nms")
    mssql_username = os.getenv("NMS_MSSQL_USERNAME", "sa")
    mssql_password = os.getenv("NMS_MSSQL_PASSWORD", "ChangeThisStrongPassword!123")
    mssql_driver = os.getenv("NMS_MSSQL_DRIVER", "ODBC Driver 18 for SQL Server")
    mssql_trust_server_certificate = _bool(os.getenv("NMS_MSSQL_TRUST_SERVER_CERTIFICATE"), True)
    allowed_origins = _csv(os.getenv("NMS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5177"))
    trusted_proxy_ips = set(_csv(os.getenv("NMS_TRUSTED_PROXY_IPS", "")))
    corporate_networks = _csv(os.getenv("NMS_CORPORATE_NETWORKS", "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"))
    collector_enabled = _bool(os.getenv("NMS_COLLECTOR_ENABLED"), True)
    collector_interval_seconds = int(os.getenv("NMS_COLLECTOR_INTERVAL_SECONDS", "30"))
    collector_timeout_ms = int(os.getenv("NMS_COLLECTOR_TIMEOUT_MS", "1000"))
    warning_latency_ms = float(os.getenv("NMS_WARNING_LATENCY_MS", "150"))
    critical_latency_ms = float(os.getenv("NMS_CRITICAL_LATENCY_MS", "500"))
    warning_packet_loss_percent = float(os.getenv("NMS_WARNING_PACKET_LOSS_PERCENT", "5"))
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
    bootstrap_admin_username = os.getenv("NMS_BOOTSTRAP_ADMIN_USERNAME", "admin")
    bootstrap_admin_password = os.getenv("NMS_BOOTSTRAP_ADMIN_PASSWORD", "admin")
    bootstrap_admin_email = os.getenv("NMS_BOOTSTRAP_ADMIN_EMAIL", "admin@example.internal")


settings = Settings()
