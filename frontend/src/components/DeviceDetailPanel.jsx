import { Server, Wifi, Network, MapPin } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";

function DetailRow({ label, value }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-line py-2 text-sm last:border-b-0">
      <div className="text-slate-500">{label}</div>
      <div className="font-medium text-ink">{value || "-"}</div>
    </div>
  );
}

export default function DeviceDetailPanel({ device }) {
  if (!device) {
    return (
      <aside className="h-full border-l border-line bg-white p-5">
        <div className="text-sm text-slate-500">Select a device</div>
      </aside>
    );
  }
  return (
    <aside className="h-full overflow-auto border-l border-line bg-white p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-ink">{device.device_name}</h2>
          <p className="text-sm text-slate-500">{device.ip_address}</p>
        </div>
        <StatusBadge status={device.status} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md border border-line p-3">
          <Server size={16} className="mb-2 text-slate-500" />
          <div className="font-semibold">{device.device_type}</div>
          <div className="text-slate-500">{device.criticality}</div>
        </div>
        <div className="rounded-md border border-line p-3">
          <Network size={16} className="mb-2 text-slate-500" />
          <div className="font-semibold">{device.switch_name || "-"}</div>
          <div className="text-slate-500">{device.switch_port || "-"}</div>
        </div>
        <div className="rounded-md border border-line p-3">
          <Wifi size={16} className="mb-2 text-slate-500" />
          <div className="font-semibold">{device.connected_ap_name || "-"}</div>
          <div className="text-slate-500">{device.connected_ap_ip || "-"}</div>
        </div>
        <div className="rounded-md border border-line p-3">
          <MapPin size={16} className="mb-2 text-slate-500" />
          <div className="font-semibold">{device.plant_name || device.plant_code}</div>
          <div className="text-slate-500">{device.line_name || device.line_code}</div>
        </div>
      </div>

      <DetailRow label="Location" value={[device.building, device.floor, device.area, device.zone].filter(Boolean).join(" / ")} />
      <DetailRow label="Hostname" value={device.hostname} />
      <DetailRow label="MAC" value={device.mac_address} />
      <DetailRow label="VLAN" value={device.vlan} />
      <DetailRow label="Latency" value={device.latency_ms != null ? `${device.latency_ms} ms` : "-"} />
      <DetailRow label="Packet Loss" value={device.packet_loss_percent != null ? `${device.packet_loss_percent}%` : "-"} />
      <DetailRow label="Failures" value={device.consecutive_failure_count} />
      <DetailRow label="Owner" value={device.owner_department} />
      <DetailRow label="Notes" value={device.notes} />
    </aside>
  );
}
