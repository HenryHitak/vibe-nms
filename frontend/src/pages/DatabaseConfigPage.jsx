import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Database, PlugZap, RotateCcw, Save, ServerCog, XCircle } from "lucide-react";
import { api } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";

const EMPTY_FORM = {
  database_engine: "mssql",
  database_path: "",
  mssql_server: "localhost\\SQLEXPRESS",
  mssql_port: "",
  mssql_database: "vibe_nms",
  mssql_auth: "sql",
  mssql_username: "sa",
  mssql_password: "",
  mssql_driver: "ODBC Driver 18 for SQL Server",
  mssql_encrypt: true,
  mssql_trust_server_certificate: true
};

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function InfoRow({ label, value }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 border-b border-line py-2 text-sm last:border-b-0">
      <div className="text-slate-500">{label}</div>
      <div className="min-w-0 break-words font-semibold text-ink">{valueOrDash(value)}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function ResultBox({ result }) {
  if (!result) return null;
  const ok = Boolean(result.ok);
  const Icon = ok ? CheckCircle2 : XCircle;
  const classes = ok ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-900";
  return (
    <div className={`rounded-md border p-4 text-sm ${classes}`}>
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <Icon size={18} /> {ok ? "Connection OK" : "Connection Failed"}
      </div>
      <div className="leading-5">{result.message}</div>
      {result.engine === "mssql" ? (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <InfoRow label="Target" value={result.target} />
          <InfoRow label="Database" value={result.database} />
          <InfoRow label="DB Exists" value={result.database_exists ? "Yes" : "No"} />
          <InfoRow label="Edition" value={result.edition} />
          <InfoRow label="Version" value={result.product_version} />
          <InfoRow label="Express" value={result.is_express ? "Yes" : "No"} />
        </div>
      ) : null}
    </div>
  );
}

export default function DatabaseConfigPage() {
  const [payload, setPayload] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  async function load() {
    try {
      const next = await api("/database/config");
      setPayload(next);
      setForm({ ...EMPTY_FORM, ...(next.pending || {}), mssql_password: "" });
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const driverOptions = useMemo(() => {
    const known = new Set([form.mssql_driver, ...(payload?.drivers || []), "ODBC Driver 18 for SQL Server"]);
    return [...known].filter(Boolean);
  }, [form.mssql_driver, payload]);

  function change(event) {
    const { name, type, checked, value } = event.target;
    setSaved(false);
    setTestResult(null);
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  function applyExpressPreset() {
    setSaved(false);
    setTestResult(null);
    setForm((current) => ({
      ...current,
      ...(payload?.recommended || EMPTY_FORM),
      mssql_password: current.mssql_password || ""
    }));
  }

  async function testConnection() {
    setTesting(true);
    setError("");
    try {
      setTestResult(await api("/database/config/test", {
        method: "POST",
        body: JSON.stringify(form)
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    try {
      const next = await api("/database/config", {
        method: "PUT",
        body: JSON.stringify(form)
      });
      setPayload((current) => ({ ...(current || {}), ...next }));
      setForm((current) => ({ ...current, mssql_password: "" }));
      setSaved(true);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  const runtime = payload?.runtime || {};
  const pending = payload?.pending || {};
  const sqlMode = form.database_engine === "mssql";
  const sqlAuth = form.mssql_auth === "sql";

  return (
    <AdminLayout
      title="Database Config"
      actions={
        <>
          <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700" onClick={load}>
            <RotateCcw size={16} /> Refresh
          </button>
          <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white" onClick={save}>
            <Save size={16} /> Save Config
          </button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto pr-1">
        {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
        {saved ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-950">Saved to {payload?.env_path}. Restart VibeNMS to apply the database engine change.</div> : null}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_.8fr]">
          <section className="rounded-md border border-line bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Database size={18} className="text-slate-500" />
                <h2 className="font-semibold">SQL Server 2025 Express Profile</h2>
              </div>
              <button className="h-9 rounded-md border border-line bg-slate-50 px-3 text-sm font-semibold text-slate-700" onClick={applyExpressPreset}>
                Apply Preset
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Database Engine">
                <select className="h-10 w-full rounded-md border border-line bg-white px-3" name="database_engine" value={form.database_engine} onChange={change}>
                  <option value="mssql">MS SQL Server 2025 Express</option>
                  <option value="sqlite">SQLite Local File</option>
                </select>
              </Field>

              {!sqlMode ? (
                <Field label="SQLite Path">
                  <input className="h-10 w-full rounded-md border border-line px-3" name="database_path" value={form.database_path || ""} onChange={change} />
                </Field>
              ) : null}

              {sqlMode ? (
                <>
                  <Field label="Server / Instance">
                    <input className="h-10 w-full rounded-md border border-line px-3" name="mssql_server" value={form.mssql_server || ""} onChange={change} placeholder="localhost\\SQLEXPRESS" />
                  </Field>
                  <Field label="TCP Port">
                    <input className="h-10 w-full rounded-md border border-line px-3" name="mssql_port" value={form.mssql_port || ""} onChange={change} placeholder="blank for SQLEXPRESS dynamic port" />
                  </Field>
                  <Field label="Database">
                    <input className="h-10 w-full rounded-md border border-line px-3" name="mssql_database" value={form.mssql_database || ""} onChange={change} />
                  </Field>
                  <Field label="Authentication">
                    <select className="h-10 w-full rounded-md border border-line bg-white px-3" name="mssql_auth" value={form.mssql_auth || "sql"} onChange={change}>
                      <option value="sql">SQL Login</option>
                      <option value="windows">Windows Auth</option>
                    </select>
                  </Field>
                  <Field label="Username">
                    <input className="h-10 w-full rounded-md border border-line px-3 disabled:bg-slate-100" name="mssql_username" value={form.mssql_username || ""} onChange={change} disabled={!sqlAuth} />
                  </Field>
                  <Field label="Password">
                    <input className="h-10 w-full rounded-md border border-line px-3 disabled:bg-slate-100" name="mssql_password" type="password" value={form.mssql_password || ""} onChange={change} disabled={!sqlAuth} placeholder={pending.mssql_password_configured ? "Leave blank to keep existing password" : "SQL login password"} />
                  </Field>
                  <Field label="ODBC Driver">
                    <select className="h-10 w-full rounded-md border border-line bg-white px-3" name="mssql_driver" value={form.mssql_driver || ""} onChange={change}>
                      {driverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-1 gap-2 rounded-md border border-line bg-slate-50 p-3 text-sm md:col-span-2 md:grid-cols-2">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" name="mssql_encrypt" checked={Boolean(form.mssql_encrypt)} onChange={change} />
                      Encrypt connection
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" name="mssql_trust_server_certificate" checked={Boolean(form.mssql_trust_server_certificate)} onChange={change} />
                      Trust server certificate
                    </label>
                  </div>
                </>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 disabled:cursor-wait disabled:opacity-60" onClick={testConnection} disabled={testing}>
                <PlugZap size={16} /> {testing ? "Testing" : "Test Connection"}
              </button>
              <span className="text-sm text-slate-500">Target: {sqlMode ? `${form.mssql_server}${form.mssql_port ? `,${form.mssql_port}` : ""}` : form.database_path}</span>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-md border border-line bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <ServerCog size={18} className="text-slate-500" />
                <h2 className="font-semibold">Runtime Database</h2>
              </div>
              <div className="rounded-md border border-line px-3">
                <InfoRow label="Engine" value={runtime.database_engine} />
                <InfoRow label="Profile" value={runtime.sql_server_profile} />
                <InfoRow label="Target" value={runtime.database_engine === "mssql" ? runtime.mssql_target : runtime.database_path} />
                <InfoRow label="Database" value={runtime.mssql_database} />
                <InfoRow label="Auth" value={runtime.mssql_auth} />
                <InfoRow label="Driver" value={runtime.mssql_driver} />
              </div>
            </section>

            <section className="rounded-md border border-line bg-white p-4 shadow-sm">
              <h2 className="mb-3 font-semibold">Pending .env Config</h2>
              <div className="rounded-md border border-line px-3">
                <InfoRow label="Path" value={payload?.env_path} />
                <InfoRow label="Engine" value={pending.database_engine} />
                <InfoRow label="Target" value={pending.database_engine === "mssql" ? pending.mssql_target : pending.database_path} />
                <InfoRow label="Password" value={pending.mssql_password_configured ? "Configured" : "Not configured"} />
                <InfoRow label="Restart" value={payload?.restart_required || saved ? "Required" : "Not required"} />
              </div>
            </section>
          </aside>
        </div>

        <ResultBox result={testResult} />

        <section className="rounded-md border border-line bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Restart Commands</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <pre className="overflow-auto rounded-md border border-line bg-slate-50 p-3 text-sm">{payload?.restart?.stop || "Stop-ScheduledTask -TaskName VibeNMS"}</pre>
            <pre className="overflow-auto rounded-md border border-line bg-slate-50 p-3 text-sm">{payload?.restart?.start || "Start-ScheduledTask -TaskName VibeNMS"}</pre>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
