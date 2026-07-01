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
import SystemSettingsPage from "./pages/SystemSettingsPage.jsx";
import TrafficGraphPage from "./pages/TrafficGraphPage.jsx";
import UserAdminPage from "./pages/UserAdminPage.jsx";

const ADMIN_ROUTES = [
  { key: "users", label: "User Accounts", icon: UserRound, page: UserAdminPage },
  { key: "devices", label: "Device Master", icon: Server, page: DeviceAdminPage },
  { key: "audit", label: "Audit Logs", icon: History, page: AuditLogPage },
  { key: "monitoring", label: "Monitoring Logs", icon: ListChecks, page: MonitoringLogPage },
  { key: "database", label: "DB Config", icon: Database, page: DatabaseConfigPage },
  { key: "backend", label: "Backend Info", icon: Server, page: BackendInfoPage },
  { key: "settings", label: "Settings", icon: Settings, page: SystemSettingsPage }
];

function routeFromHash() {
  return window.location.hash.replace(/^#/, "") || "dashboard";
}

function normalizeRole(value) {
  const role = String(value || "USER").toUpperCase();
  return role === "VIEWER" ? "USER" : role;
}

function AuthenticatedApp() {
  const [route, setRoute] = useState(routeFromHash);
  const [user, setUser] = useState(getStoredUser());
  const [summary, setSummary] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("nms.sidebarCollapsed") === "true");
  const role = normalizeRole(user?.role);

  const routes = useMemo(() => {
    const base = [
      { key: "dashboard", label: "Dashboard", icon: Gauge, page: DashboardPage },
      { key: "traffic", label: "Traffic Graphs", icon: Activity, page: TrafficGraphPage },
      { key: "alerts", label: "Alert Center", icon: BellRing, page: AlertCenter },
      { key: "ap-clients", label: "AP Clients", icon: Wifi, page: APClientDiscoveryPage }
    ];
    return role === "ADMIN" ? [...base, ...ADMIN_ROUTES] : base;
  }, [role]);

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

  function logout() {
    clearSession();
    setUser(null);
    setRoute("dashboard");
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

  function navButton(item) {
    const Icon = item.icon;
    const active = route === item.key;
    return (
      <button
        key={item.key}
        className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors ${sidebarCollapsed ? "justify-center px-0" : ""} ${active ? "bg-ink text-white" : "text-slate-700 hover:bg-slate-100"}`}
        title={item.label}
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
            <div className="text-xs text-slate-500">Internal Network Monitoring</div>
          </div> : null}
        </div>
        <button
          className={`mb-4 hidden h-9 w-full items-center rounded-md border border-line bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 md:flex ${sidebarCollapsed ? "justify-center px-0" : "justify-between"}`}
          onClick={() => setSidebarCollapsed((value) => !value)}
          title={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
        >
          {!sidebarCollapsed ? <span>Menu</span> : null}
          {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <nav className="space-y-1">
          {routes.slice(0, 4).map(navButton)}
        </nav>
        {role === "ADMIN" ? (
          <>
            <div className={`mb-2 mt-6 flex items-center gap-2 px-3 text-xs font-semibold uppercase text-slate-500 ${sidebarCollapsed ? "justify-center px-0" : ""}`}>
              <Shield size={14} /> {!sidebarCollapsed ? "Admin" : null}
            </div>
            <nav className="space-y-1">
              {ADMIN_ROUTES.map(navButton)}
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
              <div className="truncate text-sm text-slate-500">Operations Console</div>
              <div className="truncate text-lg font-semibold">{routes.find((item) => item.key === route)?.label || "Dashboard"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-right text-sm md:block">
              <div className="font-semibold text-ink">{user.display_name || user.username}</div>
              <div className="text-xs font-semibold text-slate-500">{role} / {user.last_login_ip || "IP -"}</div>
            </div>
            <AlertBell
              count={notifications.length}
              notifications={notifications}
              onDismiss={dismissToast}
              onViewAlerts={() => setRoute("alerts")}
            />
            <button className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line bg-white" title="Logout" onClick={logout}>
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ActivePage role={role} />
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
              <button className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line" title="Dismiss" onClick={() => dismissToast(toast.id)}>
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  if (window.location.pathname.startsWith("/display")) {
    return <DisplayDashboardPage />;
  }

  return <AuthenticatedApp />;
}
