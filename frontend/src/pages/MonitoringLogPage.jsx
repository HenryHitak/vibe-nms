import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { api } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

export default function MonitoringLogPage() {
  const [payload, setPayload] = useState({ logs: [], runs: [] });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const query = status ? `?status=${status}` : "";
      setPayload(await api(`/monitoring-logs${query}`));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function runOnce() {
    try {
      await api("/monitoring/run-once", { method: "POST" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  return (
    <AdminLayout
      title="Monitoring Logs"
      actions={
        <>
          <select className="h-10 rounded-md border border-line bg-white px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All Status</option>
            {["ONLINE", "WARNING", "UNCERTAIN", "FLAPPING", "OFFLINE", "CRITICAL", "UNKNOWN"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white" onClick={runOnce}>
            <Play size={16} /> Run
          </button>
        </>
      }
    >
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="mb-5 grid grid-cols-1 gap-3 xl:grid-cols-4">
        {payload.runs.slice(0, 4).map((run) => (
          <div key={run.id} className="rounded-md border border-line bg-white p-4">
            <div className="mb-1 text-sm text-slate-500">{run.started_at}</div>
            <div className="text-sm">
              Checked <span className="font-semibold">{run.total_devices_checked}</span>,
              online <span className="font-semibold text-green-nms">{run.online_count}</span>,
              warning <span className="font-semibold text-orange-nms">{run.warning_count}</span>,
              offline <span className="font-semibold text-red-nms">{run.offline_count}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="table-scroll overflow-auto border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2">Checked</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Device</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">Method</th>
              <th className="px-3 py-2">Latency</th>
              <th className="px-3 py-2">Loss</th>
              <th className="px-3 py-2">Failures</th>
              <th className="px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {payload.logs.map((log) => (
              <tr key={log.id} className="border-t border-line">
                <td className="px-3 py-2 tabular-nums">{log.checked_at}</td>
                <td className="px-3 py-2"><StatusBadge status={log.status} /></td>
                <td className="px-3 py-2 font-semibold">{log.device_name}</td>
                <td className="px-3 py-2 tabular-nums">{log.ip_address}</td>
                <td className="px-3 py-2">{log.check_method}</td>
                <td className="px-3 py-2 tabular-nums">{log.latency_ms ?? "-"}</td>
                <td className="px-3 py-2 tabular-nums">{log.packet_loss_percent ?? "-"}</td>
                <td className="px-3 py-2 tabular-nums">{log.consecutive_failure_count}</td>
                <td className="max-w-[360px] px-3 py-2 text-xs text-slate-600">{log.error_message || "-"}</td>
              </tr>
            ))}
            {payload.logs.length === 0 ? (
              <tr><td className="px-3 py-8 text-center text-slate-500" colSpan="9">No monitoring logs</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}

