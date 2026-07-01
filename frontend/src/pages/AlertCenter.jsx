import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, CheckCheck, CircleCheckBig, X } from "lucide-react";
import { api } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";
import { formatTijuanaDateTime } from "../time.js";

function Severity({ value }) {
  const classes =
    value === "CRITICAL"
      ? "bg-red-900 text-white"
      : value === "WARNING"
        ? "bg-amber-100 text-amber-900"
        : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex h-6 min-w-20 items-center justify-center rounded px-2 text-xs font-semibold ${classes}`}>{value || "-"}</span>;
}

function StatusBadge({ value }) {
  const classes =
    value === "ACTIVE"
      ? "border-red-200 bg-red-50 text-red-800"
      : value === "ACKNOWLEDGED"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-emerald-200 bg-emerald-50 text-emerald-800";
  return <span className={`inline-flex h-6 items-center rounded border px-2 text-xs font-semibold ${classes}`}>{value || "-"}</span>;
}

function TypeBadge({ value, muted }) {
  return (
    <span className={`inline-flex h-6 items-center rounded px-2 text-xs font-semibold ${muted ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-700"}`}>
      {value || "UNKNOWN"}
    </span>
  );
}

export default function AlertCenter({ role = "USER" }) {
  const [alerts, setAlerts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [mutes, setMutes] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const muteMap = useMemo(() => {
    return Object.fromEntries(mutes.map((mute) => [mute.alert_type, Boolean(mute.muted)]));
  }, [mutes]);

  async function load() {
    try {
      const query = status ? `?status=${status}` : "";
      const [alertPayload, notificationPayload, mutePayload] = await Promise.all([
        api(`/alerts${query}`),
        api("/notifications?unread_only=false"),
        api("/notification-mutes")
      ]);
      setAlerts(alertPayload);
      setNotifications(notificationPayload);
      setMutes(mutePayload);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  async function handleAlert(id, name) {
    try {
      await api(`/alerts/${id}/${name}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function markRead(id) {
    try {
      await api(`/notifications/${id}/read`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function setMute(alertType, muted) {
    try {
      await api(`/notification-mutes/${encodeURIComponent(alertType || "UNKNOWN")}`, {
        method: "POST",
        body: JSON.stringify({ muted })
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function muteButton(alertType) {
    if (!alertType) {
      return null;
    }
    const muted = muteMap[alertType];
    return (
      <button
        className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold ${
          muted ? "border-slate-300 bg-slate-100 text-slate-700" : "border-line bg-white text-slate-700 hover:bg-slate-50"
        }`}
        title={muted ? "Receive new notifications for this alert type" : "Stop new notifications for this alert type"}
        onClick={() => setMute(alertType, !muted)}
      >
        {muted ? <Bell size={14} /> : <BellOff size={14} />}
        {muted ? "Unmute" : "Mute"}
      </button>
    );
  }

  return (
    <AdminLayout
      title="Alert Center"
      actions={
        <select className="h-10 rounded-md border border-line bg-white px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All Alerts</option>
          <option value="ACTIVE">Active</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      }
    >
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

      <div className="mb-4 rounded-md border border-line bg-white p-4 text-sm text-slate-700 shadow-sm">
        <div className="font-semibold text-ink">Alert handling guide</div>
        <div className="mt-1">`Mark Reviewed` means an ADMIN has checked the alert but the issue is still open. `Close Alert` resolves that alert. `Mute` stops new dashboard notifications for that alert type, but does not disable alert creation.</div>
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
        <section className="min-w-0 border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="font-semibold text-ink">Alert List</h2>
              <div className="text-xs text-slate-500">{alerts.length} items</div>
            </div>
          </div>
          <div className="table-scroll max-h-[calc(100vh-250px)] overflow-auto">
            <table className="min-w-[1100px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Device</th>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2">Last Detected</th>
                  <th className="px-3 py-2 text-right">Handling</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id} className="border-t border-line">
                    <td className="px-3 py-2"><Severity value={alert.severity} /></td>
                    <td className="px-3 py-2"><StatusBadge value={alert.status} /></td>
                    <td className="px-3 py-2"><TypeBadge value={alert.alert_type} muted={muteMap[alert.alert_type]} /></td>
                    <td className="px-3 py-2 font-semibold">{alert.device_name || "-"}</td>
                    <td className="px-3 py-2 tabular-nums">{alert.ip_address || "-"}</td>
                    <td className="max-w-[360px] px-3 py-2 text-slate-700">{alert.message}</td>
                    <td className="px-3 py-2 tabular-nums">{formatTijuanaDateTime(alert.last_detected_at)}</td>
                    <td className="px-3 py-2 text-right">
                      {role === "ADMIN" ? (
                        <div className="inline-flex flex-wrap justify-end gap-2">
                          {alert.status === "ACTIVE" ? (
                            <button
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            title="Mark reviewed but keep the alert open"
                            onClick={() => handleAlert(alert.id, "acknowledge")}
                          >
                            <CheckCheck size={14} /> Mark Reviewed
                          </button>
                        ) : null}
                        {alert.status !== "RESOLVED" ? (
                          <button
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            title="Close this alert"
                            onClick={() => handleAlert(alert.id, "resolve")}
                          >
                            <CircleCheckBig size={14} /> Close Alert
                          </button>
                        ) : (
                            <span className="inline-flex h-8 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-semibold text-emerald-800">Closed</span>
                          )}
                          {muteButton(alert.alert_type)}
                        </div>
                      ) : (
                        <span className="text-slate-400">Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
                {alerts.length === 0 ? (
                  <tr><td className="px-3 py-8 text-center text-slate-500" colSpan="8">No alerts</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="min-w-0 border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="font-semibold text-ink">Notification List</h2>
              <div className="text-xs text-slate-500">{notifications.filter((item) => !item.read_at).length} unread / {notifications.length} recent</div>
            </div>
          </div>
          <div className="max-h-[calc(100vh-250px)] overflow-auto">
            {notifications.map((notification) => {
              const muted = muteMap[notification.alert_type];
              return (
                <div key={notification.id} className={`border-b border-line px-4 py-3 last:border-b-0 ${notification.read_at ? "bg-white" : "bg-red-50/40"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <TypeBadge value={notification.alert_type} muted={muted} />
                        {notification.severity ? <Severity value={notification.severity} /> : null}
                        {muted ? <span className="text-xs font-semibold text-slate-500">MUTED</span> : null}
                      </div>
                      <div className="mt-2 font-semibold text-ink">{notification.title}</div>
                      <div className="mt-1 text-sm text-slate-600">{notification.message}</div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{formatTijuanaDateTime(notification.created_at)}</span>
                        <span>{notification.device_name || "-"}</span>
                        <span>{notification.ip_address || "-"}</span>
                      </div>
                      {role === "ADMIN" && notification.alert_type ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {muteButton(notification.alert_type)}
                          {!notification.read_at ? (
                            <button
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              title="Mark notification as read"
                              onClick={() => markRead(notification.id)}
                            >
                              <X size={14} /> Mark Read
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">No notifications</div>
            ) : null}
          </div>
        </aside>
      </div>
    </AdminLayout>
  );
}
