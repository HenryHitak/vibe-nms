import { useEffect } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import DeviceDetailPanel from "./DeviceDetailPanel.jsx";

export default function DeviceDetailModal({ open, device, loading, error, onClose }) {
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6"
      onMouseDown={onClose}
    >
      <section
        className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-line bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-normal text-slate-500">Device Detail</div>
            <h2 className="truncate text-lg font-semibold text-ink">{device?.device_name || "Loading device"}</h2>
          </div>
          <button
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 hover:bg-slate-50"
            title="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 bg-panel p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center rounded-md border border-line bg-white text-sm text-slate-600">
              <Loader2 className="mr-2 animate-spin" size={18} />
              Loading latest device information
            </div>
          ) : null}

          {!loading && error ? (
            <div className="flex h-full items-center justify-center rounded-md border border-red-200 bg-red-50 p-5 text-sm text-red-800">
              <AlertTriangle className="mr-2 shrink-0" size={18} />
              {error}
            </div>
          ) : null}

          {!loading && !error ? <DeviceDetailPanel device={device} /> : null}
        </div>
      </section>
    </div>
  );
}
