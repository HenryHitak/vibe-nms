from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DevicePayload(BaseModel):
    plant_code: str
    plant_name: str | None = None
    building: str | None = None
    floor: str | None = None
    area: str | None = None
    zone: str | None = None
    line_code: str
    line_name: str | None = None
    detailed_location: str | None = None
    device_name: str
    device_type: str
    ip_address: str
    mac_address: str | None = None
    hostname: str | None = None
    connected_ap_name: str | None = None
    connected_ap_ip: str | None = None
    switch_name: str | None = None
    switch_port: str | None = None
    vlan: int | None = None
    owner_department: str | None = None
    criticality: str = "MEDIUM"
    monitoring_enabled: bool = True
    notes: str | None = None


class DevicePatch(BaseModel):
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
    switch_name: str | None = None
    switch_port: str | None = None
    vlan: int | None = None
    owner_department: str | None = None
    criticality: str | None = None
    monitoring_enabled: bool | None = None
    notes: str | None = None


class ImportCommitRequest(BaseModel):
    import_job_id: int = Field(..., gt=0)


class NotificationReadRequest(BaseModel):
    read: bool = True


class SettingValue(BaseModel):
    value: str


class BulkSettingsPayload(BaseModel):
    settings: dict[str, Any]


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreatePayload(BaseModel):
    username: str
    password: str = Field(..., min_length=8)
    display_name: str | None = None
    email: str | None = None
    role: str = "USER"
    is_active: bool = True


class UserUpdatePayload(BaseModel):
    display_name: str | None = None
    email: str | None = None
    role: str | None = None
    is_active: bool | None = None


class PasswordResetPayload(BaseModel):
    password: str = Field(..., min_length=8)
