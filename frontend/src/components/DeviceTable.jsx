import { useState } from "react";
import StatusBadge from "./StatusBadge.jsx";
import { formatTijuanaDateTime } from "../time.js";

const PREVIEW_WIDTH = 820;
const PREVIEW_HEIGHT = 460;
const PREVIEW_OFFSET = 18;
const PREVIEW_PADDING = 16;

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

function boolText(value) {
  if (value === null || value === undefined) return "-";
  return value ? "Enabled" : "Disabled";
}

function DeviceTypeBadge({ type }) {
  return (
    <span className="inline-flex max-w-[120px] items-center rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase leading-5 text-slate-700">
      <span className="truncate">{valueOrDash(type)}</span>
    </span>
  );
}

function locationText(device) {
  return [device.building, device.floor, device.area, device.zone].filter(Boolean).join(" / ") || "-";
}

function previewPosition(event) {
  let left = event.clientX + PREVIEW_OFFSET;
  let top = event.clientY + PREVIEW_OFFSET;

  if (typeof window !== "undefined") {
    if (left + PREVIEW_WIDTH > window.innerWidth - PREVIEW_PADDING) {
      left = event.clientX - PREVIEW_WIDTH - PREVIEW_OFFSET;
    }
    if (top + PREVIEW_HEIGHT > window.innerHeight - PREVIEW_PADDING) {
      top = window.innerHeight - PREVIEW_HEIGHT - PREVIEW_PADDING;
    }
    left = Math.max(PREVIEW_PADDING, left);
    top = Math.max(PREVIEW_PADDING, top);
  }

  return { left, top };
}

function PreviewField({ label, value }) {
  return (
    <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-2 border-b border-slate-200 py-1 last:border-b-0">
      <div className="text-[10px] font-semibold uppercase tracking-normal text-slate-500">{label}</div>
      <div className="min-w-0 break-words text-left text-[11px] font-semibold leading-snug text-ink">{valueOrDash(value)}</div>
    </div>
  );
}

function PreviewSection({ title, children }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-normal text-slate-500">{title}</h3>
      <div className="rounded-md border border-line bg-slate-50 px-3">
        {children}
      </div>
    </section>
  );
}

function DeviceHoverPreview({ device, position }) {
  if (!device) return null;
  const plantName = device.plant_name || device.plant_code;
  const lineName = device.line_name || device.line_code;

  return (
    <div
      className="pointer-events-none fixed z-30 max-h-[calc(100vh-32px)] w-[820px] max-w-[calc(100vw-32px)] overflow-auto rounded-md border border-line bg-white p-4 text-left shadow-2xl"
      style={{ left: position.left, top: position.top }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">Device Preview</div>
          <div className="break-words text-base font-semibold leading-tight text-ink">{valueOrDash(device.device_name)}</div>
          <div className="break-words text-xs text-slate-500">{valueOrDash(device.ip_address)}</div>
        </div>
        <StatusBadge status={device.status} />
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PreviewSection title="Network">
            <PreviewField label="IP" value={device.ip_address} />
            <PreviewField label="MAC" value={device.mac_address} />
            <PreviewField label="Host" value={device.hostname} />
            <PreviewField label="VLAN" value={device.vlan} />
            <PreviewField label="AP" value={device.connected_ap_name} />
            <PreviewField label="AP IP" value={device.connected_ap_ip} />
            <PreviewField label="Switch" value={device.switch_name} />
            <PreviewField label="Port" value={device.switch_port} />
          </PreviewSection>

          <PreviewSection title="Monitoring">
            <PreviewField label="Status" value={device.status} />
            <PreviewField label="Level" value={device.criticality} />
            <PreviewField label="Method" value={device.latest_check_method} />
            <PreviewField label="Latency" value={device.latency_ms != null ? `${device.latency_ms} ms` : "-"} />
            <PreviewField label="ICMP Loss" value={device.packet_loss_percent != null ? `${device.packet_loss_percent}%` : "-"} />
            <PreviewField label="Checked" value={formatTijuanaDateTime(device.latest_checked_at)} />
            <PreviewField label="Fail" value={device.consecutive_failure_count} />
            <PreviewField label="Alerts" value={device.active_alert_count} />
            <PreviewField label="Monitor" value={boolText(device.monitoring_enabled)} />
            <PreviewField label="Deleted" value={device.is_deleted ? "Yes" : "No"} />
          </PreviewSection>

          <PreviewSection title="Location">
            <PreviewField label="Plant" value={plantName} />
            <PreviewField label="Line" value={lineName} />
            <PreviewField label="Path" value={locationText(device)} />
            <PreviewField label="Detail" value={device.detailed_location} />
          </PreviewSection>

          <PreviewSection title="Asset">
            <PreviewField label="Type" value={device.device_type} />
            <PreviewField label="Vendor" value={device.ap_vendor} />
            <PreviewField label="Ctrl" value={device.ap_controller_type} />
            <PreviewField label="Ctrl ID" value={device.ap_controller_id} />
            <PreviewField label="Owner" value={device.owner_department} />
            <PreviewField label="Up By" value={device.updated_by} />
            <PreviewField label="Update" value={formatTijuanaDateTime(device.updated_at)} />
            <PreviewField label="Cr By" value={device.created_by} />
            <PreviewField label="Create" value={formatTijuanaDateTime(device.created_at)} />
          </PreviewSection>
        </div>

        <div className="rounded-md border border-line bg-slate-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">Latest Reason</div>
          <div className="break-words text-xs font-medium leading-snug text-ink">{valueOrDash(device.latest_monitoring_reason || device.notes)}</div>
        </div>
      </div>
    </div>
  );
}

export default function DeviceTable({ devices = [], selectedId, onSelect, onIpDoubleClick, actions, className = "" }) {
  const [preview, setPreview] = useState({ device: null, position: { left: 0, top: 0 } });

  function showPreview(device, event) {
    setPreview({ device, position: previewPosition(event) });
  }

  function movePreview(event) {
    setPreview((current) => (
      current.device ? { ...current, position: previewPosition(event) } : current
    ));
  }

  function hidePreview() {
    setPreview({ device: null, position: { left: 0, top: 0 } });
  }

  function selectDevice(device) {
    hidePreview();
    onSelect?.(device);
  }

  return (
    <div className={`table-scroll overflow-auto border border-line bg-white ${className}`}>
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
          <tr>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Device</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">IP</th>
            <th className="px-3 py-2">Plant</th>
            <th className="px-3 py-2">Line</th>
            <th className="px-3 py-2">AP</th>
            <th className="px-3 py-2">Switch</th>
            <th className="px-3 py-2">ICMP Loss</th>
            {actions ? <th className="px-3 py-2 text-right">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr
              key={device.id}
              className={`cursor-pointer border-t border-line hover:bg-slate-50 ${selectedId === device.id ? "bg-cyan-50" : ""}`}
              onClick={() => selectDevice(device)}
              onMouseEnter={(event) => showPreview(device, event)}
              onMouseMove={movePreview}
              onMouseLeave={hidePreview}
            >
              <td className="px-3 py-2"><StatusBadge status={device.status} /></td>
              <td className="px-3 py-2 font-semibold text-ink">{device.device_name}</td>
              <td className="px-3 py-2"><DeviceTypeBadge type={device.device_type} /></td>
              <td
                className={`px-3 py-2 tabular-nums ${onIpDoubleClick ? "cursor-help hover:text-cyan-700 hover:underline" : ""}`}
                title={onIpDoubleClick ? "Double-click to open Source Map" : undefined}
                onDoubleClick={(event) => {
                  if (!onIpDoubleClick) return;
                  event.preventDefault();
                  event.stopPropagation();
                  hidePreview();
                  onIpDoubleClick(device);
                }}
              >
                {device.ip_address}
              </td>
              <td className="px-3 py-2">{device.plant_name || device.plant_code}</td>
              <td className="px-3 py-2">{device.line_name || device.line_code}</td>
              <td className="px-3 py-2">{device.connected_ap_name || "-"}</td>
              <td className="px-3 py-2">{[device.switch_name, device.switch_port].filter(Boolean).join(" / ") || "-"}</td>
              <td className="px-3 py-2 tabular-nums">{device.packet_loss_percent ?? "-"}</td>
              {actions ? (
                <td className="px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}>
                  {actions(device)}
                </td>
              ) : null}
            </tr>
          ))}
          {devices.length === 0 ? (
            <tr>
              <td className="px-3 py-8 text-center text-slate-500" colSpan={actions ? 10 : 9}>No devices</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <DeviceHoverPreview device={preview.device} position={preview.position} />
    </div>
  );
}
