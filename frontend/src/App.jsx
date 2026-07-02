import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BellRing,
  Database,
  Gauge,
  History,
  ListChecks,
  LogOut,
  Menu,
  MonitorCog,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Settings,
  Shield,
  UserRound,
  Wifi,
  X
} from "lucide-react";
import { api, clearSession, getStoredUser, getToken, setSession } from "./api.js";
import APClientDiscoveryPage from "./pages/APClientDiscoveryPage.jsx";
import AlertBell from "./components/AlertBell.jsx";
import AlertCenter from "./pages/AlertCenter.jsx";
import AuditLogPage from "./pages/AuditLogPage.jsx";
import BackendInfoPage from "./pages/BackendInfoPage.jsx";
import DatabaseConfigPage from "./pages/DatabaseConfigPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import DeviceAdminPage from "./pages/DeviceAdminPage.jsx";
import DisplayDashboardPage from "./pages/DisplayDashboardPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import MonitoringLogPage from "./pages/MonitoringLogPage.jsx";
import SourceMapModal from "./components/SourceMapModal.jsx";
import SystemSettingsPage from "./pages/SystemSettingsPage.jsx";
import TableColumnResizer from "./components/TableColumnResizer.jsx";
import TrafficGraphPage from "./pages/TrafficGraphPage.jsx";
import UserAdminPage from "./pages/UserAdminPage.jsx";
import { useI18n } from "./i18n.jsx";

const ADMIN_ROUTES = [
  { key: "traffic", labelKey: "routes.traffic", icon: Activity, page: TrafficGraphPage },
  { key: "ap-clients", labelKey: "routes.apClients", icon: Wifi, page: APClientDiscoveryPage },
  { key: "users", labelKey: "routes.users", icon: UserRound, page: UserAdminPage },
  { key: "devices", labelKey: "routes.devices", icon: Server, page: DeviceAdminPage },
  { key: "audit", labelKey: "routes.audit", icon: History, page: AuditLogPage },
  { key: "monitoring", labelKey: "routes.monitoring", icon: ListChecks, page: MonitoringLogPage },
  { key: "database", labelKey: "routes.database", icon: Database, page: DatabaseConfigPage },
  { key: "backend", labelKey: "routes.backend", icon: Server, page: BackendInfoPage },
  { key: "settings", labelKey: "routes.settings", icon: Settings, page: SystemSettingsPage }
];

const PRIMARY_ROUTE_KEYS = ["dashboard", "alerts"];
const USER_ROUTE_KEYS = ["dashboard", "alerts"];
const ADMIN_ROUTE_KEYS = ADMIN_ROUTES.map((item) => item.key);
const MENU_ORDER_STORAGE_KEY = "nms.menuOrder";

function routeFromHash() {
  return window.location.hash.replace(/^#/, "") || "dashboard";
}

function normalizeRole(value) {
  const role = String(value || "USER").toUpperCase();
  return role === "VIEWER" ? "USER" : role;
}

function loadMenuOrder() {
  try {
    const payload = JSON.parse(localStorage.getItem(MENU_ORDER_STORAGE_KEY) || "{}");
    return {
      primary: Array.isArray(payload.primary) ? payload.primary : [],
      admin: Array.isArray(payload.admin) ? payload.admin : []
    };
  } catch {
    return { primary: [], admin: [] };
  }
}

function orderedByPreference(items, preferredKeys) {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const ordered = preferredKeys
    .map((key) => byKey.get(key))
    .filter(Boolean);
  const missing = items.filter((item) => !preferredKeys.includes(item.key));
  return [...ordered, ...missing];
}

function AuthenticatedApp() {
  const { t } = useI18n();
  const [route, setRoute] = useState(routeFromHash);
  const [user, setUser] = useState(getStoredUser());
  const [summary, setSummary] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sourceMapTarget, setSourceMapTarget] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("nms.sidebarCollapsed") === "true");
  const [menuOrder, setMenuOrder] = useState(loadMenuOrder);
  const [draggedMenu, setDraggedMenu] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const role = normalizeRole(user?.role);

  const { primaryRoutes, adminRoutes, routes } = useMemo(() => {
    const allPrimary = [
      { key: "dashboard", labelKey: "routes.dashboard", icon: Gauge, page: DashboardPage },
      { key: "alerts", labelKey: "routes.alerts", icon: BellRing, page: AlertCenter }
    ].map((item) => ({ ...item, label: t(item.labelKey) }));
    const allowedPrimaryKeys = role === "ADMIN" ? PRIMARY_ROUTE_KEYS : USER_ROUTE_KEYS;
    const primary = allPrimary.filter((item) => allowedPrimaryKeys.includes(item.key));
    const admin = ADMIN_ROUTES.map((item) => ({ ...item, label: t(item.labelKey) }));
    const orderedPrimary = orderedByPreference(primary, menuOrder.primary);
    const orderedAdmin = role === "ADMIN" ? orderedByPreference(admin, menuOrder.admin) : [];
    return {
      primaryRoutes: orderedPrimary,
      adminRoutes: orderedAdmin,
      routes: [...orderedPrimary, ...orderedAdmin]
    };
  }, [menuOrder, role, t]);

  const ActivePage = (routes.find((item) => item.key === route) || routes[0]).page;

  useEffect(() => {
    if (!routes.some((item) => item.key === route)) {
      setRoute("dashboard");
      return;
    }
    if (role !== "ADMIN" && ADMIN_ROUTES.some((item) => item.key === route)) {
      setRoute("dashboard");
    }
  }, [role, route, routes]);

  useEffect(() => {
    function handleHashChange() {
      setRoute(routeFromHash());
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (window.location.hash.replace(/^#/, "") !== route) {
      window.location.hash = route;
    }
  }, [route]);

  useEffect(() => {
    async function loadMe() {
      if (!getToken()) return;
      try {
        const payload = await api("/auth/me");
        if (payload.user) {
          setSession({ token: getToken(), user: payload.user });
          setUser(payload.user);
        }
      } catch {
        setUser(null);
      }
    }
    loadMe();
  }, []);

  useEffect(() => {
    if (!user) return;
    async function loadSummary() {
      try {
        const [summaryPayload, notificationPayload] = await Promise.all([
          api("/dashboard/summary"),
          api("/notifications?unread_only=true")
        ]);
        setSummary(summaryPayload);
        setNotifications(notificationPayload);
        setToasts(notificationPayload.slice(0, 3));
      } catch {
        setSummary(null);
      }
    }
    loadSummary();
    const timer = setInterval(loadSummary, 5000);
    return () => clearInterval(timer);
  }, [user]);

  useEffect(() => {
    localStorage.setItem("nms.sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem(MENU_ORDER_STORAGE_KEY, JSON.stringify(menuOrder));
  }, [menuOrder]);

  function logout() {
    clearSession();
    setUser(null);
    setRoute("dashboard");
  }

  function openSourceMap(target = {}) {
    if (role !== "ADMIN") return;
    setSourceMapTarget(target);
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  async function dismissToast(id) {
    try {
      await api(`/notifications/${id}/read`, { method: "POST" });
    } finally {
      setNotifications((current) => current.filter((notification) => notification.id !== id));
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }
  }

  function reorderMenuItem(group, draggedKey, targetKey, position) {
    if (!draggedKey || !targetKey || draggedKey === targetKey) return;
    const currentRoutes = group === "admin" ? adminRoutes : primaryRoutes;
    const allowedKeys = group === "admin" ? ADMIN_ROUTE_KEYS : PRIMARY_ROUTE_KEYS;
    const currentKeys = currentRoutes.map((item) => item.key);
    if (!currentKeys.includes(draggedKey) || !currentKeys.includes(targetKey)) return;

    const nextKeys = currentKeys.filter((key) => key !== draggedKey);
    const targetIndex = nextKeys.indexOf(targetKey);
    const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
    nextKeys.splice(insertIndex, 0, draggedKey);

    setMenuOrder((current) => ({
      ...current,
      [group]: nextKeys.filter((key) => allowedKeys.includes(key))
    }));
  }

  function navButton(item, group) {
    const Icon = item.icon;
    const active = route === item.key;
    const isDragging = draggedMenu?.group === group && draggedMenu?.key === item.key;
    const isDropTarget = dropTarget?.group === group && dropTarget?.key === item.key;
    return (
      <button
        key={item.key}
        draggable
        className={`flex h-10 w-full cursor-grab items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors active:cursor-grabbing ${sidebarCollapsed ? "justify-center px-0" : ""} ${active ? "bg-ink text-white" : "text-slate-700 hover:bg-slate-100"} ${isDragging ? "opacity-50" : ""} ${isDropTarget ? "ring-2 ring-cyan-500 ring-offset-1" : ""}`}
        title={item.label}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.key);
          setDraggedMenu({ group, key: item.key });
        }}
        onDragOver={(event) => {
          if (draggedMenu?.group !== group || draggedMenu?.key === item.key) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const position = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
          event.dataTransfer.dropEffect = "move";
          setDropTarget({ group, key: item.key, position });
        }}
        onDragLeave={() => {
          setDropTarget((current) => (current?.key === item.key && current?.group === group ? null : current));
        }}
        onDrop={(event) => {
          event.preventDefault();
          const draggedKey = draggedMenu?.key || event.dataTransfer.getData("text/plain");
          reorderMenuItem(group, draggedKey, item.key, dropTarget?.position || "before");
          setDraggedMenu(null);
          setDropTarget(null);
        }}
        onDragEnd={() => {
          setDraggedMenu(null);
          setDropTarget(null);
        }}
        onClick={() => {
          setRoute(item.key);
          setMobileOpen(false);
        }}
      >
        <Icon size={18} />
        {!sidebarCollapsed ? <span className="truncate">{item.label}</span> : null}
      </button>
    );
  }

  return (
    <div className="flex h-screen min-h-0 bg-slate-100 text-ink">
      <aside className={`${mobileOpen ? "fixed inset-y-0 left-0 z-40 block w-72" : "hidden"} border-r border-line bg-white p-4 shadow-sm transition-[width] duration-200 md:block ${sidebarCollapsed ? "md:w-20" : "md:w-72"} overflow-y-auto`}>
        <div className={`mb-6 flex items-center ${sidebarCollapsed ? "justify-center" : "gap-3"}`}>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-ink text-white">
            <MonitorCog size={22} />
          </div>
          {!sidebarCollapsed ? <div>
            <div className="font-semibold">Vibe NMS</div>
            <div className="text-xs text-slate-500">{t("app.subtitle")}</div>
          </div> : null}
        </div>
        <button
          className={`mb-4 hidden h-9 w-full items-center rounded-md border border-line bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 md:flex ${sidebarCollapsed ? "justify-center px-0" : "justify-between"}`}
          onClick={() => setSidebarCollapsed((value) => !value)}
          title={sidebarCollapsed ? t("app.expandMenu") : t("app.collapseMenu")}
        >
          {!sidebarCollapsed ? <span>{t("app.menu")}</span> : null}
          {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <nav className="space-y-1">
          {primaryRoutes.map((item) => navButton(item, "primary"))}
        </nav>
        {role === "ADMIN" ? (
          <>
            <div className={`mb-2 mt-6 flex items-center gap-2 px-3 text-xs font-semibold uppercase text-slate-500 ${sidebarCollapsed ? "justify-center px-0" : ""}`}>
              <Shield size={14} /> {!sidebarCollapsed ? t("app.admin") : null}
            </div>
            <nav className="space-y-1">
              {adminRoutes.map((item) => navButton(item, "admin"))}
            </nav>
          </>
        ) : null}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col p-3 md:p-5">
        <header className="mb-4 flex h-16 shrink-0 items-center justify-between rounded-md border border-line bg-white px-4 shadow-sm md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line md:hidden" onClick={() => setMobileOpen((value) => !value)}>
              <Menu size={18} />
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm text-slate-500">{t("app.operationsConsole")}</div>
              <div className="truncate text-lg font-semibold">{routes.find((item) => item.key === route)?.label || t("routes.dashboard")}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-right text-sm md:block">
              <div className="font-semibold text-ink">{user.display_name || user.username}</div>
              <button
                className="text-right text-xs font-semibold text-slate-500 hover:text-cyan-700"
                title="Double-click to open Source Map"
                onDoubleClick={() => openSourceMap({})}
              >
                {role} / {user.last_login_ip || "IP -"}
              </button>
            </div>
            <AlertBell
              count={notifications.length}
              notifications={notifications}
              onDismiss={dismissToast}
              onViewAlerts={() => setRoute("alerts")}
            />
            <button className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line bg-white" title={t("app.logout")} onClick={logout}>
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ActivePage role={role} onOpenSourceMap={openSourceMap} />
        </div>
      </main>
      <div className="fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-32px))] space-y-2">
        {toasts.map((toast) => (
          <div key={toast.id} className="rounded-md border border-line bg-white p-3 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-ink">{toast.title}</div>
                <div className="mt-1 text-sm text-slate-600">{toast.message}</div>
              </div>
              <button className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line" title={t("common.dismiss")} onClick={() => dismissToast(toast.id)}>
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <SourceMapModal
        open={sourceMapTarget !== null}
        target={sourceMapTarget}
        onClose={() => setSourceMapTarget(null)}
      />
    </div>
  );
}

export default function App() {
  if (window.location.pathname.startsWith("/display")) {
    return (
      <>
        <TableColumnResizer />
        <DisplayDashboardPage />
      </>
    );
  }

  return (
    <>
      <TableColumnResizer />
      <AuthenticatedApp />
    </>
  );
}
