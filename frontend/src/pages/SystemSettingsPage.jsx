import { useEffect, useState } from "react";
import { Bell, BellOff, Save } from "lucide-react";
import { api } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";
import { SUPPORTED_LANGUAGES, useI18n } from "../i18n.jsx";

const KNOWN_KEYS = [
  "monitoring_interval_seconds",
  "warning_latency_ms",
  "critical_latency_ms",
  "warning_packet_loss_percent",
  "tcp_fallback_ports",
  "corporate_networks"
];

const MONITORING_INTERVAL_OPTIONS = [30, 40, 50, 60, 70, 80, 90];

const ALERT_SETTINGS = [
  {
    key: "alert_network_warning_enabled",
    labelKey: "alerts.networkWarning",
    descriptionKey: "alerts.networkWarningDescription"
  },
  {
    key: "alert_network_offline_enabled",
    labelKey: "alerts.networkOffline",
    descriptionKey: "alerts.networkOfflineDescription"
  },
  {
    key: "alert_network_packet_loss_enabled",
    labelKey: "alerts.packetLoss",
    descriptionKey: "alerts.packetLossDescription"
  },
  {
    key: "alert_network_latency_enabled",
    labelKey: "alerts.latency",
    descriptionKey: "alerts.latencyDescription"
  },
  {
    key: "alert_network_flapping_enabled",
    labelKey: "alerts.flapping",
    descriptionKey: "alerts.flappingDescription"
  },
  {
    key: "alert_ap_unknown_client_enabled",
    labelKey: "alerts.apUnknownClient",
    descriptionKey: "alerts.apUnknownClientDescription"
  },
  {
    key: "alert_ap_wrong_ap_enabled",
    labelKey: "alerts.apWrongConnection",
    descriptionKey: "alerts.apWrongConnectionDescription"
  },
  {
    key: "alert_ap_duplicate_ip_enabled",
    labelKey: "alerts.apDuplicateIp",
    descriptionKey: "alerts.apDuplicateIpDescription"
  },
  {
    key: "alert_ap_critical_missing_enabled",
    labelKey: "alerts.apCriticalMissing",
    descriptionKey: "alerts.apCriticalMissingDescription"
  },
  {
    key: "alert_ap_client_count_drop_enabled",
    labelKey: "alerts.apClientCountDrop",
    descriptionKey: "alerts.apClientCountDropDescription"
  }
];

function enabled(value) {
  return String(value ?? "true").toLowerCase() !== "false";
}

export default function SystemSettingsPage() {
  const { language, setLanguage, t } = useI18n();
  const [settings, setSettings] = useState({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

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

  async function toggleAlert(key) {
    const next = { ...settings, [key]: enabled(settings[key]) ? "false" : "true" };
    setSettings(next);
    setSaved(false);
    setSaving(true);
    try {
      setSettings(await api("/system-settings", { method: "PUT", body: JSON.stringify({ settings: next }) }));
      setSaved(true);
      setError("");
    } catch (err) {
      setError(err.message);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      setSettings(await api("/system-settings", { method: "PUT", body: JSON.stringify({ settings }) }));
      setSaved(true);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout
      title={t("settings.title")}
      actions={
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={saving} onClick={save}>
          <Save size={16} /> {saving ? t("common.saving") : t("common.save")}
        </button>
      }
    >
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      {saved ? <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">{t("common.saved")}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 rounded-md border border-line bg-white shadow-sm xl:col-span-2">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-semibold">{t("settings.languageTitle")}</h2>
            <div className="text-sm text-slate-500">{t("settings.languageDescription")}</div>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-[minmax(240px,360px)_1fr]">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">{t("settings.uiLanguage")}</span>
              <select
                className="h-10 w-full rounded-md border border-line bg-white px-3"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {SUPPORTED_LANGUAGES.map((item) => (
                  <option key={item.code} value={item.code}>{item.label}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end text-sm text-slate-500">{t("settings.languageHelp")}</div>
          </div>
        </section>

        <section className="min-w-0 rounded-md border border-line bg-white shadow-sm">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-semibold">{t("settings.alarmTitle")}</h2>
            <div className="text-sm text-slate-500">{t("settings.alarmDescription")}</div>
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
                        <span className="truncate">{t(item.labelKey)}</span>
                      </div>
                      <div className="mt-1 text-sm leading-5 text-slate-500">{t(item.descriptionKey)}</div>
                    </div>
                    <button
                      className={`h-8 shrink-0 rounded-md border px-3 text-xs font-semibold disabled:opacity-50 ${isEnabled ? "border-green-300 bg-green-50 text-green-800" : "border-slate-300 bg-slate-100 text-slate-600"}`}
                      disabled={saving}
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
            <h2 className="font-semibold">{t("settings.monitoringTitle")}</h2>
          </div>
          {KNOWN_KEYS.map((key) => (
            <label key={key} className="block border-b border-line p-4 text-sm last:border-b-0">
              <span className="mb-1 block break-words font-medium text-slate-700">{key}</span>
              {key === "monitoring_interval_seconds" ? (
                <select
                  className="h-10 w-full rounded-md border border-line bg-white px-3"
                  value={settings[key] || "60"}
                  onChange={(event) => change(key, event.target.value)}
                >
                  {MONITORING_INTERVAL_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>{seconds} seconds</option>
                  ))}
                </select>
              ) : (
                <input className="h-10 w-full rounded-md border border-line px-3" value={settings[key] || ""} onChange={(event) => change(key, event.target.value)} />
              )}
            </label>
          ))}
        </section>
      </div>
    </AdminLayout>
  );
}
