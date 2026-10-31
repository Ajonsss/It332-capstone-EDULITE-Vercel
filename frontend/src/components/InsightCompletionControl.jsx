import { useState } from "react";

export default function InsightCompletionControl({ insight, onFinish }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (insight?.supportType !== "intervention") return null;
  const completed = insight.status === "completed";
  const finish = async () => {
    if (busy || completed || !window.confirm("Mark this intervention as finished? It will be kept as a closed recommendation.")) return;
    setBusy(true); setError("");
    try { await onFinish(insight); }
    catch (err) { setError(err.response?.data?.message || "Unable to finish the intervention. Please try again."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2">
    <p role="status" className="text-sm font-semibold text-[var(--ed-accent-text)]">
      {completed ? "Closed · Intervention finished" : "Open intervention"}
      {completed && insight.completedAt && <span className="mt-1 block text-xs font-normal text-[var(--ed-muted)]">Finished {new Date(insight.completedAt).toLocaleDateString()}</span>}
    </p>
    {!completed && <button type="button" aria-label={`Finish intervention ${insight.title || "Saved Recommendation"}`} disabled={busy} onClick={finish}
      className="rounded-xl border border-[var(--ed-primary)] px-3 py-2 text-sm font-semibold text-[var(--ed-accent-text)] disabled:opacity-50">
      {busy ? "Saving..." : "Intervention finished"}
    </button>}
    {error && <p role="alert" className="text-sm text-[var(--ed-danger)]">{error}</p>}
  </div>;
}
