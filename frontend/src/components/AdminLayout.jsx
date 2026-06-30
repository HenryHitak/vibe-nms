export default function AdminLayout({ title, actions, children }) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

