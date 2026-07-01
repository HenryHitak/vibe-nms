import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MapPin, RefreshCw, Wifi } from "lucide-react";
import { api } from "../api.js";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatTijuanaDateTime } from "../time.js";

const CLIENT_STATUS_CLASS = {
  HEALTHY: "border-green-300 bg-green-100 text-green-800",
  UNKNOWN_DEVICE: "border-amber-300 bg-amber-100 text-amber-900",
  NO_IP: "border-amber-300 bg-amber-100 text-amber-900",
  WEAK_SIGNAL: "border-amber-300 bg-amber-100 text-amber-900",
  WRONG_AP: "border-amber-300 bg-amber-100 text-amber-900",
  IP_CONFLICT: "border-red-300 bg-red-100 text-red-800"
};

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

function locationText(ap) {
  return [ap?.building, ap?.floor, ap?.area, ap?.zone].filter(Boolean).join(" / ") || "-";
}

function ClientStatusBadge({ status }) {
  const value = status || "UNKNOWN";
  const className = CLIENT_STATUS_CLASS[value] || "border-slate-300 bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex h-6 min-w-24 items-center justify-center rounded border px-2 text-xs font-semibold ${className}`}>
      {value}
    </span>
  );
}

function SummaryStat({ label, value, tone }) {
  const toneClass = {
    green: "text-green-nms",
    orange: "text-orange-nms",
    red: "text-red-nms",
    blue: "text-cyan-700"
  }[tone] || "text-ink";
  return (
    <div className="rounded-md border border-line bg-white p-3 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-normal text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value ?? 0}</div>
    </div>
  );
}

export default function APClientDiscoveryPage({ role }) {
  const [aps, setAps] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [clients, setClients] = useState([]);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [error, setError] = useState("");

  async function loadAps() {
    try {
      const [apPayload, alertPayload] = await Promise.all([
        api("/dashboard/by-ap"),
        api("/alerts/ap-client-issues?status=ACTIVE")
      ]);
      setAps(apPayload);
      setAlerts(alertPayload);
      setError("");
      if (apPayload.length) {
        setSelectedId((current) => current || apPayload[0].ap.id);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadSelected(apId = selectedId) {
    if (!apId) return;
    setLoading(true);
    try {
      const [summaryPayload, clientsPayload, historyPayload] = await Promise.all([
        api(`/access-points/${apId}/summary`),
        api(`/access-points/${apId}/clients`),
        api(`/access-points/${apId}/clients/history?limit=100`)
      ]);
      setSummary(summaryPayload);
      setClients(clientsPayload);
      setHistory(historyPayload);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAps();
    const timer = setInterval(loadAps, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadSelected(selectedId);
  }, [selectedId]);

  async function runDiscovery() {
    setRunning(true);
    try {
      const result = await api("/discovery/ap-clients/run", { method: "POST" });
      setRunResult(result);
      await loadAps();
      await loadSelected(selectedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const selectedAp = summary?.ap;
  const connectedIps = useMemo(
    () => clients.map((client) => client.client_ip_address).filter(Boolean),
    [clients]
  );
  const redCount = clients.filter((client) => client.status === "IP_CONFLICT").length;
  const orangeCount = clients.filter((client) => ["UNKNOWN_DEVICE", "NO_IP", "WEAK_SIGNAL", "WRONG_AP"].includes(client.status)).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">AP Client Monitoring</h1>
          <div className="text-sm text-slate-500">Monitor wireless clients collected by the backend from registered APs or controllers. Client CRUD is managed in Device Master.</div>
        </div>
        <div className="flex gap-2">
          <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700" onClick={() => { loadAps(); loadSelected(selectedId); }}>
            <RefreshCw size={16} /> Refresh
          </button>
          {role === "ADMIN" ? (
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50" onClick={runDiscovery} disabled={running}>
              <Wifi size={16} /> {running ? "Discovering" : "Discover AP Clients Now"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mb-4 rounded-md border border-line bg-white p-4 text-sm text-slate-700 shadow-sm">
        <div className="font-semibold text-ink">How this works</div>
        <div className="mt-1">Register AP devices and wireless devices in `Device Master`. Set AP records to `Device Type = AP`, and for wireless devices enter expected AP fields only when confirmed. This page only monitors discovered AP clients and shows match/issue status.</div>
      </div>

      {runResult ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["APs Queried", runResult.total_aps],
            ["Clients Found", runResult.total_clients],
            ["Known", runResult.known],
            ["Unknown", runResult.unknown],
            ["Issues", runResult.issues]
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-line bg-white p-3 shadow-sm">
              <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{value ?? 0}</div>
            </div>
          ))}
          {runResult.total_aps === 0 ? (
            <div className="col-span-full rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              No AP was queried. Add AP devices in `Device Master`, set `Device Type` to `AP`, and keep monitoring enabled.
            </div>
          ) : null}
          {runResult.total_aps > 0 && runResult.total_clients === 0 ? (
            <div className="col-span-full rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Discovery ran, but no clients were returned. Configure each AP with a real controller type such as cisco-wlc, meraki-api, aruba-central-api, unifi-api, generic-snmp, or generic-api.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[330px_1fr]">
        <aside className="min-h-0 overflow-auto rounded-md border border-line bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-semibold">Access Points</div>
            <span className="text-sm text-slate-500">{aps.length}</span>
          </div>
          <div className="space-y-2">
            {aps.map((item) => {
              const ap = item.ap;
              return (
                <button
                  key={ap.id}
                  className={`w-full rounded-md border p-3 text-left transition-colors ${selectedId === ap.id ? "border-cyan-400 bg-cyan-50" : "border-line bg-slate-50 hover:bg-white"}`}
                  onClick={() => setSelectedId(ap.id)}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink">{ap.device_name}</div>
                      <div className="truncate text-xs text-slate-500">{ap.ip_address}</div>
                    </div>
                    <StatusBadge status={ap.status} />
                  </div>
                  <div className="flex flex-wrap gap-1 text-xs">
                    {item.connected_ip_addresses.slice(0, 5).map((ip) => (
                      <span key={ip} className="rounded border border-line bg-white px-1.5 py-0.5 tabular-nums text-slate-700">{ip}</span>
                    ))}
                    {item.connected_ip_addresses.length > 5 ? <span className="text-slate-500">+{item.connected_ip_addresses.length - 5}</span> : null}
                  </div>
                </button>
              );
            })}
            {!aps.length ? (
              <div className="rounded-md border border-dashed border-line bg-slate-50 p-4 text-sm text-slate-600">
                <div className="font-semibold text-ink">No AP devices registered</div>
                <div className="mt-1">Go to `Device Master`, add an Access Point, and set `Device Type` to `AP`.</div>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto">
          {selectedAp ? (
            <div className="space-y-4">
              <section className="rounded-md border border-line bg-white p-4 shadow-sm">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2 text-sm text-slate-500">
                      <Wifi size={16} /> Access Point
                    </div>
                    <h2 className="truncate text-xl font-semibold text-ink">{selectedAp.device_name}</h2>
                    <div className="mt-1 text-sm text-slate-500">{selectedAp.ip_address}</div>
                  </div>
                  <StatusBadge status={selectedAp.status} />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <SummaryStat label="Connected" value={summary.connected_client_count} tone="blue" />
                  <SummaryStat label="Known" value={summary.known_device_count} tone="green" />
                  <SummaryStat label="Unknown" value={summary.unknown_device_count} tone="orange" />
                  <SummaryStat label="Issues" value={redCount + orangeCount} tone={redCount ? "red" : orangeCount ? "orange" : "green"} />
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                  <div className="rounded-md border border-line bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase text-slate-500">Plant / Line</div>
                    <div className="mt-1 font-semibold text-ink">{valueOrDash(selectedAp.plant_name || selectedAp.plant_code)} / {valueOrDash(selectedAp.line_name || selectedAp.line_code)}</div>
                  </div>
                  <div className="rounded-md border border-line bg-slate-50 p-3">
                    <div className="flex items-center gap-1 text-xs font-semibold uppercase text-slate-500"><MapPin size={13} /> Location</div>
                    <div className="mt-1 font-semibold text-ink">{locationText(selectedAp)}</div>
                  </div>
                  <div className="rounded-md border border-line bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase text-slate-500">Provider</div>
                    <div className="mt-1 font-semibold text-ink">{valueOrDash(selectedAp.ap_controller_type || selectedAp.ap_vendor || "default")}</div>
                  </div>
                </div>
              </section>

              <section className="rounded-md border border-line bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold">Connected IP List</h2>
                  <span className="text-sm text-slate-500">{connectedIps.length} IPs</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {connectedIps.map((ip) => (
                    <span key={ip} className="rounded-md border border-line bg-slate-50 px-2 py-1 text-sm font-semibold tabular-nums text-ink">{ip}</span>
                  ))}
                  {!connectedIps.length ? <span className="text-sm text-slate-500">No connected client IPs discovered yet</span> : null}
                </div>
              </section>

              <section className="rounded-md border border-line bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <div>
                    <h2 className="font-semibold">Connected Clients</h2>
                    <div className="text-sm text-slate-500">Read-only monitoring data. Add or edit devices in Device Master.</div>
                  </div>
                  {loading ? <span className="text-sm text-slate-500">Loading</span> : null}
                </div>
                <div className="table-scroll overflow-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">IP</th>
                        <th className="px-3 py-2">MAC</th>
                        <th className="px-3 py-2">Hostname</th>
                        <th className="px-3 py-2">SSID</th>
                        <th className="px-3 py-2">VLAN</th>
                        <th className="px-3 py-2">RSSI</th>
                        <th className="px-3 py-2">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((client) => (
                        <tr key={client.id} className="border-t border-line">
                          <td className="px-3 py-2"><ClientStatusBadge status={client.status} /></td>
                          <td className="px-3 py-2 font-semibold tabular-nums text-ink">{valueOrDash(client.client_ip_address)}</td>
                          <td className="px-3 py-2 tabular-nums">{valueOrDash(client.client_mac_address)}</td>
                          <td className="px-3 py-2">{valueOrDash(client.client_hostname || client.matched_device_name)}</td>
                          <td className="px-3 py-2">{valueOrDash(client.ssid)}</td>
                          <td className="px-3 py-2">{valueOrDash(client.vlan)}</td>
                          <td className="px-3 py-2">{valueOrDash(client.rssi)}</td>
                          <td className="px-3 py-2">{formatTijuanaDateTime(client.last_seen)}</td>
                        </tr>
                      ))}
                      {!clients.length ? (
                        <tr><td colSpan="8" className="px-3 py-8 text-center text-slate-500">No connected clients discovered</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-md border border-line bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <AlertTriangle size={17} className="text-orange-nms" />
                    <h2 className="font-semibold">AP Client Issues</h2>
                  </div>
                  <div className="space-y-2">
                    {alerts.slice(0, 8).map((alert) => (
                      <div key={alert.id} className="rounded-md border border-line bg-slate-50 p-3 text-sm">
                        <div className="font-semibold text-ink">{alert.alert_type}</div>
                        <div className="mt-1 text-slate-600">{alert.message}</div>
                      </div>
                    ))}
                    {!alerts.length ? <div className="text-sm text-slate-500">No active AP client issues</div> : null}
                  </div>
                </div>

                <div className="rounded-md border border-line bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <CheckCircle2 size={17} className="text-green-nms" />
                    <h2 className="font-semibold">Recent Observations</h2>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-auto">
                    {history.slice(0, 20).map((row) => (
                      <div key={row.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-md border border-line bg-slate-50 p-2 text-xs">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-ink">{valueOrDash(row.client_hostname || row.client_mac_address)}</div>
                          <div className="truncate text-slate-500">{valueOrDash(row.client_ip_address)} / {valueOrDash(row.ssid)}</div>
                        </div>
                        <div className="text-right tabular-nums text-slate-500">{formatTijuanaDateTime(row.last_seen)}</div>
                      </div>
                    ))}
                    {!history.length ? <div className="text-sm text-slate-500">No history yet</div> : null}
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-line bg-white p-6 text-center text-sm text-slate-500">
              Select an access point, or register an AP in Device Master first.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
