import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createStudentImportRouter } from "../studentImport.js";
import AuditEvent from "../models/AuditEvent.js";
import { academicContext } from "../services/academicContext.js";
import { createImportTemplate } from "../utils/guidedStudentImport.js";
import { parseStudentWorkbook } from "../utils/studentImport.js";

const ownerId = "507f1f77bcf86cd799439011", subjectId = "507f1f77bcf86cd799439012", sectionId = "507f1f77bcf86cd799439013", schoolYearId = "507f1f77bcf86cd799439014";
const options = (mode) => ({ importMode: mode, gradeLevel: 7, sectionName: "Rose", subjectName: "Math" });
async function workbook(mode, rows, edit = () => {}) {
  const buffer = await createImportTemplate({ mode, gradeLevel: 7, sectionName: "Rose", subject: { name: "Math" } });
  const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer);
  const sheet = book.getWorksheet("Students");
  rows.forEach((values, index) => { sheet.getRow(index + 9).values = mode === "grades" ? [values[0]] : values; });
  if (mode === "grades") {
    const term = book.getWorksheet("Term 1");
    for (const [index, column] of [..."BCD"].entries()) {
      if (!rows.some((row) => row[index + 1] != null)) continue;
      term.getCell(`${column}3`).value = `Quiz ${index + 1}`;
      term.getCell(`${column}4`).value = 100;
      term.getCell(`${column}5`).value = "2026-10-01";
      rows.forEach((row, i) => { if (row[index + 1] != null) term.getCell(`${column}${i + 9}`).value = row[index + 1]; });
    }
  }
  edit(sheet);
  return book.xlsx.writeBuffer();
}

test("simple templates store class details once and import individual scores with zero and missing values", async () => {
  const names = await parseStudentWorkbook(await workbook("names", [["María Santos"], ["Jose Cruz"], ["María Santos"]]), options("names"));
  assert.deepEqual(names.students.map((row) => [row.grade, row.section, row.name]), [[7, "Rose", "María Santos"], [7, "Rose", "Jose Cruz"]]);
  assert.equal(names.skipped[0].row, 11); assert.deepEqual(names.grades, []);
  const grades = await parseStudentWorkbook(await workbook("grades", [["Maria Santos", 0, "85", null], ["Jose Cruz"]]), options("grades"));
  assert.deepEqual(grades.scores.map((row) => row.score), [0, 85]);
  assert.equal(grades.assessments.length, 2); assert.deepEqual(grades.grades, []);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await createImportTemplate({ mode: "grades", gradeLevel: 7, sectionName: "Rose", subject: { name: "Math" } }));
  assert.equal(book.worksheets.length, 4);
  assert.equal(book.getWorksheet("Students").getCell("B4").value, 7);
  assert.equal(book.getWorksheet("Students").getCell("B5").value, "Rose");
  assert.equal(book.getWorksheet("Students").getCell("B6").value, "Math");
  assert.equal(book.getWorksheet("Students").views[0].ySplit, 8);
  assert.equal(book.getWorksheet("Term 1").getCell("B9").dataValidation.type, "whole");
});

test("simple template validation rejects mismatched metadata, formulas, duplicate grade rows and accidental grades in names mode", async () => {
  for (const [mode, rows, edit] of [
    ["names", [["Maria Santos"]], (sheet) => { sheet.getCell("B4").value = 8; }],
    ["grades", [["Maria Santos", 85]], (sheet) => { sheet.getCell("B6").value = "Science"; }],
    ["grades", [["Maria Santos", 85], ["maria santos", 90]], () => {}],
    ["grades", [["Maria Santos", { formula: "80+5", result: 85 }]], () => {}],
    ["grades", [["Maria Santos", 101]], () => {}],
    ["names", [["Maria Santos", 85]], () => {}],
    ["names", [["Maria123 Santos"]], () => {}],
    ["names", [["Maria Santos"]], (sheet) => { sheet.getCell("A8").value = { formula: '"Student Name"', result: "Student Name" }; }],
  ]) await assert.rejects(parseStudentWorkbook(await workbook(mode, rows, edit), options(mode)), (error) => error.status === 422 && ["Students", "Term 1"].includes(error.issues[0].sheet));
  await assert.rejects(parseStudentWorkbook(await workbook("names", []), options("names")), /list is empty/);
  await assert.rejects(parseStudentWorkbook(await workbook("names", Array.from({ length: 1001 }, () => ["Maria Santos"])), options("names")), /at most 1000/);
  const corrupt = await JSZip.loadAsync(await workbook("names", [["Maria Santos"]]));
  corrupt.file("xl/worksheets/sheet1.xml", "<worksheet><sheetData></worksheet>");
  await assert.rejects(parseStudentWorkbook(await corrupt.generateAsync({ type: "nodebuffer" }), options("names")), (error) => error.status === 422 && /Unable to read/.test(error.message));
});

async function api(t, { existing = [] } = {}) {
  const state = { ownerId, schoolYearId, saved: structuredClone(existing), sections: [{ _id: sectionId, ownerId, name: "Rose", nameKey: "rose" }], writes: [], subjectReads: 0 };
  t.mock.method(AuditEvent, "create", async () => []);
  const app = express();
  app.use(createStudentImportRouter({
    auth(req, _res, next) { req.user = { id: state.ownerId }; academicContext.run({ ownerId: state.ownerId, schoolYearId: state.schoolYearId }, next); },
    Subjects: { async find(filter) { state.subjectReads++; assert.equal(filter.ownerId, state.ownerId); return filter._id.$in.includes(subjectId) ? [{ _id: subjectId, name: "Math" }] : []; } },
    Sections: {
      find(filter) { assert.equal(filter.ownerId, state.ownerId); return { lean: async () => structuredClone(state.sections.filter((section) => section.ownerId === filter.ownerId && section._id === filter._id)) }; },
      async findOneAndUpdate() { assert.fail("Guided imports must not create sections"); },
    },
    Students: {
      find(filter) { assert.equal(filter.ownerId, state.ownerId); assert.equal(filter.schoolYearId, state.schoolYearId); return { lean: async () => structuredClone(state.saved.filter((row) => row.ownerId === state.ownerId && row.schoolYearId === state.schoolYearId && !row.archived)) }; },
      async bulkWrite(operations) {
        state.writes.push(operations); let matchedCount = 0, modifiedCount = 0; const upsertedIds = {};
        for (const [index, { updateOne: { filter, update } }] of operations.entries()) {
          assert.equal(filter.ownerId, state.ownerId); assert.equal(filter.schoolYearId, state.schoolYearId);
          if (update.$setOnInsert) {
            const found = state.saved.find((row) => row.ownerId === filter.ownerId && row.schoolYearId === filter.schoolYearId && row.sectionId === filter.sectionId && row.grade === filter.grade && new RegExp(filter.name.$regex, "i").test(row.name));
            if (!found) { const id = `new-${state.saved.length}`; state.saved.push({ _id: id, ...structuredClone(update.$setOnInsert), ...(update.$addToSet ? { subjectIds: [...update.$addToSet.subjectIds.$each] } : {}) }); upsertedIds[index] = id; }
            else if (update.$addToSet) {
              const added = update.$addToSet.subjectIds.$each.filter((id) => !found.subjectIds.includes(id));
              found.subjectIds.push(...added); if (added.length) modifiedCount++;
            }
          } else {
            const found = state.saved.find((row) => row._id === filter._id);
            assert.deepEqual(filter.importedGrades, found.importedGrades);
            if (Array.isArray(filter.subjectIds)) assert.deepEqual(filter.subjectIds, found.subjectIds);
            found.importedGrades = structuredClone(update.$set.importedGrades);
            for (const id of update.$addToSet?.subjectIds.$each ?? []) if (!found.subjectIds.includes(id)) found.subjectIds.push(id);
            matchedCount++;
          }
        }
        return { matchedCount, modifiedCount, upsertedIds };
      },
    },
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/students/import`;
  return { state, base, async upload(buffer, { mode = "names", preview = true, token, ids = mode === "grades" ? [subjectId] : [], ...overrides } = {}) {
    const form = new FormData(); form.append("file", new Blob([buffer]), "students.xlsx");
    for (const [key, value] of Object.entries({ import_mode: mode, grade_level: "7", section_id: sectionId, section_name: "Rose", subject_ids: JSON.stringify(ids), ...(token ? { confirmation_token: token } : {}), ...overrides })) form.append(key, value);
    const response = await fetch(`${base}${preview ? "/preview" : ""}`, { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
  } };
}

test("names-only preview makes no writes or subject queries and requires confirmation before registration", async (t) => {
  const app = await api(t), buffer = await workbook("names", [["Maria Santos"], ["Jose Cruz"], ["Maria Santos"]]);
  const preview = await app.upload(buffer);
  assert.equal(preview.status, 200); assert.equal(preview.body.student_count, 2); assert.equal(preview.body.skipped.length, 1);
  assert.equal(app.state.subjectReads, 0); assert.deepEqual(app.state.writes, []);
  assert.equal((await app.upload(buffer, { preview: false })).status, 409); assert.deepEqual(app.state.writes, []);
  const commit = await app.upload(buffer, { preview: false, token: preview.body.confirmation_token });
  assert.equal(commit.status, 200); assert.equal(commit.body.imported_count, 2); assert.deepEqual(app.state.saved[0].subjectIds, []);
  assert.equal(app.state.sections.length, 1); assert.equal(app.state.saved[0].sectionId, sectionId);
  assert.equal((await app.upload(buffer, { preview: false, token: preview.body.confirmation_token })).status, 409);
  const repeat = await app.upload(buffer); assert.equal(repeat.body.new_student_count, 0); assert.equal(repeat.body.existing_student_count, 2);
});

test("confirmation rejects changed files, saved records, owner and school year before writing", async (t) => {
  const app = await api(t), buffer = await workbook("names", [["Maria Santos"]]);
  const preview = await app.upload(buffer), token = preview.body.confirmation_token;
  assert.equal((await app.upload(await workbook("names", [["Jose Cruz"]]), { preview: false, token })).status, 409);
  app.state.schoolYearId = "507f1f77bcf86cd799439015";
  assert.equal((await app.upload(buffer, { preview: false, token })).status, 409);
  app.state.schoolYearId = schoolYearId; app.state.ownerId = "507f1f77bcf86cd799439016";
  assert.equal((await app.upload(buffer, { preview: false, token })).status, 400);
  app.state.ownerId = ownerId;
  app.state.saved.push({ _id: "concurrent", ownerId, schoolYearId, sectionId, grade: 7, name: "Maria Santos", subjectIds: [] });
  assert.equal((await app.upload(buffer, { preview: false, token })).status, 409);
  assert.deepEqual(app.state.writes, []);
});

test("template download fills class once and disables grade imports", async (t) => {
  const app = await api(t);
  const response = await fetch(`${app.base}/template?mode=names&grade_level=7&section_id=${sectionId}&section_name=Rose`);
  assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition"), /student-names-template.xlsx/);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual(book.worksheets.map((sheet) => sheet.name), ["Students"]);
  assert.equal(book.getWorksheet("Students").getCell("B5").value, "Rose"); assert.equal(app.state.subjectReads, 0);
  assert.equal((await fetch(`${app.base}/template?mode=grades&grade_level=7&section_id=${sectionId}&section_name=Rose&subject_id=507f1f77bcf86cd799439099`)).status, 400);
  const invalid = await app.upload(await workbook("grades", [["Maria Santos", 85]]), { mode: "grades", ids: ["507f1f77bcf86cd799439099"] });
  assert.equal(invalid.status, 400); assert.deepEqual(app.state.writes, []);
  const disabled = await app.upload(await workbook("grades", [["Maria Santos", 85]]), { mode: "grades" });
  assert.equal(disabled.status, 400); assert.match(disabled.body.message, /Only student names/);
  assert.equal(app.state.subjectReads, 0);
});

test("names-only registration preserves previously saved subjects and grades", async (t) => {
  const existing = { _id: "existing", ownerId, schoolYearId, sectionId, grade: 7, name: "Maria Santos", subjectIds: [subjectId], importedGrades: [{ subjectId, term1: 85, term2: 90 }] };
  const app = await api(t, { existing: [existing] }), buffer = await workbook("names", [["Maria Santos"], ["Jose Cruz"]]);
  const preview = await app.upload(buffer); assert.equal(preview.status, 200);
  const imported = await app.upload(buffer, { preview: false, token: preview.body.confirmation_token });
  assert.equal(imported.status, 200); assert.equal(imported.body.imported_count, 1);
  assert.deepEqual(app.state.saved[0], existing); assert.deepEqual(app.state.saved[1].subjectIds, []);
  assert.equal(app.state.saved[1].importedGrades, undefined);
});

test("names imports optionally enroll new students in owned subjects without changing existing enrollments", async (t) => {
  const existing = { _id: "existing", ownerId, schoolYearId, sectionId, grade: 7, name: "Maria Santos", subjectIds: [], importedGrades: [] };
  const app = await api(t, { existing: [existing] }), buffer = await workbook("names", [["Maria Santos"], ["Jose Cruz"]]);
  const preview = await app.upload(buffer, { ids: [subjectId] });
  assert.equal(preview.status, 200); assert.deepEqual(app.state.writes, []);
  assert.equal((await app.upload(buffer, { ids: [], preview: false, token: preview.body.confirmation_token })).status, 409);
  assert.deepEqual(app.state.writes, []);
  const result = await app.upload(buffer, { ids: [subjectId], preview: false, token: preview.body.confirmation_token });
  assert.equal(result.status, 200); assert.equal(result.body.imported_count, 1);
  assert.deepEqual(app.state.saved[0], existing);
  assert.deepEqual(app.state.saved[1].subjectIds, [subjectId]);
  assert.equal(app.state.saved[1].importedGrades, undefined);
  const foreign = await app.upload(buffer, { ids: ["507f1f77bcf86cd799439099"] });
  assert.equal(foreign.status, 400); assert.match(foreign.body.message, /unavailable/);
  assert.equal(app.state.writes.length, 1);
});

test("class imports add subject enrollment to existing students only with a matching confirmed review", async (t) => {
  const existing = { _id: "existing", ownerId, schoolYearId, sectionId, grade: 7, name: "Maria Santos", subjectIds: [schoolYearId], importedGrades: [{ subjectId: schoolYearId, term1: 85 }] };
  const app = await api(t, { existing: [existing] }), buffer = await workbook("names", [["Maria Santos"], ["Jose Cruz"]]);
  const preview = await app.upload(buffer, { ids: [subjectId], enroll_existing: "true" });
  assert.equal(preview.status, 200); assert.equal(preview.body.enroll_existing, true); assert.deepEqual(app.state.writes, []);
  assert.equal((await app.upload(buffer, { ids: [subjectId], preview: false, token: preview.body.confirmation_token })).status, 409);
  const saved = await app.upload(buffer, { ids: [subjectId], enroll_existing: "true", preview: false, token: preview.body.confirmation_token });
  assert.equal(saved.status, 200); assert.equal(saved.body.imported_count, 1); assert.equal(saved.body.enrolled_existing_count, 1);
  assert.deepEqual(app.state.saved[0].subjectIds, [schoolYearId, subjectId]);
  assert.deepEqual(app.state.saved[0].importedGrades, existing.importedGrades);
  assert.deepEqual(app.state.saved[1].subjectIds, [subjectId]);
  const repeated = await app.upload(buffer, { ids: [subjectId], enroll_existing: "true" });
  assert.equal((await app.upload(buffer, { ids: [subjectId], enroll_existing: "true", preview: false, token: repeated.body.confirmation_token })).body.enrolled_existing_count, 0);
  assert.equal((await app.upload(buffer, { enroll_existing: "true" })).status, 400);
});

test("guided imports require an owned registered section for downloads, preview and confirmation", async (t) => {
  const app = await api(t), buffer = await workbook("names", [["Maria Santos"]]);
  for (const overrides of [{ section_id: "" }, { section_id: "invalid" }, { section_id: "507f1f77bcf86cd799439099" }, { section_name: "Unregistered" }]) {
    const rejected = await app.upload(buffer, overrides);
    assert.equal(rejected.status, 400); assert.match(rejected.body.message, /registered section/);
  }
  assert.equal((await fetch(`${app.base}/template?mode=names&grade_level=7&section_name=Rose`)).status, 400);
  const preview = await app.upload(buffer); assert.equal(preview.status, 200);
  app.state.sections[0].ownerId = "507f1f77bcf86cd799439099";
  assert.equal((await app.upload(buffer)).status, 400);
  assert.equal((await fetch(`${app.base}/template?mode=names&grade_level=7&section_id=${sectionId}`)).status, 400);
  app.state.sections = [];
  assert.equal((await app.upload(buffer, { preview: false, token: preview.body.confirmation_token })).status, 400);
  assert.deepEqual(app.state.writes, []); assert.deepEqual(app.state.saved, []); assert.deepEqual(app.state.sections, []);
});
