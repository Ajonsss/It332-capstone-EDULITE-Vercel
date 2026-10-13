import { useEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import axios from "axios";

const API = "http://localhost:3000";
const fieldClass = "mt-1 w-full rounded-xl border border-[var(--ed-border)] bg-[var(--ed-surface)] px-3 py-2.5";
const outcomes = { promoted: "Promoted", graduated: "Graduated", intervention: "Further intervention" };
const grade = (value) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "Pending";

export default function YearEndView({ onFinished, onOpenInsight }) {
  const [activeYearName, setActiveYearName] = useState("Legacy / unassigned records");
  const [years, setYears] = useState([]);
  const [nextYear, setNextYear] = useState("");
  const [printReport, setPrintReport] = useState(null);
  const [reports, setReports] = useState([]);
  const [archives, setArchives] = useState([]);
  const [tab, setTab] = useState("review");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [selectedId, setSelectedId] = useState(null);
  const [archiveId, setArchiveId] = useState(null);
  const [archiveRequest, setArchiveRequest] = useState(0);
  const [archive, setArchive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [schoolYear, setSchoolYear] = useState("");
  const [outcome, setOutcome] = useState("promoted");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([axios.get(`${API}/year-end-report`), axios.get(`${API}/student-archives`), axios.get(`${API}/school-years`)])
      .then(([review, history, yearResponse]) => { if (!cancelled) { setReports(review.data); setArchives(history.data); setActiveYearName(yearResponse.data.years.find((year) => String(year._id ?? "") === String(yearResponse.data.activeId ?? ""))?.name ?? "School year"); setSchoolYear(yearResponse.data.years.find((year) => year._id && String(year._id) === String(yearResponse.data.activeId))?.name ?? ""); setYears(yearResponse.data.years.filter((year) => year._id && String(year._id) !== String(yearResponse.data.activeId))); } })
      .catch((requestError) => { if (!cancelled) setError(requestError.response?.data?.message || "Unable to load the year-end review."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!archiveId) return;
    let cancelled = false;
    axios.get(`${API}/student-archives/${archiveId}`).then((response) => { if (!cancelled) setArchive(response.data); })
      .catch((requestError) => { if (!cancelled) setError(requestError.response?.data?.message || "Unable to load this archive."); })
      .finally(() => { if (!cancelled) setArchiveLoading(false); });
    return () => { cancelled = true; };
  }, [archiveId, archiveRequest]);

  const selected = reports.find((student) => student.id === selectedId);
  const matching = (tab === "review" ? reports : archives).filter((student) => `${student.name} ${student.section} ${student.grade} ${student.schoolYear ?? ""}`.toLowerCase().includes(search.toLowerCase()) && (tab === "archives" || status === "ALL" || student.status === status));
  const finish = async (event) => {
    event.preventDefault();
    if (saving || !selected?.complete || !schoolYear.trim()) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await axios.post(`${API}/students/${selected.id}/finish`, { school_year: schoolYear.trim(), outcome, notes, ...(outcome === "promoted" ? { next_year_id: nextYear } : {}) });
      setReports((current) => current.filter((student) => student.id !== selected.id));
      setSelectedId(null);
      setMessage(`${selected.name} has been finished and archived. Open Archives to look back at their records.`);
      const [history] = await Promise.all([axios.get(`${API}/student-archives`), onFinished?.()]);
      setArchives(history.data);
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to finish the student or refresh the records. Reload before trying again."); }
    finally { setSaving(false); }
  };

  return <div className="space-y-6">
    <section className="rounded-[22px] border border-[var(--ed-border)] bg-[var(--ed-surface)] p-6">
      <h2 className="text-xl font-bold">Year-end review</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--ed-muted)]">Review all enrolled subjects across Terms 1–3. Readiness follows the active school year’s grading and promotion rules in Settings. Review these recommendations before confirming promotion or graduation.</p>
      <div className="mt-5 flex flex-wrap gap-3 text-sm">
        <span className="rounded-xl bg-[var(--ed-accent-soft)] px-4 py-3">Ready for review: {reports.filter((student) => student.status === "ready").length}</span>
        <span className="rounded-xl bg-[var(--ed-warning-soft)] px-4 py-3">Further intervention: {reports.filter((student) => student.status === "intervention").length}</span>
        <span className="rounded-xl bg-[var(--ed-subtle)] px-4 py-3">Pending results: {reports.filter((student) => student.status === "pending").length}</span>
      </div>
      <div className="mt-5 flex gap-2" role="group" aria-label="Year-end views">
        {[['review', 'Review students'], ['archives', 'Archives']].map(([value, label]) => <button key={value} type="button" disabled={saving} aria-pressed={tab === value} onClick={() => { setTab(value); setSearch(""); setError(""); }} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${tab === value ? "border-[var(--ed-primary)] bg-[var(--ed-accent-soft)] text-[var(--ed-accent-text)]" : "border-[var(--ed-border)]"}`}>{label}</button>)}
      </div>
    </section>
    {error && <p role="alert" className="rounded-xl bg-[var(--ed-danger-soft)] p-4 text-[var(--ed-danger)]">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-[var(--ed-accent-soft)] p-4">{message}</p>}
    {printReport && createPortal(<div className="year-end-print-root"><PrintableYearEnd report={printReport} /></div>, document.body)}
    {loading ? <p>Loading year-end records…</p> : <>
      <div className="flex flex-wrap gap-3">
        {tab === "review" && <button type="button" disabled={!matching.length} className="rounded-xl border border-[var(--ed-border)] px-4 py-2 text-sm" onClick={() => { flushSync(() => setPrintReport({ type: "class", students: matching, title: "Year-end class report", schoolYear: activeYearName })); window.print(); }}>Print class report / save PDF</button>}
        <input type="search" aria-label="Search year-end students" placeholder="Search name, section, grade, or school year" className={`${fieldClass} max-w-md`} value={search} onChange={(event) => setSearch(event.target.value)} />
        {tab === "review" && <select aria-label="Year-end status" className={`${fieldClass} max-w-xs`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">All recommendations</option><option value="ready">Ready for review</option><option value="intervention">Further intervention</option><option value="pending">Pending results</option></select>}
      </div>
      <section className="overflow-hidden rounded-[22px] border border-[var(--ed-border)] bg-[var(--ed-surface)]">
        {matching.map((student) => <button key={student.id} type="button" disabled={saving} aria-label={`Review ${student.name}`} onClick={() => {
          setError("");
          if (tab === "archives") { setArchive(null); setArchiveLoading(true); setArchiveId(student.id); setArchiveRequest((current) => current + 1); }
          else { setSelectedId(student.id); setOutcome(student.status === "ready" ? "promoted" : "intervention"); setNotes(""); }
        }} className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-[var(--ed-border)] p-4 text-left hover:bg-[var(--ed-hover)]">
          <span><strong>{student.name}</strong><span className="mt-1 block text-xs text-[var(--ed-muted)]">Grade {student.grade} · {student.section}{student.schoolYear && ` · ${student.schoolYear}`}</span></span>
          <span className="text-right text-sm">{tab === "review" ? student.recommendation : outcomes[student.outcome]}<span className="block text-xs text-[var(--ed-muted)]">Final average: {grade(student.finalAverage)}</span></span>
        </button>)}
        {!matching.length && <p className="p-6 text-sm text-[var(--ed-muted)]">{tab === "archives" ? "No archived students match. Finish a student after reviewing their year-end results." : "No active students match this review."}</p>}
      </section>
      {tab === "review" && selected && <section className="rounded-[22px] border border-[var(--ed-border)] bg-[var(--ed-surface)] p-6">
        <YearEndDetails student={selected} />
        <button type="button" className="mt-4 rounded-xl border border-[var(--ed-border)] px-4 py-2 text-sm" onClick={() => { flushSync(() => setPrintReport({ type: "individual", students: [selected], title: "Individual year-end report", schoolYear: activeYearName })); window.print(); }}>Print student report / save PDF</button>
        {!selected.complete ? <p className="mt-5 rounded-xl bg-[var(--ed-warning-soft)] p-4 text-sm">This student cannot be finished yet. Complete the pending assessments and year-end results first.{selected.failedSubjects.length > 0 && ` Intervention is also needed in: ${selected.failedSubjects.join(", ")}.`}</p> : <form onSubmit={finish} className="mt-6 space-y-4 border-t border-[var(--ed-border)] pt-5">
          <h3 className="text-lg font-bold">Finish this year level</h3>
          <p className="text-sm text-[var(--ed-muted)]">Finishing removes the student from active classes and saves their grades, assessment scores, and learning insights in Archives. Their current grade level is preserved.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">School year<input aria-label="Finish school year" required maxLength={40} placeholder="e.g. 2026–2027" value={schoolYear} onChange={(event) => setSchoolYear(event.target.value)} className={fieldClass} disabled={saving} /></label>
            <label className="text-sm">Teacher's decision<select aria-label="Finish outcome" className={fieldClass} value={outcome} onChange={(event) => setOutcome(event.target.value)} disabled={saving}>{selected.status === "ready" && <><option value="promoted">Promoted to the next year level</option><option value="graduated">Graduated</option></>}<option value="intervention">Further intervention needed</option></select></label>
          </div>
          {outcome === "promoted" && <label className="block text-sm">Next school year<select aria-label="Next school year" required className={fieldClass} disabled={saving} value={nextYear} onChange={(event) => setNextYear(event.target.value)}><option value="">Choose a different school year</option>{years.map((year) => <option key={year._id} value={year._id}>{year.name}</option>)}</select><span className="mt-1 block text-xs text-[var(--ed-muted)]">Create the next school year in Settings first. A fresh enrollment uses the next grade level and the current section and subjects, which you can edit in the new year.</span></label>}
          <label className="block text-sm">Teacher notes / next steps<textarea className={fieldClass} maxLength={2000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={saving} /></label>
          <button type="submit" disabled={saving} className="rounded-xl bg-[var(--ed-primary)] px-5 py-3 font-semibold text-white disabled:opacity-50">{saving ? "Archiving…" : `Finish & archive ${selected.name}`}</button>
        </form>}
      </section>}
      {tab === "archives" && archiveLoading && <p>Loading archived record…</p>}
      {tab === "archives" && archive && !archiveLoading && <section className="rounded-[22px] border border-[var(--ed-border)] bg-[var(--ed-surface)] p-6">
        <YearEndDetails student={archive} />
        <div className="mt-4 flex flex-wrap gap-3"><button type="button" className="rounded-xl border border-[var(--ed-border)] px-4 py-2 text-sm" onClick={() => { flushSync(() => setPrintReport({ type: "individual", students: [archive], title: "Archived year-end report", schoolYear: archive.schoolYear })); window.print(); }}>Print archived report / save PDF</button><button type="button" disabled={saving} className="rounded-xl border border-[var(--ed-border)] px-4 py-2 text-sm" onClick={async () => {
          if (!window.confirm("Restore this student to their original school year? Any next-year enrollment will be kept.")) return;
          setSaving(true); setError("");
          try { const response = await axios.post(`${API}/student-archives/${archiveId}/restore`); setMessage(response.data.message); setArchive(null); setArchiveId(null); const [review, history] = await Promise.all([axios.get(`${API}/year-end-report`), axios.get(`${API}/student-archives`), onFinished?.()]); setReports(review.data); setArchives(history.data); } catch (err) { setError(err.response?.data?.message || "Unable to restore the student."); } finally { setSaving(false); }
        }}>Restore student</button></div>
        <p className="mt-4 text-sm">{archive.schoolYear} · {outcomes[archive.outcome]} · Archived {new Date(archive.archivedAt).toLocaleDateString()}</p>
        {archive.notes && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-[var(--ed-subtle)] p-4 text-sm">Teacher notes: {archive.notes}</p>}
        <h3 className="mt-6 text-lg font-bold">Intervention progress at year-end</h3>
        {(archive.interventions ?? []).map((item, index) => <article key={index} className="mt-3 rounded-xl border border-[var(--ed-border)] p-4"><strong>{item.title}</strong><p className="mt-1 text-sm">{item.difficulty} · {item.status.replaceAll("_", " ")} · Baseline: {item.baselineScore ?? "Not recorded"} · Follow-up: {item.followUpScore ?? "Not recorded"}</p><p className="mt-2 whitespace-pre-wrap text-sm">{item.activities}</p>{item.notes && <p className="mt-2 text-sm text-[var(--ed-muted)]">{item.notes}</p>}</article>)}
        {!archive.interventions?.length && <p className="mt-2 text-sm text-[var(--ed-muted)]">No intervention activities were tracked for this student.</p>}
        <h3 className="mt-6 text-lg font-bold">Saved learning insights</h3>
        {(archive.insights ?? []).map((insight, index) => <details key={index} className="mt-3 rounded-xl border border-[var(--ed-border)] p-4"><summary className="cursor-pointer font-semibold">{insight.title}</summary>{onOpenInsight && <button type="button" onClick={() => onOpenInsight({ ...insight, id: insight._id, pdfUrl: `/api/gemini/insights/${insight._id}/pdf` })} className="mt-3 rounded-lg border border-[var(--ed-border)] px-3 py-2 text-sm font-semibold text-[var(--ed-accent-text)]">Open full learning insight</button>}<p className="mt-3 text-sm">{insight.result?.plan?.overview}</p>{(insight.result?.plan?.targetedInterventions ?? []).map((item, i) => <div key={i} className="mt-4 text-sm"><strong>{item.title}</strong><p>{item.rationale}</p><ul className="list-disc pl-5">{item.actions?.map((action, j) => <li key={j}>{action}</li>)}</ul>{item.practiceActivities?.map((activity, j) => <div key={j} className="mt-3"><strong>{activity.difficulty}: {activity.title}</strong><p>{activity.objective}</p><ol className="list-decimal pl-5">{activity.tasks?.map((task, k) => <li key={k}>{task}</li>)}</ol><p>Mastery: {activity.masteryCheck}</p></div>)}</div>)}{(insight.result?.plan?.enrichmentActivities ?? []).map((item, i) => <p key={i} className="mt-3 text-sm"><strong>{item.title}</strong>: {item.description}</p>)}</details>)}
        {!archive.insights?.length && <p className="mt-3 text-sm text-[var(--ed-muted)]">No learning insights were saved for this student.</p>}
      </section>}
    </>}
  </div>;
}

function YearEndDetails({ student }) {
  return <>
    <h2 className="text-xl font-bold">{student.name} · Grade {student.grade} · {student.section}</h2>
    <p className="mt-2 text-sm text-[var(--ed-muted)]">{student.recommendation}</p>
    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead><tr>{["Subject", "Term 1", "Term 2", "Term 3", "Final", "Result"].map((label) => <th key={label} className="border-b border-[var(--ed-border)] p-3">{label}</th>)}</tr></thead><tbody>{student.subjects.map((subject) => <tr key={subject.id}><td className="p-3">{subject.name}</td>{[1, 2, 3].map((term) => <td key={term} className="p-3">{grade(subject.terms[`term${term}`]?.termGrade)}</td>)}<td className="p-3">{grade(subject.final.finalGrade)}</td><td className="p-3">{subject.final.finalGrade === null ? "Pending results" : subject.final.finalGrade < (student.rules?.passingGrade ?? 75) ? "Needs intervention" : subject.final.isFullyComplete ? "Passed" : "Passed · partial scores"}</td></tr>)}</tbody></table></div>
    {student.subjects.map((subject) => <details key={subject.id} className="mt-3 rounded-xl border border-[var(--ed-border)] p-3"><summary className="cursor-pointer text-sm font-semibold">{subject.name} assessment history ({subject.assessments.length})</summary><ul className="mt-3 space-y-2 text-sm">{subject.assessments.map((assessment) => <li key={assessment.assessmentId} className="border-t border-[var(--ed-border)] pt-2"><strong>{assessment.name}</strong> · Term {assessment.term} · {assessment.score ?? "Not recorded"} / {assessment.totalItems}{assessment.budgetOfWork && <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--ed-muted)]">Budget of Work: {assessment.budgetOfWork}</p>}</li>)}</ul></details>)}
  </>;
}


function PrintableYearEnd({ report }) {
  return <article className="year-end-paper"><h1>{report.title}</h1><p>School year: {report.schoolYear}</p><p>Prepared {new Date().toLocaleDateString()} · Recommendations require teacher review.</p>{report.type === "class" ? <table><thead><tr><th>Student</th><th>Grade / section</th><th>Final average</th><th>Recommendation</th><th>Subjects needing intervention</th><th>Pending subjects</th></tr></thead><tbody>{report.students.map((student) => <tr key={student.id}><td>{student.name}</td><td>{student.grade} / {student.section}</td><td>{grade(student.finalAverage)}</td><td>{student.recommendation}</td><td>{student.failedSubjects.join(", ") || "None"}</td><td>{student.pendingSubjects.join(", ") || (student.subjects.length ? "None" : "No subjects")}</td></tr>)}</tbody></table> : report.students.map((student) => <div key={student.id}><h2>{student.name}</h2><p>Grade {student.grade} · {student.section} · {student.schoolYear ?? "Current school year"}</p><p>{student.recommendation} · Final average: {grade(student.finalAverage)}</p>{student.outcome && <p>Teacher decision: {outcomes[student.outcome]}</p>}{student.notes && <p>Teacher notes: {student.notes}</p>}<table><thead><tr><th>Subject</th><th>Term 1</th><th>Term 2</th><th>Term 3</th><th>Final</th></tr></thead><tbody>{student.subjects.map((subject) => <tr key={subject.id}><td>{subject.name}</td>{[1,2,3].map((term) => <td key={term}>{grade(subject.terms[`term${term}`]?.termGrade)}</td>)}<td>{grade(subject.final.finalGrade)}</td></tr>)}</tbody></table>{student.subjects.map((subject) => <section key={subject.id}><h3>{subject.name} assessment record</h3><table><thead><tr><th>Assessment</th><th>Term</th><th>Score / HPS</th></tr></thead><tbody>{subject.assessments.map((assessment) => <tr key={assessment.assessmentId}><td>{assessment.name}</td><td>{assessment.term}</td><td>{assessment.score ?? "Missing"} / {assessment.totalItems}</td></tr>)}</tbody></table></section>)}</div>)}</article>;
}
