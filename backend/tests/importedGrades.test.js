import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import Student from "../models/Student.js";
import express from "express";
import { once } from "node:events";
import { createStudentImportRouter } from "../studentImport.js";
import assessmentRouter from "../assessment.js";
import Subject from "../models/Subject.js";
import Assessment from "../models/Assessment.js";
import AssessmentScore from "../models/AssessmentScore.js";
import { buildYearEndReports } from "../studentLifecycle.js";
import { parseStudentWorkbook, IMPORT_HEADERS, GRADE_IMPORT_HEADERS } from "../utils/studentImport.js";
import { prepareGradeImport } from "../services/gradeImport.js";
import { calculateStudentSubjectGrade, calculateTermGrade } from "../utils/grading.js";
import { classifyYearEnd } from "../utils/yearEnd.js";
import { ecrWorkbook, completedTerm } from "./helpers/ecrWorkbook.js";

const subjectId = "507f1f77bcf86cd799439012";
const sectionId = "507f1f77bcf86cd799439013";
const studentKey = JSON.stringify([7, "rose", "maria santos"]);
async function workbook(rows, { roster = [[7, "Rose", "Maria Santos"]], headers = GRADE_IMPORT_HEADERS } = {}) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Students").addRows([IMPORT_HEADERS, ...roster]);
  book.addWorksheet("Grades").addRows([headers, ...rows]);
  return book.xlsx.writeBuffer();
}

test("term grade import accepts multiple subjects, zero, decimals and missing terms", async () => {
  const parsed = await parseStudentWorkbook(await workbook([
    ["7", " ROSE ", " Maria  Santos ", "Mathematics", 85.25, 0, ""],
    [7, "Rose", "Maria Santos", "Science", "90", null, 95], [],
  ]));
  assert.equal(parsed.students.length, 1);
  assert.equal(parsed.grades.length, 2);
  assert.equal(parsed.grades[0].studentKey, studentKey);
  assert.deepEqual([parsed.grades[0].term1, parsed.grades[0].term2, parsed.grades[0].term3], [85.25, 0, null]);
});

test("invalid or conflicting Grades rows reject the entire workbook before writing", async () => {
  for (const value of [-1, 101, true, "85%", "8e1", 80.123, { formula: "80+5", result: 85 }]) {
    await assert.rejects(parseStudentWorkbook(await workbook([[7, "Rose", "Maria Santos", "Math", value]])), (error) => error.status === 422 && error.issues[0].sheet === "Grades" && error.issues[0].row === 2);
  }
  await assert.rejects(parseStudentWorkbook(await workbook([[8, "Rose", "Maria Santos", "Math", 85]])), /No students or grades/);
  await assert.rejects(parseStudentWorkbook(await workbook([[7, "Rose", "Maria Santos", "Math", 85], [7, "rose", "Maria Santos", "MATH", 90]])), /No students or grades/);
  await assert.rejects(parseStudentWorkbook(await workbook([], { headers: ["Grade Level", "Subject"] })), /Grades row 1/);
  await assert.rejects(parseStudentWorkbook(await workbook([], { headers: [{ formula: '"Grade Level"', result: "Grade Level" }, ...GRADE_IMPORT_HEADERS.slice(1)] })), /plain, unique/);
});

test("grade plans preserve existing values and reject unknown or unenrolled subjects", () => {
  const row = { row: 2, studentKey, subject: "Math", term1: 85, term2: 90, term3: null };
  const input = { grades: [row], subjects: [{ _id: subjectId, name: "Math" }], sections: [{ _id: sectionId, name: "Rose" }],
    existingStudents: [{ _id: "existing", grade: 7, sectionId, name: "Maria Santos", subjectIds: [subjectId], importedGrades: [{ subjectId, term1: 85, importedAt: new Date() }] }], importedAt: new Date() };
  const plan = prepareGradeImport(input).get(studentKey);
  assert.equal(plan.termCount, 1);
  assert.equal(plan.merged[0].term2, 90);
  assert.equal(input.existingStudents[0].importedGrades[0].term2, undefined);
  assert.throws(() => prepareGradeImport({ ...input, grades: [{ ...row, term1: 86 }] }), /No students or grades/);
  assert.throws(() => prepareGradeImport({ ...input, subjects: [] }), /No students or grades/);
  assert.throws(() => prepareGradeImport({ ...input, existingStudents: [{ ...input.existingStudents[0], subjectIds: [] }] }), /No students or grades/);
  assert.throws(() => prepareGradeImport({ ...input, existingStudents: [...input.existingStudents, { ...input.existingStudents[0], _id: "second" }] }), /No students or grades/);
  const retainedHistory = prepareGradeImport({ ...input, existingStudents: [{ ...input.existingStudents[0], importedGrades: [{ subjectId: "old-subject", term1: 80, importedAt: new Date() }] }] }).get(studentKey);
  assert.deepEqual(retainedHistory.subjectIds, [subjectId]);
  assert.equal(retainedHistory.merged[0].subjectId, "old-subject");
});

test("imported term grades are not transmuted and produce official final/year-end grades", () => {
  const calculation = calculateStudentSubjectGrade([], { term1: 85, term2: 90, term3: 95 });
  assert.equal(calculation.terms.term1.termGrade, 85);
  assert.equal(calculation.terms.term1.source, "imported");
  assert.equal(calculation.terms.term1.initialGrade, null);
  assert.equal(calculation.final.finalGrade, 90);
  assert.equal(classifyYearEnd([{ name: "Math", final: calculation.final }]).status, "ready");
  const partial = calculateStudentSubjectGrade([], { term1: 0 });
  assert.equal(partial.terms.term1.termGrade, 0);
  assert.equal(partial.final.finalGrade, null);
  assert.equal(partial.isFullyComplete, false);
  assert.equal(calculateTermGrade([], 4, 95).status, "INVALID");
});

test("complete assessment grades take precedence over imported term grades", () => {
  const records = ["written_work", "performance_task", "summative_test", "term_exam"].map((category) => ({ term: 1, category, sequence: 1, totalItems: 100, score: 100 }));
  records.push({ term: 1, category: "summative_test", sequence: 2, totalItems: 100, score: 100 });
  const result = calculateTermGrade(records, 1, 75);
  assert.equal(result.termGrade, 100);
  assert.equal(result.source, undefined);
});

test("student schema persists subject grades and validates their range", () => {
  const student = new Student({ importedGrades: [{ subjectId, term1: 85, term2: 0, importedAt: new Date() }] });
  assert.equal(student.importedGrades[0].term2, 0);
  const invalid = new Student({ importedGrades: [{ subjectId, term1: 101, importedAt: new Date() }] }).validateSync();
  assert.ok(invalid.errors["importedGrades.0.term1"]);
});

test("HTTP rejects legacy term-grade and ECR workbooks before any writes", async (t) => {
  const writes = [];
  const app = express();
  app.use(createStudentImportRouter({
    auth(req, _res, next) { req.user = { id: "507f1f77bcf86cd799439011" }; next(); },
    Subjects: { async find() { return [{ _id: subjectId, name: "Math" }]; } },
    Sections: { async findOneAndUpdate() { writes.push("section"); assert.fail("Grade imports are disabled"); } },
    Students: { async bulkWrite() { writes.push("student"); assert.fail("Grade imports are disabled"); } },
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  for (const [filename, buffer] of [
    ["grades.xlsx", await workbook([[7, "Rose", "Maria Santos", "Math", 85, 90]])],
    ["class.xlsm", await ecrWorkbook({ 2: { J7: "7 - Rose", Y7: "Math", B12: "Maria Santos" }, 3: completedTerm(12, "Maria Santos", 85) })],
  ]) {
    const data = new FormData(); data.append("file", new Blob([buffer]), filename); data.append("subject_ids", JSON.stringify([subjectId]));
    data.append("ecr_terms", "[1]");
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/students/import", { method: "POST", body: data });
    assert.equal(response.status, 422); assert.match((await response.json()).message, /Only student names/);
  }
  assert.deepEqual(writes, []);
});

const query = (value) => ({ populate() { return this; }, sort() { return this; }, select() { return this; }, lean: async () => value });
test("official summary API displays imported grades with their provenance", async (t) => {
  const student = { _id: "507f1f77bcf86cd799439015", name: "Maria Santos", grade: 7,
    sectionId: { name: "Rose" }, subjectIds: [{ _id: subjectId, name: "Math" }],
    importedGrades: [{ subjectId, term1: 85, term2: 90, term3: 95 }] };
  t.mock.method(Student, "find", () => query([student]));
  t.mock.method(Assessment, "find", () => query([]));
  const app = express(); app.use((req, res, next) => { req.user = { id: "507f1f77bcf86cd799439011" }; next(); }); app.use(assessmentRouter);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/grade-summaries`);
  assert.equal(response.status, 200);
  const [summary] = await response.json();
  assert.equal(summary.term1.source, "imported");
  assert.equal(summary.term2.termGrade, 90);
  assert.equal(summary.final.finalGrade, 90);
  assert.equal(summary.is_fully_complete, true);
});

test("year-end reports use imported official term grades without raw score records", async (t) => {
  t.mock.method(Student, "find", () => query([{ _id: "student", name: "Maria Santos", grade: 7, sectionId: { name: "Rose" }, subjectIds: [subjectId], importedGrades: [{ subjectId, term1: 85, term2: 90, term3: 95 }] }]));
  t.mock.method(Subject, "find", () => query([{ _id: subjectId, name: "Math" }]));
  t.mock.method(Assessment, "find", () => query([]));
  t.mock.method(AssessmentScore, "find", () => query([]));
  const [report] = await buildYearEndReports("owner");
  assert.equal(report.status, "ready");
  assert.equal(report.finalAverage, 90);
  assert.equal(report.subjects[0].assessments.length, 0);
  assert.equal(report.subjects[0].terms.term1.source, "imported");
});
