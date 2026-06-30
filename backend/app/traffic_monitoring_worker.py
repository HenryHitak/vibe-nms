from __future__ import annotations

import asyncio
from statistics import mean
from typing import Any

from .config import settings
from .db import connect, rows_to_dicts
from .traffic_providers import provider_for_device


def _rollup(values: list[float | None]) -> tuple[float | None, float | None, float | None]:
    clean = [float(value) for value in values if value is not None]
    if not clean:
        return None, None, None
    return min(clean), max(clean), round(mean(clean), 2)


async def run_traffic_collection_cycle(conn: Any | None = None) -> dict[str, int]:
    owns_connection = conn is None
    if conn is None:
        conn = connect()
    counts = {"total": 0, "collected": 0, "skipped": 0}
    try:
        devices = rows_to_dicts(
            conn.execute(
                """
                SELECT * FROM network_devices
                WHERE is_deleted = 0
                  AND monitoring_enabled = 1
                  AND ip_address IS NOT NULL
                  AND ip_address != ''
                ORDER BY id
                """
            ).fetchall()
        )
        for device in devices:
            counts["total"] += 1
            provider = provider_for_device(device)
            observation = await provider.get_traffic(device)
            if not observation or (observation.rx_bps is None and observation.tx_bps is None):
                counts["skipped"] += 1
                continue
            recent_rows = conn.execute(
                """
                SELECT rx_bps, tx_bps
                FROM network_traffic_metrics
                WHERE device_id = ?
                ORDER BY collected_at DESC, id DESC
                LIMIT 29
                """,
                (device["id"],),
            ).fetchall()
            recent_rx = [row["rx_bps"] for row in recent_rows]
            recent_tx = [row["tx_bps"] for row in recent_rows]
            rx_min, rx_max, rx_avg = _rollup([observation.rx_bps, *recent_rx])
            tx_min, tx_max, tx_avg = _rollup([observation.tx_bps, *recent_tx])
            payload = observation.to_db_payload()
            conn.execute(
                """
                INSERT INTO network_traffic_metrics(
                    device_id, interface_name, rx_bps, tx_bps,
                    rx_min_bps, rx_max_bps, rx_avg_bps,
                    tx_min_bps, tx_max_bps, tx_avg_bps,
                    utilization_percent, source, raw_data_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    device["id"],
                    payload.get("interface_name"),
                    payload.get("rx_bps"),
                    payload.get("tx_bps"),
                    rx_min,
                    rx_max,
                    rx_avg,
                    tx_min,
                    tx_max,
                    tx_avg,
                    payload.get("utilization_percent"),
                    payload.get("source"),
                    payload.get("raw_data_json"),
                ),
            )
            counts["collected"] += 1
        conn.commit()
        return counts
    finally:
        if owns_connection:
            conn.close()


async def traffic_collection_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await run_traffic_collection_cycle()
        except Exception:
            pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.traffic_collection_interval_seconds)
        except asyncio.TimeoutError:
            continue
