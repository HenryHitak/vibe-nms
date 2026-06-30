import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Edit3, MapPin, Plus, RefreshCw, Save, Trash2, Wifi, X } from "lucide-react";
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

const EMPTY_REGISTERED_CLIENT = {
  device_name: "",
  device_type: "OTHER",
  ip_address: "",
  mac_address: "",
  hostname: "",
  vlan: "",
  owner_department: "",
  criticality: "MEDIUM",
  monitoring_enabled: true,
  notes: ""
};

export default function APClientDiscoveryPage({ role }) {
  const [aps, setAps] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [clients, setClients] = useState([]);
  const [registeredClients, setRegisteredClients] = useState([]);
  const [registeredForm, setRegisteredForm] = useState(EMPTY_REGISTERED_CLIENT);
  const [editingRegistered, setEditingRegistered] = useState(null);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
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
      const [summaryPayload, clientsPayload, registeredPayload, historyPayload] = await Promise.all([
        api(`/access-points/${apId}/summary`),
        api(`/access-points/${apId}/clients`),
        api(`/access-points/${apId}/registered-clients`),
        api(`/access-points/${apId}/clients/history?limit=100`)
      ]);
      setSummary(summaryPayload);
      setClients(clientsPayload);
      setRegisteredClients(registeredPayload);
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
    resetRegisteredForm();
  }, [selectedId]);

  async function runDiscovery() {
    setRunning(true);
    try {
      await api("/discovery/ap-clients/run", { method: "POST" });
      await loadAps();
      await loadSelected(selectedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  function resetRegisteredForm() {
    setEditingRegistered(null);
    setRegisteredForm(EMPTY_REGISTERED_CLIENT);
  }

  function changeRegisteredForm(event) {
    const { name, value, type, checked } = event.target;
    setRegisteredForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  function registerObservedClient(client) {
    setEditingRegistered(null);
    setRegisteredForm({
      ...EMPTY_REGISTERED_CLIENT,
      device_name: client.client_hostname || client.client_ip_address || client.client_mac_address || "",
      ip_address: client.client_ip_address || "",
      mac_address: client.client_mac_address || "",
      hostname: client.client_hostname || "",
      vlan: client.vlan ?? "",
      notes: `Registered from AP discovery on ${selectedAp?.device_name || "selected AP"}`
    });
  }

  function editRegisteredClient(client) {
    setEditingRegistered(client);
    setRegisteredForm({
      device_name: client.device_name || "",
      device_type: client.device_type || "OTHER",
      ip_address: client.ip_address || "",
      mac_address: client.mac_address || "",
      hostname: client.hostname || "",
      vlan: client.vlan ?? "",
      owner_department: client.owner_department || "",
      criticality: client.criticality || "MEDIUM",
      monitoring_enabled: Boolean(client.monitoring_enabled),
      notes: client.notes || ""
    });
  }

  function registeredPayload() {
    return {
      ...registeredForm,
      device_name: registeredForm.device_name.trim(),
      ip_address: registeredForm.ip_address.trim(),
      mac_address: registeredForm.mac_address.trim() || null,
      hostname: registeredForm.hostname.trim() || null,
      vlan: registeredForm.vlan === "" ? null : Number(registeredForm.vlan),
      owner_department: registeredForm.owner_department.trim() || null,
      notes: registeredForm.notes.trim() || null
    };
  }

  async function saveRegisteredClient() {
    if (!selectedId) return;
    const payload = registeredPayload();
    if (!payload.device_name || !payload.ip_address) {
      setError("Client name and IP are required.");
      return;
    }
    try {
      if (editingRegistered?.id) {
        await api(`/access-points/${selectedId}/registered-clients/${editingRegistered.id}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
      } else {
        await api(`/access-points/${selectedId}/registered-clients`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }
      resetRegisteredForm();
      await loadSelected(selectedId);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteRegisteredClient(client) {
    if (!selectedId || !window.confirm(`Delete registered AP client "${client.device_name}"?`)) return;
    try {
      await api(`/access-points/${selectedId}/registered-clients/${client.id}`, { method: "DELETE" });
      if (editingRegistered?.id === client.id) {
        resetRegisteredForm();
      }
      await loadSelected(selectedId);
      setError("");
    } catch (err) {
      setError(err.message);
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
          <h1 className="text-lg font-semibold text-ink">AP Client Discovery</h1>
          <div className="text-sm text-slate-500">Wireless clients discovered by backend collectors inside the corporate network.</div>
        </div>
        <div className="flex gap-2">
          <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700" onClick={() => { loadAps(); loadSelected(selectedId); }}>
            <RefreshCw size={16} /> Refresh
          </button>
          {role === "ADMIN" ? (
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white" onClick={runDiscovery} disabled={running}>
              <Wifi size={16} /> {running ? "Running" : "Run Discovery"}
            </button>
          ) : null}
        </div>
      </div>

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
            {!aps.length ? <div className="py-8 text-center text-sm text-slate-500">No AP devices registered</div> : null}
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

              <section className="rounded-md border border-line bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Registered AP Clients</h2>
                    <div className="text-sm text-slate-500">Known wireless devices expected on this AP.</div>
                  </div>
                  <span className="text-sm text-slate-500">{registeredClients.length} registered</span>
                </div>

                {role === "ADMIN" ? (
                  <div className="mb-4 rounded-md border border-line bg-slate-50 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="font-semibold">{editingRegistered ? "Edit Client" : "Add Client"}</div>
                      {editingRegistered ? (
                        <button className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-semibold" onClick={resetRegisteredForm}>
                          <X size={14} /> Cancel
                        </button>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">Client Name</span>
                        <input className="h-10 w-full rounded-md border border-line bg-white px-3" name="device_name" value={registeredForm.device_name} onChange={changeRegisteredForm} />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">IP Address</span>
                        <input className="h-10 w-full rounded-md border border-line bg-white px-3" name="ip_address" value={registeredForm.ip_address} onChange={changeRegisteredForm} />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">MAC</span>
                        <input className="h-10 w-full rounded-md border border-line bg-white px-3" name="mac_address" value={registeredForm.mac_address} onChange={changeRegisteredForm} />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">Hostname</span>
                        <input className="h-10 w-full rounded-md border border-line bg-white px-3" name="hostname" value={registeredForm.hostname} onChange={changeRegisteredForm} />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">Type</span>
                        <select className="h-10 w-full rounded-md border border-line bg-white px-3" name="device_type" value={registeredForm.device_type} onChange={changeRegisteredForm}>
                          {["WORKSTATION", "IOT", "HMI", "PLC", "SCANNER", "CAMERA", "PRINTER", "SENSOR", "OTHER"].map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">VLAN</span>
                        <input className="h-10 w-full rounded-md border border-line bg-white px-3" name="vlan" type="number" value={registeredForm.vlan} onChange={changeRegisteredForm} />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">Criticality</span>
                        <select className="h-10 w-full rounded-md border border-line bg-white px-3" name="criticality" value={registeredForm.criticality} onChange={changeRegisteredForm}>
                          {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">Owner</span>
                        <input className="h-10 w-full rounded-md border border-line bg-white px-3" name="owner_department" value={registeredForm.owner_department} onChange={changeRegisteredForm} />
                      </label>
                      <label className="text-sm md:col-span-2 xl:col-span-3">
                        <span className="mb-1 block text-slate-600">Notes</span>
                        <input className="h-10 w-full rounded-md border border-line bg-white px-3" name="notes" value={registeredForm.notes} onChange={changeRegisteredForm} />
                      </label>
                      <label className="flex items-end gap-2 pb-2 text-sm">
                        <input type="checkbox" name="monitoring_enabled" checked={Boolean(registeredForm.monitoring_enabled)} onChange={changeRegisteredForm} />
                        Monitoring enabled
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white" onClick={saveRegisteredClient}>
                        {editingRegistered ? <Save size={16} /> : <Plus size={16} />} {editingRegistered ? "Save Client" : "Add Client"}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="table-scroll overflow-auto rounded-md border border-line">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Client</th>
                        <th className="px-3 py-2">IP</th>
                        <th className="px-3 py-2">MAC</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Criticality</th>
                        <th className="px-3 py-2">Monitor</th>
                        {role === "ADMIN" ? <th className="px-3 py-2 text-right">Actions</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {registeredClients.map((client) => (
                        <tr key={client.id} className="border-t border-line">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-ink">{client.device_name}</div>
                            <div className="text-xs text-slate-500">{valueOrDash(client.hostname)}</div>
                          </td>
                          <td className="px-3 py-2 tabular-nums">{client.ip_address}</td>
                          <td className="px-3 py-2 tabular-nums">{valueOrDash(client.mac_address)}</td>
                          <td className="px-3 py-2">{client.device_type}</td>
                          <td className="px-3 py-2">{client.criticality}</td>
                          <td className="px-3 py-2">{client.monitoring_enabled ? "ON" : "OFF"}</td>
                          {role === "ADMIN" ? (
                            <td className="px-3 py-2 text-right">
                              <button className="mr-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-slate-700" title="Edit" onClick={() => editRegisteredClient(client)}>
                                <Edit3 size={14} />
                              </button>
                              <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-red-700" title="Delete" onClick={() => deleteRegisteredClient(client)}>
                                <Trash2 size={14} />
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                      {!registeredClients.length ? (
                        <tr><td colSpan={role === "ADMIN" ? 7 : 6} className="px-3 py-8 text-center text-slate-500">No registered AP clients</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-md border border-line bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <h2 className="font-semibold">Connected Clients</h2>
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
                        {role === "ADMIN" ? <th className="px-3 py-2 text-right">Actions</th> : null}
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
                          {role === "ADMIN" ? (
                            <td className="px-3 py-2 text-right">
                              {!client.is_known_device ? (
                                <button className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-semibold text-cyan-800" onClick={() => registerObservedClient(client)}>
                                  <Plus size={13} /> Register
                                </button>
                              ) : (
                                <span className="text-xs font-semibold text-green-700">Known</span>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                      {!clients.length ? (
                        <tr><td colSpan={role === "ADMIN" ? 9 : 8} className="px-3 py-8 text-center text-slate-500">No connected clients discovered</td></tr>
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
            <div className="flex h-full items-center justify-center rounded-md border border-line bg-white text-sm text-slate-500">
              Select an access point
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
