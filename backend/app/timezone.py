from __future__ import annotations

from datetime import datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import settings


STORAGE_FORMAT = "%Y-%m-%d %H:%M:%S"


class TijuanaFallbackZone(tzinfo):
    def tzname(self, dt: datetime | None) -> str:
        return "America/Tijuana"

    def utcoffset(self, dt: datetime | None) -> timedelta:
        return timedelta(hours=-7 if self._is_dst(dt) else -8)

    def dst(self, dt: datetime | None) -> timedelta:
        return timedelta(hours=1 if self._is_dst(dt) else 0)

    @staticmethod
    def _nth_weekday(year: int, month: int, weekday: int, occurrence: int) -> int:
        first = datetime(year, month, 1)
        offset = (weekday - first.weekday()) % 7
        return 1 + offset + ((occurrence - 1) * 7)

    def _is_dst(self, dt: datetime | None) -> bool:
        if dt is None:
            return False
        naive = dt.replace(tzinfo=None)
        start_day = self._nth_weekday(naive.year, 3, 6, 2)
        end_day = self._nth_weekday(naive.year, 11, 6, 1)
        start = datetime(naive.year, 3, start_day, 2, 0, 0)
        end = datetime(naive.year, 11, end_day, 2, 0, 0)
        return start <= naive < end


def app_zone() -> tzinfo:
    try:
        return ZoneInfo(settings.time_zone)
    except ZoneInfoNotFoundError:
        return TijuanaFallbackZone()


def local_datetime_filter_to_utc_storage(value: str) -> str:
    text = value.strip()
    if not text:
        return text
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=app_zone())
    return parsed.astimezone(timezone.utc).replace(tzinfo=None, microsecond=0).strftime(STORAGE_FORMAT)
