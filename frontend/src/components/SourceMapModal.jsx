import { useEffect, useMemo, useState } from "react";
import { Activity, Database, GitBranch, Network, Shield, X } from "lucide-react";
import { api } from "../api.js";
import { formatTijuanaDateTime } from "../time.js";

function valueOrDash(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function InfoRow({ label, value }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 border-b border-line py-2 text-sm last:border-b-0">
      <div className="font-semibold text-slate-500">{label}</div>
      <div className="min-w-0 break-words font-medium text-ink">{valueOrDash(value)}</div>
    </div>
  );
}

function SectionCard({ section }) {
  return (
    <div className="rounded-md border border-line bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <GitBranch size={16} className="text-cyan-700" />
        <h3 className="font-semibold text-ink">{section.name}</h3>
      </div>
      <p className="mb-3 text-sm leading-5 text-slate-600">{section.purpose}</p>
      <div className="space-y-1 text-xs">
        {section.table ? <InfoRow label="Table" value={section.table} /> : null}
        {section.tables ? <InfoRow label="Tables" value={section.tables} /> : null}
        {section.records !== undefined ? <InfoRow label="Records" value={section.records} /> : null}
        {section.worker ? <InfoRow label="Worker" value={section.worker} /> : null}
        {section.provider ? <InfoRow label="Provider" value={section.provider} /> : null}
        {section.source ? <InfoRow label="Source" value={section.source} /> : null}
        {section.writes ? <InfoRow label="Writes" value={section.writes} /> : null}
        {section.reads ? <InfoRow label="Reads" value={section.reads} /> : null}
        {section.endpoints ? <InfoRow label="Endpoints" value={section.endpoints} /> : null}
        {section.real_data_inputs ? <InfoRow label="Real Inputs" value={section.real_data_inputs} /> : null}
        {section.tokens_exposed_to_frontend !== undefined ? <InfoRow label="Frontend Tokens" value={section.tokens_exposed_to_frontend ? "Exposed" : "Not exposed"} /> : null}
      </div>
    </div>
  );
}

function JsonPreview({ value }) {
  if (!value) return null;
  return (
    <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-line bg-slate-950 p-3 text-xs text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function LatestData({ payload }) {
  const device = payload?.device || {};
  const target = device.target;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-line bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <Network size={16} className="text-cyan-700" />
          <h3 className="font-semibold">Selected Device/IP Source</h3>
        </div>
        {target ? (
          <div>
            <InfoRow label="Device" value={target.device_name} />
            <InfoRow label="IP" value={target.ip_address} />
            <InfoRow label="MAC" value={target.mac_address} />
            <InfoRow label="Type" value={target.device_type} />
            <InfoRow label="Plant / Line" value={`${valueOrDash(target.plant_name || target.plant_code)} / ${valueOrDash(target.line_name || target.line_code)}`} />
            <InfoRow label="AP" value={target.connected_ap_name || target.connected_ap_ip} />
            <InfoRow label="Switch" value={[target.switch_name, target.switch_port].filter(Boolean).join(" / ")} />
            <InfoRow label="Created From" value={`${valueOrDash(target.created_by)} / ${valueOrDash(target.created_from_ip)}`} />
            <InfoRow label="Updated From" value={`${valueOrDash(target.updated_by)} / ${valueOrDash(target.updated_from_ip)}`} />
          </div>
        ) : (
          <div className="text-sm text-slate-500">No specific device selected. Showing full system source map.</div>
        )}
      </div>

      {target ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-md border border-line bg-white p-4 shadow-sm">
            <h3 className="mb-2 font-semibold">Latest Ping Monitoring</h3>
            <InfoRow label="Table" value="device_metrics" />
            <InfoRow label="Status" value={device.latest_monitoring?.status} />
            <InfoRow label="Method" value={device.latest_monitoring?.check_method} />
            <InfoRow label="Latency" value={device.latest_monitoring?.latency_ms != null ? `${device.latest_monitoring.latency_ms} ms` : "-"} />
            <InfoRow label="ICMP Loss" value={device.latest_monitoring?.packet_loss_percent != null ? `${device.latest_monitoring.packet_loss_percent}%` : "-"} />
            <InfoRow label="Reason" value={device.latest_monitoring?.error_message} />
            <InfoRow label="Checked" value={formatTijuanaDateTime(device.latest_monitoring?.checked_at)} />
          </div>

          <div className="rounded-md border border-line bg-white p-4 shadow-sm">
            <h3 className="mb-2 font-semibold">Latest Traffic</h3>
            <InfoRow label="Table" value="network_traffic_metrics" />
            <InfoRow label="Source" value={device.latest_traffic?.source} />
            <InfoRow label="Interface" value={device.latest_traffic?.interface_name} />
            <InfoRow label="RX bps" value={device.latest_traffic?.rx_bps} />
            <InfoRow label="TX bps" value={device.latest_traffic?.tx_bps} />
            <InfoRow label="Collected" value={formatTijuanaDateTime(device.latest_traffic?.collected_at)} />
            <JsonPreview value={device.latest_traffic?.raw_data} />
          </div>

          <div className="rounded-md border border-line bg-white p-4 shadow-sm">
            <h3 className="mb-2 font-semibold">AP Current Client Match</h3>
            <InfoRow label="Table" value="ap_connected_clients_current" />
            <InfoRow label="Rows" value={device.ap_current?.length || 0} />
            <div className="mt-2 max-h-48 overflow-auto">
              {(device.ap_current || []).map((row) => (
                <div key={row.id} className="mb-2 rounded border border-line bg-slate-50 p-2 text-xs">
                  <div className="font-semibold">{valueOrDash(row.client_ip_address)} / {valueOrDash(row.client_mac_address)}</div>
                  <div className="text-slate-600">{valueOrDash(row.ap_name)} ({valueOrDash(row.ap_ip_address)}) / {valueOrDash(row.status)} / {formatTijuanaDateTime(row.last_seen)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-line bg-white p-4 shadow-sm">
            <h3 className="mb-2 font-semibold">Audit / Import Source</h3>
            <InfoRow label="Audit Rows" value={device.audit_logs?.length || 0} />
            <InfoRow label="Import Rows" value={device.import_rows?.length || 0} />
            <div className="mt-2 max-h-48 overflow-auto">
              {(device.audit_logs || []).slice(0, 6).map((row) => (
                <div key={row.id} className="mb-2 rounded border border-line bg-slate-50 p-2 text-xs">
                  <div className="font-semibold">{row.action_type} / {row.entity_type} / {row.result}</div>
                  <div className="text-slate-600">{valueOrDash(row.actor_username)} from {valueOrDash(row.actor_ip_address)} / {formatTijuanaDateTime(row.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function SourceMapModal({ open, target, onClose }) {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (target?.device_id) params.set("device_id", target.device_id);
    if (target?.ip_address && !target?.device_id) params.set("ip_address", target.ip_address);
    return params.toString();
  }, [target]);

  useEffect(() => {
    if (!open) return;
    async function load() {
      setLoading(true);
      try {
        setPayload(await api(`/source-map${query ? `?${query}` : ""}`));
        setError("");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [open, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4">
      <div className="flex h-[min(900px,92vh)] w-[min(1280px,96vw)] min-h-0 flex-col overflow-hidden rounded-md border border-line bg-slate-100 shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <Database size={16} /> ADMIN Source Map
            </div>
            <h2 className="mt-1 text-xl font-semibold text-ink">Where This Information Comes From</h2>
            <div className="mt-1 text-sm text-slate-500">Double-click ADMIN/IP or a device IP to open this map. API tokens are never exposed here.</div>
          </div>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {loading ? <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-600">Loading source map...</div> : null}
          {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
          {payload ? (
            <div className="space-y-5">
              <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-md border border-line bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2 font-semibold"><Shield size={16} /> Request</div>
                  <InfoRow label="User" value={payload.requested_by?.username} />
                  <InfoRow label="Role" value={payload.requested_by?.role} />
                  <InfoRow label="Source IP" value={payload.requested_by?.ip_address} />
                  <InfoRow label="Generated" value={formatTijuanaDateTime(payload.generated_at)} />
                </div>
                <div className="rounded-md border border-line bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2 font-semibold"><Database size={16} /> Database</div>
                  <InfoRow label="Engine" value={payload.database?.engine} />
                  <InfoRow label="Target" value={payload.database?.target} />
                </div>
                <div className="rounded-md border border-line bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2 font-semibold"><Activity size={16} /> Runtime</div>
                  <InfoRow label="Ping Worker" value={payload.runtime?.collector_enabled ? "ON" : "OFF"} />
                  <InfoRow label="AP Provider" value={payload.runtime?.ap_client_provider} />
                  <InfoRow label="Traffic Provider" value={payload.runtime?.traffic_provider} />
                  <InfoRow label="Traffic Worker" value={payload.runtime?.traffic_collection_enabled ? "ON" : "OFF"} />
                </div>
              </section>

              <LatestData payload={payload} />

              <section>
                <h3 className="mb-3 text-lg font-semibold text-ink">System Data Flow</h3>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {(payload.sections || []).map((section) => (
                    <SectionCard key={section.name} section={section} />
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
