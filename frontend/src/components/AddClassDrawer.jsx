import { lazy, Suspense, useState } from "react";
import axios from "axios";
import { API_URL } from "../utils/api.js";
import { parseWholeNumber, validateInput } from "../../../shared/inputValidation.mjs";
import ClassSidePanel from "./ClassSidePanel";
import StudentImport from "./StudentImport";
import ValidatedInput from "./ValidatedInput";
import LoadingIndicator from "./LoadingIndicator";

const StudentForm = lazy(() => import("./StudentForm"));
const field = "mt-2 w-full rounded-xl border border-[var(--ed-border)] bg-[var(--ed-surface)] px-3 py-3 text-sm";
const primary = "rounded-xl bg-[var(--ed-primary)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-xl border border-[var(--ed-border)] px-4 py-3 text-sm font-semibold disabled:opacity-50";
const steps = ["Grade Level", "Section", "Subject", "Students"];

export default function AddClassDrawer({ sections, subjects, students = [], initialGrade = "", initialSectionId = "", initialSubjectId = "", schoolYearName, onRegistered, onRefresh, onClose }) {
  const [step, setStep] = useState(0), [grade, setGrade] = useState(String(initialGrade));
  const [sectionId, setSectionId] = useState(initialSectionId), [sectionName, setSectionName] = useState("");
  const [subjectId, setSubjectId] = useState(initialSubjectId), [subjectName, setSubjectName] = useState("");
  const [sectionMode, setSectionMode] = useState(sections.length ? "existing" : "new");
  const [subjectMode, setSubjectMode] = useState(subjects.length ? "existing" : "new");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [created, setCreated] = useState(null), [method, setMethod] = useState("");
  const [studentCount, setStudentCount] = useState(0), [studentKey, setStudentKey] = useState(0);
  const [studentSearch, setStudentSearch] = useState("");
  const [selection, setSelection] = useState({ scope: "", ids: [] });
  const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const chosenSection = sectionMode === "existing" ? sections.find((item) => item.id === sectionId) : sections.find((item) => normalize(item.name) === normalize(sectionName));
  const roster = students.filter((student) => Number(student.grade) === parseWholeNumber(grade) && chosenSection &&
    (student.section_id ? student.section_id === chosenSection.id : normalize(student.section) === normalize(chosenSection.name)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const chosenSubject = subjectMode === "existing" ? subjects.find((item) => item.id === subjectId) : subjects.find((item) => normalize(item.name) === normalize(subjectName));
  const alreadyEnrolled = (student) => Boolean(chosenSubject && student.subject_ids?.includes(chosenSubject.id));
  const availableIds = roster.filter((student) => !alreadyEnrolled(student)).map((student) => student.id);
  const selectionScope = JSON.stringify([parseWholeNumber(grade), chosenSection?.id, chosenSubject?.id ?? "new"]);
  const selectedIds = selection.scope === selectionScope ? selection.ids.filter((id) => availableIds.includes(id)) : [];
  const selectStudents = (ids) => setSelection({ scope: selectionScope, ids });

  const next = async (event) => {
    event.preventDefault();
    if (busy) return;
    let message = "";
    if (step === 0) message = validateInput(grade, { kind: "integer", label: "Grade Level", min: 1 });
    if (step === 1) message = sectionMode === "existing" ? !sectionId && "Choose a section." : validateInput(sectionName, { kind: "section", label: "Section name" });
    if (step === 2) message = subjectMode === "existing" ? !subjectId && "Choose a subject." : validateInput(subjectName, { kind: "subject", label: "Subject name" });
    if (message) { setError(message); return; }
    setError("");
    if (step < 2) { setStep(step + 1); return; }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API_URL}/classes`, { grade: parseWholeNumber(grade),
        ...(sectionMode === "existing" ? { section_id: sectionId } : { section_name: sectionName.trim() }),
        ...(subjectMode === "existing" ? { subject_id: subjectId } : { subject_name: subjectName.trim() }),
        ...(selectedIds.length ? { student_ids: selectedIds } : {}),
      });
      setCreated(data); setStep(3);
      await onRegistered(data);
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to save the class. Try again."); }
    finally { setBusy(false); }
  };
  const refreshed = async () => { await onRefresh(); };

  return <ClassSidePanel title="Add class" busy={busy} onClose={onClose}>
    <p className="text-sm text-[var(--ed-muted)]">Set up your class one question at a time. School year: {schoolYearName}.</p>
    <ol aria-label="Class setup steps" className="my-6 grid grid-cols-4 gap-2">
      {steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} className={`rounded-xl border px-2 py-3 text-center text-xs font-semibold ${index === step ? "border-[var(--ed-primary)] bg-[var(--ed-accent-soft)] text-[var(--ed-accent-text)]" : "border-[var(--ed-border)] text-[var(--ed-muted)]"}`}>{index + 1}. {label}</li>)}
    </ol>
    <h3 tabIndex={-1} className="text-2xl font-bold">{["What grade level is this class?", "Which section will you teach?", "Which subject will you teach?", "How would you like to add students?"][step]}</h3>
    {error && <p role="alert" className="mt-4 rounded-xl bg-[var(--ed-danger-soft)] p-4 text-sm text-[var(--ed-danger)]">{error}</p>}
    {step < 3 ? <form onSubmit={next} className="mt-6 space-y-6">
      {step === 0 && <label className="block text-sm font-semibold">Grade Level<ValidatedInput aria-label="Class grade level" label="Grade Level" kind="integer" min={1} required value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="e.g. 7" className={field} /></label>}
      {step === 1 && <EntryQuestion kind="section" items={sections} mode={sectionMode} setMode={setSectionMode} value={sectionId} setValue={setSectionId} name={sectionName} setName={setSectionName} />}
      {step === 2 && <>
        <EntryQuestion kind="subject" items={subjects} mode={subjectMode} setMode={setSubjectMode} value={subjectId} setValue={setSubjectId} name={subjectName} setName={setSubjectName} />
        <fieldset className="space-y-3 rounded-xl border border-[var(--ed-border)] p-4" disabled={busy}>
          <legend className="px-1 text-sm font-semibold">Enroll registered students</legend>
          <p className="text-sm text-[var(--ed-muted)]">Choose students already registered in Grade {grade}, {chosenSection?.name ?? sectionName}. They will be enrolled in this subject when you save the class.</p>
          {roster.length ? <>
            <label className="block text-sm font-semibold">Find a student<input type="search" aria-label="Find registered students" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} className={field} placeholder="Search by name" /></label>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button type="button" className="font-semibold text-[var(--ed-primary)] disabled:opacity-50" disabled={!availableIds.length} onClick={() => selectStudents(availableIds)}>Select all</button>
              <button type="button" className="font-semibold disabled:opacity-50" disabled={!selectedIds.length} onClick={() => selectStudents([])}>Clear selection</button>
              <span role="status">{selectedIds.length} of {availableIds.length} selected</span>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto" role="group" aria-label="Registered students in this section">
              {roster.filter((student) => normalize(student.name).includes(normalize(studentSearch))).map((student) => <label key={student.id} className="flex items-center gap-3 rounded-lg border border-[var(--ed-border)] p-3 text-sm">
                <input type="checkbox" aria-label={`Enroll ${student.name}`} disabled={alreadyEnrolled(student)} checked={alreadyEnrolled(student) || selectedIds.includes(student.id)} className="accent-[var(--ed-primary)]" onChange={(event) => selectStudents(event.target.checked ? [...selectedIds, student.id] : selectedIds.filter((id) => id !== student.id))} />
                <span>{student.name}{alreadyEnrolled(student) && <span className="ml-2 text-xs text-[var(--ed-muted)]">Already enrolled</span>}</span>
              </label>)}
              {!roster.some((student) => normalize(student.name).includes(normalize(studentSearch))) && <p className="text-sm text-[var(--ed-muted)]">No students match your search.</p>}
            </div>
          </> : <p className="text-sm text-[var(--ed-muted)]">No registered students in this grade and section yet. Save the class to register or import students.</p>}
        </fieldset>
      </>}
      <div className="flex justify-between gap-3 border-t border-[var(--ed-border)] pt-5">
        <button type="button" disabled={busy} className={secondary} onClick={() => { if (step) { setStep(step - 1); setError(""); } else onClose(); }}>{step ? "Back" : "Cancel"}</button>
        <button type="submit" disabled={busy} className={primary}>{busy ? "Saving class..." : step === 2 ? "Save class & add students" : "Next"}</button>
      </div>
    </form> : created && <div className="mt-5 space-y-5">
      <p role="status" className="rounded-xl bg-[var(--ed-accent-soft)] p-4 text-sm">Class saved: Grade {created.grade} · {created.section.name} · {created.subject.name}. You can add students now or finish and return later.</p>
      {created.enrolled_student_count > 0 && <p role="status" className="text-sm">{created.enrolled_student_count} registered student{created.enrolled_student_count === 1 ? "" : "s"} enrolled in {created.subject.name}.</p>}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" aria-pressed={method === "register"} disabled={busy} className={method === "register" ? primary : secondary} onClick={() => setMethod("register")}>Register students</button>
        <button type="button" aria-pressed={method === "import"} disabled={busy} className={method === "import" ? primary : secondary} onClick={() => setMethod("import")}>Import students</button>
      </div>
      {studentCount > 0 && <p role="status" className="text-sm">{studentCount} student{studentCount === 1 ? "" : "s"} registered. Add another or select Finish.</p>}
      <div hidden={method !== "register"}>{method === "register" && <Suspense fallback={<LoadingIndicator label="Loading registration..." />}>
        <StudentForm key={studentKey} embedded compact lockEnrollment initialGrade={created.grade} initialSection={created.section.name} initialSubjectId={created.subject.id} onBusyChange={setBusy} onCancel={() => setMethod("")} onSaved={async () => { await refreshed(); setStudentCount((count) => count + 1); setStudentKey((key) => key + 1); }} />
      </Suspense>}</div>
      <div hidden={method !== "import"}>{method === "import" && <StudentImport compact lockClass enrollExisting defaultExpanded initialGradeLevel={created.grade} sections={[created.section]} subjects={[created.subject]} initialSectionId={created.section.id} initialSubjectIds={[created.subject.id]} schoolYearName={schoolYearName} onBusyChange={setBusy} onImported={refreshed} />}</div>
      <button type="button" disabled={busy} className={`${primary} w-full`} onClick={onClose}>Finish</button>
    </div>}
  </ClassSidePanel>;
}

function EntryQuestion({ kind, items, mode, setMode, value, setValue, name, setName }) {
  const label = kind === "section" ? "Section" : "Subject";
  return <fieldset className="space-y-4"><legend className="sr-only">{label}</legend>
    <div className="flex flex-wrap gap-4 text-sm">
      {items.length > 0 && <label><input type="radio" name={`class-${kind}-mode`} checked={mode === "existing"} onChange={() => setMode("existing")} className="mr-2 accent-[var(--ed-primary)]" />Use existing {kind}</label>}
      <label><input type="radio" name={`class-${kind}-mode`} checked={mode === "new"} onChange={() => setMode("new")} className="mr-2 accent-[var(--ed-primary)]" />Create new {kind}</label>
    </div>
    {mode === "existing" ? <label className="block text-sm font-semibold">{label}<select aria-label={`Class ${kind}`} required value={value} onChange={(event) => setValue(event.target.value)} className={field}><option value="">Choose a {kind}</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      : <label className="block text-sm font-semibold">{label} name<ValidatedInput aria-label={`New class ${kind}`} kind={kind} label={`${label} name`} required value={name} onChange={(event) => setName(event.target.value)} className={field} placeholder={kind === "section" ? "e.g. Rose" : "e.g. Mathematics"} /></label>}
  </fieldset>;
}
