import { useEffect, useState } from "react";
import { Database, RefreshCw, ServerCog, Wifi } from "lucide-react";
import { api } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";

function InfoRow({ label, value }) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-line py-3 text-sm last:border-b-0 md:grid-cols-[180px_1fr]">
      <div className="font-medium text-slate-500">{label}</div>
      <div className="min-w-0 break-words font-semibold text-ink">{value === null || value === undefined || value === "" ? "-" : String(value)}</div>
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <section className="rounded-md border border-line bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={18} className="text-slate-500" />
        <h2 className="font-semibold">{title}</h2>
      </div>
      <div className="rounded-md border border-line px-3">
        {children}
      </div>
    </section>
  );
}

export default function BackendInfoPage() {
  const [runtime, setRuntime] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setRuntime(await api("/backend/runtime"));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const db = runtime?.database || {};
  const workers = runtime?.workers || {};
  const backendApi = runtime?.api || {};

  return (
    <AdminLayout
      title="Backend Info"
      actions={
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white" onClick={load}>
          <RefreshCw size={16} /> Refresh
        </button>
      }
    >
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Section icon={ServerCog} title="Backend Process">
          <InfoRow label="App" value={runtime?.app_name} />
          <InfoRow label="PID" value={runtime?.process?.pid} />
          <InfoRow label="Host" value={runtime?.process?.host} />
          <InfoRow label="Port" value={runtime?.process?.port} />
          <InfoRow label="Frontend Dist" value={runtime?.frontend?.dist_path} />
          <InfoRow label="Frontend Exists" value={runtime?.frontend?.exists ? "Yes" : "No"} />
        </Section>

        <Section icon={Database} title="SQL / Database">
          <InfoRow label="Engine" value={db.engine} />
          {db.engine === "mssql" ? (
            <>
              <InfoRow label="Server" value={db.server} />
              <InfoRow label="Port" value={db.port} />
              <InfoRow label="Database" value={db.database} />
              <InfoRow label="Driver" value={db.driver} />
            </>
          ) : (
            <>
              <InfoRow label="SQLite File" value={db.path} />
              <InfoRow label="File Exists" value={db.exists ? "Yes" : "No"} />
            </>
          )}
        </Section>

        <Section icon={Wifi} title="Background Workers">
          <InfoRow label="Ping Collector" value={workers.ping_collector_enabled ? "Enabled" : "Disabled"} />
          <InfoRow label="Ping Interval" value={`${workers.ping_interval_seconds ?? "-"} seconds`} />
          <InfoRow label="Ping Count" value={workers.ping_count} />
          <InfoRow label="TCP Fallback Ports" value={(workers.tcp_fallback_ports || []).join(", ")} />
          <InfoRow label="AP Discovery" value={workers.ap_client_discovery_enabled ? "Enabled" : "Disabled"} />
          <InfoRow label="AP Interval" value={`${workers.ap_client_discovery_interval_seconds ?? "-"} seconds`} />
        </Section>

        <Section icon={ServerCog} title="External Dashboard API">
          <InfoRow label="Display Page" value={backendApi.display_page} />
          <InfoRow label="GET" value={backendApi.dashboard_get} />
          <InfoRow label="POST" value={backendApi.dashboard_post} />
          <InfoRow label="Swagger Docs" value={backendApi.docs} />
          <InfoRow label="Example" value="/display?plant=Main Plant" />
        </Section>
      </div>
    </AdminLayout>
  );
}
