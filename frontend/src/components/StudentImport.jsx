import { useRef, useState } from "react";
import axios from "axios";

const API_URL = "http://localhost:3000";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export default function StudentImport({ subjects, onImported }) {
  const [expanded, setExpanded] = useState(false);
  const [file, setFile] = useState(null);
  const [subjectIds, setSubjectIds] = useState([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const selectFile = (event) => {
    const selected = event.target.files?.[0] ?? null;
    setResult(null);
    setError("");
    setFile(null);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".xlsx")) {
      setError("Choose an Excel workbook (.xlsx).");
      event.target.value = "";
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setError("The Excel file must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }
    setFile(selected);
  };

  const handleImport = async (event) => {
    event.preventDefault();
    if (importing) return;
    if (!file || !subjectIds.length) {
      setError("Choose an Excel file and at least one subject.");
      return;
    }
    setImporting(true);
    setError("");
    setResult(null);
    const data = new FormData();
    data.append("file", file);
    data.append("subject_ids", JSON.stringify(subjectIds));
    try {
      const response = await axios.post(`${API_URL}/students/import`, data);
      setResult(response.data);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      try {
        await onImported();
      } catch {
        setError("Import completed, but the student list could not refresh. Reload the page to see the results.");
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to complete the import. Reload the student list before retrying.");
      setResult(requestError.response?.data ?? null);
      // A connection failure can occur after the server has saved students.
      if (!requestError.response || requestError.response.status >= 500) {
        await onImported().catch(() => {});
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-6 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-[var(--ed-color-25313c)]">Import students from Excel</h3>
          <p className="mt-1 text-sm text-[var(--ed-color-71808d)]">Register a class at once using grade level, section, and student names.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <a href="/templates/student-import-template.xlsx" download className="rounded-[12px] border border-[var(--ed-color-d8e1e7)] px-4 py-2.5 text-sm font-semibold text-[var(--ed-color-25313c)] hover:bg-[var(--ed-color-f5f8fa)]">Download template</a>
          <button type="button" disabled={importing} onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="student-import-form" className="rounded-[12px] bg-[var(--ed-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:opacity-50">{expanded ? "Close import" : "Upload Excel file"}</button>
        </div>
      </div>
      {expanded && (
        <form id="student-import-form" onSubmit={handleImport} className="mt-6 space-y-5 border-t border-[var(--ed-color-e3e9ee)] pt-5">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--ed-color-71808d)]">
            <li>Download the template and paste one student per row in the Students worksheet.</li>
            <li>Fill Grade Level with a whole number (for example, 7), Section, and Student Name on every row.</li>
            <li>Save as .xlsx, choose the subjects for this class, and import.</li>
          </ol>
          <p className="text-sm text-[var(--ed-color-71808d)]">Up to 1,000 students and 5 MB per file. Missing sections are created automatically. Matching names in the same grade and section are skipped. Existing subject enrollments stay as they are.</p>
          <div>
            <label htmlFor="student-import-file" className="mb-2 block text-sm font-semibold text-[var(--ed-color-25313c)]">Excel file</label>
            <input ref={fileInputRef} id="student-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectFile} disabled={importing} className="block w-full rounded-[12px] border border-[var(--ed-color-d8e1e7)] p-3 text-sm text-[var(--ed-color-25313c)] file:mr-4 file:rounded-lg file:border-0 file:bg-[var(--ed-color-edf7fc)] file:px-3 file:py-2 file:font-semibold file:text-[var(--ed-color-168cc8)]" />
          </div>
          <fieldset disabled={importing}>
            <legend className="text-sm font-semibold text-[var(--ed-color-25313c)]">Subjects for all imported students</legend>
            <p className="mt-1 text-sm text-[var(--ed-color-71808d)]">Choose at least one subject. You can edit each student's enrollment later.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {subjects.map((subject) => (
                <label key={subject.id} className="flex cursor-pointer items-center gap-2 rounded-[12px] border border-[var(--ed-color-d8e1e7)] px-3 py-2 text-sm text-[var(--ed-color-25313c)]">
                  <input type="checkbox" checked={subjectIds.includes(String(subject.id))} onChange={(event) => setSubjectIds((current) => event.target.checked ? [...current, String(subject.id)] : current.filter((id) => id !== String(subject.id)))} className="accent-[var(--ed-primary)]" />
                  {subject.name}
                </label>
              ))}
            </div>
            {!subjects.length && <p className="mt-3 text-sm text-[var(--ed-color-b45309)]">Add a subject from the Subjects page before importing students.</p>}
          </fieldset>
          {error && <p role="alert" className="rounded-[12px] bg-[var(--ed-color-fff1f2)] px-4 py-3 text-sm text-[var(--ed-color-be123c)]">{error}</p>}
          {result && (
            <div aria-live="polite" className="space-y-3 text-sm">
              {typeof result.imported_count === "number" && <p className="rounded-[12px] bg-[var(--ed-color-edf7fc)] px-4 py-3 font-semibold text-[var(--ed-color-168cc8)]">{result.message}</p>}
              {Boolean(result.issues?.length || result.skipped?.length) && (
                <div className="max-h-64 overflow-auto rounded-[12px] border border-[var(--ed-color-e3e9ee)]">
                  <table className="w-full text-left">
                    <thead className="bg-[var(--ed-color-f5f8fa)] text-[var(--ed-color-25313c)]"><tr><th scope="col" className="px-4 py-2">Excel row</th><th scope="col" className="px-4 py-2">Result</th></tr></thead>
                    <tbody className="divide-y divide-[var(--ed-color-e3e9ee)] text-[var(--ed-color-71808d)]">
                      {[...(result.issues ?? []), ...(result.skipped ?? [])].map((issue) => <tr key={issue.row}><td className="px-4 py-2">{issue.row}</td><td className="px-4 py-2">{issue.name ? `${issue.name}: ` : ""}{issue.message}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <button type="submit" disabled={importing || !file || !subjectIds.length} className="rounded-[12px] bg-[var(--ed-primary)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50">{importing ? "Importing students..." : "Import students"}</button>
        </form>
      )}
    </section>
  );
}
