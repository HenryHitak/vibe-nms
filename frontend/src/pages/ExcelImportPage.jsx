import { useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { api, downloadFile } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";

export default function ExcelImportPage() {
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [error, setError] = useState("");

  async function preview() {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      setJob(await api("/import/devices/preview", { method: "POST", body: formData }));
      setCommitResult(null);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function commit() {
    if (!job?.id) return;
    try {
      setCommitResult(await api("/import/devices/commit", { method: "POST", body: JSON.stringify({ import_job_id: job.id }) }));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  const rows = job?.rows || [];

  return (
    <AdminLayout
      title="Excel Import"
      actions={
        <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold" onClick={() => downloadFile("/import/template/devices.xlsx", "devices-template.xlsx")}>
          <Download size={16} /> Template
        </button>
      }
    >
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-line bg-white p-4">
        <FileSpreadsheet size={20} className="text-green-nms" />
        <input className="max-w-full rounded-md border border-line bg-white p-2 text-sm" type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={!file} onClick={preview}>
          <Upload size={16} /> Preview
        </button>
      </div>

      {job ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ["Rows", job.total_rows],
              ["Valid", job.valid_rows],
              ["Warnings", job.warning_rows],
              ["Errors", job.error_rows],
              ["Job", job.id]
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-line bg-white p-4">
                <div className="text-sm text-slate-500">{label}</div>
                <div className="text-2xl font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          <div className="mb-4 flex justify-end">
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={job.error_rows > 0 || commitResult} onClick={commit}>
              Commit Import
            </button>
          </div>
          {commitResult ? (
            <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
              Inserted {commitResult.inserted_rows}, updated {commitResult.updated_rows}, failed {commitResult.failed_rows}
            </div>
          ) : null}
          <div className="table-scroll overflow-auto border border-line bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Device</th>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
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
        </>
      ) : null}
    </AdminLayout>
  );
}

