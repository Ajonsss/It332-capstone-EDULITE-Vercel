import { validateInput } from "../../shared/inputValidation.mjs";

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const IMPORT_HEADERS = ["Grade Level", "Section", "Student Name"];
export const GRADE_IMPORT_HEADERS = [...IMPORT_HEADERS, "Subject", "Term 1 Grade", "Term 2 Grade", "Term 3 Grade"];
export const MAX_GRADE_IMPORT_ROWS = 10000;

export class StudentImportError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.issues = issues;
    this.status = 422;
  }
}

export function normalizeImportText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cellValue(cell) {
  const value = cell.value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    // Formula results, dates, errors and hyperlinks are not student input.
    throw new Error("Use plain text or numbers, not formulas, dates, or links.");
  }
  return value;
}

export function studentImportKey({ grade, section, name }) {
  return JSON.stringify([grade, section.toLowerCase(), name.toLowerCase()]);
}

export async function parseStudentWorkbook(buffer, options = {}) {
  const { openWorkbookXml } = await import("./workbookXml.js");
  let xml;
  try { xml = await openWorkbookXml(buffer); }
  catch {
    throw new StudentImportError("Unable to read this Excel file. Upload a valid, unprotected .xlsx or .xlsm file.");
  }
  if (options.namesOnly && (xml.sheets.size !== 1 || !xml.sheets.has("Students"))) {
    throw new StudentImportError("Only student names can be imported for now. Upload the single-sheet student names template without grades or assessment worksheets.");
  }
  if (xml.sheets.has("Students")) {
    try {
      const cells = await xml.cells("Students", (a) => /^[A-D]\d+$/.test(a));
      const { IMPORT_TITLES, parseGuidedStudentSheet } = await import("./guidedStudentImport.js");
      if (options.namesOnly && cells.get("A2")?.value === IMPORT_TITLES.grades) {
        throw new StudentImportError("Only student names can be imported for now. Download the student names template.");
      }
      if (options.importMode || Object.values(IMPORT_TITLES).includes(cells.get("A2")?.value)) {
        const parsed = parseGuidedStudentSheet(cells, options);
        if (parsed.mode === "grades") {
          const { parseAssessmentSheets } = await import("./assessmentWorkbook.js");
          return { ...parsed, ...await parseAssessmentSheets(xml, parsed.students) };
        }
        return parsed;
      }
    } catch (error) {
      if (error instanceof StudentImportError) throw error;
      throw new StudentImportError("Unable to read the Students worksheet. Upload a valid .xlsx template with plain names and grades.");
    }
  }
  if (options.importMode) throw new StudentImportError("Use the simplified Students template downloaded for this import option.");
  if (!xml.sheets.has("Students") && xml.sheets.has("INPUT")) {
    if (!["TERM1", "TERM2", "TERM3"].every((name) => xml.sheets.has(name))) {
      throw new StudentImportError("Keep the ECR worksheets INPUT, TERM1, TERM2 and TERM3 unchanged.");
    }
    try {
      const { parseEcrWorkbook } = await import("./ecrImport.js");
      return await parseEcrWorkbook(xml, options);
    } catch (error) {
      if (error instanceof StudentImportError) throw error;
      throw new StudentImportError("Unable to read the ECR workbook. Keep the supplied layout and save it in Excel before uploading.");
    }
  }
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new StudentImportError("Unable to read this Excel file. Upload a valid, unprotected .xlsx file.");
  }
  const sheet = workbook.getWorksheet("Students");
  if (!sheet) {
    throw new StudentImportError('The file must contain a worksheet named "Students". Download the template first.');
  }
  const columns = new Map();
  try {
    sheet.getRow(1).eachCell((cell, column) => {
      const header = normalizeImportText(cellValue(cell)).toLowerCase();
      if (columns.has(header)) throw new Error("Duplicate column headers.");
      columns.set(header, column);
    });
  } catch {
    throw new StudentImportError("Keep the template column headers as plain, unique text in row 1.");
  }
  if (IMPORT_HEADERS.some((header) => !columns.has(header.toLowerCase()))) {
    throw new StudentImportError(`Row 1 must contain: ${IMPORT_HEADERS.join(", ")}.`);
  }
  const students = [];
  const issues = [];
  const skipped = [];
  const seen = new Set();
  let populatedRows = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = IMPORT_HEADERS.map((header) => row.getCell(columns.get(header.toLowerCase())));
    if (cells.every((cell) => cell.value == null || cell.value === "" ||
      (typeof cell.value === "string" && !cell.value.trim()))) return;
    populatedRows += 1;
    if (populatedRows > MAX_IMPORT_ROWS) return;
    try {
      const [rawGrade, rawSection, rawName] = cells.map(cellValue);
      const gradeText = typeof rawGrade === "number" ? String(rawGrade) : normalizeImportText(rawGrade);
      const grade = /^\d+$/.test(gradeText) ? Number(gradeText) : NaN;
      const section = typeof rawSection === "number" ? String(rawSection) : normalizeImportText(rawSection);
      const name = normalizeImportText(rawName);
      const errors = [];
      if (!Number.isSafeInteger(grade) || grade < 1) errors.push("Grade Level must be a positive whole number (for example, 7).");
      if (!section) errors.push("Section is required.");
      if (!name) errors.push("Student Name is required as text.");
      if (section) {
        const sectionError = validateInput(typeof rawSection === "number" ? String(rawSection) : rawSection, { kind: "section", label: "Section" });
        if (sectionError) errors.push(sectionError);
      }
      if (name) {
        const nameError = validateInput(rawName, { kind: "personName", label: "Student Name" });
        if (nameError) errors.push(nameError);
      }
      if (errors.length) {
        issues.push({ row: rowNumber, message: errors.join(" ") });
        return;
      }
      const student = { row: rowNumber, grade, section, name };
      const key = studentImportKey(student);
      if (seen.has(key)) {
        skipped.push({ row: rowNumber, name, message: "Duplicate name, grade and section in this file." });
      } else {
        seen.add(key);
        students.push(student);
      }
    } catch (error) {
      issues.push({ row: rowNumber, message: error.message });
    }
  });
  if (populatedRows > MAX_IMPORT_ROWS) {
    throw new StudentImportError(`Upload at most ${MAX_IMPORT_ROWS} students at a time.`);
  }
  if (!populatedRows) throw new StudentImportError("The Students worksheet is empty. Paste your students below the headers.");
  if (issues.length) throw new StudentImportError("Fix the listed rows and upload again. No students were imported.", issues);
  const grades = parseGradeRows(workbook.getWorksheet("Grades"), students);
  return { students, skipped, grades };
}

function parseGradeRows(sheet, students) {
  if (!sheet) return [];
  const columns = new Map();
  try {
    sheet.getRow(1).eachCell((cell, column) => {
      const header = normalizeImportText(cellValue(cell)).toLowerCase();
      if (columns.has(header)) throw new Error("Duplicate Grades headers.");
      columns.set(header, column);
    });
  } catch {
    throw new StudentImportError("Grades row 1 must have plain, unique column headers.");
  }
  if (GRADE_IMPORT_HEADERS.some((header) => !columns.has(header.toLowerCase()))) {
    throw new StudentImportError(`Grades row 1 must contain: ${GRADE_IMPORT_HEADERS.join(", ")}.`);
  }
  const roster = new Set(students.map(studentImportKey));
  const seen = new Set();
  const grades = [];
  const issues = [];
  let count = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = GRADE_IMPORT_HEADERS.map((header) => row.getCell(columns.get(header.toLowerCase())));
    if (cells.every((cell) => cell.value == null || typeof cell.value === "string" && !cell.value.trim())) return;
    if (++count > MAX_GRADE_IMPORT_ROWS) return;
    try {
      const [level, section, name, subject, ...values] = cells.map(cellValue);
      const gradeText = typeof level === "number" ? String(level) : normalizeImportText(level);
      const identity = { grade: /^\d+$/.test(gradeText) ? Number(gradeText) : NaN,
        section: typeof section === "number" ? String(section) : normalizeImportText(section), name: normalizeImportText(name) };
      const studentKey = studentImportKey(identity);
      if (!roster.has(studentKey)) throw new Error("Match Grade Level, Section and Student Name to a row in the Students worksheet.");
      const subjectName = normalizeImportText(subject);
      if (!subjectName) throw new Error("Subject is required for existing grades.");
      const terms = values.map((value, index) => {
        if (value == null || typeof value === "string" && !value.trim()) return null;
        const text = typeof value === "number" ? String(value) : normalizeImportText(value);
        const number = /^\d+(?:\.\d{1,2})?$/.test(text) ? Number(text) : NaN;
        if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error(`Term ${index + 1} Grade must be a number from 0 to 100 with at most two decimal places. Leave missing grades blank.`);
        return number;
      });
      if (terms.every((value) => value === null)) throw new Error("Enter at least one term grade, or leave this entire row blank.");
      const key = `${studentKey}:${subjectName.toLowerCase()}`;
      if (seen.has(key)) throw new Error("Use one Grades row per student and subject. Combine term grades into that row.");
      seen.add(key);
      grades.push({ row: rowNumber, sheet: "Grades", studentKey, subject: subjectName, term1: terms[0], term2: terms[1], term3: terms[2] });
    } catch (error) {
      issues.push({ sheet: "Grades", row: rowNumber, message: error.message });
    }
  });
  if (count > MAX_GRADE_IMPORT_ROWS) throw new StudentImportError(`Upload at most ${MAX_GRADE_IMPORT_ROWS} grade rows at a time.`);
  if (issues.length) throw new StudentImportError("Fix the listed Grades rows and upload again. No students or grades were imported.", issues);
  return grades;
}
