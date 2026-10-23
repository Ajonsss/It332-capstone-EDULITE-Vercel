import { validateInput } from "../../shared/inputValidation.mjs";
import { normalizeImportText, StudentImportError, studentImportKey } from "./studentImport.js";

const ROSTER_ROWS = [...Array.from({ length: 50 }, (_, i) => i + 12), ...Array.from({ length: 50 }, (_, i) => i + 63)];
const SCORE_COLUMNS = ["F", "G", "H", "I", "J", "N", "O", "P", "T", "U", "V"];
const blank = (value) => value == null || typeof value === "string" && !value.trim();

function literal(cell, label) {
  if (cell?.formula || cell?.type === "e" || cell?.type === "b" || cell?.type === "d") throw new Error(`${label} must be plain text or a number.`);
  return cell?.value;
}

export async function parseEcrWorkbook(workbook, { ecrTerms = [] } = {}) {
  if (!Array.isArray(ecrTerms) || ecrTerms.some((term) => ![1, 2, 3].includes(term))) throw new StudentImportError("Choose valid ECR terms (1, 2 or 3).");
  ecrTerms = [...new Set(ecrTerms)];
  const input = await workbook.cells("INPUT", (a) => /^(B\d+|F7|J7|W7|Y7)$/.test(a));
  const issues = [], students = [], skipped = [], grades = [], seen = new Set();
  const issue = (sheet, row, message) => issues.push({ sheet, row, message });
  // These labels identify this specific template, rather than any file with
  // similarly named sheets. Its shared INPUT and term rows must stay aligned.
  if (normalizeImportText(input.get("B8")?.value) !== "LEARNERS' NAMES" ||
      normalizeImportText(input.get("F7")?.value) !== "GRADE & SECTION:" ||
      normalizeImportText(input.get("W7")?.value) !== "SUBJECT:" ||
      normalizeImportText(input.get("B11")?.value) !== "MALE" ||
      normalizeImportText(input.get("B62")?.value) !== "FEMALE") {
    throw new StudentImportError("Keep the supplied trimester ECR template's INPUT layout and worksheet names unchanged.");
  }
  const populated = ROSTER_ROWS.filter((row) => !blank(input.get(`B${row}`)?.value) || input.get(`B${row}`)?.formula);
  if (!populated.length) throw new StudentImportError("The INPUT roster is empty. Enter learners in B12:B61 and B63:B112 before importing.");
  let grade, section, subject;
  try {
    const classLabel = normalizeImportText(literal(input.get("J7"), "INPUT J7"));
    const match = /^(?:grade\s*)?(10|[4-9])(?:\s*[-–—:/]\s*|\s+)(.+)$/i.exec(classLabel);
    if (!match) throw new Error('Set INPUT J7 (Grade & Section) to e.g. "7 - Rose". This ECR supports Grades 4–10.');
    grade = Number(match[1]); section = normalizeImportText(match[2]);
    const error = validateInput(section, { kind: "section", label: "Section" });
    if (error) throw new Error(error);
  } catch (error) { issue("INPUT", 7, error.message); }
  if (ecrTerms.length) {
    try {
      subject = normalizeImportText(literal(input.get("Y7"), "INPUT Y7"));
      if (!subject || subject === "ENG/FIL/MATH/SCI/AP/GMRC/VALUES") throw new Error("Replace INPUT Y7's subject placeholder with the name of one selected subject, for example Mathematics.");
      const error = validateInput(subject, { kind: "subject", label: "Subject" });
      if (error) throw new Error(error);
    } catch (error) { issue("INPUT", 7, error.message); }
  }
  for (const row of populated) {
    try {
      const name = normalizeImportText(literal(input.get(`B${row}`), "Learner name"));
      const error = validateInput(name, { kind: "personName", label: "Learner name" });
      if (error) throw new Error(error);
      if (!grade || !section) continue;
      const student = { sheet: "INPUT", row, grade, section, name };
      const key = studentImportKey(student);
      // Different slots can contain different term results. Do not choose a
      // grade silently when two roster entries identify the same student.
      if (seen.has(key)) {
        if (ecrTerms.length) throw new Error("Duplicate learner name in this class. Resolve it before importing grades.");
        skipped.push({ sheet: "INPUT", row, name, message: "Duplicate name, grade and section in this file." });
      } else { seen.add(key); students.push(student); }
    } catch (error) { issue("INPUT", row, error.message); }
  }
  for (const term of ecrTerms) {
    const sheet = `TERM${term}`;
    const cells = await workbook.cells(sheet, (a) => /^(B\d+|AA\d+|[FGHIJNOPUVT]\d+)$/.test(a));
    if (normalizeImportText(cells.get("AA8")?.value).toLowerCase() !== "term grade") throw new StudentImportError(`${sheet} AA8 must remain the template's Term Grade column.`);
    for (const student of students) {
      const row = student.row, cell = cells.get(`AA${row}`);
      const scores = SCORE_COLUMNS.map((column) => cells.get(`${column}${row}`)?.value);
      const hasScores = scores.some((value) => !blank(value));
      if (blank(cell?.value)) {
        if (cell?.type === "e" || hasScores) issue(sheet, row, `AA${row} has no saved term grade. Complete this term, recalculate and save in Excel, or deselect Term ${term} on the upload screen.`);
        continue;
      }
      if (cell.type === "e" || typeof cell.value !== "number" || !Number.isFinite(cell.value) || cell.value < 0 || cell.value > 100 || Math.abs(cell.value * 100 - Math.round(cell.value * 100)) > 1e-8) {
        issue(sheet, row, `AA${row} must contain a saved final term grade from 0 to 100, with at most two decimal places.`); continue;
      }
      if (normalizeImportText(cells.get(`B${row}`)?.value) !== student.name) {
        issue(sheet, row, "The saved learner name does not match INPUT. Recalculate and save the workbook in Excel before uploading."); continue;
      }
      if (cell.formula) {
        // The supplied file contains sample scores and a cached 60 despite
        // blank maximum scores. Such a result is not an existing term grade.
        const hasGroup = (columns) => columns.some((column) => !blank(cells.get(`${column}${row}`)?.value));
        const missingGroup = !hasGroup(["F", "G", "H", "I", "J"]) || !hasGroup(["N", "O", "P"]) || !["T", "U", "V"].every((column) => !blank(cells.get(`${column}${row}`)?.value));
        const invalidScores = SCORE_COLUMNS.some((column) => {
          const score = cells.get(`${column}${row}`)?.value, maximum = cells.get(`${column}10`)?.value;
          return !blank(score) && !(typeof score === "number" && Number.isFinite(score) && score >= 0 &&
            typeof maximum === "number" && Number.isFinite(maximum) && maximum > 0 && score <= maximum);
        });
        if (missingGroup || invalidScores) {
          issue(sheet, row, "The calculated term grade has incomplete scores or maximum scores. Replace the template's samples with actual completed scores, then recalculate and save in Excel, or deselect this term."); continue;
        }
      }
      const key = studentImportKey(student);
      let record = grades.find((entry) => entry.studentKey === key);
      if (!record) { record = { sheet: "INPUT", row, studentKey: key, subject, term1: null, term2: null, term3: null }; grades.push(record); }
      record[`term${term}`] = cell.value;
    }
  }
  if (issues.length) throw new StudentImportError("Fix the listed ECR cells and upload again. No students or grades were imported.", issues);
  return { students, skipped, grades };
}
