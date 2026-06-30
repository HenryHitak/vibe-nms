import { useEffect, useRef, useState } from "react";
import { Bell, ExternalLink, X } from "lucide-react";
import { formatTijuanaDateTime } from "../time.js";

export default function AlertBell({ count = 0, notifications = [], onDismiss, onViewAlerts }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function viewAlerts() {
    setOpen(false);
    onViewAlerts?.();
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-line bg-white text-ink shadow-sm hover:bg-slate-50"
        title="Notifications"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-nms px-1 text-[11px] font-bold text-white">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-50 w-[min(380px,calc(100vw-32px))] overflow-hidden rounded-md border border-line bg-white text-left shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="font-semibold text-ink">Notifications</div>
              <div className="text-xs text-slate-500">{notifications.length} unread</div>
            </div>
            <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white hover:bg-slate-50" title="Alert Center" onClick={viewAlerts}>
              <ExternalLink size={15} />
            </button>
          </div>

          <div className="max-h-80 overflow-auto">
            {notifications.length ? notifications.map((notification) => (
              <div key={notification.id} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{notification.title}</div>
                    <div className="mt-1 text-sm text-slate-600">{notification.message}</div>
                    <div className="mt-2 text-xs text-slate-500">{formatTijuanaDateTime(notification.created_at)}</div>
                  </div>
                  <button
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-slate-50"
                    title="Mark as read"
                    onClick={() => onDismiss?.(notification.id)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )) : (
              <div className="px-4 py-8 text-center text-sm text-slate-500">No unread notifications</div>
            )}
          </div>

          <button
            className="flex h-10 w-full items-center justify-center gap-2 border-t border-line bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-white"
            onClick={viewAlerts}
          >
            Open Alert Center <ExternalLink size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
