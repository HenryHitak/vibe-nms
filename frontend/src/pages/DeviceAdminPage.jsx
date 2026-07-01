import { useEffect, useRef, useState } from "react";
import { Download, FileDown, FileUp, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { api, downloadFile } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";
import DeviceTable from "../components/DeviceTable.jsx";

const EMPTY_DEVICE = {
  plant_name: "",
  building: "",
  floor: "",
  area: "",
  zone: "",
  line_name: "",
  detailed_location: "",
  device_name: "",
  device_type: "OTHER",
  ip_address: "",
  mac_address: "",
  hostname: "",
  connected_ap_name: "",
  connected_ap_ip: "",
  ap_vendor: "",
  ap_controller_type: "",
  ap_controller_id: "",
  switch_name: "",
  switch_port: "",
  vlan: "",
  owner_department: "",
  criticality: "MEDIUM",
  monitoring_enabled: true,
  notes: ""
};

const DEVICE_TYPES = [
  "AP",
  "SWITCH",
  "ROUTER",
  "FIREWALL",
  "CONTROLLER",
  "SERVER",
  "NAS",
  "UPS",
  "WORKSTATION",
  "PC",
  "LAPTOP",
  "MOBILE",
  "TABLET",
  "PLC",
  "HMI",
  "ROBOT",
  "SCANNER",
  "CAMERA",
  "PRINTER",
  "SENSOR",
  "IOT",
  "OTHER"
];

const WIRELESS_CLIENT_TYPES = new Set(["WORKSTATION", "PC", "LAPTOP", "MOBILE", "TABLET", "IOT", "HMI", "PLC", "ROBOT", "SCANNER", "CAMERA", "PRINTER", "SENSOR"]);
const SWITCH_PORT_TYPES = new Set(["AP", "WORKSTATION", "PC", "LAPTOP", "PLC", "HMI", "ROBOT", "SCANNER", "CAMERA", "PRINTER", "SENSOR", "IOT", "SERVER", "NAS", "UPS"]);

function Field({ label, name, value, onChange, type = "text", hint }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-600">{label}</span>
      <input
        className="h-10 w-full rounded-md border border-line bg-white px-3"
        name={name}
        type={type}
        value={value ?? ""}
        onChange={onChange}
      />
      {hint ? <span className="mt-1 block text-xs leading-4 text-slate-500">{hint}</span> : null}
    </label>
  );
}

function FormSection({ title, children }) {
  return (
    <section className="rounded-md border border-line bg-slate-50 p-3">
      <div className="mb-3 text-xs font-semibold uppercase text-slate-500">{title}</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-1">{children}</div>
    </section>
  );
}

function normalizedType(value) {
  return String(value || "OTHER").toUpperCase();
}

export default function DeviceAdminPage({ onOpenSourceMap }) {
  const [devices, setDevices] = useState([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_DEVICE);
  const [importJob, setImportJob] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileInputRef = useRef(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const params = new URLSearchParams();
      if (includeDeleted) params.set("include_deleted", "true");
      if (query) params.set("q", query);
      setDevices(await api(`/devices?${params.toString()}`));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [includeDeleted]);

  function startCreate() {
    setEditing(null);
    setForm(EMPTY_DEVICE);
  }

  function startEdit(device) {
    setEditing(device);
    setForm({ ...EMPTY_DEVICE, ...device, monitoring_enabled: Boolean(device.monitoring_enabled) });
  }

  function updateForm(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  async function save() {
    try {
      const deviceType = normalizedType(form.device_type);
      const payload = {
        ...form,
        plant_code: form.plant_name,
        line_code: form.line_name,
        vlan: form.vlan === "" || form.vlan == null ? null : Number(form.vlan),
        device_type: deviceType,
        monitoring_enabled: Boolean(form.monitoring_enabled)
      };
      const supportsWireless = deviceType !== "AP" && WIRELESS_CLIENT_TYPES.has(deviceType);
      const supportsSwitch = SWITCH_PORT_TYPES.has(deviceType);
      if (deviceType === "AP") {
        payload.connected_ap_name = null;
        payload.connected_ap_ip = null;
      } else {
        payload.ap_vendor = null;
        payload.ap_controller_type = null;
        payload.ap_controller_id = null;
      }
      if (!supportsWireless) {
        payload.connected_ap_name = null;
        payload.connected_ap_ip = null;
      }
      if (!supportsSwitch) {
        payload.switch_name = null;
        payload.switch_port = null;
      }
      if (editing?.id) {
        await api(`/devices/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/devices", { method: "POST", body: JSON.stringify(payload) });
      }
      await load();
      startCreate();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(device) {
    try {
      await api(`/devices/${device.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function restore(device) {
    try {
      await api(`/devices/${device.id}/restore`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function previewImport(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      setImportBusy(true);
      setImportJob(await api("/import/devices/preview", { method: "POST", body: formData }));
      setCommitResult(null);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function commitImport() {
    if (!importJob?.id) return;
    try {
      setImportBusy(true);
      const result = await api("/import/devices/commit", { method: "POST", body: JSON.stringify({ import_job_id: importJob.id }) });
      setCommitResult(result);
      await load();
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setImportBusy(false);
    }
  }

  async function exportDevices() {
    try {
      await downloadFile("/export/devices.xlsx", "devices.xlsx");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function downloadTemplate() {
    try {
      await downloadFile("/import/template/devices.xlsx", "devices-template.xlsx");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  const deviceType = normalizedType(form.device_type);
  const isAp = deviceType === "AP";
  const showWirelessFields = !isAp && WIRELESS_CLIENT_TYPES.has(deviceType);
  const showSwitchFields = SWITCH_PORT_TYPES.has(deviceType);

  return (
    <AdminLayout
      title="Device Master"
      actions={
        <>
          <input className="h-10 rounded-md border border-line bg-white px-3 text-sm" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && load()} />
          <label className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm">
            <input type="checkbox" checked={includeDeleted} onChange={(event) => setIncludeDeleted(event.target.checked)} />
            Deleted
          </label>
          <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold" onClick={downloadTemplate}>
            <Download size={16} /> Template
          </button>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept=".xlsx"
            onChange={(event) => previewImport(event.target.files?.[0])}
          />
          <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold disabled:opacity-50" disabled={importBusy} onClick={() => fileInputRef.current?.click()}>
            <FileUp size={16} /> Excel Import
          </button>
          <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold" onClick={exportDevices}>
            <FileDown size={16} /> Excel Export
          </button>
          <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white" onClick={startCreate}>
            <Plus size={16} /> Add
          </button>
        </>
      }
    >
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      {importJob ? (
        <section className="mb-4 rounded-md border border-line bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Excel Import Preview</h2>
              <div className="text-sm text-slate-500">Job {importJob.id} / {importJob.total_rows} rows</div>
            </div>
            <div className="flex items-center gap-2">
              <button className="h-9 rounded-md border border-line bg-white px-3 text-sm font-semibold" onClick={() => { setImportJob(null); setCommitResult(null); }}>
                Close
              </button>
              <button className="h-9 rounded-md bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={importBusy || importJob.error_rows > 0 || commitResult} onClick={commitImport}>
                Commit Import
              </button>
            </div>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ["Rows", importJob.total_rows],
              ["Valid", importJob.valid_rows],
              ["Warnings", importJob.warning_rows],
              ["Errors", importJob.error_rows],
              ["Job", importJob.id]
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-line bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
                <div className="text-xl font-semibold tabular-nums text-ink">{value}</div>
              </div>
            ))}
          </div>
          {commitResult ? (
            <div className="mb-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
              Inserted {commitResult.inserted_rows}, updated {commitResult.updated_rows}, failed {commitResult.failed_rows}
            </div>
          ) : null}
          <div className="table-scroll max-h-72 overflow-auto border border-line">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Device</th>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {(importJob.rows || []).map((row) => (
                  <tr key={row.row_number} className="border-t border-line">
                    <td className="px-3 py-2 tabular-nums">{row.row_number}</td>
                    <td className="px-3 py-2">{row.validation_status}</td>
                    <td className="px-3 py-2 font-semibold">{row.row_data.device_name || "-"}</td>
                    <td className="px-3 py-2 tabular-nums">{row.row_data.ip_address || "-"}</td>
                    <td className="px-3 py-2">{row.validation_message || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <div className="grid h-full min-h-[650px] grid-cols-1 gap-4 xl:grid-cols-[1fr_440px]">
        <DeviceTable
          devices={devices}
          onSelect={startEdit}
          onIpDoubleClick={(device) => onOpenSourceMap?.({ device_id: device.id, ip_address: device.ip_address })}
          selectedId={editing?.id}
          actions={(device) => (
            <div className="inline-flex gap-2">
              <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white" title="Edit" onClick={() => startEdit(device)}>
                <Pencil size={14} />
              </button>
              {device.is_deleted ? (
                <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white" title="Restore" onClick={() => restore(device)}>
                  <RotateCcw size={14} />
                </button>
              ) : (
                <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-red-700" title="Delete" onClick={() => remove(device)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        />

        <aside className="overflow-auto border border-line bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">{editing?.id ? "Edit Device" : "Add Device"}</h2>
            <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white" title="Clear" onClick={startCreate}>
              <X size={15} />
            </button>
          </div>
          <div className="mb-4 rounded-md border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900">
            Enter only confirmed information. Optional fields can stay blank. The form changes by Device Type so AP, PC/Laptop, Mobile/Tablet, PLC, Switch, and Server records do not ask for unrelated fields.
          </div>
          <div className="space-y-4">
            <FormSection title="Required identity">
              <Field label="Plant Name" name="plant_name" value={form.plant_name} onChange={updateForm} />
              <Field label="Line Name" name="line_name" value={form.line_name} onChange={updateForm} />
              <Field label="Device Name" name="device_name" value={form.device_name} onChange={updateForm} />
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Device Type</span>
                <select className="h-10 w-full rounded-md border border-line bg-white px-3" name="device_type" value={form.device_type} onChange={updateForm}>
                  {DEVICE_TYPES.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <Field
                label={isAp ? "AP Management IP" : "Device IP Address"}
                name="ip_address"
                value={form.ip_address}
                onChange={updateForm}
                hint={isAp ? "This is the AP's own management IP. Do not enter Connected AP IP for an AP." : "This is the device's own IP address."}
              />
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Criticality</span>
                <select className="h-10 w-full rounded-md border border-line bg-white px-3" name="criticality" value={form.criticality} onChange={updateForm}>
                  {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="monitoring_enabled" checked={Boolean(form.monitoring_enabled)} onChange={updateForm} />
                Monitoring enabled
              </label>
            </FormSection>

            <FormSection title="Known identity">
              <Field label="MAC Address" name="mac_address" value={form.mac_address} onChange={updateForm} hint="Optional. Useful for AP client matching and duplicate detection." />
              <Field label="Hostname" name="hostname" value={form.hostname} onChange={updateForm} />
              <Field label="VLAN" name="vlan" value={form.vlan ?? ""} onChange={updateForm} type="number" />
              <Field label="Owner Department" name="owner_department" value={form.owner_department} onChange={updateForm} />
            </FormSection>

            {isAp ? (
              <FormSection title="AP controller details">
                <Field label="AP Vendor" name="ap_vendor" value={form.ap_vendor} onChange={updateForm} hint="Example: Cisco, Meraki, Aruba, UniFi." />
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">AP Controller Type</span>
                  <select className="h-10 w-full rounded-md border border-line bg-white px-3" name="ap_controller_type" value={form.ap_controller_type || ""} onChange={updateForm}>
                    <option value="">Not configured</option>
                    {["cisco-wlc", "meraki-api", "aruba-central-api", "unifi-api", "generic-snmp", "generic-api", "demo"].map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <Field label="AP Controller ID" name="ap_controller_id" value={form.ap_controller_id} onChange={updateForm} />
              </FormSection>
            ) : null}

            {showWirelessFields ? (
              <FormSection title="Expected wireless AP">
                <Field label="Expected AP Name" name="connected_ap_name" value={form.connected_ap_name} onChange={updateForm} hint="Only enter this if the expected AP is confirmed." />
                <Field label="Expected AP IP" name="connected_ap_ip" value={form.connected_ap_ip} onChange={updateForm} hint="Optional. Used to detect wrong AP connections." />
              </FormSection>
            ) : null}

            {showSwitchFields ? (
              <FormSection title="Switch connection">
                <Field label="Switch Name" name="switch_name" value={form.switch_name} onChange={updateForm} />
                <Field label="Switch Port" name="switch_port" value={form.switch_port} onChange={updateForm} />
              </FormSection>
            ) : null}

            <FormSection title="Location and notes">
              <Field label="Building" name="building" value={form.building} onChange={updateForm} />
              <Field label="Floor" name="floor" value={form.floor} onChange={updateForm} />
              <Field label="Area" name="area" value={form.area} onChange={updateForm} />
              <Field label="Zone" name="zone" value={form.zone} onChange={updateForm} />
              <Field label="Detailed Location" name="detailed_location" value={form.detailed_location} onChange={updateForm} />
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Notes</span>
                <textarea className="min-h-20 w-full rounded-md border border-line bg-white px-3 py-2" name="notes" value={form.notes || ""} onChange={updateForm} />
              </label>
            </FormSection>
            <button className="mt-2 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white" onClick={save}>
              <Save size={16} /> Save
            </button>
          </div>
        </aside>
      </div>
    </AdminLayout>
  );
}
