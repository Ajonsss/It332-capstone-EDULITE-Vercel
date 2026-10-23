import { isCalendarDate, validateInput } from "../../shared/inputValidation.mjs";
import { StudentImportError, normalizeImportText, studentImportKey } from "./studentImport.js";

export const ASSESSMENT_IMPORT_SLOTS = Object.freeze([
  ...Array.from({ length: 5 }, (_, i) => ({ column: String.fromCharCode(66 + i), label: `WW${i + 1}`, category: "written_work", sequence: i + 1 })),
  ...Array.from({ length: 3 }, (_, i) => ({ column: String.fromCharCode(71 + i), label: `PT${i + 1}`, category: "performance_task", sequence: i + 1 })),
  { column: "J", label: "ST1", category: "summative_test", sequence: 1 },
  { column: "K", label: "ST2", category: "summative_test", sequence: 2 },
  { column: "L", label: "TE", category: "term_exam", sequence: 1 },
]);
const blank = (value) => value == null || typeof value === "string" && !value.trim();
const plain = (cell) => {
  if (cell?.formula || ["e", "b", "d"].includes(cell?.type)) throw new Error("Paste plain assessment details and scores, not formulas or errors.");
  return cell?.value;
};
function whole(value, min, max = Number.MAX_SAFE_INTEGER) {
  const text = typeof value === "number" ? String(value) : normalizeImportText(value);
  const number = /^\d+$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : NaN;
}
function assessmentDate(value, date1904) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 2958465) {
    // Excel saves date cells as serial numbers. Reject the fictitious 1900-02-29.
    if (!date1904 && value === 60) return null;
    const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
    const day = new Date(epoch + (value + (!date1904 && value < 60 ? 1 : 0)) * 86400000);
    if (Number.isNaN(day.getTime())) return null;
    value = day.toISOString().slice(0, 10);
  }
  return isCalendarDate(value) ? value : null;
}
function rosterLink(cell, row, name) {
  if (!cell?.formula) return normalizeImportText(cell?.value) === name;
  const master = cell.formulaMaster;
  const formula = (master?.text ?? cell.formulaText ?? "").replace(/\s/g, "").replace(/'/g, "").toUpperCase();
  const baseRow = master ? Number(master.address.match(/\d+$/)[0]) : row;
  if (baseRow !== row && /\$\d/.test(formula)) return false;
  return formula.replace(/\$/g, "") === `IF(STUDENTS!A${baseRow}="","",STUDENTS!A${baseRow})`;
}

export async function parseAssessmentSheets(workbook, students) {
  const assessments = [], scores = [], issues = [];
  const roster = new Map(students.map((student) => [student.row, student]));
  const issue = (sheet, row, column, message) => issues.push({ sheet, row, message: `${column}${row}: ${message}` });
  for (const term of [1, 2, 3]) {
    const sheet = `Term ${term}`;
    if (!workbook.sheets.has(sheet)) throw new StudentImportError(`Keep the Students, Term 1, Term 2 and Term 3 worksheets. Download the assessment-records template.`);
    const cells = await workbook.cells(sheet);
    if (plain(cells.get("A8")) !== "Student Name" || plain(cells.get("A3")) !== "Assessment Name" || plain(cells.get("A4")) !== "Highest Possible Score" || plain(cells.get("A5")) !== "Assessment Date" || plain(cells.get("A6")) !== "Budget of Work (optional)") throw new StudentImportError(`Keep the labels and row 8 headers in ${sheet} unchanged.`);
    const rowNumbers = [...new Set([...cells.keys()].filter((address) => /^[A-Z]+\d+$/.test(address) && Number(address.match(/\d+$/)[0]) >= 9).map((address) => Number(address.match(/\d+$/)[0])))];
    const linksChecked = new Set();
    for (const slot of ASSESSMENT_IMPORT_SLOTS) {
      const { column, label, category, sequence } = slot;
      if (plain(cells.get(`${column}8`)) !== label) throw new StudentImportError(`Keep ${sheet} ${column}8 as ${label}.`);
      const metadata = [3, 4, 5, 6].map((row) => cells.get(`${column}${row}`));
      const hasDefinition = metadata.some((cell) => !blank(cell?.value) || cell?.formula);
      let definition;
      if (hasDefinition) {
        try {
          const [rawName, rawHps, rawDate, rawBudget] = metadata.map(plain);
          const name = normalizeImportText(rawName), totalItems = whole(rawHps, 1), date = assessmentDate(rawDate, workbook.date1904);
          const nameError = validateInput(rawName, { kind: "assessment", label: "Assessment Name" });
          if (nameError) throw new Error(nameError);
          if (!Number.isFinite(totalItems)) throw new Error("Highest Possible Score must be a positive whole number.");
          if (!date) throw new Error("Enter the actual assessment date as YYYY-MM-DD or an Excel date.");
          const budgetError = validateInput(rawBudget, { kind: "budgetOfWork", label: "Budget of Work", required: false });
          if (budgetError) throw new Error(budgetError);
          definition = { key: `${term}:${category}:${sequence}`, sheet, row: 3, column, label, name, term, category, sequence, totalItems, date, budgetOfWork: typeof rawBudget === "string" ? rawBudget.trim() : "" };
          assessments.push(definition);
        } catch (error) { issue(sheet, 3, column, error.message); }
      }
      for (const row of rowNumbers) {
        const cell = cells.get(`${column}${row}`);
        if (blank(cell?.value) && !cell?.formula) continue;
        const student = roster.get(row);
        if (!student) { issue(sheet, row, column, "There is a score without a student in the same Students row. Add the name to Students or clear this score."); continue; }
        if (!linksChecked.has(row)) {
          if (!rosterLink(cells.get(`A${row}`), row, student.name)) issue(sheet, row, "A", "The learner name must link to the same Students row or match that learner exactly. Do not sort the score sheets separately.");
          linksChecked.add(row);
        }
        if (!hasDefinition) { issue(sheet, row, column, "Enter the assessment name, maximum score and date above this column first."); continue; }
        if (!definition) continue;
        try {
          const score = whole(plain(cell), 0, definition.totalItems);
          if (!Number.isFinite(score)) throw new Error(`Score must be a whole number from 0 to ${definition.totalItems}. Leave missing scores blank.`);
          scores.push({ sheet, row, column, studentKey: studentImportKey(student), assessmentKey: definition.key, score });
        } catch (error) { issue(sheet, row, column, error.message); }
      }
    }
    for (const [address, cell] of cells) {
      const match = /^([A-Z]+)(\d+)$/.exec(address);
      if (match && Number(match[2]) >= 9 && !/^[A-L]$/.test(match[1]) && (!blank(cell.value) || cell.formula)) issue(sheet, Number(match[2]), match[1], "Use the existing WW1–WW5, PT1–PT3, ST1, ST2 and TE columns. Additional score columns are not imported.");
    }
  }
  if (!assessments.length && !issues.length) throw new StudentImportError("Enter at least one assessment in Term 1, Term 2 or Term 3, or choose names only.");
  if (issues.length) throw new StudentImportError("Fix the listed assessment cells before reviewing. Nothing has been imported.", issues);
  return { assessments, scores };
}
