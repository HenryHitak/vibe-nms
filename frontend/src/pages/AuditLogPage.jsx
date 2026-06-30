import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";
import { NMS_TIME_ZONE_LABEL, formatTijuanaDateTime } from "../time.js";

export default function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState({
    date_from: "",
    date_to: "",
    username: "",
    source_ip: "",
    action_type: "",
    entity_type: "",
    target_ip: "",
    result: ""
  });
  const [error, setError] = useState("");

  async function load() {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      setLogs(await api(`/audit-logs?${params.toString()}`));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function change(event) {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  return (
    <AdminLayout
      title="CRUD Audit Logs"
      actions={
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white" onClick={load}>
          <Search size={16} /> Search
        </button>
      }
    >
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="mb-4 grid grid-cols-2 gap-3 rounded-md border border-line bg-white p-4 md:grid-cols-4 xl:grid-cols-8">
        <input className="h-10 rounded-md border border-line px-3 text-sm" type="datetime-local" name="date_from" value={filters.date_from} onChange={change} title={`From (${NMS_TIME_ZONE_LABEL})`} />
        <input className="h-10 rounded-md border border-line px-3 text-sm" type="datetime-local" name="date_to" value={filters.date_to} onChange={change} title={`To (${NMS_TIME_ZONE_LABEL})`} />
        <input className="h-10 rounded-md border border-line px-3 text-sm" placeholder="Username" name="username" value={filters.username} onChange={change} />
        <input className="h-10 rounded-md border border-line px-3 text-sm" placeholder="Source IP" name="source_ip" value={filters.source_ip} onChange={change} />
        <select className="h-10 rounded-md border border-line px-3 text-sm" name="action_type" value={filters.action_type} onChange={change}>
          <option value="">Action</option>
          {["CREATE", "UPDATE", "DELETE", "IMPORT", "EXPORT", "ACK_ALERT", "RESOLVE_ALERT", "SETTINGS_CHANGE"].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select className="h-10 rounded-md border border-line px-3 text-sm" name="entity_type" value={filters.entity_type} onChange={change}>
          <option value="">Entity</option>
          {["DEVICE", "PLANT", "LINE", "LOCATION", "AP", "ALERT", "ALERT_RULE", "SYSTEM_SETTING"].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input className="h-10 rounded-md border border-line px-3 text-sm" placeholder="Target IP" name="target_ip" value={filters.target_ip} onChange={change} />
        <select className="h-10 rounded-md border border-line px-3 text-sm" name="result" value={filters.result} onChange={change}>
          <option value="">Result</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="FAILED">FAILED</option>
        </select>
      </div>

      <div className="table-scroll overflow-auto border border-line bg-white">
        <table className="min-w-[1200px] text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Source IP</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Target IP</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Changed Fields</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-line align-top">
                <td className="px-3 py-2 tabular-nums">{formatTijuanaDateTime(log.created_at)}</td>
                <td className="px-3 py-2">{log.actor_username}</td>
                <td className="px-3 py-2 tabular-nums">{log.actor_ip_address}</td>
                <td className="px-3 py-2">{log.action_type}</td>
                <td className="px-3 py-2">{log.entity_type}</td>
                <td className="px-3 py-2 tabular-nums">{log.target_ip_address || "-"}</td>
                <td className="px-3 py-2">{log.result}</td>
                <td className="max-w-[440px] px-3 py-2">
                  <pre className="whitespace-pre-wrap text-xs text-slate-700">{JSON.stringify(log.changed_fields_json || {}, null, 2)}</pre>
                </td>
              </tr>
            ))}
            {logs.length === 0 ? (
              <tr><td className="px-3 py-8 text-center text-slate-500" colSpan="8">No audit logs</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
