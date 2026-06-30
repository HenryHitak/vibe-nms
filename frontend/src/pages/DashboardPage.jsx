import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, RadioTower, ServerCrash } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import AlertBanner from "../components/AlertBanner.jsx";
import DeviceDetailPanel from "../components/DeviceDetailPanel.jsx";
import DeviceTable from "../components/DeviceTable.jsx";

function Stat({ icon: Icon, label, value, tone }) {
  const toneClass = {
    green: "text-green-nms",
    orange: "text-orange-nms",
    red: "text-red-nms",
    blue: "text-cyan-700"
  }[tone] || "text-slate-600";
  return (
    <div className="rounded-md border border-line bg-white p-4">
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
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const [summaryPayload, devicesPayload] = await Promise.all([
        api("/dashboard/summary"),
        api("/devices")
      ]);
      setSummary(summaryPayload);
      setDevices(devicesPayload);
      if (!selected && devicesPayload.length) setSelected(devicesPayload[0]);
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

  const counts = summary?.status_counts || {};
  const chartCounts = useMemo(
    () => ["ONLINE", "WARNING", "UNCERTAIN", "FLAPPING", "OFFLINE", "CRITICAL", "UNKNOWN"].map((status) => ({ status, count: counts[status] || 0 })),
    [counts]
  );
  const trend = useMemo(
    () => [...(summary?.recent_metrics || [])].reverse().slice(-30).map((row, index) => ({
      index: index + 1,
      latency: row.latency_ms ?? 0,
      loss: row.packet_loss_percent ?? 0,
      device: row.device_name
    })),
    [summary]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AlertBanner alerts={summary?.recent_alerts || []} />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Stat icon={RadioTower} label="Devices" value={summary?.total_devices} tone="blue" />
          <Stat icon={CheckCircle2} label="Online" value={counts.ONLINE || 0} tone="green" />
          <Stat icon={AlertTriangle} label="Warning" value={(counts.WARNING || 0) + (counts.UNCERTAIN || 0) + (counts.FLAPPING || 0)} tone="orange" />
          <Stat icon={ServerCrash} label="Offline / Critical" value={(counts.OFFLINE || 0) + (counts.CRITICAL || 0)} tone="red" />
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.3fr]">
          <section className="rounded-md border border-line bg-white p-4">
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

          <section className="rounded-md border border-line bg-white p-4">
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
                  <Line yAxisId="right" type="monotone" dataKey="loss" stroke="#dc2626" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <div className="grid min-h-[520px] grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
          <section className="min-h-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Devices</h2>
              <span className="text-sm text-slate-500">{devices.length} active</span>
            </div>
            <DeviceTable devices={devices} selectedId={selected?.id} onSelect={setSelected} />
          </section>
          <DeviceDetailPanel device={selected} />
        </div>
      </div>
    </div>
  );
}

