import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { createPortal } from "react-dom";
import { AWARD_TYPES, buildAwardCandidates } from "../utils/awards";

const fieldClass = "mt-2 w-full rounded-xl border border-[var(--ed-border)] bg-[var(--ed-surface)] px-3 py-2.5 text-[var(--ed-text)]";
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const number = (value) => value === null ? "—" : value.toFixed(2);

export default function AwardsView({ students, sections, subjects, gradeSummaries, persistHistory = false }) {
  const [section, setSection] = useState("ALL");
  const [subjectId, setSubjectId] = useState("ALL");
  const [term, setTerm] = useState("1");
  const [awardType, setAwardType] = useState("excellence");
  const [minimum, setMinimum] = useState("90");
  const [school, setSchool] = useState("");
  const [schoolYear, setSchoolYear] = useState("");
  const [title, setTitle] = useState("Academic Excellence");
  const [signatory, setSignatory] = useState("");
  const [role, setRole] = useState("Class Adviser");
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!persistHistory) return;
    let mounted = true;
    axios.get("http://localhost:3000/award-history").then((response) => { if (mounted) setHistory(response.data); }).catch(() => { if (mounted) setError("Unable to load award history."); });
    return () => { mounted = false; };
  }, [persistHistory]);
  const candidates = useMemo(() => buildAwardCandidates(students, gradeSummaries, { section, subjectId, term, awardType, minimum }), [students, gradeSummaries, section, subjectId, term, awardType, minimum]);
  const eligible = candidates.filter((student) => student.eligible);
  const recipients = eligible.filter((student) => selected.includes(student.id));
  const scope = subjectId === "ALL" ? "all enrolled subjects" : subjects.find((subject) => String(subject.id) === subjectId)?.name ?? "Selected subject";
  const changeScope = (setter, value) => { setter(value); setSelected([]); };
  const generate = async (event) => {
    event.preventDefault();
    if (saving || !recipients.length || !school.trim() || !title.trim()) return;
    if (persistHistory) {
      setSaving(true); setError("");
      try {
        const response = await axios.post("http://localhost:3000/award-history", { studentIds: recipients.map((student) => student.id), term: Number(term), awardType, minimum: Number(minimum), subjectId, school, title, schoolYear, signatory, role, date });
        setCertificates(response.data.map((item) => item.certificate));
        setHistory((current) => [...response.data, ...current]);
      } catch (err) { setError(err.response?.data?.message || "Unable to save certificates. Please review the grades and try again."); }
      finally { setSaving(false); }
      return;
    }
    setCertificates(recipients.map((student) => ({
      studentName: student.name, gradeLevel: student.grade, section: student.section,
      grade: student.awardGrade, previousGrade: student.previousGrade, improvement: student.improvement,
      school: school.trim(), schoolYear: schoolYear.trim(), title: title.trim(), signatory: signatory.trim(), role: role.trim(), date, term, scope, awardType,
    })));
  };

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-xl bg-[var(--ed-danger-soft)] p-4 text-[var(--ed-danger)]">{error}</p>}
      <form onSubmit={generate} className="space-y-6">
        <section className="rounded-[22px] border border-[var(--ed-border)] bg-[var(--ed-surface)] p-6">
          <h2 className="text-xl font-bold">Award criteria</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ed-muted)]">Use official term grades to suggest recipients. These are teacher-defined awards; review your school's criteria before issuing certificates. All Subjects requires complete grades in every enrolled subject.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-semibold">Section<select aria-label="Award section" className={fieldClass} value={section} onChange={(event) => changeScope(setSection, event.target.value)}><option value="ALL">All sections</option>{sections.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
            <label className="text-sm font-semibold">Subject<select aria-label="Award subject" className={fieldClass} value={subjectId} onChange={(event) => changeScope(setSubjectId, event.target.value)}><option value="ALL">All Subjects</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="text-sm font-semibold">Term<select aria-label="Award term" className={fieldClass} value={term} onChange={(event) => changeScope(setTerm, event.target.value)}>{[1, 2, 3].map((item) => <option key={item} value={item}>Term {item}</option>)}</select></label>
            <label className="text-sm font-semibold">Award<select aria-label="Award type" className={fieldClass} value={awardType} onChange={(event) => {
              const option = AWARD_TYPES.find((item) => item.value === event.target.value);
              setAwardType(option.value); setMinimum(String(option.minimum)); setTitle(option.label); setSelected([]);
            }}>{AWARD_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="text-sm font-semibold">{awardType === "improvement" ? "Minimum improvement (grade points)" : "Minimum official grade"}<input aria-label="Award threshold" type="number" min={awardType === "improvement" ? 1 : 0} max="100" step="0.1" required className={fieldClass} value={minimum} onChange={(event) => changeScope(setMinimum, event.target.value)} /></label>
          </div>
          {awardType === "improvement" && <p className="mt-4 text-sm text-[var(--ed-muted)]">Improvement compares the selected term with the previous term for the same subjects. Choose Term 2 or 3.</p>}
        </section>

        <section className="rounded-[22px] border border-[var(--ed-border)] bg-[var(--ed-surface)] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Recipients <span className="text-sm font-normal text-[var(--ed-muted)]">{eligible.length} eligible · {recipients.length} selected</span></h2>
            <button type="button" disabled={!eligible.length} onClick={() => setSelected(recipients.length === eligible.length ? [] : eligible.map((student) => student.id))} className="rounded-lg border border-[var(--ed-border)] px-3 py-2 text-sm disabled:opacity-40">{eligible.length > 0 && recipients.length === eligible.length ? "Clear selection" : "Select all eligible"}</button>
          </div>
          <div className="mt-4 max-h-96 space-y-2 overflow-auto">
            {candidates.map((student) => <label key={student.id} className="flex items-center gap-3 rounded-xl border border-[var(--ed-border)] p-3">
              <input type="checkbox" aria-label={`Award recipient ${student.name}`} disabled={!student.eligible} checked={student.eligible && selected.includes(student.id)} onChange={() => setSelected((current) => current.includes(student.id) ? current.filter((id) => id !== student.id) : [...current, student.id])} className="h-4 w-4 accent-[var(--ed-primary)]" />
              <span className="min-w-0 flex-1"><span className="block font-semibold">{student.name}</span><span className="block text-xs text-[var(--ed-muted)]">Grade {student.grade} · {student.section}{!student.eligible && ` · ${student.reason}`}</span></span>
              <span className="text-right text-sm">{number(student.awardGrade)}{awardType === "improvement" && <span className="block text-xs text-[var(--ed-muted)]">Change: {student.improvement === null ? "—" : `${student.improvement >= 0 ? "+" : ""}${number(student.improvement)}`} points</span>}</span>
            </label>)}
            {!candidates.length && <p className="py-6 text-sm text-[var(--ed-muted)]">No students match this scope. Register students and record their grades first.</p>}
          </div>
        </section>

        <section className="rounded-[22px] border border-[var(--ed-border)] bg-[var(--ed-surface)] p-6">
          <h2 className="text-xl font-bold">Certificate details</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-semibold">School / institution<input required maxLength={150} aria-label="Certificate school" className={fieldClass} value={school} onChange={(event) => setSchool(event.target.value)} placeholder="School name" /></label>
            <label className="text-sm font-semibold">Award title<input required maxLength={100} aria-label="Certificate award title" className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="text-sm font-semibold">School year (optional)<input maxLength={40} className={fieldClass} value={schoolYear} onChange={(event) => setSchoolYear(event.target.value)} placeholder="e.g. 2026–2027" /></label>
            <label className="text-sm font-semibold">Issue date<input type="date" required className={fieldClass} value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label className="text-sm font-semibold">Signatory (optional)<input maxLength={100} className={fieldClass} value={signatory} onChange={(event) => setSignatory(event.target.value)} placeholder="Teacher's name" /></label>
            <label className="text-sm font-semibold">Signatory role<input maxLength={80} className={fieldClass} value={role} onChange={(event) => setRole(event.target.value)} /></label>
          </div>
          <button type="submit" disabled={saving || !recipients.length} className="mt-6 rounded-xl bg-[var(--ed-primary)] px-5 py-3 font-semibold text-white disabled:opacity-40">{saving ? "Saving certificates…" : `Create certificates (${recipients.length})`}</button>
        </section>
      </form>
      {certificates.length > 0 && <section className="space-y-4" aria-label="Certificate previews">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Print preview · {certificates.length} certificate{certificates.length === 1 ? "" : "s"}</h2><p className="mt-1 text-sm text-[var(--ed-muted)]">Print on A4 landscape or choose Save as PDF. Disable browser headers and footers. Recreate certificates after changing the details above.</p></div><button type="button" onClick={() => window.print()} className="rounded-xl bg-[var(--ed-primary)] px-5 py-3 font-semibold text-white">Print certificates</button></div>
        {certificates.map((certificate, index) => <div key={index} className="certificate-preview"><Certificate certificate={certificate} /></div>)}
      </section>}
      {persistHistory && <section className="rounded-[22px] border border-[var(--ed-border)] bg-[var(--ed-surface)] p-6"><h2 className="text-xl font-bold">Award history</h2><p className="mt-2 text-sm text-[var(--ed-muted)]">Saved certificates for the active school year. Reopening preserves the original award details.</p><div className="mt-4 space-y-3">{history.map((item) => <div key={item._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ed-border)] p-3"><div><strong>{item.certificate.studentName}</strong><p className="text-sm text-[var(--ed-muted)]">{item.certificate.title} · Term {item.certificate.term} · {item.certificate.date}</p></div><button type="button" className="text-sm font-semibold text-[var(--ed-accent-text)]" onClick={() => setCertificates([item.certificate])}>Reopen / reprint</button></div>)}{!history.length && <p className="text-sm text-[var(--ed-muted)]">No certificates issued in this school year.</p>}</div></section>}
      {certificates.length > 0 && createPortal(<div className="awards-print-root">{certificates.map((certificate, index) => <Certificate key={index} certificate={certificate} />)}</div>, document.body)}
    </div>
  );
}

function Certificate({ certificate }) {
  const date = new Date(`${certificate.date}T12:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const compact = [certificate.school, certificate.title, certificate.studentName, certificate.scope, certificate.section, certificate.signatory].join(" ").length > 320;
  return <article className={`award-certificate${compact ? " certificate-compact" : ""}`}>
    <div className="certificate-school">{certificate.school}</div>
    <div className="certificate-rule" />
    <p className="certificate-eyebrow">Certificate of Achievement</p>
    <h2>{certificate.title}</h2>
    <p className="certificate-presented">Presented to</p>
    <h3>{certificate.studentName}</h3>
    <p className="certificate-class">Grade {certificate.gradeLevel} · {certificate.section}</p>
    <p className="certificate-citation">In recognition of {certificate.awardType === "improvement" ? `academic improvement of ${number(certificate.improvement)} grade points, from ${number(certificate.previousGrade)} to ${number(certificate.grade)}` : `academic performance with an official ${certificate.scope === "all enrolled subjects" ? "average term grade" : "term grade"} of ${number(certificate.grade)}`} in {certificate.scope}, Term {certificate.term}{certificate.schoolYear && `, School Year ${certificate.schoolYear}`}.</p>
    <p className="certificate-date">Awarded on {date}</p>
    <div className="certificate-signature"><strong>{certificate.signatory || "\u00a0"}</strong><span>{certificate.role || "Authorized signatory"}</span></div>
  </article>;
}
