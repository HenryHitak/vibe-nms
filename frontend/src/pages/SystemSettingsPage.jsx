import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { api } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";

const KNOWN_KEYS = [
  "monitoring_interval_seconds",
  "warning_latency_ms",
  "critical_latency_ms",
  "warning_packet_loss_percent",
  "tcp_fallback_ports",
  "corporate_networks"
];

export default function SystemSettingsPage() {
  const [settings, setSettings] = useState({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      setSettings(await api("/system-settings"));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function change(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function save() {
    try {
      setSettings(await api("/system-settings", { method: "PUT", body: JSON.stringify({ settings }) }));
      setSaved(true);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <AdminLayout
      title="System Settings"
      actions={
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white" onClick={save}>
          <Save size={16} /> Save
        </button>
      }
    >
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      {saved ? <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">Saved</div> : null}
      <div className="max-w-3xl border border-line bg-white">
        {KNOWN_KEYS.map((key) => (
          <label key={key} className="grid grid-cols-1 gap-2 border-b border-line p-4 text-sm last:border-b-0 md:grid-cols-[240px_1fr]">
            <span className="font-medium text-slate-700">{key}</span>
            <input className="h-10 rounded-md border border-line px-3" value={settings[key] || ""} onChange={(event) => change(key, event.target.value)} />
          </label>
        ))}
      </div>
    </AdminLayout>
  );
}
