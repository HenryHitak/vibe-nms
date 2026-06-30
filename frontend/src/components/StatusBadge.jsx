const STATUS_CLASS = {
  ONLINE: "bg-green-100 text-green-800 border-green-300",
  WARNING: "bg-amber-100 text-amber-900 border-amber-300",
  UNCERTAIN: "bg-amber-100 text-amber-900 border-amber-300",
  FLAPPING: "bg-amber-100 text-amber-900 border-amber-300",
  OFFLINE: "bg-red-100 text-red-800 border-red-300",
  CRITICAL: "bg-red-900 text-white border-red-900",
  UNKNOWN: "bg-slate-100 text-slate-700 border-slate-300",
  DISABLED: "bg-slate-100 text-slate-700 border-slate-300"
};

export default function StatusBadge({ status }) {
  const value = status || "UNKNOWN";
  return (
    <span className={`inline-flex h-6 min-w-20 items-center justify-center rounded border px-2 text-xs font-semibold ${STATUS_CLASS[value] || STATUS_CLASS.UNKNOWN}`}>
      {value}
    </span>
  );
}

