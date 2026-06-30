import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Filter, Play, RefreshCcw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, getStoredUser } from "../api.js";

function formatBps(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)} Gbps`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(2)} Mbps`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)} Kbps`;
  return `${number.toFixed(0)} bps`;
}

function toMbps(value) {
  return Number(((Number(value || 0)) / 1_000_000).toFixed(2));
}

function timeLabel(value) {
  const text = String(value || "");
  return text.length >= 16 ? text.slice(11, 16) : text;
}

function KpiCard({ label, value, sublabel }) {
  return (
    <div className="rounded-md border border-line bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {sublabel ? <div className="mt-1 truncate text-xs text-slate-500">{sublabel}</div> : null}
    </div>
  );
}

function aggregate(values, key, mode) {
  const clean = values.map((row) => Number(row[key] || 0)).filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  if (mode === "min") return Math.min(...clean);
  if (mode === "max") return Math.max(...clean);
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export default function TrafficGraphPage() {
  const user = getStoredUser();
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  const [payload, setPayload] = useState(null);
  const [devices, setDevices] = useState([]);
  const [plantFilter, setPlantFilter] = useState("");
  const [lineFilter, setLineFilter] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (plantFilter) query.set("plant", plantFilter);
      if (lineFilter) query.set("line", lineFilter);
      if (deviceFilter) query.set("device_id", deviceFilter);
      query.set("point_limit", "720");
      query.set("device_limit", "300");
      const [trafficPayload, devicesPayload] = await Promise.all([
        api(`/traffic/summary?${query.toString()}`),
        api("/devices")
      ]);
      setPayload(trafficPayload);
      setDevices(devicesPayload);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [plantFilter, lineFilter, deviceFilter]);

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

  const deviceOptions = useMemo(
    () => devices
      .filter((device) => {
        const plant = device.plant_name || device.plant_code;
        const line = device.line_name || device.line_code;
        return (!plantFilter || plant === plantFilter) && (!lineFilter || line === lineFilter);
      })
      .sort((a, b) => String(a.device_name).localeCompare(String(b.device_name))),
    [devices, plantFilter, lineFilter]
  );

  useEffect(() => {
    if (lineFilter && !lineOptions.includes(lineFilter)) setLineFilter("");
  }, [lineFilter, lineOptions]);

  useEffect(() => {
    if (deviceFilter && !deviceOptions.some((device) => String(device.id) === String(deviceFilter))) setDeviceFilter("");
  }, [deviceFilter, deviceOptions]);

  async function runNow() {
    setRunning(true);
    try {
      await api("/traffic/run", { method: "POST" });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const latest = payload?.latest || [];
  const summary = payload?.summary || {};
  const trend = (payload?.timeseries || []).map((row) => ({
    time: timeLabel(row.time),
    rx: toMbps(row.rx_bps),
    tx: toMbps(row.tx_bps),
    rxMax: toMbps(row.rx_max_bps),
    txMax: toMbps(row.tx_max_bps)
  }));
  const topDevices = (payload?.top_devices || []).map((row) => ({
    name: row.device_name,
    rx: toMbps(row.rx_bps),
    tx: toMbps(row.tx_bps),
    total: toMbps(Number(row.rx_bps || 0) + Number(row.tx_bps || 0))
  }));
  const sourceText = Object.entries(summary.source_counts || {}).map(([source, count]) => `${source}: ${count}`).join(" / ");
  const rxMin = aggregate(latest, "rx_min_bps", "min");
  const rxMax = aggregate(latest, "rx_max_bps", "max");
  const rxAvg = aggregate(latest, "rx_avg_bps", "avg");
  const txMin = aggregate(latest, "tx_min_bps", "min");
  const txMax = aggregate(latest, "tx_max_bps", "max");
  const txAvg = aggregate(latest, "tx_avg_bps", "avg");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

        <section className="mb-4 rounded-md border border-line bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Filter size={16} className="text-slate-500" /> Traffic Filters
            </div>
            <select className="h-10 min-w-40 rounded-md border border-line bg-white px-3 text-sm" value={plantFilter} onChange={(event) => setPlantFilter(event.target.value)}>
              <option value="">All Plants</option>
              {plantOptions.map((plant) => <option key={plant} value={plant}>{plant}</option>)}
            </select>
            <select className="h-10 min-w-40 rounded-md border border-line bg-white px-3 text-sm" value={lineFilter} onChange={(event) => setLineFilter(event.target.value)}>
              <option value="">All Lines</option>
              {lineOptions.map((line) => <option key={line} value={line}>{line}</option>)}
            </select>
            <select className="h-10 min-w-56 rounded-md border border-line bg-white px-3 text-sm" value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}>
              <option value="">All Devices</option>
              {deviceOptions.map((device) => <option key={device.id} value={device.id}>{device.device_name} / {device.ip_address}</option>)}
            </select>
            <button className="h-10 rounded-md border border-line bg-slate-50 px-3 text-sm font-semibold text-slate-700" onClick={() => { setPlantFilter(""); setLineFilter(""); setDeviceFilter(""); }}>
              Reset
            </button>
            <button className="ml-auto inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={load} disabled={loading}>
              <RefreshCcw size={16} /> Refresh
            </button>
            {isAdmin ? (
              <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white disabled:opacity-60" onClick={runNow} disabled={running}>
                <Play size={16} /> Run Now
              </button>
            ) : null}
          </div>
        </section>

        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Current RX" value={formatBps(summary.current_rx_bps)} sublabel={`${summary.device_count || 0} devices`} />
          <KpiCard label="Current TX" value={formatBps(summary.current_tx_bps)} sublabel={sourceText || "No source"} />
          <KpiCard label="Peak RX" value={formatBps(rxMax || summary.max_rx_bps)} sublabel={`Min ${formatBps(rxMin)} / Avg ${formatBps(rxAvg)}`} />
          <KpiCard label="Peak TX" value={formatBps(txMax || summary.max_tx_bps)} sublabel={`Min ${formatBps(txMin)} / Avg ${formatBps(txAvg)}`} />
        </div>

        {!latest.length ? (
          <section className="mb-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            No traffic metrics are available yet. Traffic collection source: {payload?.settings?.traffic_default_provider || "not loaded"}.
          </section>
        ) : null}

        <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
          <section className="rounded-md border border-line bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Activity size={18} className="text-cyan-700" />
              <h2 className="font-semibold">TX / RX Traffic Trend</h2>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="M" />
                  <Tooltip formatter={(value) => `${value} Mbps`} />
                  <Legend />
                  <Line type="monotone" dataKey="rx" name="RX Mbps" stroke="#0e7490" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="tx" name="TX Mbps" stroke="#ea580c" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="rxMax" name="RX Max" stroke="#0891b2" strokeDasharray="5 5" dot={false} />
                  <Line type="monotone" dataKey="txMax" name="TX Max" stroke="#f97316" strokeDasharray="5 5" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-md border border-line bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 size={18} className="text-slate-500" />
              <h2 className="font-semibold">Top Traffic Devices</h2>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topDevices} layout="vertical" margin={{ left: 16, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="M" />
                  <YAxis dataKey="name" type="category" width={130} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => `${value} Mbps`} />
                  <Legend />
                  <Bar dataKey="rx" name="RX Mbps" stackId="traffic" fill="#0e7490" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="tx" name="TX Mbps" stackId="traffic" fill="#ea580c" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section className="rounded-md border border-line bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold">Latest Interface Traffic</h2>
            <span className="text-sm text-slate-500">Last collected: {summary.last_collected_at || "-"}</span>
          </div>
          <div className="max-h-[520px] overflow-auto table-scroll">
            <table className="w-full min-w-[1180px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase text-slate-600">
                <tr>
                  <th className="border-b border-line px-3 py-2">Device</th>
                  <th className="border-b border-line px-3 py-2">IP</th>
                  <th className="border-b border-line px-3 py-2">Plant / Line</th>
                  <th className="border-b border-line px-3 py-2">AP</th>
                  <th className="border-b border-line px-3 py-2">Switch</th>
                  <th className="border-b border-line px-3 py-2">Interface</th>
                  <th className="border-b border-line px-3 py-2">RX</th>
                  <th className="border-b border-line px-3 py-2">RX Min / Avg / Max</th>
                  <th className="border-b border-line px-3 py-2">TX</th>
                  <th className="border-b border-line px-3 py-2">TX Min / Avg / Max</th>
                  <th className="border-b border-line px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((row) => (
                  <tr key={`${row.device_id}-${row.id}`} className="hover:bg-slate-50">
                    <td className="border-b border-line px-3 py-2 font-semibold text-ink">{row.device_name}</td>
                    <td className="border-b border-line px-3 py-2 tabular-nums">{row.ip_address}</td>
                    <td className="border-b border-line px-3 py-2">{row.plant_name || "-"} / {row.line_name || "-"}</td>
                    <td className="border-b border-line px-3 py-2">{row.connected_ap_name || row.connected_ap_ip || "-"}</td>
                    <td className="border-b border-line px-3 py-2">{row.switch_name || "-"} {row.switch_port ? `/ ${row.switch_port}` : ""}</td>
                    <td className="border-b border-line px-3 py-2">{row.interface_name || "-"}</td>
                    <td className="border-b border-line px-3 py-2 font-semibold tabular-nums text-cyan-700">{formatBps(row.rx_bps)}</td>
                    <td className="border-b border-line px-3 py-2 tabular-nums">{formatBps(row.rx_min_bps)} / {formatBps(row.rx_avg_bps)} / {formatBps(row.rx_max_bps)}</td>
                    <td className="border-b border-line px-3 py-2 font-semibold tabular-nums text-orange-700">{formatBps(row.tx_bps)}</td>
                    <td className="border-b border-line px-3 py-2 tabular-nums">{formatBps(row.tx_min_bps)} / {formatBps(row.tx_avg_bps)} / {formatBps(row.tx_max_bps)}</td>
                    <td className="border-b border-line px-3 py-2">{row.source || "-"}</td>
                  </tr>
                ))}
                {!latest.length ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-slate-500" colSpan="11">No traffic metrics</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
