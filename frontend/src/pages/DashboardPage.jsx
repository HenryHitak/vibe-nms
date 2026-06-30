import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Filter, RadioTower, ServerCrash } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import AlertBanner from "../components/AlertBanner.jsx";
import DeviceDetailModal from "../components/DeviceDetailModal.jsx";
import DeviceTable from "../components/DeviceTable.jsx";

function Stat({ icon: Icon, label, value, tone }) {
  const toneClass = {
    green: "text-green-nms",
    orange: "text-orange-nms",
    red: "text-red-nms",
    blue: "text-cyan-700"
  }[tone] || "text-slate-600";
  return (
    <div className="rounded-md border border-line bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <Icon className={toneClass} size={18} />
      </div>
      <div className="text-3xl font-semibold tabular-nums text-ink">{value ?? 0}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [devices, setDevices] = useState([]);
  const [apDashboard, setApDashboard] = useState([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailDevice, setDetailDevice] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [plantFilter, setPlantFilter] = useState("");
  const [lineFilter, setLineFilter] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [summaryPayload, devicesPayload, apPayload] = await Promise.all([
        api("/dashboard/summary"),
        api("/devices"),
        api("/dashboard/by-ap")
      ]);
      setSummary(summaryPayload);
      setDevices(devicesPayload);
      setApDashboard(apPayload);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  const plantOptions = useMemo(
    () => [...new Set(devices.map((device) => device.plant_name || device.plant_code).filter(Boolean))].sort(),
    [devices]
  );

  const lineOptions = useMemo(
    () => [...new Set(devices
      .filter((device) => !plantFilter || (device.plant_name || device.plant_code) === plantFilter)
      .map((device) => device.line_name || device.line_code)
      .filter(Boolean))].sort(),
    [devices, plantFilter]
  );

  const filteredDevices = useMemo(
    () => devices.filter((device) => {
      const plantName = device.plant_name || device.plant_code;
      const lineName = device.line_name || device.line_code;
      return (!plantFilter || plantName === plantFilter) && (!lineFilter || lineName === lineFilter);
    }),
    [devices, plantFilter, lineFilter]
  );

  useEffect(() => {
    if (lineFilter && !lineOptions.includes(lineFilter)) {
      setLineFilter("");
    }
  }, [lineFilter, lineOptions]);

  async function openDeviceDetail(device) {
    setDetailOpen(true);
    setDetailDevice(device);
    setDetailLoading(true);
    setDetailError("");
    try {
      const latestDevice = await api(`/devices/${device.id}`);
      setDetailDevice(latestDevice);
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDeviceDetail() {
    setDetailOpen(false);
    setDetailError("");
  }

  const counts = useMemo(
    () => filteredDevices.reduce((acc, device) => {
      acc[device.status || "UNKNOWN"] = (acc[device.status || "UNKNOWN"] || 0) + 1;
      return acc;
    }, {}),
    [filteredDevices]
  );

  const plantImpact = useMemo(() => {
    const plants = new Map();
    for (const device of devices) {
      const key = device.plant_name || device.plant_code || "UNKNOWN";
      const current = plants.get(key) || {
        plant_name: key,
        total: 0,
        online: 0,
        warning: 0,
        offline: 0,
        lines: new Set()
      };
      current.total += 1;
      current.lines.add(device.line_name || device.line_code);
      if (device.status === "ONLINE") current.online += 1;
      else if (["WARNING", "UNCERTAIN", "FLAPPING"].includes(device.status)) current.warning += 1;
      else if (["OFFLINE", "CRITICAL"].includes(device.status)) current.offline += 1;
      plants.set(key, current);
    }
    return [...plants.values()]
      .map((plant) => ({ ...plant, line_count: plant.lines.size }))
      .sort((a, b) => b.offline - a.offline || b.warning - a.warning || a.plant_name.localeCompare(b.plant_name));
  }, [devices]);

  const chartCounts = useMemo(
    () => ["ONLINE", "WARNING", "UNCERTAIN", "FLAPPING", "OFFLINE", "CRITICAL", "UNKNOWN"].map((status) => ({ status, count: counts[status] || 0 })),
    [counts]
  );
  const trend = useMemo(
    () => [...(summary?.recent_metrics || [])]
      .filter((row) => (!plantFilter || (row.plant_name || row.plant_code) === plantFilter) && (!lineFilter || (row.line_name || row.line_code) === lineFilter))
      .reverse()
      .slice(-30)
      .map((row, index) => ({
      index: index + 1,
      latency: row.latency_ms ?? 0,
      icmpLoss: row.packet_loss_percent ?? 0,
      device: row.device_name
    })),
    [summary, plantFilter, lineFilter]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AlertBanner alerts={summary?.recent_alerts || []} />
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

        <section className="mb-4 rounded-md border border-line bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Filter size={16} className="text-slate-500" /> Filter
            </div>
            <select className="h-10 min-w-40 rounded-md border border-line bg-white px-3 text-sm" value={plantFilter} onChange={(event) => setPlantFilter(event.target.value)}>
              <option value="">All Plants</option>
              {plantOptions.map((plant) => <option key={plant} value={plant}>{plant}</option>)}
            </select>
            <select className="h-10 min-w-40 rounded-md border border-line bg-white px-3 text-sm" value={lineFilter} onChange={(event) => setLineFilter(event.target.value)}>
              <option value="">All Lines</option>
              {lineOptions.map((line) => <option key={line} value={line}>{line}</option>)}
            </select>
            <button className="h-10 rounded-md border border-line bg-slate-50 px-3 text-sm font-semibold text-slate-700" onClick={() => { setPlantFilter(""); setLineFilter(""); }}>
              Reset
            </button>
            <div className="ml-auto text-sm text-slate-500">{filteredDevices.length} of {devices.length} devices</div>
          </div>
        </section>

        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Stat icon={RadioTower} label="Devices" value={filteredDevices.length} tone="blue" />
          <Stat icon={CheckCircle2} label="Online" value={counts.ONLINE || 0} tone="green" />
          <Stat icon={AlertTriangle} label="Warning" value={(counts.WARNING || 0) + (counts.UNCERTAIN || 0) + (counts.FLAPPING || 0)} tone="orange" />
          <Stat icon={ServerCrash} label="Offline / Critical" value={(counts.OFFLINE || 0) + (counts.CRITICAL || 0)} tone="red" />
        </div>

        <section className="mb-5 rounded-md border border-line bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Plant Impact</h2>
            <span className="text-sm text-slate-500">{plantImpact.length} plants</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {plantImpact.slice(0, 8).map((plant) => (
              <button
                key={plant.plant_name}
                className={`rounded-md border p-3 text-left transition-colors ${plantFilter === plant.plant_name ? "border-cyan-400 bg-cyan-50" : "border-line bg-slate-50 hover:bg-white"}`}
                onClick={() => setPlantFilter(plant.plant_name)}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{plant.plant_name}</div>
                    <div className="truncate text-xs text-slate-500">{plant.line_count} lines</div>
                  </div>
                  <div className={`h-3 w-3 rounded-full ${plant.offline ? "bg-red-nms" : plant.warning ? "bg-orange-nms" : "bg-green-nms"}`} />
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div><div className="font-semibold">{plant.total}</div><div className="text-slate-500">Total</div></div>
                  <div><div className="font-semibold text-green-nms">{plant.online}</div><div className="text-slate-500">Online</div></div>
                  <div><div className="font-semibold text-orange-nms">{plant.warning}</div><div className="text-slate-500">Warn</div></div>
                  <div><div className="font-semibold text-red-nms">{plant.offline}</div><div className="text-slate-500">Down</div></div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="mb-5 rounded-md border border-line bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">AP Connected IPs</h2>
            <span className="text-sm text-slate-500">{apDashboard.length} APs</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {apDashboard.map((item) => {
              const ap = item.ap;
              return (
                <div key={ap.id} className="rounded-md border border-line bg-slate-50 p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink">{ap.device_name}</div>
                      <div className="truncate text-xs text-slate-500">{ap.ip_address}</div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <div className="font-semibold text-ink">{item.connected_client_count}</div>
                      clients
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.connected_ip_addresses.map((ip) => (
                      <span key={ip} className="rounded border border-line bg-white px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-700">{ip}</span>
                    ))}
                    {!item.connected_ip_addresses.length ? <span className="text-xs text-slate-500">No connected IPs discovered</span> : null}
                  </div>
                </div>
              );
            })}
            {!apDashboard.length ? <div className="text-sm text-slate-500">No AP devices registered</div> : null}
          </div>
        </section>

        <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.3fr]">
          <section className="rounded-md border border-line bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Activity size={18} className="text-slate-500" />
              <h2 className="font-semibold">Network State</h2>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartCounts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0f766e" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-md border border-line bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-semibold">Recent Metrics</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="index" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Line yAxisId="left" type="monotone" dataKey="latency" stroke="#0e7490" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="icmpLoss" name="ICMP Loss" stroke="#dc2626" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <div className="grid min-h-[560px] grid-cols-1 gap-5">
          <section className="min-h-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Devices</h2>
              <span className="text-sm text-slate-500">{filteredDevices.length} active</span>
            </div>
            <DeviceTable devices={filteredDevices} selectedId={detailOpen ? detailDevice?.id : null} onSelect={openDeviceDetail} />
          </section>
        </div>
      </div>
      <DeviceDetailModal
        open={detailOpen}
        device={detailDevice}
        loading={detailLoading}
        error={detailError}
        onClose={closeDeviceDetail}
      />
    </div>
  );
}
