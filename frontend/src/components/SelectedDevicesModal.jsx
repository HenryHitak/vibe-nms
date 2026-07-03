import { useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { downloadPostFile } from "../api.js";
import { formatTijuanaDateTime } from "../time.js";
import StatusBadge from "./StatusBadge.jsx";

function valueOrDash(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

function dateOrDash(value) {
  return value ? formatTijuanaDateTime(value) : "-";
}

function pathText(device) {
  return [device.building, device.floor, device.area, device.zone, device.detailed_location].filter(Boolean).join(" / ") || "-";
}

function switchText(device) {
  return [device.switch_name, device.switch_port].filter(Boolean).join(" / ") || "-";
}

function Cell({ children, className = "" }) {
  return (
    <td className={`border-t border-line px-3 py-2 align-top text-xs leading-snug text-ink ${className}`}>
      <div className="min-w-0 break-words">{children}</div>
    </td>
  );
}

const TABLE_COLUMNS = [
  "Status",
  "Device",
  "Type",
  "IP",
  "MAC",
  "Hostname",
  "Plant",
  "Line",
  "Location",
  "AP",
  "AP IP",
  "Switch",
  "VLAN",
  "Owner",
  "Criticality",
  "Enabled",
  "Method",
  "Latency",
  "Loss",
  "Failures",
  "Last Check",
  "Alerts",
  "Reason",
  "Notes"
];

export default function SelectedDevicesModal({ open, devices = [], onClose }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setError("");
  }, [open]);

  const deviceIds = useMemo(
    () => devices.map((device) => device.id).filter((id) => id !== null && id !== undefined),
    [devices]
  );

  async function exportSelectedDevices() {
    if (!deviceIds.length || downloading) return;
    setDownloading(true);
    setError("");
    try {
      await downloadPostFile("/export/selected-devices.xlsx", { device_ids: deviceIds }, "selected-devices.xlsx");
    } catch (err) {
      setError(err.message || "Excel download failed");
    } finally {
      setDownloading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onMouseDown={onClose}>
      <section
        className="flex h-[78vh] w-full max-w-[96vw] flex-col overflow-hidden rounded-md border border-line bg-panel shadow-2xl xl:max-w-7xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-normal text-slate-500">Selected Devices</div>
            <h2 className="truncate text-lg font-semibold text-ink">{devices.length} device{devices.length === 1 ? "" : "s"} selected</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!deviceIds.length || downloading}
              onClick={exportSelectedDevices}
            >
              <Download size={16} />
              {downloading ? "Downloading" : "Excel"}
            </button>
            <button className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-slate-50" title="Close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        {error ? <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm font-semibold text-red-800">{error}</div> : null}

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {devices.length ? (
            <div className="table-scroll overflow-auto rounded-md border border-line bg-white">
              <table className="min-w-[2600px] border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-600">
                  <tr>
                    {TABLE_COLUMNS.map((column) => (
                      <th key={column} className="px-3 py-2 font-semibold">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => {
                    const plantName = device.plant_name || device.plant_code;
                    const lineName = device.line_name || device.line_code;
                    return (
                      <tr key={device.id} className="hover:bg-slate-50">
                        <Cell><StatusBadge status={device.status} /></Cell>
                        <Cell className="font-semibold">{valueOrDash(device.device_name)}</Cell>
                        <Cell>{valueOrDash(device.device_type)}</Cell>
                        <Cell className="tabular-nums">{valueOrDash(device.ip_address)}</Cell>
                        <Cell>{valueOrDash(device.mac_address)}</Cell>
                        <Cell>{valueOrDash(device.hostname)}</Cell>
                        <Cell>{valueOrDash(plantName)}</Cell>
                        <Cell>{valueOrDash(lineName)}</Cell>
                        <Cell>{pathText(device)}</Cell>
                        <Cell>{valueOrDash(device.connected_ap_name)}</Cell>
                        <Cell className="tabular-nums">{valueOrDash(device.connected_ap_ip)}</Cell>
                        <Cell>{switchText(device)}</Cell>
                        <Cell>{valueOrDash(device.vlan)}</Cell>
                        <Cell>{valueOrDash(device.owner_department)}</Cell>
                        <Cell>{valueOrDash(device.criticality)}</Cell>
                        <Cell>{valueOrDash(device.monitoring_enabled)}</Cell>
                        <Cell>{valueOrDash(device.latest_check_method)}</Cell>
                        <Cell className="tabular-nums">{device.latency_ms != null ? `${device.latency_ms} ms` : "-"}</Cell>
                        <Cell className="tabular-nums">{device.packet_loss_percent != null ? `${device.packet_loss_percent}%` : "-"}</Cell>
                        <Cell className="tabular-nums">{valueOrDash(device.consecutive_failure_count)}</Cell>
                        <Cell>{dateOrDash(device.latest_checked_at)}</Cell>
                        <Cell className="tabular-nums">{valueOrDash(device.active_alert_count)}</Cell>
                        <Cell>{valueOrDash(device.latest_monitoring_reason)}</Cell>
                        <Cell>{valueOrDash(device.notes)}</Cell>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
