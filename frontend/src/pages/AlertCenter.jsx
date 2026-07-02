import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";
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

function TypeBadge({ value, muted }) {
  return (
    <span className={`inline-flex h-6 items-center rounded px-2 text-xs font-semibold ${muted ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-700"}`}>
      {value || "UNKNOWN"}
    </span>
  );
}

export default function AlertCenter({ role = "USER" }) {
  const isAdmin = String(role || "").toUpperCase() === "ADMIN";
  const [notifications, setNotifications] = useState([]);
  const [mutes, setMutes] = useState([]);
  const [error, setError] = useState("");

  const muteMap = useMemo(() => {
    return Object.fromEntries(mutes.map((mute) => [mute.alert_type, Boolean(mute.muted)]));
  }, [mutes]);

  async function load() {
    try {
      const notificationPayload = await api("/notifications?unread_only=false");
      setNotifications(notificationPayload);
      if (isAdmin) {
        const mutePayload = await api("/notification-mutes");
        setMutes(mutePayload);
      } else {
        setMutes([]);
      }
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [isAdmin]);

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

  function NotificationList({ adminActions = false, className = "" }) {
    return (
      <aside className={className}>
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
                    {adminActions && notification.alert_type ? (
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
    );
  }

  return (
    <AdminLayout title="Notification List">
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <NotificationList adminActions={isAdmin} className="min-w-0 border border-line bg-white" />
    </AdminLayout>
  );
}
