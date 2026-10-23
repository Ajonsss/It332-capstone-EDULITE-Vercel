import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export default function ClassSidePanel({ title, busy = false, onClose, children }) {
  const panelRef = useRef(null), closeRef = useRef({ busy, onClose });
  const titleId = useId();
  useEffect(() => { closeRef.current = { busy, onClose }; }, [busy, onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement, previousOverflow = document.body.style.overflow;
    const siblings = [...document.body.children].filter((element) => !element.contains(panelRef.current));
    const previousInert = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    document.body.style.overflow = "hidden";
    panelRef.current.querySelector("[data-close-panel]")?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); if (!closeRef.current.busy) closeRef.current.onClose(); }
      if (event.key !== "Tab") return;
      const focusable = [...panelRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')]
        .filter((element) => !element.closest("[hidden]"));
      const first = focusable[0], last = focusable.at(-1);
      if (!first) { event.preventDefault(); panelRef.current.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      siblings.forEach((element, index) => { element.inert = previousInert[index]; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(<div className="fixed inset-0 z-[100] flex justify-end bg-black/35 backdrop-blur-[2px]" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} className="flex h-dvh w-full max-w-2xl flex-col border-l border-[var(--ed-border)] bg-[var(--ed-surface)] shadow-2xl outline-none">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--ed-border)] px-5 py-5 sm:px-7">
        <h2 id={titleId} className="text-xl font-bold">{title}</h2>
        <button data-close-panel type="button" aria-label="Close class panel" disabled={busy} onClick={onClose} className="rounded-xl border border-[var(--ed-border)] px-3 py-2 text-sm disabled:opacity-50">Close</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-7">{children}</div>
    </section>
  </div>, document.body);
}
