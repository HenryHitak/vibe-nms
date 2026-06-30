import StatusBadge from "./StatusBadge.jsx";

export default function DeviceTable({ devices = [], selectedId, onSelect, actions }) {
  return (
    <div className="table-scroll overflow-auto border border-line bg-white">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
          <tr>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Device</th>
            <th className="px-3 py-2">IP</th>
            <th className="px-3 py-2">Plant</th>
            <th className="px-3 py-2">Line</th>
            <th className="px-3 py-2">AP</th>
            <th className="px-3 py-2">Switch</th>
            <th className="px-3 py-2">Loss</th>
            {actions ? <th className="px-3 py-2 text-right">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr
              key={device.id}
              className={`border-t border-line hover:bg-slate-50 ${selectedId === device.id ? "bg-cyan-50" : ""}`}
              onClick={() => onSelect?.(device)}
            >
              <td className="px-3 py-2"><StatusBadge status={device.status} /></td>
              <td className="px-3 py-2 font-semibold text-ink">{device.device_name}</td>
              <td className="px-3 py-2 tabular-nums">{device.ip_address}</td>
              <td className="px-3 py-2">{device.plant_name || device.plant_code}</td>
              <td className="px-3 py-2">{device.line_name || device.line_code}</td>
              <td className="px-3 py-2">{device.connected_ap_name || "-"}</td>
              <td className="px-3 py-2">{[device.switch_name, device.switch_port].filter(Boolean).join(" / ") || "-"}</td>
              <td className="px-3 py-2 tabular-nums">{device.packet_loss_percent ?? "-"}</td>
              {actions ? (
                <td className="px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}>
                  {actions(device)}
                </td>
              ) : null}
            </tr>
          ))}
          {devices.length === 0 ? (
            <tr>
              <td className="px-3 py-8 text-center text-slate-500" colSpan={actions ? 9 : 8}>No devices</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
