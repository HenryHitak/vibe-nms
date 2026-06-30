import { useState } from "react";
import { LogIn, MonitorCog } from "lucide-react";
import { login } from "../api.js";

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = await login(username, password);
      onLogin(payload.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel p-4">
      <form className="w-full max-w-sm rounded-md border border-line bg-white p-6 shadow-sm" onSubmit={submit}>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-ink text-white">
            <MonitorCog size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink">Vibe NMS</h1>
            <p className="text-sm text-slate-500">Network Monitoring Login</p>
          </div>
        </div>
        {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-slate-600">Username</span>
          <input className="h-10 w-full rounded-md border border-line px-3" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label className="mb-5 block text-sm">
          <span className="mb-1 block text-slate-600">Password</span>
          <input className="h-10 w-full rounded-md border border-line px-3" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white disabled:opacity-60" disabled={busy}>
          <LogIn size={16} /> Login
        </button>
      </form>
    </main>
  );
}
