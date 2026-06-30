import { useEffect, useState } from "react";
import { KeyRound, Plus, Save, Trash2, UserRound } from "lucide-react";
import { api } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";

const EMPTY_USER = {
  username: "",
  password: "",
  display_name: "",
  email: "",
  role: "USER",
  is_active: true
};

export default function UserAdminPage() {
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_USER);
  const [resetPassword, setResetPassword] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setUsers(await api("/users"));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startCreate() {
    setSelected(null);
    setForm(EMPTY_USER);
    setResetPassword("");
  }

  function startEdit(user) {
    setSelected(user);
    setForm({ ...EMPTY_USER, ...user, password: "" });
    setResetPassword("");
  }

  function change(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  async function save() {
    try {
      if (selected?.id) {
        await api(`/users/${selected.id}`, {
          method: "PUT",
          body: JSON.stringify({
            display_name: form.display_name,
            email: form.email,
            role: form.role,
            is_active: form.is_active
          })
        });
      } else {
        await api("/users", { method: "POST", body: JSON.stringify(form) });
      }
      await load();
      startCreate();
    } catch (err) {
      setError(err.message);
    }
  }

  async function reset() {
    if (!selected?.id || !resetPassword) return;
    try {
      await api(`/users/${selected.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: resetPassword })
      });
      setResetPassword("");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function disable(user) {
    try {
      await api(`/users/${user.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <AdminLayout
      title="User Accounts"
      actions={
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white" onClick={startCreate}>
          <Plus size={16} /> Add User
        </button>
      }
    >
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="grid min-h-[620px] grid-cols-1 gap-4 xl:grid-cols-[1fr_420px]">
        <div className="table-scroll overflow-auto border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last Login</th>
                <th className="px-3 py-2">Last IP</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className={`border-t border-line ${selected?.id === user.id ? "bg-cyan-50" : ""}`} onClick={() => startEdit(user)}>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{user.username}</div>
                    <div className="text-xs text-slate-500">{user.display_name || user.email || "-"}</div>
                  </td>
                  <td className="px-3 py-2 font-semibold">{user.role}</td>
                  <td className="px-3 py-2">{user.is_active ? "ACTIVE" : "DISABLED"}</td>
                  <td className="px-3 py-2 tabular-nums">{user.last_login_at || "-"}</td>
                  <td className="px-3 py-2 tabular-nums">{user.last_login_ip || "-"}</td>
                  <td className="px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}>
                    <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-red-700" title="Disable" onClick={() => disable(user)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="border border-line bg-white p-4">
          <div className="mb-4 flex items-center gap-2">
            <UserRound size={18} className="text-slate-500" />
            <h2 className="font-semibold">{selected?.id ? "Edit User" : "Add User"}</h2>
          </div>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-slate-600">Username</span>
              <input className="h-10 w-full rounded-md border border-line px-3 disabled:bg-slate-100" name="username" value={form.username || ""} disabled={Boolean(selected?.id)} onChange={change} />
            </label>
            {!selected?.id ? (
              <label className="block">
                <span className="mb-1 block text-slate-600">Initial Password</span>
                <input className="h-10 w-full rounded-md border border-line px-3" name="password" type="password" value={form.password || ""} onChange={change} />
              </label>
            ) : null}
            <label className="block">
              <span className="mb-1 block text-slate-600">Display Name</span>
              <input className="h-10 w-full rounded-md border border-line px-3" name="display_name" value={form.display_name || ""} onChange={change} />
            </label>
            <label className="block">
              <span className="mb-1 block text-slate-600">Email</span>
              <input className="h-10 w-full rounded-md border border-line px-3" name="email" value={form.email || ""} onChange={change} />
            </label>
            <label className="block">
              <span className="mb-1 block text-slate-600">Role</span>
              <select className="h-10 w-full rounded-md border border-line bg-white px-3 font-semibold" name="role" value={form.role || "USER"} onChange={change}>
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" name="is_active" checked={Boolean(form.is_active)} onChange={change} />
              Active
            </label>
            {selected?.id ? (
              <div className="grid grid-cols-2 gap-2 rounded-md border border-line bg-slate-50 p-3 text-xs text-slate-600">
                <div>
                  <div className="font-semibold text-slate-700">Last Login</div>
                  <div className="mt-1 tabular-nums">{selected.last_login_at || "-"}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-700">Last IP</div>
                  <div className="mt-1 tabular-nums">{selected.last_login_ip || "-"}</div>
                </div>
              </div>
            ) : null}
            <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white" onClick={save}>
              <Save size={16} /> Save
            </button>
          </div>

          {selected?.id ? (
            <div className="mt-6 border-t border-line pt-4">
              <div className="mb-3 flex items-center gap-2 font-semibold">
                <KeyRound size={17} className="text-slate-500" /> Reset Password
              </div>
              <div className="flex gap-2">
                <input className="h-10 min-w-0 flex-1 rounded-md border border-line px-3 text-sm" type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} />
                <button className="h-10 rounded-md border border-line bg-white px-3 text-sm font-semibold" onClick={reset}>Reset</button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </AdminLayout>
  );
}
