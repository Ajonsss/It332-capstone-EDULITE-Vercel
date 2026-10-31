import { useId, useState } from "react";
import ClassSidePanel from "./ClassSidePanel";

export default function FilterSidebar({ children, title = "Filter & sort", activeCount = 0, disabled = false, onReset }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const close = () => setOpen(false);

  return <>
    <button type="button" aria-label="Open filters and sorting" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? panelId : undefined} disabled={disabled} onClick={() => setOpen(true)}
      className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--ed-border)] bg-[var(--ed-surface)] px-3 py-2 text-sm font-semibold text-[var(--ed-text)] transition hover:bg-[var(--ed-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ed-primary)] disabled:cursor-not-allowed disabled:opacity-50">
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
        <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
        <path d="M7 3v4M13 8v4M8 13v4" strokeLinecap="round" />
      </svg>
      Filters
      {activeCount > 0 && <span aria-label={`${activeCount} active options`} className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--ed-accent-soft)] px-1 text-xs text-[var(--ed-accent-text)]">{activeCount}</span>}
    </button>
    {open && <ClassSidePanel id={panelId} title={title} compact closeLabel="Close filters and sorting" onClose={close}
      footer={<div className="flex items-center justify-between gap-3">
        {onReset && <button type="button" disabled={disabled || activeCount === 0} onClick={onReset} className="rounded-lg px-3 py-2 text-sm font-semibold text-[var(--ed-accent-text)] hover:bg-[var(--ed-subtle)] disabled:opacity-50">Reset</button>}
        <button type="button" onClick={close} className="ml-auto rounded-xl bg-[var(--ed-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)]">Done</button>
      </div>}>
      <p className="mb-6 text-sm text-[var(--ed-muted)]">Changes update the results immediately.</p>
      <fieldset disabled={disabled} className="min-w-0 space-y-5">{children}</fieldset>
    </ClassSidePanel>}
  </>;
}
