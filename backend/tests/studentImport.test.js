import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import express from "express";
import { once } from "node:events";
import { createStudentImportRouter } from "../studentImport.js";
import { parseStudentWorkbook, IMPORT_HEADERS, GRADE_IMPORT_HEADERS, MAX_IMPORT_ROWS } from "../utils/studentImport.js";

const ownerId = "507f1f77bcf86cd799439011";
const subjectId = "507f1f77bcf86cd799439012";
const sectionId = "507f1f77bcf86cd799439013";

async function workbookBuffer(rows, { headers = IMPORT_HEADERS, sheetName = "Students" } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  sheet.addRows(rows);
  return workbook.xlsx.writeBuffer();
}

test("parses pasted names, mixed grades and sections; ignores blanks and duplicate rows", async () => {
  const buffer = await workbookBuffer([
    [7, "  Rose  ", "  María   Dela Cruz "], [],
    ["7", "ROSE", "maría dela cruz"], [8, "101", "Jose Santos Jr."],
  ]);
  const parsed = await parseStudentWorkbook(buffer);
  assert.deepEqual(parsed.students, [
    { row: 2, grade: 7, section: "Rose", name: "María Dela Cruz" },
    { row: 5, grade: 8, section: "101", name: "Jose Santos Jr." },
  ]);
  assert.equal(parsed.skipped[0].row, 4);
});

test("reports every invalid row with its Excel row number", async () => {
  const buffer = await workbookBuffer([[7, "Rose", "Valid Student"], [0, "", ""], [7.5, "Rose", 123], ["7e0", "Rose", "Student"]]);
  await assert.rejects(parseStudentWorkbook(buffer), (error) => {
    assert.deepEqual(error.issues.map((issue) => issue.row), [3, 4, 5]);
    assert.match(error.message, /No students were imported/);
    return true;
  });
});

test("rejects formulas even when a cached result is present", async () => {
  const buffer = await workbookBuffer([[{ formula: "3+4", result: 7 }, "Rose", "Maria Santos"]]);
  await assert.rejects(parseStudentWorkbook(buffer), (error) => {
    assert.match(error.issues[0].message, /not formulas/);
    return true;
  });
});

test("supports rich text and reordered headers", async () => {
  const buffer = await workbookBuffer([[{ richText: [{ text: "Maria " }, { text: "Santos" }] }, 7, "Rose"]], { headers: ["Student Name", "Grade Level", "Section"] });
  assert.equal((await parseStudentWorkbook(buffer)).students[0].name, "Maria Santos");
});

test("rejects corrupt files, missing sheet, missing headers, duplicates and empty sheets", async () => {
  await assert.rejects(parseStudentWorkbook(Buffer.from("not an Excel file")), /valid, unprotected/);
  await assert.rejects(parseStudentWorkbook(await workbookBuffer([], { sheetName: "Wrong" })), /worksheet named/);
  await assert.rejects(parseStudentWorkbook(await workbookBuffer([], { headers: ["Name"] })), /Row 1 must contain/);
  await assert.rejects(parseStudentWorkbook(await workbookBuffer([], { headers: [...IMPORT_HEADERS, "Section"] })), /unique text/);
  await assert.rejects(parseStudentWorkbook(await workbookBuffer([])), /worksheet is empty/);
});

test("enforces student limit including repeated names", async () => {
  const buffer = await workbookBuffer(Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => [7, "Rose", "Maria Santos"]));
  await assert.rejects(parseStudentWorkbook(buffer), /at most 1000/);
});

test("legacy template retains its headers and optional grade import compatibility", async () => {
  const buffer = await fs.readFile(new URL("../../frontend/public/templates/student-import-template.xlsx", import.meta.url));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.getWorksheet("Students").getRow(1).values.slice(1, 4), IMPORT_HEADERS);
  assert.deepEqual(workbook.getWorksheet("Grades").getRow(1).values.slice(1, 8), GRADE_IMPORT_HEADERS);
  await assert.rejects(parseStudentWorkbook(buffer), /worksheet is empty/);
  const sheet = workbook.getWorksheet("Students");
  sheet.getRow(2).values = [7, "Rose", "Maria Santos"];
  workbook.getWorksheet("Grades").getRow(2).values = [7, "Rose", "Maria Santos", "Mathematics", 88.5, null, 0];
  const parsed = await parseStudentWorkbook(await workbook.xlsx.writeBuffer());
  assert.equal(parsed.students.length, 1);
  assert.equal(parsed.grades[0].term1, 88.5);
  assert.equal(parsed.grades[0].term2, null);
  assert.equal(parsed.grades[0].term3, 0);
  assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(sheet.getCell("A2").dataValidation.type, "whole");
});

async function withApi(t, { availableSubjects = [{ _id: subjectId }], bulkError, authenticated = true } = {}) {
  const calls = { sections: [], writes: [], subjects: [] };
  const saved = new Set();
  const app = express();
  app.use(createStudentImportRouter({
    auth(req, res, next) {
      if (!authenticated) return res.status(401).json({ message: "Authentication is required." });
      req.user = { id: ownerId };
      next();
    },
    Subjects: { async find(filter) { calls.subjects.push(filter); return availableSubjects; } },
    Sections: { async findOneAndUpdate(...args) { calls.sections.push(args); return { _id: sectionId }; } },
    Students: { async bulkWrite(operations, options) {
      assert.equal(options.timestamps, false);
      calls.writes.push(operations);
      if (bulkError) throw bulkError;
      const upsertedIds = {};
      operations.forEach(({ updateOne }, index) => {
        const key = JSON.stringify(updateOne.filter);
        if (!saved.has(key)) { saved.add(key); upsertedIds[index] = `student-${index}`; }
      });
      return { upsertedIds };
    } },
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/students/import`;
  return {
    calls,
    async upload(buffer, { filename = "students.xlsx", ids = [subjectId], includeFile = true } = {}) {
      const form = new FormData();
      if (includeFile) form.append("file", new Blob([buffer]), filename);
      form.append("subject_ids", JSON.stringify(ids));
      const response = await fetch(url, { method: "POST", body: form });
      return { status: response.status, body: await response.json() };
    },
  };
}

test("HTTP import creates sections, scopes writes to the teacher, and skips repeat uploads", async (t) => {
  const api = await withApi(t);
  const buffer = await workbookBuffer([[7, "Rose", "Maria Santos"], [7, "rose", "MARIA SANTOS"], [7, "Rose", "Jose (Jr.)"]]);
  const first = await api.upload(buffer);
  assert.equal(first.status, 200);
  assert.equal(first.body.imported_count, 2);
  assert.equal(first.body.skipped_count, 1);
  assert.equal(api.calls.sections.length, 1);
  assert.deepEqual(api.calls.sections[0][0], { ownerId, nameKey: "rose" });
  assert.equal(api.calls.subjects[0].ownerId, ownerId);
  for (const { updateOne } of api.calls.writes[0]) {
    assert.equal(updateOne.filter.ownerId, ownerId);
    assert.deepEqual(updateOne.update.$setOnInsert.subjectIds, [subjectId]);
    assert.equal(updateOne.update.$set, undefined);
    assert.ok(updateOne.update.$setOnInsert.createdAt instanceof Date);
  }
  assert.equal(api.calls.writes[0][1].updateOne.filter.name.$regex, "^Jose \\(Jr\\.\\)$");
  const second = await api.upload(buffer);
  assert.equal(second.body.imported_count, 0);
  assert.equal(second.body.skipped_count, 3);
});

test("HTTP invalid workbook or foreign subjects writes nothing", async (t) => {
  const api = await withApi(t);
  const invalid = await api.upload(await workbookBuffer([[7, "Rose", "Valid"], [7, "", "Invalid"]]));
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.issues[0].row, 3);
  assert.equal(api.calls.sections.length, 0);
  assert.equal(api.calls.writes.length, 0);
  const foreign = await withApi(t, { availableSubjects: [] });
  assert.equal((await foreign.upload(await workbookBuffer([[7, "Rose", "Maria"]]))).status, 400);
  assert.equal(foreign.calls.sections.length, 0);
});

test("HTTP rejects unauthenticated, missing, wrong-type, oversized and missing-subject uploads", async (t) => {
  const buffer = await workbookBuffer([[7, "Rose", "Maria Santos"]]);
  const unauthenticated = await withApi(t, { authenticated: false });
  assert.equal((await unauthenticated.upload(buffer)).status, 401);
  const api = await withApi(t);
  assert.equal((await api.upload(buffer, { includeFile: false })).status, 400);
  assert.equal((await api.upload(buffer, { filename: "students.csv" })).status, 400);
  assert.equal((await api.upload(buffer, { ids: [] })).status, 400);
  assert.equal((await api.upload(buffer, { ids: ["invalid-id"] })).status, 400);
  assert.equal((await api.upload(Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
  assert.equal(api.calls.writes.length, 0);
});

test("HTTP reports partial database writes with exact failed row numbers", async (t) => {
  const api = await withApi(t, { bulkError: Object.assign(new Error("partial"), {
    result: { upsertedIds: { 0: "created" } }, writeErrors: [{ index: 1, code: 11000 }],
  }) });
  const response = await api.upload(await workbookBuffer([[7, "Rose", "Maria"], [7, "Rose", "Jose"]]));
  assert.equal(response.status, 207);
  assert.equal(response.body.imported_count, 1);
  assert.equal(response.body.failed_count, 1);
  assert.equal(response.body.skipped_count, 0);
  assert.equal(response.body.issues[0].row, 3);
});
