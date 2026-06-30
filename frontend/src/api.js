const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export function getToken() {
  return localStorage.getItem("nms.token") || "";
}

export function setSession({ token, user }) {
  localStorage.setItem("nms.token", token);
  localStorage.setItem("nms.user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("nms.token");
  localStorage.removeItem("nms.user");
  localStorage.removeItem("nms.role");
  localStorage.removeItem("nms.username");
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("nms.user") || "null");
  } catch {
    return null;
  }
}

export function getActorHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function humanizeField(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatErrorDetail(detail) {
  if (!detail) {
    return "";
  }
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        const location = Array.isArray(item?.loc) ? item.loc.filter((part) => part !== "body").pop() : "";
        const field = location ? `${humanizeField(location)}: ` : "";
        return `${field}${item?.msg || JSON.stringify(item)}`;
      })
      .join(" ");
  }
  return detail.message || detail.msg || JSON.stringify(detail);
}

export async function api(path, options = {}) {
  const headers = {
    ...getActorHeaders(),
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {})
  };
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
    }
    const message = formatErrorDetail(payload?.detail || payload) || `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function login(username, password) {
  const payload = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  setSession(payload);
  return payload;
}

export function downloadUrl(path) {
  return `${API_BASE}${path}`;
}

export async function downloadFile(path, filename) {
  const response = await fetch(downloadUrl(path), { headers: getActorHeaders() });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Download failed: ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
