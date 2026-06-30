import { useMemo, useState } from "react";
import { TriangleAlert, X } from "lucide-react";

export default function AlertBanner({ alerts = [] }) {
  const activeAlerts = alerts.filter((alert) => alert.status === "ACTIVE");
  const alertSignature = useMemo(
    () => activeAlerts.map((alert) => alert.id).sort((a, b) => a - b).join(","),
    [activeAlerts]
  );
  const [dismissedSignature, setDismissedSignature] = useState("");
  if (!activeAlerts.length) return null;
  if (alertSignature && dismissedSignature === alertSignature) return null;

  const severityRank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  const sorted = [...activeAlerts].sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));
  const plantCounts = sorted.reduce((acc, alert) => {
    const plant = alert.plant_name || alert.plant_code || "UNKNOWN";
    acc[plant] = acc[plant] || { plant_name: plant, count: 0, lines: new Set(), severity: alert.severity };
    acc[plant].count += 1;
    if (alert.line_name || alert.line_code) acc[plant].lines.add(alert.line_name || alert.line_code);
    if ((severityRank[alert.severity] ?? 9) < (severityRank[acc[plant].severity] ?? 9)) acc[plant].severity = alert.severity;
    return acc;
  }, {});
  const plantImpact = Object.values(plantCounts).sort((a, b) => b.count - a.count || (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))[0];
  const alert = sorted[0];
  const isPlantDrop = plantImpact && plantImpact.count >= 2;
  const severity = isPlantDrop ? plantImpact.severity : alert.severity;
  const red = severity === "CRITICAL";
  const classes = red
    ? "border-red-200 bg-red-50 text-red-900"
    : "border-amber-200 bg-amber-50 text-amber-950";
  const divider = red ? "text-red-400" : "text-amber-500";

  return (
    <div className={`mb-4 flex items-center gap-3 rounded-md border px-4 py-3 text-sm shadow-sm ${classes}`}>
      <TriangleAlert size={18} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{severity}</span>
        <span className={`mx-2 ${divider}`}>/</span>
        {isPlantDrop ? (
          <>
            <span className="font-semibold">Plant {plantImpact.plant_name}</span>
            <span className={`mx-2 ${divider}`}>/</span>
            <span>{plantImpact.count} active network alerts</span>
            <span className={`mx-2 ${divider}`}>/</span>
            <span>Lines {[...plantImpact.lines].slice(0, 4).join(", ") || "-"}</span>
          </>
        ) : (
          <>
            <span>Plant {alert.plant_name || alert.plant_code || "-"}</span>
            <span className={`mx-2 ${divider}`}>/</span>
            <span>{alert.line_name || alert.line_code || "LINE"}</span>
            <span className={`mx-2 ${divider}`}>/</span>
            <span>{alert.device_name || "Device"}</span>
            <span className={`mx-2 ${divider}`}>/</span>
            <span>{alert.ip_address || alert.message}</span>
          </>
        )}
      </div>
      <button
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-current/20 bg-white/50 hover:bg-white"
        title="Dismiss alert banner"
        onClick={() => setDismissedSignature(alertSignature)}
      >
        <X size={15} />
      </button>
    </div>
  );
}
