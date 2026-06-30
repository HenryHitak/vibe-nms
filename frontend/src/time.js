export const NMS_TIME_ZONE = "America/Tijuana";
export const NMS_TIME_ZONE_LABEL = "Mexico/Tijuana";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: NMS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23"
});

function parseUtcDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const normalized = text.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTijuanaDateTime(value, fallback = "-") {
  const date = parseUtcDate(value);
  if (!date) {
    return fallback;
  }
  const parts = Object.fromEntries(
    DATE_TIME_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatTijuanaNow() {
  return formatTijuanaDateTime(new Date());
}
