import {
  Activity,
  Gauge,
  MapPin,
  Network,
  RadioTower,
  Server,
  ShieldAlert,
  Wifi
} from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";

const STATUS_TONE = {
  ONLINE: {
    label: "Healthy",
    border: "border-green-200",
    header: "bg-green-50",
    dot: "bg-green-nms",
    text: "text-green-800"
  },
  WARNING: {
    label: "Needs attention",
    border: "border-amber-200",
    header: "bg-amber-50",
    dot: "bg-orange-nms",
    text: "text-amber-900"
  },
  UNCERTAIN: {
    label: "Uncertain",
    border: "border-amber-200",
    header: "bg-amber-50",
    dot: "bg-orange-nms",
    text: "text-amber-900"
  },
  FLAPPING: {
    label: "Flapping",
    border: "border-amber-200",
    header: "bg-amber-50",
    dot: "bg-orange-nms",
    text: "text-amber-900"
  },
  OFFLINE: {
    label: "Down",
    border: "border-red-200",
    header: "bg-red-50",
    dot: "bg-red-nms",
    text: "text-red-800"
  },
  CRITICAL: {
    label: "Critical outage",
    border: "border-red-200",
    header: "bg-red-50",
    dot: "bg-red-nms",
    text: "text-red-800"
  },
  UNKNOWN: {
    label: "Unknown",
    border: "border-slate-200",
    header: "bg-slate-50",
    dot: "bg-slate-400",
    text: "text-slate-700"
  }
};

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

function locationText(device) {
  const parts = [device.building, device.floor, device.area, device.zone].filter(Boolean);
  return parts.length ? parts.join(" / ") : "-";
}

function metricTone(metric, value) {
  if (metric === "loss") {
    if (value >= 100) return "red";
    if (value > 0) return "amber";
    return "green";
  }
  if (metric === "failures") {
    if (value >= 3) return "red";
    if (value > 0) return "amber";
    return "green";
  }
  if (metric === "latency") {
    if (value == null) return "slate";
    if (value >= 250) return "red";
    if (value >= 100) return "amber";
    return "green";
  }
  return "slate";
}

function MetricTile({ icon: Icon, label, value, tone }) {
  const toneClass = {
    green: "border-green-200 bg-green-50 text-green-800",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-800",
    slate: "border-line bg-slate-50 text-slate-700"
  }[tone] || "border-line bg-slate-50 text-slate-700";

  return (
    <div className={`rounded-md border px-3 py-2.5 ${toneClass}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-normal opacity-75">{label}</span>
        <Icon size={15} />
      </div>
      <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function InfoItem({ icon: Icon, label, primary, secondary }) {
  return (
    <div className="flex min-w-0 gap-3 rounded-md border border-line bg-slate-50 p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-500">
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-normal text-slate-500">{label}</div>
        <div className="truncate text-sm font-semibold text-ink">{valueOrDash(primary)}</div>
        {secondary !== undefined ? <div className="truncate text-xs text-slate-500">{valueOrDash(secondary)}</div> : null}
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="grid grid-cols-[98px_1fr] gap-3 border-b border-line py-2.5 text-sm last:border-b-0">
      <div className="text-slate-500">{label}</div>
      <div className="min-w-0 break-words font-medium text-ink">{valueOrDash(value)}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-normal text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

export default function DeviceDetailPanel({ device }) {
  if (!device) {
    return (
      <aside className="flex h-full min-h-[320px] items-center justify-center rounded-md border border-line bg-white p-5 text-center shadow-sm">
        <div>
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-line bg-slate-50 text-slate-500">
            <Server size={20} />
          </div>
          <div className="font-semibold text-ink">Select a device</div>
          <div className="mt-1 text-sm text-slate-500">Click a row to view network status and asset details.</div>
        </div>
      </aside>
    );
  }

  const status = device.status || "UNKNOWN";
  const tone = STATUS_TONE[status] || STATUS_TONE.UNKNOWN;
  const latency = device.latency_ms;
  const loss = device.packet_loss_percent;
  const failures = device.consecutive_failure_count ?? 0;
  const plantName = device.plant_name || device.plant_code;
  const lineName = device.line_name || device.line_code;

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-line bg-white shadow-sm">
      <div className={`border-b ${tone.border} ${tone.header} p-5`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-slate-500">
              <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
              Device detail
            </div>
            <h2 className="truncate text-lg font-semibold text-ink">{device.device_name}</h2>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-slate-600">
              <RadioTower size={15} className="shrink-0" />
              <span className="truncate">{valueOrDash(device.ip_address)}</span>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-white/70 bg-white/70 px-3 py-2">
          <div className="min-w-0">
            <div className={`text-sm font-semibold ${tone.text}`}>{tone.label}</div>
            <div className="truncate text-xs text-slate-500">{valueOrDash(plantName)} / {valueOrDash(lineName)}</div>
          </div>
          <ShieldAlert className={tone.text} size={18} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 border-b border-line p-4 sm:grid-cols-3">
        <MetricTile
          icon={Gauge}
          label="Latency"
          value={latency != null ? `${latency} ms` : "-"}
          tone={metricTone("latency", latency)}
        />
        <MetricTile
          icon={Activity}
          label="Loss"
          value={loss != null ? `${loss}%` : "-"}
          tone={metricTone("loss", loss)}
        />
        <MetricTile
          icon={ShieldAlert}
          label="Failures"
          value={failures}
          tone={metricTone("failures", failures)}
        />
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
        <Section title="Connection">
          <div className="grid grid-cols-1 gap-2">
            <InfoItem icon={Server} label="Device" primary={device.device_type} secondary={device.criticality} />
            <InfoItem icon={Network} label="Switch" primary={device.switch_name} secondary={device.switch_port} />
            <InfoItem icon={Wifi} label="Access point" primary={device.connected_ap_name} secondary={device.connected_ap_ip} />
            <InfoItem icon={MapPin} label="Plant / Line" primary={plantName} secondary={lineName} />
          </div>
        </Section>

        <Section title="Location">
          <div className="rounded-md border border-line px-3">
            <DetailRow label="Path" value={locationText(device)} />
            <DetailRow label="Owner" value={device.owner_department} />
            <DetailRow label="Notes" value={device.notes} />
          </div>
        </Section>

        <Section title="Identity">
          <div className="rounded-md border border-line px-3">
            <DetailRow label="Hostname" value={device.hostname} />
            <DetailRow label="MAC" value={device.mac_address} />
            <DetailRow label="VLAN" value={device.vlan} />
          </div>
        </Section>

        <Section title="Monitoring">
          <div className="rounded-md border border-line px-3">
            <DetailRow label="Latency" value={latency != null ? `${latency} ms` : "-"} />
            <DetailRow label="Packet Loss" value={loss != null ? `${loss}%` : "-"} />
            <DetailRow label="Failures" value={failures} />
          </div>
        </Section>
      </div>
    </aside>
  );
}
