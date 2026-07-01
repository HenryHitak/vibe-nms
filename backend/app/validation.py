from __future__ import annotations

import ipaddress
import re
from typing import Any

from .config import settings


VALID_DEVICE_TYPES = {
    "AP",
    "CAMERA",
    "CONTROLLER",
    "FIREWALL",
    "HMI",
    "IOT",
    "LAPTOP",
    "MOBILE",
    "NAS",
    "PLC",
    "PC",
    "PRINTER",
    "ROBOT",
    "ROUTER",
    "SCANNER",
    "SENSOR",
    "SWITCH",
    "SERVER",
    "TABLET",
    "UPS",
    "WORKSTATION",
    "OTHER",
}
VALID_CRITICALITY = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_STATUSES = {"ONLINE", "WARNING", "UNCERTAIN", "FLAPPING", "OFFLINE", "CRITICAL", "UNKNOWN", "DISABLED"}
VALID_ALERT_STATUS = {"ACTIVE", "ACKNOWLEDGED", "RESOLVED", "SUPPRESSED"}


def normalize_upper(value: Any) -> str:
    return str(value or "").strip().upper()


def validate_ip(value: str | None) -> bool:
    if not value:
        return False
    try:
        ipaddress.ip_address(value.strip())
        return True
    except ValueError:
        return False


def validate_mac(value: str | None) -> bool:
    if not value:
        return True
    return bool(re.fullmatch(r"([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}", value.strip()))


def parse_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "yes", "y", "1", "enabled", "on"}:
            return True
        if text in {"false", "no", "n", "0", "disabled", "off"}:
            return False
    return None


def ip_in_allowed_networks(ip_address: str) -> bool:
    if not settings.corporate_networks:
        return True
    try:
        ip_obj = ipaddress.ip_address(ip_address)
    except ValueError:
        return False
    for network in settings.corporate_networks:
        try:
            if ip_obj in ipaddress.ip_network(network, strict=False):
                return True
        except ValueError:
            continue
    return False
