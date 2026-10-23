import { useState } from "react";
import axios from "axios";
import { API_URL } from "../utils/api.js";
import { parseWholeNumber, validateInput } from "../../../shared/inputValidation.mjs";
import ClassSidePanel from "./ClassSidePanel";
import ValidatedInput from "./ValidatedInput";
import ClassStructureManager from "./ClassStructureManager";

const field = "mt-2 w-full rounded-xl border border-[var(--ed-border)] bg-[var(--ed-surface)] px-3 py-3 text-sm";
const primary = "rounded-xl bg-[var(--ed-primary)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-xl border border-[var(--ed-border)] px-4 py-3 text-sm font-semibold disabled:opacity-50";
const classKey = (grade, sectionId) => `${grade}:${sectionId}`;

export default function ModifyClassDrawer({ hierarchy, sections, subjects, initialGrade, initialSectionId, onSaved, onChanged, onClose }) {
  const options = hierarchy.flatMap((grade) => grade.sections.map((section) => ({ ...section, grade: grade.grade, key: classKey(grade.grade, section.id) })));
  const initial = options.find((item) => item.key === classKey(initialGrade, initialSectionId));
  const [mode, setMode] = useState((initialGrade && !initialSectionId) || !options.length ? "grades" : "details");
  const [managementContext, setManagementContext] = useState({ grade: initialGrade ?? hierarchy[0]?.grade, sectionId: initialSectionId ?? "" });
  const [sourceKey, setSourceKey] = useState(initial?.key ?? "");
  const [grade, setGrade] = useState(initial ? String(initial.grade) : ""), [sectionId, setSectionId] = useState(initial?.id ?? "");
  const [sectionName, setSectionName] = useState(""), [newSection, setNewSection] = useState(false);
  const [subjectIds, setSubjectIds] = useState(initial?.subjects.map((subject) => String(subject.id)) ?? []);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const source = options.find((item) => item.key === sourceKey);
  const chooseClass = (key) => {
    const item = options.find((option) => option.key === key);
    setSourceKey(key); setGrade(item ? String(item.grade) : ""); setSectionId(item?.id ?? "");
    setSubjectIds(item?.subjects.map((subject) => String(subject.id)) ?? []);
    setNewSection(false); setSectionName(""); setNewSubjectName(""); setError("");
    if (item) setManagementContext({ grade: item.grade, sectionId: item.id });
  };
  const save = async (event) => {
    event.preventDefault(); if (busy) return;
    const message = !source ? "Choose a class to modify." :
      validateInput(grade, { kind: "integer", label: "Grade Level", min: 1 }) ||
      (newSection ? validateInput(sectionName, { kind: "section", label: "Section name" }) : !sectionId && "Choose a section.") ||
      validateInput(newSubjectName, { kind: "subject", label: "Additional subject", required: false }) ||
      (!subjectIds.length && !newSubjectName.trim() && "Choose at least one subject.");
    if (message) { setError(message); return; }
    setBusy(true); setError("");
    try {
      const { data } = await axios.put(`${API_URL}/classes`, { source_grade: source.grade, source_section_id: String(source.id), grade: parseWholeNumber(grade),
        ...(newSection ? { section_name: sectionName.trim() } : { section_id: String(sectionId) }), subject_ids: subjectIds, new_subject_name: newSubjectName.trim(),
      });
      await onSaved(data);
      onClose();
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to modify this class. Try again."); }
    finally { setBusy(false); }
  };

  return <ClassSidePanel title="Modify class" busy={busy} onClose={onClose}>
    <nav aria-label="Class modification options" className="mb-6 flex flex-wrap gap-2">{[["details", "Class details"], ["grades", "Grade levels"], ["sections", "Sections"], ["subjects", "Subjects"]].map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => setMode(value)} className={mode === value ? primary : secondary}>{label}</button>)}</nav>
    {mode !== "details" ? <ClassStructureManager key={mode} kind={mode} hierarchy={hierarchy} sections={sections} subjects={subjects} initialGrade={managementContext.grade} initialSectionId={managementContext.sectionId} onContextChange={setManagementContext} onChanged={onChanged} onBusyChange={setBusy} /> : <form onSubmit={save} className="space-y-6">
      <label className="block text-sm font-semibold">Class to modify<select aria-label="Class to modify" required disabled={busy} value={sourceKey} onChange={(event) => chooseClass(event.target.value)} className={field}>
        <option value="">Choose a registered class</option>{options.map((item) => <option key={item.key} value={item.key}>Grade {item.grade} · {item.name}</option>)}
      </select></label>
      {error && <p role="alert" className="rounded-xl bg-[var(--ed-danger-soft)] p-4 text-sm text-[var(--ed-danger)]">{error}</p>}
      {source && <fieldset disabled={busy} className="space-y-5">
        <legend className="sr-only">Class details</legend>
        <p className="rounded-xl bg-[var(--ed-subtle)] p-4 text-sm leading-6">Grade and section changes apply to this class's {source.students.length} student{source.students.length === 1 ? "" : "s"}. Their recorded scores, grades, and subject enrollments are kept.</p>
        <label className="block text-sm font-semibold">Grade Level<ValidatedInput aria-label="Modify class grade level" kind="integer" label="Grade Level" min={1} required value={grade} onChange={(event) => setGrade(event.target.value)} className={field} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newSection} onChange={(event) => setNewSection(event.target.checked)} className="accent-[var(--ed-primary)]" />Create a new section for this class</label>
        {newSection ? <label className="block text-sm font-semibold">Section name<ValidatedInput aria-label="Modify class new section" kind="section" label="Section name" required value={sectionName} onChange={(event) => setSectionName(event.target.value)} className={field} /></label>
          : <label className="block text-sm font-semibold">Section<select aria-label="Modify class section" required value={sectionId} onChange={(event) => setSectionId(event.target.value)} className={field}><option value="">Choose a section</option>{sections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">Registered subjects</legend>
          <p className="text-xs leading-5 text-[var(--ed-muted)]">Adding a subject registers it for this class. Enroll students using Add class or their individual records. Subjects with enrolled students must stay registered.</p>
          {subjects.map((item) => {
            const enrolledCount = source.subjects.find((subject) => String(subject.id) === String(item.id))?.students.length ?? 0;
            return <label key={item.id} className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={`Register ${item.name} for class`} checked={subjectIds.includes(String(item.id))} disabled={enrolledCount > 0} onChange={(event) => { const checked = event.target.checked; setSubjectIds((current) => checked ? [...current, String(item.id)] : current.filter((id) => id !== String(item.id))); }} className="mt-1 accent-[var(--ed-primary)]" /><span>{item.name}{enrolledCount > 0 && <span className="ml-2 text-xs text-[var(--ed-muted)]">{enrolledCount} enrolled</span>}</span></label>;
          })}
        </fieldset>
        <label className="block text-sm font-semibold">Additional subject (optional)<ValidatedInput aria-label="Modify class additional subject" kind="subject" label="Additional subject" value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} placeholder="Create or register a subject by name" className={field} /></label>
      </fieldset>}
      <div className="flex justify-end gap-3 border-t border-[var(--ed-border)] pt-5"><button type="button" disabled={busy} className={secondary} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || !source} className={primary}>{busy ? "Saving changes..." : "Save changes"}</button></div>
    </form>}
  </ClassSidePanel>;
}
