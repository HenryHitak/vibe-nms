from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TrimmedModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class DevicePayload(TrimmedModel):
    plant_code: str | None = None
    plant_name: str | None = None
    building: str | None = None
    floor: str | None = None
    area: str | None = None
    zone: str | None = None
    line_code: str | None = None
    line_name: str | None = None
    detailed_location: str | None = None
    device_name: str
    device_type: str
    ip_address: str
    mac_address: str | None = None
    hostname: str | None = None
    connected_ap_name: str | None = None
    connected_ap_ip: str | None = None
    ap_vendor: str | None = None
    ap_controller_type: str | None = None
    ap_controller_id: str | None = None
    switch_name: str | None = None
    switch_port: str | None = None
    vlan: int | None = None
    owner_department: str | None = None
    criticality: str = "MEDIUM"
    monitoring_enabled: bool = True
    notes: str | None = None


class DevicePatch(TrimmedModel):
    plant_code: str | None = None
    plant_name: str | None = None
    building: str | None = None
    floor: str | None = None
    area: str | None = None
    zone: str | None = None
    line_code: str | None = None
    line_name: str | None = None
    detailed_location: str | None = None
    device_name: str | None = None
    device_type: str | None = None
    ip_address: str | None = None
    mac_address: str | None = None
    hostname: str | None = None
    connected_ap_name: str | None = None
    connected_ap_ip: str | None = None
    ap_vendor: str | None = None
    ap_controller_type: str | None = None
    ap_controller_id: str | None = None
    switch_name: str | None = None
    switch_port: str | None = None
    vlan: int | None = None
    owner_department: str | None = None
    criticality: str | None = None
    monitoring_enabled: bool | None = None
    notes: str | None = None


class ImportCommitRequest(TrimmedModel):
    import_job_id: int = Field(..., gt=0)


class SelectedDevicesExportRequest(TrimmedModel):
    device_ids: list[int] = Field(..., min_length=1, max_length=500)


class NotificationReadRequest(TrimmedModel):
    read: bool = True


class NotificationMutePayload(TrimmedModel):
    muted: bool = True


class SettingValue(TrimmedModel):
    value: str


class BulkSettingsPayload(TrimmedModel):
    settings: dict[str, Any]


class DatabaseConfigPayload(TrimmedModel):
    database_engine: str = "mssql"
    database_path: str | None = None
    mssql_server: str = "localhost\\SQLEXPRESS"
    mssql_port: str | None = None
    mssql_database: str = "vibe_nms"
    mssql_auth: str = "sql"
    mssql_username: str | None = "sa"
    mssql_password: str | None = None
    mssql_driver: str = "ODBC Driver 18 for SQL Server"
    mssql_encrypt: bool = True
    mssql_trust_server_certificate: bool = True


class DisplayDashboardRequest(TrimmedModel):
    plant: str | None = None
    line: str | None = None
    status: str | None = None
    device_limit: int = Field(200, ge=1, le=1000)
    alert_limit: int = Field(20, ge=1, le=100)
    metric_limit: int = Field(60, ge=1, le=500)
    include_ap: bool = True


class TrafficConfigPayload(TrimmedModel):
    traffic_collection_enabled: bool = True
    traffic_collection_interval_seconds: int = Field(60, ge=10, le=3600)
    traffic_default_provider: str = "not-configured"
    traffic_generic_api_url: str | None = None
    traffic_generic_api_token: str | None = None
    cisco_wlc_controller_url: str | None = None
    cisco_wlc_api_token: str | None = None
    generic_snmp_community: str | None = None


class TrafficObservationPayload(TrimmedModel):
    device_id: int | None = None
    ip_address: str | None = None
    device_name: str | None = None
    interface_name: str | None = None
    rx_bps: float | None = None
    tx_bps: float | None = None
    utilization_percent: float | None = None
    source: str = "api-ingest"
    collected_at: str | None = None
    raw_data: dict[str, Any] | None = None


class TrafficObservationIngestRequest(TrimmedModel):
    observations: list[TrafficObservationPayload] = Field(..., min_length=1, max_length=500)


class APClientRegistrationPayload(TrimmedModel):
    device_name: str
    device_type: str = "OTHER"
    ip_address: str
    mac_address: str | None = None
    hostname: str | None = None
    vlan: int | None = None
    owner_department: str | None = None
    criticality: str = "MEDIUM"
    monitoring_enabled: bool = True
    notes: str | None = None


class APClientRegistrationPatch(TrimmedModel):
    device_name: str | None = None
    device_type: str | None = None
    ip_address: str | None = None
    mac_address: str | None = None
    hostname: str | None = None
    vlan: int | None = None
    owner_department: str | None = None
    criticality: str | None = None
    monitoring_enabled: bool | None = None
    notes: str | None = None


class LoginRequest(TrimmedModel):
    username: str
    password: str


class UserCreatePayload(TrimmedModel):
    username: str
    password: str = Field(..., min_length=4)
    display_name: str | None = None
    email: str | None = None
    role: str = "USER"
    is_active: bool = True


class UserUpdatePayload(TrimmedModel):
    display_name: str | None = None
    email: str | None = None
    role: str | None = None
    is_active: bool | None = None


class PasswordResetPayload(TrimmedModel):
    password: str = Field(..., min_length=4)
