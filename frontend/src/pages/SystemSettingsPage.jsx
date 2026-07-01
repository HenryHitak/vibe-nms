import { useEffect, useState } from "react";
import { Bell, BellOff, Save } from "lucide-react";
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

const ALERT_SETTINGS = [
  {
    key: "alert_network_warning_enabled",
    label: "Network warning",
    description: "Ping failure before OFFLINE, warning latency, or warning state alerts."
  },
  {
    key: "alert_network_offline_enabled",
    label: "Network offline / critical",
    description: "OFFLINE and CRITICAL ping status alerts."
  },
  {
    key: "alert_network_packet_loss_enabled",
    label: "Packet loss",
    description: "Alerts when packet loss is above the configured warning threshold."
  },
  {
    key: "alert_network_latency_enabled",
    label: "Latency",
    description: "Alerts when ping latency is above warning or critical thresholds."
  },
  {
    key: "alert_network_flapping_enabled",
    label: "Flapping",
    description: "Alerts when a device repeatedly changes between up and down states."
  },
  {
    key: "alert_ap_unknown_client_enabled",
    label: "AP unknown client",
    description: "Alerts for wireless clients not registered in Device Master."
  },
  {
    key: "alert_ap_wrong_ap_enabled",
    label: "AP wrong connection",
    description: "Alerts when a known client appears on a different AP than expected."
  },
  {
    key: "alert_ap_duplicate_ip_enabled",
    label: "AP duplicate IP",
    description: "Alerts when AP discovery sees duplicate client IP addresses."
  },
  {
    key: "alert_ap_critical_missing_enabled",
    label: "AP critical missing",
    description: "Alerts when a critical expected wireless device is missing."
  },
  {
    key: "alert_ap_client_count_drop_enabled",
    label: "AP client count drop",
    description: "Alerts when an AP client count drops sharply."
  }
];

function enabled(value) {
  return String(value ?? "true").toLowerCase() !== "false";
}

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

  function toggleAlert(key) {
    setSettings((current) => ({ ...current, [key]: enabled(current[key]) ? "false" : "true" }));
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 rounded-md border border-line bg-white shadow-sm">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-semibold">Alarm Settings</h2>
            <div className="text-sm text-slate-500">Turn alert creation on or off by alarm type. Disabled types resolve active alerts during the next collector cycle.</div>
          </div>
          <div className="grid gap-3 p-4 2xl:grid-cols-2">
            {ALERT_SETTINGS.map((item) => {
              const isEnabled = enabled(settings[item.key]);
              return (
                <div key={item.key} className="min-w-0 rounded-md border border-line bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        {isEnabled ? <Bell size={16} className="shrink-0 text-green-nms" /> : <BellOff size={16} className="shrink-0 text-slate-500" />}
                        <span className="truncate">{item.label}</span>
                      </div>
                      <div className="mt-1 text-sm leading-5 text-slate-500">{item.description}</div>
                    </div>
                    <button
                      className={`h-8 shrink-0 rounded-md border px-3 text-xs font-semibold ${isEnabled ? "border-green-300 bg-green-50 text-green-800" : "border-slate-300 bg-slate-100 text-slate-600"}`}
                      onClick={() => toggleAlert(item.key)}
                    >
                      {isEnabled ? "ON" : "OFF"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="min-w-0 rounded-md border border-line bg-white shadow-sm">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-semibold">Monitoring Settings</h2>
          </div>
          {KNOWN_KEYS.map((key) => (
            <label key={key} className="block border-b border-line p-4 text-sm last:border-b-0">
              <span className="mb-1 block break-words font-medium text-slate-700">{key}</span>
              <input className="h-10 w-full rounded-md border border-line px-3" value={settings[key] || ""} onChange={(event) => change(key, event.target.value)} />
            </label>
          ))}
        </section>
      </div>
    </AdminLayout>
  );
}
