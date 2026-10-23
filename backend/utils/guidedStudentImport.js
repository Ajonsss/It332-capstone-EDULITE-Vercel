import fs from "node:fs/promises";
import JSZip from "jszip";
import { validateInput } from "../../shared/inputValidation.mjs";
import { MAX_IMPORT_ROWS, normalizeImportText, studentImportKey, StudentImportError } from "./studentImport.js";

export const IMPORT_TITLES = { names: "Import student names", grades: "Import students with assessment records" };
export const SIMPLE_HEADERS = ["Student Name"];
const blank = (value) => value == null || typeof value === "string" && !value.trim();
const cachedTemplates = new Map();
const templateFiles = {
  names: new URL("../templates/student-names.xlsx", import.meta.url),
  grades: new URL("../templates/student-grades.xlsx", import.meta.url),
};

export function importClassDetails({ mode, gradeLevel, sectionName }) {
  if (!Object.hasOwn(IMPORT_TITLES, mode)) throw new StudentImportError("Choose names only or students with existing grades.");
  const gradeText = String(gradeLevel ?? "").trim();
  const grade = /^\d+$/.test(gradeText) ? Number(gradeText) : NaN;
  if (!Number.isSafeInteger(grade) || grade < 1) throw new StudentImportError("Grade Level must be a positive whole number.");
  const section = normalizeImportText(sectionName);
  const error = validateInput(sectionName, { kind: "section", label: "Section Name" });
  if (error) throw new StudentImportError(error);
  return { mode, grade, section };
}

export async function createImportTemplate({ mode, gradeLevel, sectionName, subject }) {
  const details = importClassDetails({ mode, gradeLevel, sectionName });
  if (mode === "grades" && !subject?.name) throw new StudentImportError("Choose a subject before downloading the grades template.");
  if (!cachedTemplates.has(mode)) cachedTemplates.set(mode, fs.readFile(templateFiles[mode]));
  const zip = await JSZip.loadAsync(await cachedTemplates.get(mode));
  const sheetPath = "xl/worksheets/sheet1.xml";
  let xml = await zip.file(sheetPath).async("string");
  const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const [address, value] of [["B4", details.grade], ["B5", details.section], ...(mode === "grades" ? [["B6", subject.name]] : [])]) {
    const pattern = new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
    if (!pattern.test(xml)) throw new Error("Import template metadata cell is missing.");
    xml = xml.replace(pattern, (_match, attributes) => {
      const attrs = attributes.replace(/\s+t="[^"]*"/g, "");
      return typeof value === "number" ? `<c${attrs}><v>${value}</v></c>` : `<c${attrs} t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
    });
  }
  zip.file(sheetPath, xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function plain(cell) {
  if (cell?.formula || ["e", "b", "d"].includes(cell?.type)) throw new Error("Paste plain names and numbers. Formulas, dates and errors are not accepted.");
  return cell?.value;
}

export function parseGuidedStudentSheet(cells, options = {}) {
  const mode = Object.keys(IMPORT_TITLES).find((key) => cells.get("A2")?.value === IMPORT_TITLES[key]);
  if (!mode || options.importMode && mode !== options.importMode) throw new StudentImportError("Use the template for the selected import option. Download a new copy after changing the option.");
  const issues = [], students = [], grades = [], skipped = [], seen = new Set();
  let details, subject, metadataRow = 4;
  try {
    if (plain(cells.get("A4")) !== "Grade Level" || plain(cells.get("A5")) !== "Section Name") throw new Error("Keep the Grade Level and Section Name labels unchanged.");
    details = importClassDetails({ mode, gradeLevel: plain(cells.get("B4")), sectionName: plain(cells.get("B5")) });
    if (options.gradeLevel !== undefined) {
      const selected = importClassDetails({ mode, gradeLevel: options.gradeLevel, sectionName: options.sectionName });
      if (details.grade !== selected.grade || details.section.toLowerCase() !== selected.section.toLowerCase()) throw new Error("The workbook's Grade Level or Section differs from the class on screen. Correct the class details or upload the matching workbook.");
    }
    if (mode === "grades") {
      metadataRow = 6;
      if (plain(cells.get("A6")) !== "Subject") throw new Error("Keep the Subject label in row 6 unchanged.");
      subject = normalizeImportText(plain(cells.get("B6")));
      if (!subject || subject.toLowerCase() !== normalizeImportText(options.subjectName).toLowerCase()) throw new Error("The workbook's Subject must match the subject selected on screen. Download a template for that subject.");
    }
  } catch (error) { issues.push({ sheet: "Students", row: metadataRow, message: error.message }); }
  const headers = SIMPLE_HEADERS.slice(0, 1);
  try {
    for (const [index, header] of headers.entries()) {
      if (plain(cells.get(`${"ABCD"[index]}8`)) !== header) throw new Error(`Keep row 8 headers as: ${headers.join(", ")}.`);
    }
  } catch (error) { throw new StudentImportError(error.message, [{ sheet: "Students", row: 8, message: error.message }]); }
  const rows = [...new Set([...cells.keys()].filter((a) => /^[A-D]\d+$/.test(a) && Number(a.slice(1)) >= 9).map((a) => Number(a.slice(1))))].sort((a, b) => a - b);
  let count = 0;
  for (const row of rows) {
    const source = [..."ABCD"].map((column) => cells.get(`${column}${row}`));
    if (source.every((cell) => blank(cell?.value) && !cell?.formula)) continue;
    if (++count > MAX_IMPORT_ROWS) break;
    try {
      const [rawName, ...rawTerms] = source.map(plain);
      const name = normalizeImportText(rawName);
      const error = validateInput(rawName, { kind: "personName", label: "Student Name" });
      if (error) throw new Error(error);
      if (rawTerms.some((value) => !blank(value))) throw new Error(mode === "names" ? "This is a names-only import. Remove grades and scores from the student names sheet." : "Enter individual scores in the Term 1, Term 2 and Term 3 sheets, not final term grades next to the names.");
      if (!details) continue;
      const student = { sheet: "Students", row, grade: details.grade, section: details.section, name };
      const key = studentImportKey(student);
      if (seen.has(key)) {
        if (mode === "grades") throw new Error("Duplicate student name. Use one roster row per student and put all their assessment scores on the matching term-sheet row.");
        skipped.push({ sheet: "Students", row, name, message: "Duplicate student name in this workbook." });
        continue;
      }
      seen.add(key); students.push(student);
    } catch (error) { issues.push({ sheet: "Students", row, message: error.message }); }
  }
  if (count > MAX_IMPORT_ROWS) throw new StudentImportError(`Upload at most ${MAX_IMPORT_ROWS} students at a time.`);
  if (!count) throw new StudentImportError("The student list is empty. Paste names below the row 8 headers, starting in row 9.");
  if (issues.length) throw new StudentImportError("Fix the listed rows before reviewing the import. Nothing has been imported.", issues);
  return { format: "guided", mode, students, grades, skipped };
}
