import { useEffect, useMemo, useState } from "react";
import { Filter, PanelRightClose, Search, ServerCrash } from "lucide-react";
import { api } from "../api.js";
import AlertBanner from "../components/AlertBanner.jsx";
import DeviceDetailModal from "../components/DeviceDetailModal.jsx";
import DeviceTable from "../components/DeviceTable.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

const DASHBOARD_REFRESH_MS = 60000;
const DASHBOARD_COLUMNS = ["status", "device", "type", "ip", "plant", "line"];

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

function dashboardStatus(device) {
  return isPingOffline(device) ? "OFFLINE" : "ONLINE";
}

function searchableEntries(device) {
  const plantName = device.plant_name || device.plant_code;
  const lineName = device.line_name || device.line_code;
  const location = [device.building, device.floor, device.area, device.zone, device.detailed_location].filter(Boolean).join(" / ");
  const switchInfo = [device.switch_name, device.switch_port].filter(Boolean).join(" / ");
  return [
    ["Device", device.device_name],
    ["Type", device.device_type],
    ["Status", dashboardStatus(device)],
    ["Raw Status", device.status],
    ["IP", device.ip_address],
    ["MAC", device.mac_address],
    ["Hostname", device.hostname],
    ["Plant", plantName],
    ["Line", lineName],
    ["Location", location],
    ["AP", device.connected_ap_name],
    ["AP IP", device.connected_ap_ip],
    ["Switch", switchInfo],
    ["VLAN", device.vlan],
    ["Owner", device.owner_department],
    ["Criticality", device.criticality],
    ["Check", device.latest_check_method],
    ["Reason", device.latest_monitoring_reason],
    ["Notes", device.notes]
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
}

function matchingEntry(device, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  return searchableEntries(device).find(([, value]) => String(value).toLowerCase().includes(needle)) || null;
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
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [offlinePanelHidden, setOfflinePanelHidden] = useState(() => localStorage.getItem("nms.dashboardOfflinePanelHidden") === "true");
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
    const timer = setInterval(load, DASHBOARD_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("nms.dashboardOfflinePanelHidden", String(offlinePanelHidden));
  }, [offlinePanelHidden]);

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

  const plantLineFilteredDevices = useMemo(
    () => devices
      .filter((device) => {
        const plantName = device.plant_name || device.plant_code;
        const lineName = device.line_name || device.line_code;
        return (!plantFilter || plantName === plantFilter) && (!lineFilter || lineName === lineFilter);
      })
      .sort(compareByLatestUpdate),
    [devices, plantFilter, lineFilter]
  );

  const filteredDevices = useMemo(
    () => {
      const query = searchQuery.trim();
      if (!query) return plantLineFilteredDevices;
      return plantLineFilteredDevices.filter((device) => matchingEntry(device, query));
    },
    [plantLineFilteredDevices, searchQuery]
  );

  const dashboardDevices = useMemo(
    () => filteredDevices.map((device) => ({ ...device, status: dashboardStatus(device) })),
    [filteredDevices]
  );

  const searchSuggestions = useMemo(
    () => {
      const query = searchInput.trim();
      if (!query) return [];
      return plantLineFilteredDevices
        .map((device) => ({ device, match: matchingEntry(device, query) }))
        .filter((item) => item.match)
        .slice(0, 8);
    },
    [plantLineFilteredDevices, searchInput]
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

  function applySearch(value = searchInput) {
    setSearchQuery(value.trim());
    setSearchSuggestionsOpen(false);
  }

  function handleSearchKeyDown(event) {
    if (event.isComposing || event.key !== "Enter") return;
    event.preventDefault();
    applySearch();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AlertBanner alerts={summary?.recent_alerts || []} />
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

        <section className="mb-4 rounded-md border border-line bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start gap-3">
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
            <div className="relative min-w-[260px] flex-1">
              <div className="flex gap-2">
                <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3">
                  <Search size={16} className="shrink-0 text-slate-500" />
                  <input
                    className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                    placeholder="Search any device information"
                    value={searchInput}
                    onChange={(event) => {
                      setSearchInput(event.target.value);
                      setSearchSuggestionsOpen(true);
                    }}
                    onFocus={() => setSearchSuggestionsOpen(Boolean(searchInput.trim()))}
                    onKeyDown={handleSearchKeyDown}
                  />
                </div>
                <button
                  className="h-10 rounded-md border border-line bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-800"
                  onClick={() => applySearch()}
                >
                  Confirm
                </button>
              </div>
              {searchInput.trim() && searchSuggestionsOpen ? (
                <div className="absolute left-0 right-0 top-11 z-20 max-h-80 overflow-auto rounded-md border border-line bg-white shadow-lg">
                  {searchSuggestions.map(({ device, match }) => {
                    const plantName = device.plant_name || device.plant_code || "-";
                    const lineName = device.line_name || device.line_code || "-";
                    return (
                      <button
                        key={device.id}
                        className="block w-full border-b border-line px-3 py-2 text-left text-sm last:border-b-0 hover:bg-cyan-50"
                        onClick={() => {
                          const nextQuery = String(match?.[1] || device.device_name || "");
                          setSearchInput(nextQuery);
                          applySearch(nextQuery);
                        }}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-ink">{device.device_name}</div>
                            <div className="truncate text-xs text-slate-500">{device.ip_address} / {plantName} / {lineName}</div>
                          </div>
                          <StatusBadge status={dashboardStatus(device)} />
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-600">
                          <span className="font-semibold">{match?.[0]}:</span> {String(match?.[1] || "-")}
                        </div>
                      </button>
                    );
                  })}
                  {!searchSuggestions.length ? (
                    <div className="px-3 py-3 text-sm text-slate-500">No matching device information</div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button className="h-10 rounded-md border border-line bg-slate-50 px-3 text-sm font-semibold text-slate-700" onClick={() => { setPlantFilter(""); setLineFilter(""); setSearchInput(""); setSearchQuery(""); setSearchSuggestionsOpen(false); }}>
              Reset
            </button>
            <div className="ml-auto text-sm text-slate-500">
              {filteredDevices.length} devices / {offlineDevices.length} offline
            </div>
          </div>
        </section>

        <div className={`grid min-h-[560px] grid-cols-1 gap-5 ${offlinePanelHidden ? "xl:grid-cols-1" : "xl:grid-cols-[minmax(0,7fr)_minmax(420px,3fr)]"}`}>
          <section className="min-h-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <h2 className="font-semibold">Devices</h2>
                {offlinePanelHidden ? (
                  <button
                    className="inline-flex h-7 items-center rounded-md border border-red-200 bg-red-50 px-2 text-xs font-semibold text-red-800 hover:bg-red-100"
                    title="Show Offline Ping"
                    onClick={() => setOfflinePanelHidden(false)}
                  >
                    Offline Ping: <span className="ml-1 tabular-nums">{offlineDevices.length}</span>
                  </button>
                ) : null}
              </div>
              <span className="text-sm text-slate-500">Latest update first</span>
            </div>
            <DeviceTable
              devices={dashboardDevices}
              selectedId={detailOpen ? detailDevice?.id : null}
              onSelect={openDeviceDetail}
              onIpDoubleClick={String(role || "").toUpperCase() === "ADMIN" ? openSourceMapForDevice : undefined}
              columns={DASHBOARD_COLUMNS}
              className="h-[calc(100vh-285px)] min-h-[560px]"
            />
          </section>

          {!offlinePanelHidden ? (
            <aside className="min-h-0 rounded-md border border-red-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-red-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <ServerCrash size={18} className="text-red-nms" />
                  <h2 className="font-semibold">Offline Ping</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800">{offlineDevices.length}</span>
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-white text-red-800 hover:bg-red-50"
                    title="Hide Offline Ping"
                    onClick={() => setOfflinePanelHidden(true)}
                  >
                    <PanelRightClose size={16} />
                  </button>
                </div>
              </div>
              <DeviceTable
                devices={offlineDevices.map((device) => ({ ...device, status: "OFFLINE" }))}
                selectedId={detailOpen ? detailDevice?.id : null}
                onSelect={openDeviceDetail}
                onIpDoubleClick={String(role || "").toUpperCase() === "ADMIN" ? openSourceMapForDevice : undefined}
                columns={DASHBOARD_COLUMNS}
                className="h-[calc(100vh-335px)] min-h-[510px] border-0"
              />
            </aside>
          ) : null}
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
