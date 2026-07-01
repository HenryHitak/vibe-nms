from __future__ import annotations

import json
import random
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from .config import settings


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_mac(value: str | None) -> str | None:
    if not value:
        return None
    compact = "".join(character for character in value.upper() if character.isalnum())
    if len(compact) != 12:
        return value.upper().replace("-", ":")
    return ":".join(compact[index:index + 2] for index in range(0, 12, 2))


@dataclass
class APClientObservation:
    client_mac_address: str | None = None
    client_ip_address: str | None = None
    client_hostname: str | None = None
    username: str | None = None
    ssid: str | None = None
    vlan: int | None = None
    rssi: int | None = None
    signal_quality: str | None = None
    connection_status: str = "CONNECTED"
    first_seen: str | None = None
    last_seen: str | None = None
    source: str = "demo"
    confidence: float = 0.95
    raw_data: dict[str, Any] | None = None

    def to_db_payload(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["client_mac_address"] = normalize_mac(payload["client_mac_address"])
        payload["raw_data_json"] = json.dumps(payload.pop("raw_data") or {}, default=str)
        return payload


class APClientProvider(Protocol):
    name: str

    async def get_connected_clients(self, ap: dict[str, Any]) -> list[APClientObservation]:
        ...


class DemoAPClientProvider:
    name = "demo"

    def __init__(self, registered_devices: list[dict[str, Any]] | None = None):
        self.registered_devices = registered_devices or []

    async def get_connected_clients(self, ap: dict[str, Any]) -> list[APClientObservation]:
        now = utc_now_iso()
        observations: list[APClientObservation] = []
        ap_name = ap.get("device_name")
        ap_ip = ap.get("ip_address")

        for device in self.registered_devices:
            if device.get("id") == ap.get("id"):
                continue
            expected_name = (device.get("connected_ap_name") or "").lower()
            expected_ip = device.get("connected_ap_ip") or ""
            if expected_name != (ap_name or "").lower() and expected_ip != ap_ip:
                continue
            observations.append(
                APClientObservation(
                    client_mac_address=device.get("mac_address"),
                    client_ip_address=device.get("ip_address"),
                    client_hostname=device.get("hostname") or device.get("device_name"),
                    username=None,
                    ssid="Plant-IoT",
                    vlan=device.get("vlan"),
                    rssi=-48 - min(len(observations) * 4, 24),
                    signal_quality="GOOD",
                    first_seen=now,
                    last_seen=now,
                    source=self.name,
                    confidence=0.98,
                    raw_data={"demo_source": "registered_device", "device_id": device.get("id")},
                )
            )

        if not observations:
            seed = int(ap.get("id") or 1)
            random.seed(seed)
            observations.append(
                APClientObservation(
                    client_mac_address=f"02:00:00:{seed:02X}:AA:01",
                    client_ip_address=f"10.{seed % 200}.10.{20 + seed % 30}",
                    client_hostname=f"demo-client-{seed}",
                    ssid="Plant-IoT",
                    vlan=100 + seed % 20,
                    rssi=-55,
                    signal_quality="GOOD",
                    first_seen=now,
                    last_seen=now,
                    source=self.name,
                    confidence=0.80,
                    raw_data={"demo_source": "synthetic_client"},
                )
            )
        return observations


class NoAPClientProvider:
    name = "not-configured"

    async def get_connected_clients(self, ap: dict[str, Any]) -> list[APClientObservation]:
        return []


class GenericAPIAPClientProvider:
    name = "generic-api"

    def __init__(self, base_url: str, token: str, source: str = "generic-api"):
        self.base_url = (base_url or "").rstrip("/")
        self.token = token or ""
        self.name = source

    async def get_connected_clients(self, ap: dict[str, Any]) -> list[APClientObservation]:
        if not self.base_url or not self.token:
            return []
        controller_id = ap.get("ap_controller_id") or ap.get("ip_address") or ap.get("device_name")
        url = f"{self.base_url}/access-points/{controller_id}/clients"
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
            return []
        rows = payload.get("clients") if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            return []
        return [self._observation_from_row(row) for row in rows if isinstance(row, dict)]

    def _observation_from_row(self, row: dict[str, Any]) -> APClientObservation:
        now = utc_now_iso()
        return APClientObservation(
            client_mac_address=row.get("mac") or row.get("macAddress") or row.get("client_mac_address"),
            client_ip_address=row.get("ip") or row.get("ipAddress") or row.get("client_ip_address"),
            client_hostname=row.get("hostname") or row.get("name") or row.get("client_hostname"),
            username=row.get("username") or row.get("user"),
            ssid=row.get("ssid"),
            vlan=_int_or_none(row.get("vlan")),
            rssi=_int_or_none(row.get("rssi")),
            signal_quality=row.get("signal_quality") or row.get("signalQuality"),
            connection_status=row.get("status") or "CONNECTED",
            first_seen=row.get("first_seen") or row.get("firstSeen") or now,
            last_seen=row.get("last_seen") or row.get("lastSeen") or now,
            source=self.name,
            confidence=0.90,
            raw_data=row,
        )


class MerakiAPIAPClientProvider(GenericAPIAPClientProvider):
    def __init__(self):
        super().__init__(settings.meraki_api_base_url, settings.meraki_api_token, "meraki-api")


class ArubaCentralAPIAPClientProvider(GenericAPIAPClientProvider):
    def __init__(self):
        super().__init__(settings.aruba_central_base_url, settings.aruba_central_api_token, "aruba-central-api")


class UniFiAPIAPClientProvider(GenericAPIAPClientProvider):
    def __init__(self):
        super().__init__(settings.unifi_controller_url, settings.unifi_api_token, "unifi-api")


class CiscoWLCAPIOrCLIProvider(GenericAPIAPClientProvider):
    def __init__(self):
        super().__init__(settings.cisco_wlc_controller_url, settings.cisco_wlc_api_token, "cisco-wlc")


class GenericSNMPAPClientProvider:
    name = "generic-snmp"

    async def get_connected_clients(self, ap: dict[str, Any]) -> list[APClientObservation]:
        # Stub: SNMP OID walks are vendor-specific and should be implemented per controller model.
        return []


def provider_for_ap(ap: dict[str, Any], registered_devices: list[dict[str, Any]] | None = None) -> APClientProvider:
    provider_key = (
        ap.get("ap_controller_type")
        or ap.get("ap_vendor")
        or settings.ap_client_default_provider
        or "not-configured"
    )
    normalized = str(provider_key).strip().lower().replace("_", "-")
    if normalized in {"", "none", "off", "disabled", "not-configured", "not-configured-yet"}:
        return NoAPClientProvider()
    if normalized in {"demo", "local-demo"}:
        return DemoAPClientProvider(registered_devices)
    if normalized in {"meraki", "meraki-api"}:
        return MerakiAPIAPClientProvider()
    if normalized in {"aruba", "aruba-central", "aruba-central-api"}:
        return ArubaCentralAPIAPClientProvider()
    if normalized in {"unifi", "unifi-api"}:
        return UniFiAPIAPClientProvider()
    if normalized in {"cisco", "cisco-wlc", "cisco-wlc-api", "cisco-wlc-cli"}:
        return CiscoWLCAPIOrCLIProvider()
    if normalized in {"snmp", "generic-snmp"}:
        return GenericSNMPAPClientProvider()
    if normalized in {"generic", "generic-api"}:
        return GenericAPIAPClientProvider(settings.generic_api_controller_url, settings.generic_api_token)
    return NoAPClientProvider()


def _int_or_none(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
