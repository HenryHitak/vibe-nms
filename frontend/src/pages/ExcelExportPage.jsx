import { useState } from "react";
import { Archive, Database, Download, FileSpreadsheet } from "lucide-react";
import { downloadFile } from "../api.js";
import AdminLayout from "../components/AdminLayout.jsx";

const EXPORTS = [
  { label: "Devices", path: "/export/devices.xlsx", file: "devices.xlsx", icon: FileSpreadsheet },
  { label: "Plants", path: "/export/plants.xlsx", file: "plants.xlsx", icon: FileSpreadsheet },
  { label: "Access Points", path: "/export/access-points.xlsx", file: "access-points.xlsx", icon: FileSpreadsheet },
  { label: "Audit Logs", path: "/export/audit-logs.xlsx", file: "audit-logs.xlsx", icon: FileSpreadsheet },
  { label: "Full Backup", path: "/export/full-backup.zip", file: "full-backup.zip", icon: Archive },
  { label: "Migration JSON", path: "/export/migration.json", file: "migration.json", icon: Database }
];

export default function ExcelExportPage() {
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");

  async function download(item) {
    try {
      setDownloading(item.label);
      await downloadFile(item.path, item.file);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading("");
    }
  }

  return (
    <AdminLayout title="Excel Export">
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {EXPORTS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              className="flex min-h-28 items-center justify-between rounded-md border border-line bg-white p-4 text-left hover:bg-slate-50"
              onClick={() => download(item)}
            >
              <div className="flex items-center gap-3">
                <Icon size={22} className="text-slate-600" />
                <div>
                  <div className="font-semibold text-ink">{item.label}</div>
                  <div className="text-sm text-slate-500">{item.file}</div>
                </div>
              </div>
              <Download size={18} className="text-slate-500" />
            </button>
          );
        })}
      </div>
      {downloading ? <div className="mt-4 text-sm text-slate-600">Downloading {downloading}</div> : null}
    </AdminLayout>
  );
}

