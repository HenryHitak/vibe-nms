import { Bell } from "lucide-react";

export default function AlertBell({ count = 0 }) {
  return (
    <button className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-line bg-white text-ink shadow-sm" title="Active alerts">
      <Bell size={18} />
      {count > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-nms px-1 text-[11px] font-bold text-white">
          {count}
        </span>
      ) : null}
    </button>
  );
}

