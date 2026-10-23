import { useId, useState } from "react";
import axios from "axios";
import { API_URL } from "../utils/api.js";
import { parseWholeNumber, validateInput } from "../../../shared/inputValidation.mjs";
import ValidatedInput from "./ValidatedInput";

const field = "mt-2 w-full rounded-xl border border-[var(--ed-border)] bg-[var(--ed-surface)] px-3 py-3 text-sm";
const primary = "rounded-xl bg-[var(--ed-primary)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-xl border border-[var(--ed-border)] px-4 py-3 text-sm font-semibold disabled:opacity-50";

export default function ClassStructureManager({ kind, hierarchy, sections, subjects, initialGrade, initialSectionId, onContextChange, onChanged, onBusyChange }) {
  const [gradeChoice, setGradeChoice] = useState(String(initialGrade ?? hierarchy[0]?.grade ?? ""));
  const [sectionChoice, setSectionChoice] = useState(String(initialSectionId ?? ""));
  const [value, setValue] = useState(""), [editing, setEditing] = useState(null), [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const listId = useId();
  const grade = hierarchy.find((entry) => String(entry.grade) === gradeChoice) ?? hierarchy[0];
  const section = grade?.sections.find((entry) => String(entry.id) === sectionChoice) ?? grade?.sections[0];
  const singular = { grades: "grade level", sections: "section", subjects: "subject" }[kind];
  const rows = kind === "grades" ? hierarchy.map((entry) => ({ ...entry, key: String(entry.grade), label: `Grade ${entry.grade}`, value: String(entry.grade), detail: `${entry.sections.length} sections · ${entry.sections.reduce((count, item) => count + item.students.length, 0)} students` }))
    : (kind === "sections" ? grade?.sections ?? [] : section?.subjects ?? []).map((entry) => ({ ...entry, key: String(entry.id), label: entry.name, value: entry.name,
      detail: kind === "sections" ? `${entry.subjects.length} subjects · ${entry.students.length} students` : `${entry.students.length} enrolled students` }));
  const context = kind === "grades" ? {} : { grade: grade?.grade, ...(kind === "subjects" ? { section_id: section?.id } : {}) };
  const ready = kind === "grades" || Boolean(grade && (kind === "sections" || section));
  const resetDrafts = () => { setEditing(null); setPendingDelete(null); setError(""); setMessage(""); setValue(""); };

  const mutate = async (method, path, body) => {
    if (busy) return;
    setBusy(true); onBusyChange(true); setError(""); setMessage("");
    let saved = false;
    try {
      const { data } = method === "delete" ? await axios.delete(`${API_URL}/class-structure/${path}`, { params: body })
        : await axios[method](`${API_URL}/class-structure/${path}`, body);
      saved = true;
      onContextChange({ grade: data.grade ?? body.grade ?? grade?.grade, sectionId: kind === "grades" ? "" : data.section_id ?? body.section_id ?? section?.id ?? "" });
      setMessage(data.message); setValue(""); setEditing(null); setPendingDelete(null);
      await onChanged();
    } catch (requestError) { setError(saved ? "Your change was saved, but the list could not refresh. Close this panel and reload the page." : requestError.response?.data?.message || "Unable to update the class structure. Try again."); }
    finally { setBusy(false); onBusyChange(false); }
  };
  const validate = (draft) => validateInput(draft, kind === "grades" ? { kind: "integer", label: "Grade level", min: 1 } : { kind: singular, label: `${singular[0].toUpperCase()}${singular.slice(1)} name` });
  const create = (event) => {
    event.preventDefault();
    const validation = validate(value);
    if (validation) { setError(validation); return; }
    mutate("post", kind, kind === "grades" ? { grade: parseWholeNumber(value) } : { ...context, name: value.trim() });
  };
  const rename = (event) => {
    event.preventDefault();
    const validation = validate(editing.value);
    if (validation) { setError(validation); return; }
    mutate("put", `${kind}/${editing.key}`, kind === "grades" ? { grade: parseWholeNumber(editing.value) } : { ...context, name: editing.value.trim() });
  };

  return <div className="space-y-5">
    <p className="text-sm leading-6 text-[var(--ed-muted)]">Manage {singular === "grade level" ? "grade levels" : `${singular}s`} for the current school year. {kind !== "grades" && "Section and subject names are shared across your classes; renaming updates the name wherever it is used."}</p>
    {kind !== "grades" && <label className="block text-sm font-semibold">Grade level<select aria-label={`Manage ${kind} grade level`} value={grade?.grade ?? ""} disabled={busy} onChange={(event) => { setGradeChoice(event.target.value); setSectionChoice(""); onContextChange({ grade: Number(event.target.value), sectionId: "" }); resetDrafts(); }} className={field}>
      {!hierarchy.length && <option value="">Create a grade level first</option>}{hierarchy.map((entry) => <option key={entry.grade} value={entry.grade}>Grade {entry.grade}</option>)}
    </select></label>}
    {kind === "subjects" && <label className="block text-sm font-semibold">Section<select aria-label="Manage subjects section" value={section?.id ?? ""} disabled={busy} onChange={(event) => { setSectionChoice(event.target.value); onContextChange({ grade: grade?.grade, sectionId: event.target.value }); resetDrafts(); }} className={field}>
      {!grade?.sections.length && <option value="">Add a section to this grade first</option>}{grade?.sections.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
    </select></label>}
    {error && <p role="alert" className="rounded-xl bg-[var(--ed-danger-soft)] p-4 text-sm text-[var(--ed-danger)]">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-[var(--ed-accent-soft)] p-4 text-sm">{message}</p>}
    <form onSubmit={create} className="space-y-3 rounded-xl border border-[var(--ed-border)] p-4">
      <fieldset disabled={busy || !ready}>
        <label className="block text-sm font-semibold">{kind === "grades" ? "New grade level" : `${singular[0].toUpperCase()}${singular.slice(1)} name`}<ValidatedInput aria-label={`New ${singular}${kind === "grades" ? "" : " name"}`} kind={kind === "grades" ? "integer" : singular} label={singular} min={kind === "grades" ? 1 : undefined} required value={value} onChange={(event) => setValue(event.target.value)} list={kind !== "grades" ? listId : undefined} className={field} /></label>
        {kind !== "grades" && <><datalist id={listId}>{(kind === "sections" ? sections : subjects).map((entry) => <option key={entry.id} value={entry.name} />)}</datalist><p className="mt-2 text-xs leading-5 text-[var(--ed-muted)]">Enter a new name or choose an existing name to register it here.</p></>}
        <button type="submit" className={`${primary} mt-3`}>Add {singular}</button>
      </fieldset>
    </form>
    <section aria-label={`Registered ${kind}`} className="space-y-3">
      <h3 className="font-semibold">Registered {kind === "grades" ? "grade levels" : kind} ({rows.length})</h3>
      {!rows.length && <p className="py-4 text-sm text-[var(--ed-muted)]">No {kind === "grades" ? "grade levels" : kind} registered here yet.</p>}
      {rows.map((entry) => <article key={entry.key} className="rounded-xl border border-[var(--ed-border)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold">{entry.label}</h4><p className="mt-1 text-xs text-[var(--ed-muted)]">{entry.detail}</p></div>
          <div className="flex gap-3 text-sm font-semibold"><button type="button" aria-label={`Rename ${entry.label}`} disabled={busy} onClick={() => { setEditing({ ...entry }); setPendingDelete(null); setError(""); }}>Edit</button><button type="button" aria-label={`Delete ${entry.label}`} disabled={busy} className="text-[var(--ed-danger)]" onClick={() => { setPendingDelete(entry); setEditing(null); setError(""); }}>Delete</button></div>
        </div>
        {editing?.key === entry.key && <form onSubmit={rename} className="mt-4 space-y-3">
          <label className="block text-sm font-semibold">{kind === "grades" ? "Grade level" : "Name"}<ValidatedInput aria-label={`Edit ${entry.label}`} kind={kind === "grades" ? "integer" : singular} label={singular} min={kind === "grades" ? 1 : undefined} required value={editing.value} disabled={busy} onChange={(event) => setEditing((current) => ({ ...current, value: event.target.value }))} className={field} /></label>
          {kind === "grades" && <p className="text-xs leading-5 text-[var(--ed-muted)]">Updates all sections and active students in this grade. Scores and subject enrollments are kept.</p>}
          <div className="flex gap-3"><button type="submit" disabled={busy} className={primary}>Save {singular}</button><button type="button" disabled={busy} className={secondary} onClick={() => setEditing(null)}>Cancel edit</button></div>
        </form>}
        {pendingDelete?.key === entry.key && <div role="group" aria-label={`Confirm delete ${entry.label}`} className="mt-4 space-y-3 border-t border-[var(--ed-border)] pt-4">
          <p className="text-sm leading-6">Remove {entry.label}{kind === "sections" ? ` from Grade ${grade.grade}` : kind === "subjects" ? ` from Grade ${grade.grade}, ${section.name}` : " and its empty class setups"}? Entries with student or assessment records are protected. {kind !== "grades" && "Shared catalog entries and records in other classes are kept."}</p>
          <div className="flex gap-3"><button type="button" disabled={busy} className="rounded-xl bg-[var(--ed-danger)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" onClick={() => mutate("delete", `${kind}/${entry.key}`, context)}>Confirm delete</button><button type="button" disabled={busy} className={secondary} onClick={() => setPendingDelete(null)}>Keep {singular}</button></div>
        </div>}
      </article>)}
    </section>
  </div>;
}
