import { useEffect, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { api } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";

function Severity({ value }) {
  const classes = value === "CRITICAL" ? "bg-red-900 text-white" : value === "WARNING" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex h-6 min-w-20 items-center justify-center rounded px-2 text-xs font-semibold ${classes}`}>{value}</span>;
}

export default function AlertCenter({ role = "USER" }) {
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const query = status ? `?status=${status}` : "";
      setAlerts(await api(`/alerts${query}`));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  async function action(id, name) {
    try {
      await api(`/alerts/${id}/${name}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <AdminLayout
      title="Alert Center"
      actions={
        <select className="h-10 rounded-md border border-line bg-white px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All</option>
          <option value="ACTIVE">Active</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      }
    >
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="table-scroll overflow-auto border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Device</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">Message</th>
              <th className="px-3 py-2">Last Detected</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.id} className="border-t border-line">
                <td className="px-3 py-2"><Severity value={alert.severity} /></td>
                <td className="px-3 py-2">{alert.status}</td>
                <td className="px-3 py-2 font-semibold">{alert.device_name || "-"}</td>
                <td className="px-3 py-2 tabular-nums">{alert.ip_address || "-"}</td>
                <td className="px-3 py-2">{alert.message}</td>
                <td className="px-3 py-2 tabular-nums">{alert.last_detected_at}</td>
                <td className="px-3 py-2 text-right">
                  {role === "ADMIN" ? (
                    <div className="inline-flex gap-2">
                      <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white" title="Acknowledge" onClick={() => action(alert.id, "acknowledge")}>
                        <Check size={15} />
                      </button>
                      <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white" title="Resolve" onClick={() => action(alert.id, "resolve")}>
                        <RotateCcw size={15} />
                      </button>
                    </div>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </td>
              </tr>
            ))}
            {alerts.length === 0 ? (
              <tr><td className="px-3 py-8 text-center text-slate-500" colSpan="7">No alerts</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
