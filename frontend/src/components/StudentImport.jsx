import { useEffect, useRef, useState } from "react";
import axios from "axios";
import ValidatedInput from "./ValidatedInput";
import { validateInput } from "../../../shared/inputValidation.mjs";
import { API_URL } from "../utils/api.js";

const fieldClass = "mt-2 block w-full rounded-xl border border-[var(--ed-border)] bg-[var(--ed-surface)] px-3 py-2.5 text-sm";
const primary = "rounded-xl bg-[var(--ed-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "rounded-xl border border-[var(--ed-border)] px-4 py-2.5 text-sm font-semibold hover:bg-[var(--ed-subtle)] disabled:opacity-50";

export default function StudentImport({ sections = [], subjects = [], initialSectionId = "", initialSubjectIds = [], initialGradeLevel = "", lockClass = false, enrollExisting = false, defaultExpanded = false, compact = false, onImported, onBusyChange, schoolYearName = "Current school year" }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [gradeLevel, setGradeLevel] = useState(String(initialGradeLevel));
  const [sectionId, setSectionId] = useState(String(initialSectionId));
  const [subjectIds, setSubjectIds] = useState(initialSubjectIds.map(String));
  const [createdSections, setCreatedSections] = useState([]);
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [review, setReview] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const fileRef = useRef(null), reviewRef = useRef(null);
  const sectionOptions = [...sections, ...createdSections.filter((created) => !sections.some((section) => String(section.id) === String(created.id)))];
  const selectedSection = sectionOptions.find((section) => String(section.id) === sectionId);
  const sectionName = selectedSection?.name ?? "";
  const selectedSubjects = subjects.filter((subject) => subjectIds.includes(String(subject.id)));

  useEffect(() => { if (review) reviewRef.current?.focus(); }, [review]);
  useEffect(() => { onBusyChange?.(Boolean(busy)); }, [busy, onBusyChange]);
  const invalidateReview = () => { setReview(null); setAcknowledged(false); setError(""); setResult(null); };
  const validateDetails = () => {
    const message = validateInput(gradeLevel, { kind: "integer", label: "Grade Level", min: 1 }) ||
      (!selectedSection ? "Choose one of your registered sections or create a section below first." : "");
    if (message) { setError(message); return false; }
    return true;
  };
  const makeData = () => {
    const data = new FormData();
    data.append("file", file); data.append("import_mode", "names"); data.append("grade_level", gradeLevel);
    data.append("section_id", sectionId);
    data.append("section_name", sectionName.trim()); data.append("subject_ids", JSON.stringify(subjectIds));
    if (enrollExisting) data.append("enroll_existing", "true");
    return data;
  };
  const selectFile = (event) => {
    invalidateReview(); setFile(null);
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!/\.xlsx$/i.test(selected.name) || selected.size > 5 * 1024 * 1024) {
      setError("Choose a completed .xlsx template, 5 MB or smaller."); event.target.value = ""; return;
    }
    setFile(selected);
  };
  const downloadTemplate = async () => {
    if (busy || !validateDetails()) return;
    setBusy("download"); setError("");
    try {
      const response = await axios.get(`${API_URL}/students/import/template`, { params: {
        mode: "names", grade_level: gradeLevel, section_id: sectionId, section_name: sectionName,
      }, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a"); link.href = url; link.download = "student-names-template.xlsx";
      document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (requestError) {
      let message = requestError.response?.data?.message;
      if (requestError.response?.data instanceof Blob) {
        try { message = JSON.parse(await requestError.response.data.text()).message; } catch { /* Use the download fallback. */ }
      }
      setError(message || "Unable to download the template. Try again.");
    } finally { setBusy(""); }
  };
  const createSection = async () => {
    if (busy) return;
    const message = validateInput(newSectionName, { kind: "section", label: "Section Name" });
    if (message) { setError(message); return; }
    setBusy("section"); invalidateReview();
    try {
      const response = await axios.post(`${API_URL}/sections`, { name: newSectionName.trim() });
      setCreatedSections((current) => [...current, response.data]); setSectionId(String(response.data.id));
      setNewSectionName(""); setAddingSection(false);
      try { await onImported?.(); } catch { setError("Section created and selected. Reload the page to refresh the section list."); }
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to create the section. Check the section list before trying again."); }
    finally { setBusy(""); }
  };
  const previewImport = async (event) => {
    event.preventDefault();
    if (busy || !validateDetails()) return;
    if (!file) { setError("Upload the completed template first."); return; }
    setBusy("review"); invalidateReview();
    try {
      const response = await axios.post(`${API_URL}/students/import/preview`, makeData());
      setReview({ ...response.data, filename: file.name, schoolYearName, subjectNames: selectedSubjects.map((subject) => subject.name) });
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to review this workbook. Try again."); setResult(requestError.response?.data ?? null); }
    finally { setBusy(""); }
  };
  const confirmImport = async () => {
    if (busy || !review || !acknowledged) return;
    if (!validateDetails()) return;
    setBusy("import"); setError("");
    const data = makeData(); data.append("confirmation_token", review.confirmation_token);
    try {
      const response = await axios.post(`${API_URL}/students/import`, data);
      setResult(response.data); setReview(null); setAcknowledged(false); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      try { await onImported?.({ sectionId, subjectIds }); } catch { setError("Import completed. Reload the page to refresh the student list."); }
    } catch (requestError) {
      setReview(null); setAcknowledged(false);
      setError(requestError.response?.data?.message || "Unable to finish the import. Reload the student list before reviewing and retrying.");
      setResult(requestError.response?.data ?? null);
      if (!requestError.response || requestError.response.status >= 500) { try { await onImported?.(); } catch { /* Preserve the import error. */ } }
    } finally { setBusy(""); }
  };

  return <section className={`rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-surface)] ${compact ? "p-3" : "p-6 sm:p-7"}`}>
    <div className={`flex flex-col gap-4 ${compact ? "" : "sm:flex-row sm:items-center sm:justify-between"}`}>
      <div><h3 className="text-lg font-bold">Import students from Excel</h3><p className="mt-1 text-sm text-[var(--ed-muted)]">Download the student names sheet, then review before importing.</p></div>
      {!lockClass && <button type="button" disabled={Boolean(busy)} onClick={() => {
        if (!expanded) {
          if (sectionOptions.some((section) => String(section.id) === String(initialSectionId))) setSectionId(String(initialSectionId));
          setSubjectIds(initialSubjectIds.map(String).filter((id) => subjects.some((subject) => String(subject.id) === id)));
          invalidateReview();
        }
        setExpanded(!expanded); setReview(null); setAcknowledged(false);
      }} aria-expanded={expanded} aria-controls="student-import-flow" className={secondary}>{expanded ? "Close import" : "Start import"}</button>}
    </div>
    {expanded && <div id="student-import-flow" className="mt-6 border-t border-[var(--ed-border)] pt-5">
      {review ? <div ref={reviewRef} tabIndex={-1} role="region" aria-labelledby="import-review-title" className="space-y-5 outline-none">
        <div><h4 id="import-review-title" className="text-lg font-bold">Finalization confirmation</h4><p className="mt-1 text-sm text-[var(--ed-muted)]">Check the class and every student below. Nothing is imported until you confirm.</p></div>
        <dl className="grid gap-3 rounded-xl bg-[var(--ed-subtle)] p-4 text-sm sm:grid-cols-2">
          {[["File", review.filename], ["Grade Level", review.grade_level], ["Section", review.section_name], ["School year", review.schoolYearName]].map(([label, value]) => <div key={label}><dt className="text-[var(--ed-muted)]">{label}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>)}
        </dl>
        <p className="text-sm">Subjects for {enrollExisting ? "new and existing students" : "new students"}: {review.subjectNames?.length ? review.subjectNames.join(", ") : "None selected"}. {enrollExisting ? "Existing students will also be enrolled in these subjects; their other enrollments and saved grades are kept." : "Existing students keep their current enrollments."}</p>
        <p className="text-sm">{review.student_count} students: {review.new_student_count} new registrations and {review.existing_student_count} already registered. {review.skipped.length > 0 ? `${review.skipped.length} duplicate rows will be skipped.` : ""}</p>
        <div className="max-h-80 overflow-auto rounded-xl border border-[var(--ed-border)]">
          <table className="w-full whitespace-nowrap text-left text-sm"><caption className="sr-only">Students to import</caption>
            <thead className="sticky top-0 bg-[var(--ed-subtle)]"><tr>{["Row", "Student Name", "Registration"].map((label, index) => <th key={index} scope="col" className="px-4 py-3">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-[var(--ed-border)]">{review.rows.map((row) => <tr key={row.row}><td className="px-4 py-2">{row.row}</td><td className="px-4 py-2 font-semibold">{row.name}</td><td className="px-4 py-2">{row.registration === "new" ? "New student" : "Already registered"}</td></tr>)}</tbody>
          </table>
        </div>
        {review.skipped.length > 0 && <ul className="max-h-32 overflow-auto text-sm text-[var(--ed-muted)]">{review.skipped.map((row) => <li key={row.row}>Row {row.row}: {row.name} — {row.message}</li>)}</ul>}
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={acknowledged} disabled={Boolean(busy)} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 accent-[var(--ed-primary)]" /><span>I have checked the class details and student names, and want to finalize this import.</span></label>
        <div className="flex flex-wrap gap-3"><button type="button" disabled={Boolean(busy)} onClick={() => { setReview(null); setAcknowledged(false); }} className={secondary}>Back to edit</button><button type="button" disabled={Boolean(busy) || !acknowledged} onClick={confirmImport} className={primary}>{busy === "import" ? "Importing…" : "Confirm and import"}</button></div>
      </div> : <form onSubmit={previewImport} className="space-y-5">
          {lockClass && <p className="rounded-xl bg-[var(--ed-subtle)] p-3 text-sm">Grade {gradeLevel} · {sectionName} · {selectedSubjects.map((subject) => subject.name).join(", ")}</p>}
          <fieldset hidden={lockClass} disabled={Boolean(busy)} className="space-y-4"><legend className="text-sm font-bold">1. Enter class details once</legend>
            <div className={`grid gap-4 pt-3 ${compact ? "" : "sm:grid-cols-2"}`}><div><label htmlFor="import-grade" className="text-sm font-semibold">Grade Level</label><ValidatedInput id="import-grade" label="Grade Level" kind="integer" min={1} value={gradeLevel} required onChange={(event) => { invalidateReview(); setGradeLevel(event.target.value); }} className={fieldClass} placeholder="e.g. 7" /></div><div><label htmlFor="import-section" className="text-sm font-semibold">Section Name</label><select id="import-section" value={sectionId} required onChange={(event) => { invalidateReview(); setSectionId(event.target.value); }} className={fieldClass}><option value="">Choose a registered section</option>{sectionOptions.map((section) => <option key={section.id} value={String(section.id)}>{section.name}</option>)}</select></div></div>
            {!sectionOptions.length && <p role="status" className="text-sm text-[var(--ed-muted)]">No registered sections yet. Create a section below before importing students.</p>}
            <div className="space-y-3">
              <button type="button" onClick={() => setAddingSection(!addingSection)} aria-expanded={addingSection} aria-controls="import-create-section" className="text-sm font-semibold text-[var(--ed-primary)]">{addingSection ? "Cancel new section" : "Section not listed? Create a section"}</button>
              {addingSection && <div id="import-create-section" className="rounded-xl border border-[var(--ed-border)] p-4"><label htmlFor="import-new-section" className="text-sm font-semibold">New Section Name</label><ValidatedInput id="import-new-section" label="Section Name" kind="section" value={newSectionName} onChange={(event) => setNewSectionName(event.target.value)} className={fieldClass} /><button type="button" onClick={createSection} className={`${secondary} mt-3`}>{busy === "section" ? "Creating section…" : "Create section"}</button></div>}
              <p className="text-sm text-[var(--ed-muted)]">New sections are registered in your account and selected here immediately. Students are imported only after final confirmation.</p>
            </div>
          </fieldset>
          {subjects.length > 0 && !lockClass && <fieldset disabled={Boolean(busy)} className="space-y-3 rounded-xl border border-[var(--ed-border)] p-3">
            <legend className="text-sm font-bold">Enroll new students in subjects (optional)</legend>
            <p className="text-xs leading-5 text-[var(--ed-muted)]">Selected subjects apply to new students in this import. Existing students keep their current enrollments.</p>
            <div className="max-h-48 space-y-2 overflow-y-auto">{subjects.map((subject) => <label key={subject.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={subjectIds.includes(String(subject.id))} onChange={(event) => {
                invalidateReview(); setSubjectIds((current) => event.target.checked ? [...current, String(subject.id)] : current.filter((id) => id !== String(subject.id)));
              }} className="mt-1 accent-[var(--ed-primary)]" /><span>{subject.name}</span>
            </label>)}</div>
          </fieldset>}
          <fieldset disabled={Boolean(busy)} className="space-y-4"><legend className="text-sm font-bold">2. Fill and upload your template</legend><p className="pt-3 text-sm text-[var(--ed-muted)]">The download fills Grade Level and Section once at the top. Paste one full name per row in Students, then save as .xlsx. Up to 1,000 students and 5 MB per file.</p><button type="button" onClick={downloadTemplate} className={secondary}>{busy === "download" ? "Preparing template…" : "Download class template"}</button><div><label htmlFor="student-import-file" className="text-sm font-semibold">Completed student names sheet</label><input ref={fileRef} id="student-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectFile} className={fieldClass} /></div></fieldset>
          {file && <p className="break-words text-sm">Selected file: {file.name}</p>}
          <p className="text-sm text-[var(--ed-muted)]">School year: {schoolYearName}. The next step shows a preview for final confirmation.</p><button type="submit" disabled={Boolean(busy) || !file} className={primary}>{busy === "review" ? "Checking workbook…" : "Review import"}</button>
      </form>}
    </div>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-[var(--ed-danger-soft)] p-4 text-sm text-[var(--ed-danger)]">{error}</p>}
    {result && <div className="mt-4 space-y-3 text-sm" aria-live="polite">
      {typeof result.imported_count === "number" && <p className="rounded-xl bg-[var(--ed-accent-soft)] p-4">{result.message}</p>}
      {Boolean(result.issues?.length || result.skipped?.length) && <ul className="max-h-64 space-y-2 overflow-auto rounded-xl border border-[var(--ed-border)] p-4">{[...(result.issues ?? []), ...(result.skipped ?? [])].map((issue, index) => <li key={index}>{issue.sheet ?? "Students"} row {issue.row}: {issue.name ? `${issue.name}: ` : ""}{issue.message}</li>)}</ul>}
    </div>}
  </section>;
}
