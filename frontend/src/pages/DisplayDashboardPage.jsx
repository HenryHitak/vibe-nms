import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Monitor, ServerCrash, Wifi } from "lucide-react";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatTijuanaNow } from "../time.js";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

function formatPercent(value) {
  return value == null ? "-" : `${value}%`;
}

function formatMs(value) {
  return value == null ? "-" : `${value} ms`;
}

function Stat({ icon: Icon, label, value, tone }) {
  const toneClass = {
    green: "border-green-200 bg-green-50 text-green-800",
    orange: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-800",
    blue: "border-cyan-200 bg-cyan-50 text-cyan-900",
    slate: "border-slate-200 bg-white text-slate-800"
  }[tone] || "border-slate-200 bg-white text-slate-800";

  return (
    <div className={`rounded-md border p-4 ${toneClass}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold uppercase tracking-normal opacity-75">{label}</div>
        <Icon size={20} />
      </div>
      <div className="text-4xl font-semibold tabular-nums">{value ?? 0}</div>
    </div>
  );
}

function buildEndpoint() {
  const query = window.location.search || "";
  return `${API_BASE}/display/dashboard${query}`;
}

export default function DisplayDashboardPage() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  async function load() {
    try {
      const response = await fetch(buildEndpoint());
      const nextPayload = await response.json();
      if (!response.ok) {
        throw new Error(nextPayload?.detail || `Display API failed: ${response.status}`);
      }
      setPayload(nextPayload);
      setUpdatedAt(formatTijuanaNow());
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

  const devices = payload?.devices || [];
  const counts = payload?.summary?.status_counts || {};
  const plantImpact = useMemo(() => {
    const plants = new Map();
    for (const device of devices) {
      const plant = device.plant_name || "UNKNOWN";
      const current = plants.get(plant) || { plant, total: 0, online: 0, warning: 0, offline: 0 };
      current.total += 1;
      if (device.status === "ONLINE") current.online += 1;
      else if (["WARNING", "UNCERTAIN", "FLAPPING"].includes(device.status)) current.warning += 1;
      else if (["OFFLINE", "CRITICAL"].includes(device.status)) current.offline += 1;
      plants.set(plant, current);
    }
    return [...plants.values()].sort((a, b) => b.offline - a.offline || b.warning - a.warning || a.plant.localeCompare(b.plant));
  }, [devices]);

  return (
    <div className="min-h-screen bg-slate-100 p-5 text-ink">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-md border border-line bg-white px-5 py-4 shadow-sm">
        <div className="min-w-0">
          <div className="text-sm font-semibold uppercase tracking-normal text-slate-500">Vibe NMS Display</div>
          <h1 className="text-2xl font-semibold">Plant Network Dashboard</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span className="inline-flex items-center gap-2 rounded-md border border-line bg-slate-50 px-3 py-2">
            <Clock size={16} /> {updatedAt || "Loading"}
          </span>
          <span className="rounded-md border border-line bg-slate-50 px-3 py-2">
            Auto refresh 5s
          </span>
        </div>
      </header>

      {error ? (
        <div className="mb-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
          {error}
        </div>
      ) : null}

      <section className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Stat icon={Monitor} label="Devices" value={payload?.summary?.total_devices || 0} tone="blue" />
        <Stat icon={CheckCircle2} label="Online" value={counts.ONLINE || 0} tone="green" />
        <Stat icon={AlertTriangle} label="Warning" value={(counts.WARNING || 0) + (counts.UNCERTAIN || 0) + (counts.FLAPPING || 0)} tone="orange" />
        <Stat icon={ServerCrash} label="Offline" value={(counts.OFFLINE || 0) + (counts.CRITICAL || 0)} tone="red" />
        <Stat icon={Wifi} label="APs" value={payload?.by_ap?.length || 0} tone="slate" />
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        <section className="rounded-md border border-line bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Devices</h2>
            <span className="text-sm text-slate-500">{devices.length} shown</span>
          </div>
          <div className="max-h-[62vh] overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Device</th>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">Plant</th>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">ICMP Loss</th>
                  <th className="px-3 py-2">Latency</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id} className="border-t border-line">
                    <td className="px-3 py-2"><StatusBadge status={device.status} /></td>
                    <td className="px-3 py-2 font-semibold">{device.device_name}</td>
                    <td className="px-3 py-2 tabular-nums">{device.ip_address}</td>
                    <td className="px-3 py-2">{device.plant_name || "-"}</td>
                    <td className="px-3 py-2">{device.line_name || "-"}</td>
                    <td className="px-3 py-2">{device.latest_check_method || "-"}</td>
                    <td className="px-3 py-2 tabular-nums">{formatPercent(device.packet_loss_percent)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMs(device.latency_ms)}</td>
                  </tr>
                ))}
                {!devices.length ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-slate-500" colSpan="8">No devices</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-md border border-line bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Plant Impact</h2>
              <span className="text-sm text-slate-500">{plantImpact.length} plants</span>
            </div>
            <div className="space-y-2">
              {plantImpact.slice(0, 10).map((plant) => (
                <div key={plant.plant} className="rounded-md border border-line bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-semibold">{plant.plant}</div>
                    <div className={`h-3 w-3 rounded-full ${plant.offline ? "bg-red-nms" : plant.warning ? "bg-orange-nms" : "bg-green-nms"}`} />
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div><div className="font-semibold">{plant.total}</div><div className="text-slate-500">Total</div></div>
                    <div><div className="font-semibold text-green-nms">{plant.online}</div><div className="text-slate-500">Online</div></div>
                    <div><div className="font-semibold text-orange-nms">{plant.warning}</div><div className="text-slate-500">Warn</div></div>
                    <div><div className="font-semibold text-red-nms">{plant.offline}</div><div className="text-slate-500">Down</div></div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-line bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Active Alerts</h2>
              <span className="text-sm text-slate-500">{payload?.summary?.active_alerts || 0} active</span>
            </div>
            <div className="space-y-2">
              {(payload?.recent_alerts || []).slice(0, 8).map((alert) => (
                <div key={alert.id} className={`rounded-md border p-3 text-sm ${alert.severity === "CRITICAL" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                  <div className="mb-1 font-semibold">{alert.severity} / {alert.alert_type}</div>
                  <div className="leading-5">{alert.message}</div>
                </div>
              ))}
              {!payload?.recent_alerts?.length ? <div className="text-sm text-slate-500">No active alerts</div> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
