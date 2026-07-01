from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any, Protocol

from .config import settings


@dataclass
class TrafficObservation:
    interface_name: str | None = None
    rx_bps: float | None = None
    tx_bps: float | None = None
    utilization_percent: float | None = None
    source: str = "demo"
    raw_data: dict[str, Any] | None = None

    def to_db_payload(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["raw_data_json"] = json.dumps(payload.pop("raw_data") or {}, default=str)
        return payload


class TrafficProvider(Protocol):
    name: str

    async def get_traffic(self, device: dict[str, Any]) -> TrafficObservation | None:
        ...


class DemoTrafficProvider:
    name = "demo"

    async def get_traffic(self, device: dict[str, Any]) -> TrafficObservation | None:
        device_id = int(device.get("id") or 1)
        tick = int(time.time() / max(10, settings.traffic_collection_interval_seconds))
        phase = (tick + device_id) % 360
        criticality = str(device.get("criticality") or "MEDIUM").upper()
        multiplier = 1.8 if criticality in {"HIGH", "CRITICAL"} else 1.0
        wave = (math.sin(phase / 8) + 1) / 2
        offset = ((device_id * 37) % 100) / 100
        rx_mbps = (0.4 + (wave * 7.5) + offset) * multiplier
        tx_mbps = (0.2 + ((1 - wave) * 4.0) + offset / 2) * multiplier
        return TrafficObservation(
            interface_name=device.get("switch_port") or device.get("connected_ap_name") or "auto",
            rx_bps=round(rx_mbps * 1_000_000, 2),
            tx_bps=round(tx_mbps * 1_000_000, 2),
            utilization_percent=round(min(100.0, ((rx_mbps + tx_mbps) / 100) * 100), 2),
            source=self.name,
            raw_data={"demo": True, "device_id": device_id, "phase": phase},
        )


class NoTrafficProvider:
    name = "not-configured"

    async def get_traffic(self, device: dict[str, Any]) -> TrafficObservation | None:
        return None


class GenericAPITrafficProvider:
    name = "generic-api"

    def __init__(self, base_url: str, token: str, source: str = "generic-api"):
        self.base_url = (base_url or "").rstrip("/")
        self.token = token or ""
        self.name = source

    async def get_traffic(self, device: dict[str, Any]) -> TrafficObservation | None:
        if not self.base_url or not self.token:
            return None
        identifier = device.get("ap_controller_id") or device.get("ip_address") or device.get("device_name")
        if not identifier:
            return None
        url = f"{self.base_url}/devices/{identifier}/traffic"
        request = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/json",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        return TrafficObservation(
            interface_name=payload.get("interface_name") or payload.get("interface") or payload.get("port"),
            rx_bps=_float_or_none(payload.get("rx_bps") or payload.get("rxBps") or payload.get("rx")),
            tx_bps=_float_or_none(payload.get("tx_bps") or payload.get("txBps") or payload.get("tx")),
            utilization_percent=_float_or_none(payload.get("utilization_percent") or payload.get("utilization")),
            source=self.name,
            raw_data=payload,
        )


class CiscoWLCTrafficProvider(GenericAPITrafficProvider):
    def __init__(self):
        super().__init__(settings.cisco_wlc_controller_url, settings.cisco_wlc_api_token, "cisco-wlc")


class GenericSNMPTrafficProvider:
    name = "generic-snmp"

    async def get_traffic(self, device: dict[str, Any]) -> TrafficObservation | None:
        # Stub: real SNMP interface counter polling requires device-specific IF-MIB index mapping.
        return None


def provider_for_device(device: dict[str, Any]) -> TrafficProvider:
    default_provider = settings.traffic_default_provider or "not-configured"
    provider_key = default_provider if default_provider != "auto" else (
        device.get("ap_controller_type")
        or device.get("ap_vendor")
        or "not-configured"
    )
    normalized = str(provider_key).strip().lower().replace("_", "-")
    if normalized in {"", "none", "off", "disabled", "not-configured", "not-configured-yet"}:
        return NoTrafficProvider()
    if normalized in {"demo", "local-demo"}:
        return DemoTrafficProvider()
    if normalized in {"generic", "generic-api", "traffic-api"}:
        return GenericAPITrafficProvider(settings.traffic_generic_api_url, settings.traffic_generic_api_token)
    if normalized in {"cisco", "cisco-wlc", "cisco-wlc-api"}:
        return CiscoWLCTrafficProvider()
    if normalized in {"snmp", "generic-snmp"}:
        return GenericSNMPTrafficProvider()
    return NoTrafficProvider()


def _float_or_none(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
