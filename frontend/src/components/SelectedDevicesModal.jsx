import { useEffect } from "react";
import { X } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";
import { formatTijuanaDateTime } from "../time.js";

function valueOrDash(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

function dateOrDash(value) {
  return value ? formatTijuanaDateTime(value) : "-";
}

function pathText(device) {
  return [device.building, device.floor, device.area, device.zone].filter(Boolean).join(" / ") || "-";
}

function switchText(device) {
  return [device.switch_name, device.switch_port].filter(Boolean).join(" / ") || "-";
}

function Field({ label, value }) {
  return (
    <div className="grid min-w-0 grid-cols-[132px_minmax(0,1fr)] gap-3 border-b border-line py-2 text-sm last:border-b-0">
      <div className="text-xs font-semibold uppercase tracking-normal text-slate-500">{label}</div>
      <div className="min-w-0 break-words font-medium text-ink">{valueOrDash(value)}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="min-w-0 rounded-md border border-line bg-white">
      <div className="border-b border-line bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-slate-500">{title}</div>
      <div className="px-3">{children}</div>
    </section>
  );
}

function DeviceCard({ device }) {
  const plantName = device.plant_name || device.plant_code;
  const lineName = device.line_name || device.line_code;
  return (
    <article className="rounded-md border border-line bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-slate-50 px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-normal text-slate-500">Selected Device</div>
          <h3 className="break-words text-base font-semibold text-ink">{valueOrDash(device.device_name)}</h3>
          <div className="mt-1 text-sm text-slate-500">{valueOrDash(device.ip_address)} / {valueOrDash(plantName)} / {valueOrDash(lineName)}</div>
        </div>
        <StatusBadge status={device.status} />
      </div>

      <div className="grid gap-3 p-4 xl:grid-cols-2 2xl:grid-cols-4">
        <Section title="Device">
          <Field label="ID" value={device.id} />
          <Field label="Name" value={device.device_name} />
          <Field label="Type" value={device.device_type} />
          <Field label="Hostname" value={device.hostname} />
          <Field label="Criticality" value={device.criticality} />
          <Field label="Owner" value={device.owner_department} />
        </Section>

        <Section title="Network">
          <Field label="IP" value={device.ip_address} />
          <Field label="MAC" value={device.mac_address} />
          <Field label="VLAN" value={device.vlan} />
          <Field label="AP" value={device.connected_ap_name} />
          <Field label="AP IP" value={device.connected_ap_ip} />
          <Field label="Switch" value={switchText(device)} />
        </Section>

        <Section title="Location">
          <Field label="Plant" value={plantName} />
          <Field label="Line" value={lineName} />
          <Field label="Path" value={pathText(device)} />
          <Field label="Detail" value={device.detailed_location} />
        </Section>

        <Section title="Monitoring">
          <Field label="Status" value={device.status} />
          <Field label="Enabled" value={device.monitoring_enabled} />
          <Field label="Method" value={device.latest_check_method} />
          <Field label="Latency" value={device.latency_ms != null ? `${device.latency_ms} ms` : "-"} />
          <Field label="ICMP Loss" value={device.packet_loss_percent != null ? `${device.packet_loss_percent}%` : "-"} />
          <Field label="Failures" value={device.consecutive_failure_count} />
          <Field label="Checked" value={dateOrDash(device.latest_checked_at)} />
          <Field label="Alerts" value={device.active_alert_count} />
        </Section>

        <Section title="AP Controller">
          <Field label="Vendor" value={device.ap_vendor} />
          <Field label="Type" value={device.ap_controller_type} />
          <Field label="Controller ID" value={device.ap_controller_id} />
        </Section>

        <Section title="Record">
          <Field label="Created By" value={device.created_by} />
          <Field label="Created" value={dateOrDash(device.created_at)} />
          <Field label="Updated By" value={device.updated_by} />
          <Field label="Updated" value={dateOrDash(device.updated_at)} />
          <Field label="Deleted" value={device.is_deleted} />
        </Section>

        <Section title="Reason">
          <Field label="Latest" value={device.latest_monitoring_reason} />
          <Field label="Notes" value={device.notes} />
        </Section>
      </div>
    </article>
  );
}

export default function SelectedDevicesModal({ open, devices = [], onClose }) {
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onMouseDown={onClose}>
      <section
        className="flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-md border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-normal text-slate-500">Selected Devices</div>
            <h2 className="truncate text-lg font-semibold text-ink">{devices.length} device{devices.length === 1 ? "" : "s"} selected</h2>
          </div>
          <button className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-slate-50" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {devices.length ? (
            <div className="space-y-4">
              {devices.map((device) => <DeviceCard key={device.id} device={device} />)}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-line bg-white text-sm text-slate-500">
              No selected devices
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
