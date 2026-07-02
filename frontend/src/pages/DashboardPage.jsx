import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Filter, ServerCrash } from "lucide-react";
import { api } from "../api.js";
import AlertBanner from "../components/AlertBanner.jsx";
import DeviceDetailModal from "../components/DeviceDetailModal.jsx";
import DeviceTable from "../components/DeviceTable.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatTijuanaDateTime } from "../time.js";

function updateStamp(device) {
  return device.latest_checked_at || device.updated_at || device.created_at || "";
}

function compareByLatestUpdate(a, b) {
  const byTime = String(updateStamp(b)).localeCompare(String(updateStamp(a)));
  if (byTime !== 0) return byTime;
  return String(a.device_name || "").localeCompare(String(b.device_name || ""));
}

function isPingOffline(device) {
  const status = String(device.status || "UNKNOWN").toUpperCase();
  return status === "OFFLINE" || status === "CRITICAL" || Number(device.packet_loss_percent || 0) >= 100;
}

function lossText(value) {
  return value === null || value === undefined || value === "" ? "-" : `${value}%`;
}

function DeviceTypeBadge({ type }) {
  return (
    <span className="inline-flex max-w-[110px] items-center rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase leading-5 text-slate-700">
      <span className="truncate">{type || "-"}</span>
    </span>
  );
}

export default function DashboardPage({ role, onOpenSourceMap }) {
  const [summary, setSummary] = useState(null);
  const [devices, setDevices] = useState([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailDevice, setDetailDevice] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [plantFilter, setPlantFilter] = useState("");
  const [lineFilter, setLineFilter] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [summaryPayload, devicesPayload] = await Promise.all([
        api("/dashboard/summary"),
        api("/devices")
      ]);
      setSummary(summaryPayload);
      setDevices(devicesPayload);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  const plantOptions = useMemo(
    () => [...new Set(devices.map((device) => device.plant_name || device.plant_code).filter(Boolean))].sort(),
    [devices]
  );

  const lineOptions = useMemo(
    () => [...new Set(devices
      .filter((device) => !plantFilter || (device.plant_name || device.plant_code) === plantFilter)
      .map((device) => device.line_name || device.line_code)
      .filter(Boolean))].sort(),
    [devices, plantFilter]
  );

  const filteredDevices = useMemo(
    () => devices
      .filter((device) => {
        const plantName = device.plant_name || device.plant_code;
        const lineName = device.line_name || device.line_code;
        return (!plantFilter || plantName === plantFilter) && (!lineFilter || lineName === lineFilter);
      })
      .sort(compareByLatestUpdate),
    [devices, plantFilter, lineFilter]
  );

  const offlineDevices = useMemo(
    () => filteredDevices.filter(isPingOffline),
    [filteredDevices]
  );

  useEffect(() => {
    if (lineFilter && !lineOptions.includes(lineFilter)) {
      setLineFilter("");
    }
  }, [lineFilter, lineOptions]);

  async function openDeviceDetail(device) {
    setDetailOpen(true);
    setDetailDevice(device);
    setDetailLoading(true);
    setDetailError("");
    try {
      const latestDevice = await api(`/devices/${device.id}`);
      setDetailDevice(latestDevice);
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDeviceDetail() {
    setDetailOpen(false);
    setDetailError("");
  }

  function openSourceMapForDevice(device) {
    if (String(role || "").toUpperCase() !== "ADMIN") return;
    onOpenSourceMap?.({ device_id: device.id, ip_address: device.ip_address });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AlertBanner alerts={summary?.recent_alerts || []} />
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

        <section className="mb-4 rounded-md border border-line bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Filter size={16} className="text-slate-500" /> Filter
            </div>
            <select className="h-10 min-w-40 rounded-md border border-line bg-white px-3 text-sm" value={plantFilter} onChange={(event) => setPlantFilter(event.target.value)}>
              <option value="">All Plants</option>
              {plantOptions.map((plant) => <option key={plant} value={plant}>{plant}</option>)}
            </select>
            <select className="h-10 min-w-40 rounded-md border border-line bg-white px-3 text-sm" value={lineFilter} onChange={(event) => setLineFilter(event.target.value)}>
              <option value="">All Lines</option>
              {lineOptions.map((line) => <option key={line} value={line}>{line}</option>)}
            </select>
            <button className="h-10 rounded-md border border-line bg-slate-50 px-3 text-sm font-semibold text-slate-700" onClick={() => { setPlantFilter(""); setLineFilter(""); }}>
              Reset
            </button>
            <div className="ml-auto text-sm text-slate-500">
              {filteredDevices.length} devices / {offlineDevices.length} offline
            </div>
          </div>
        </section>

        <div className="grid min-h-[560px] grid-cols-1 gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]">
          <section className="min-h-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold">Devices</h2>
              <span className="text-sm text-slate-500">Latest update first</span>
            </div>
            <DeviceTable
              devices={filteredDevices}
              selectedId={detailOpen ? detailDevice?.id : null}
              onSelect={openDeviceDetail}
              onIpDoubleClick={String(role || "").toUpperCase() === "ADMIN" ? openSourceMapForDevice : undefined}
              className="h-[calc(100vh-285px)] min-h-[560px]"
            />
          </section>

          <aside className="min-h-0 rounded-md border border-red-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-red-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <ServerCrash size={18} className="text-red-nms" />
                <h2 className="font-semibold">Offline Ping</h2>
              </div>
              <span className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800">{offlineDevices.length}</span>
            </div>
            <div className="table-scroll h-[calc(100vh-285px)] min-h-[560px] space-y-3 overflow-auto p-3">
              {offlineDevices.map((device) => {
                const plantName = device.plant_name || device.plant_code || "-";
                const lineName = device.line_name || device.line_code || "-";
                return (
                  <button
                    key={device.id}
                    className={`w-full rounded-md border p-3 text-left transition-colors hover:bg-red-50 ${detailOpen && detailDevice?.id === device.id ? "border-red-400 bg-red-50" : "border-red-200 bg-white"}`}
                    onClick={() => openDeviceDetail(device)}
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ink">{device.device_name}</div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                          <DeviceTypeBadge type={device.device_type} />
                          <span
                            className="truncate text-xs tabular-nums text-slate-500 hover:text-cyan-700 hover:underline"
                            title={String(role || "").toUpperCase() === "ADMIN" ? "Double-click to open Source Map" : undefined}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              openSourceMapForDevice(device);
                            }}
                          >
                            {device.ip_address}
                          </span>
                        </div>
                      </div>
                      <StatusBadge status={device.status} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded border border-red-100 bg-red-50 px-2 py-1">
                        <div className="font-semibold text-red-800">Loss</div>
                        <div className="tabular-nums text-red-900">{lossText(device.packet_loss_percent)}</div>
                      </div>
                      <div className="rounded border border-line bg-slate-50 px-2 py-1">
                        <div className="font-semibold text-slate-600">Failures</div>
                        <div className="tabular-nums text-ink">{device.consecutive_failure_count ?? "-"}</div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                      <div className="text-slate-500">Plant</div>
                      <div className="truncate font-semibold text-ink">{plantName}</div>
                      <div className="text-slate-500">Line</div>
                      <div className="truncate font-semibold text-ink">{lineName}</div>
                      <div className="text-slate-500">Check</div>
                      <div className="truncate font-semibold text-ink">{device.latest_check_method || "-"}</div>
                      <div className="text-slate-500">Updated</div>
                      <div className="truncate font-semibold text-ink">{formatTijuanaDateTime(updateStamp(device))}</div>
                    </div>
                    {device.latest_monitoring_reason ? (
                      <div className="mt-2 flex items-start gap-1.5 rounded border border-red-100 bg-red-50 px-2 py-1.5 text-xs text-red-900">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{device.latest_monitoring_reason}</span>
                      </div>
                    ) : null}
                  </button>
                );
              })}
              {!offlineDevices.length ? (
                <div className="rounded-md border border-line bg-slate-50 p-4 text-sm text-slate-500">No offline ping devices</div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
      <DeviceDetailModal
        open={detailOpen}
        device={detailDevice}
        loading={detailLoading}
        error={detailError}
        onClose={closeDeviceDetail}
      />
    </div>
  );
}
