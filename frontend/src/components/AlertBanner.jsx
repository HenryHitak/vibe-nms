import { TriangleAlert } from "lucide-react";

export default function AlertBanner({ alerts = [] }) {
  const critical = alerts.find((alert) => alert.severity === "CRITICAL" && alert.status === "ACTIVE");
  if (!critical) return null;
  return (
    <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-900">
      <TriangleAlert size={18} />
      <div className="min-w-0">
        <span className="font-semibold">CRITICAL</span>
        <span className="mx-2 text-red-400">/</span>
        <span>{critical.line_code || "LINE"}</span>
        <span className="mx-2 text-red-400">/</span>
        <span>{critical.device_name || "Device"}</span>
        <span className="mx-2 text-red-400">/</span>
        <span>{critical.ip_address || critical.message}</span>
      </div>
    </div>
  );
}

