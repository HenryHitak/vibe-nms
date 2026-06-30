import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { api } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

function formatMs(value) {
  return value == null ? "-" : `${value} ms`;
}

function formatPercent(value) {
  return value == null ? "-" : `${value}%`;
}

function reasonForLog(log, thresholds = {}) {
  if (log.error_message) {
    return log.error_message;
  }
  const warningLatency = Number(thresholds.warning_latency_ms ?? 150);
  const criticalLatency = Number(thresholds.critical_latency_ms ?? 500);
  const warningLoss = Number(thresholds.warning_packet_loss_percent ?? 5);
  const failures = Number(log.consecutive_failure_count || 0);
  const latency = Number(log.latency_ms ?? 0);
  const loss = Number(log.packet_loss_percent ?? 0);

  if (log.status === "FLAPPING") {
    return "Status changed repeatedly in recent checks. Check cable, switch port, Wi-Fi roaming, or unstable ICMP response.";
  }
  if (!log.is_online) {
    if (failures < 3) {
      return `Ping failed ${failures || 1} time(s). Device may still be online if ICMP/ping is blocked by Windows firewall or endpoint security.`;
    }
    return `Ping failed ${failures} consecutive times. Marked ${log.status}.`;
  }
  if (loss >= warningLoss) {
    return `Online, but packet loss ${loss}% is above warning threshold ${warningLoss}%.`;
  }
  if (latency >= criticalLatency && log.status === "CRITICAL") {
    return `Online, but latency ${latency} ms is above critical threshold ${criticalLatency} ms.`;
  }
  if (latency >= warningLatency) {
    return `Online, but latency ${latency} ms is above warning threshold ${warningLatency} ms.`;
  }
  return `Ping OK. Latency ${formatMs(log.latency_ms)}, packet loss ${formatPercent(log.packet_loss_percent)}.`;
}

export default function MonitoringLogPage() {
  const [payload, setPayload] = useState({ logs: [], runs: [], thresholds: {} });
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
              <th className="px-3 py-2">Reason</th>
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
                <td className="px-3 py-2 tabular-nums">{formatMs(log.latency_ms)}</td>
                <td className="px-3 py-2 tabular-nums">{formatPercent(log.packet_loss_percent)}</td>
                <td className="px-3 py-2 tabular-nums">{log.consecutive_failure_count}</td>
                <td className="min-w-[360px] max-w-[560px] px-3 py-2 text-xs leading-5 text-slate-700">{reasonForLog(log, payload.thresholds)}</td>
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
