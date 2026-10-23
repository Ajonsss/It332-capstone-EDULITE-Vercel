import { StudentImportError, studentImportKey } from "../utils/studentImport.js";

export function prepareGradeImport({ grades, subjects, sections, existingStudents, importedAt, allowEnrollment = false }) {
  const subjectByName = new Map(subjects.map((subject) => [subject.name?.trim().replace(/\s+/g, " ").toLowerCase(), subject]));
  const sectionNames = new Map(sections.map((section) => [String(section._id), section.name]));
  const existingByKey = new Map();
  const ambiguous = new Set();
  for (const student of existingStudents) {
    const key = studentImportKey({ ...student, section: sectionNames.get(String(student.sectionId)) ?? "" });
    if (existingByKey.has(key)) ambiguous.add(key);
    existingByKey.set(key, student);
  }
  const plans = new Map();
  const issues = [];
  for (const row of grades) {
    const issue = (message) => issues.push({ sheet: row.sheet ?? "Grades", row: row.row, message });
    const subject = subjectByName.get(row.subject.toLowerCase());
    if (!subject) { issue(`Subject "${row.subject}" must match a selected subject on the upload screen.`); continue; }
    if (ambiguous.has(row.studentKey)) { issue("Multiple existing students match this name, grade and section. Resolve the duplicate registrations before importing grades."); continue; }
    const existing = existingByKey.get(row.studentKey);
    const needsEnrollment = existing && !(existing.subjectIds ?? []).some((id) => String(id) === String(subject._id));
    if (needsEnrollment && !allowEnrollment) {
      issue(`This existing student is not enrolled in ${subject.name}. Update the enrollment first.`); continue;
    }
    if (!plans.has(row.studentKey)) plans.set(row.studentKey, {
      existing, before: existing?.importedGrades,
      merged: (existing?.importedGrades ?? []).map((entry) => ({ ...entry })),
      termCount: 0, rows: [], subjectIds: [], enrollSubjectIds: [],
    });
    const plan = plans.get(row.studentKey);
    plan.subjectIds.push(subject._id);
    if (needsEnrollment) plan.enrollSubjectIds.push(subject._id);
    plan.rows.push({ sheet: row.sheet ?? "Grades", row: row.row });
    if (["term1", "term2", "term3"].every((key) => row[key] === null)) continue;
    let entry = plan.merged.find((grade) => String(grade.subjectId) === String(subject._id));
    if (!entry) { entry = { subjectId: subject._id, term1: null, term2: null, term3: null, importedAt }; plan.merged.push(entry); }
    for (const key of ["term1", "term2", "term3"]) {
      if (row[key] === null) continue;
      if (entry[key] != null && entry[key] !== row[key]) {
        issue(`${key.replace("term", "Term ")} already has an imported grade (${entry[key]}). Existing grades are preserved. Remove or correct this cell.`);
      } else if (entry[key] == null) {
        entry[key] = row[key]; entry.importedAt = importedAt; plan.termCount++;
      }
    }
  }
  if (issues.length) throw new StudentImportError("Fix the listed Grades rows. No students or grades were imported.", issues);
  return plans;
}
