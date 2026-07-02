export default function AdminLayout({ title, actions, children, contentClassName = "min-h-0 flex-1 overflow-auto pb-6 pr-1" }) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 text-xl font-semibold text-ink">{title}</h1>
        {actions ? <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
