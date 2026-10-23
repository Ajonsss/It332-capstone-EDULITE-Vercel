import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createStudentImportRouter } from "../studentImport.js";
import { createImportTemplate } from "../utils/guidedStudentImport.js";
import { parseStudentWorkbook } from "../utils/studentImport.js";
import { ASSESSMENT_IMPORT_SLOTS } from "../utils/assessmentWorkbook.js";

const ownerId = "507f1f77bcf86cd799439011", subjectId = "507f1f77bcf86cd799439012", sectionId = "507f1f77bcf86cd799439013";
const parseOptions = { importMode: "grades", gradeLevel: 7, sectionName: "Rose", subjectName: "Math" };
async function workbook({ names = ["Maria Santos", "Jose Cruz"], all = false, edit = () => {} } = {}) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await createImportTemplate({ mode: "grades", gradeLevel: 7, sectionName: "Rose", subject: { name: "Math" } }));
  names.forEach((name, i) => { book.getWorksheet("Students").getCell(`A${i + 9}`).value = name; });
  for (const term of all ? [1, 2, 3] : [1]) for (const { column, label } of all ? ASSESSMENT_IMPORT_SLOTS : ASSESSMENT_IMPORT_SLOTS.slice(0, 1)) {
    const sheet = book.getWorksheet(`Term ${term}`);
    sheet.getCell(`${column}3`).value = label.startsWith("WW") ? `Quiz ${label.slice(2)}` : `${label} assessment`;
    sheet.getCell(`${column}4`).value = 100;
    sheet.getCell(`${column}5`).value = new Date(`2026-10-0${term}T00:00:00.000Z`);
    sheet.getCell(`${column}6`).value = "Fractions\nProblem solving";
    names.forEach((_name, i) => { sheet.getCell(`${column}${i + 9}`).value = i ? 90 : 80; });
  }
  edit(book);
  return book.xlsx.writeBuffer();
}

test("assessment workbook imports all 33 ECR assessments, dates, curriculum and individual scores", async () => {
  const parsed = await parseStudentWorkbook(await workbook({ all: true, edit(book) { book.getWorksheet("Term 1").getCell("B9").value = 0; book.getWorksheet("Term 3").getCell("L10").value = null; } }), parseOptions);
  assert.equal(parsed.assessments.length, 33); assert.equal(parsed.scores.length, 65); assert.deepEqual(parsed.grades, []);
  assert.equal(parsed.assessments[0].name, "Quiz 1"); assert.equal(parsed.assessments[0].date, "2026-10-01");
  assert.equal(parsed.assessments[0].budgetOfWork, "Fractions\nProblem solving"); assert.equal(parsed.scores[0].score, 0);
  assert.equal(parsed.assessments.at(-1).category, "term_exam");
});

test("assessment workbook rejects bad scores, orphan scores, missing definitions, and shifted names", async () => {
  for (const [cell, value, expected] of [["B9", 101, /0 to 100/], ["B9", 80.5, /whole number/], ["B9", { formula: "40+40", result: 80 }, /not formulas/], ["B11", 10, /without a student/], ["C9", 10, /assessment name/], ["A9", "Jose Cruz", /learner name/], ["A9", { formula: 'IF(Students!A10="","",Students!A10)', result: "Maria Santos" }, /learner name/], ["B4", 0, /positive whole number/], ["B5", "2026-02-30", /actual assessment date/], ["M9", 10, /existing WW1/]]) {
    const buffer = await workbook({ edit(book) { book.getWorksheet("Term 1").getCell(cell).value = value; } });
    await assert.rejects(parseStudentWorkbook(buffer, parseOptions), (error) => error.status === 422 && error.issues.some((issue) => issue.sheet === "Term 1" && expected.test(issue.message)));
  }
});

test("shared roster formulas and Excel's 1904 date mode preserve score identity and dates", async () => {
  const buffer = await workbook({ edit(book) { book.properties.date1904 = true; } });
  const zip = await JSZip.loadAsync(buffer);
  const file = "xl/worksheets/sheet2.xml";
  let xml = await zip.file(file).async("string");
  xml = xml.replace(/<c\b[^>]*\br="A9"[^>]*>[\s\S]*?<\/c>/, '<c r="A9"><f t="shared" si="0" ref="A9:A10">IF(Students!A9=&quot;&quot;,&quot;&quot;,Students!A9)</f><v>0</v></c>');
  xml = xml.replace(/<c\b[^>]*\br="A10"[^>]*>[\s\S]*?<\/c>/, '<c r="A10"><f t="shared" si="0"/><v>0</v></c>');
  zip.file(file, xml);
  const parsed = await parseStudentWorkbook(await zip.generateAsync({ type: "nodebuffer" }), parseOptions);
  assert.equal(parsed.assessments[0].date, "2026-10-01"); assert.equal(parsed.scores.length, 2);
});

test("HTTP disables assessment imports and rejects record workbooks disguised as names imports", async (t) => {
  const writes = [];
  const app = express();
  app.use(createStudentImportRouter({
    auth(req, _res, next) { req.user = { id: ownerId }; next(); },
    Sections: { find() { return { lean: async () => [{ _id: sectionId, ownerId, name: "Rose", nameKey: "rose" }] }; } },
    Subjects: { async find() { return [{ _id: subjectId, name: "Math" }]; } },
    Students: { async bulkWrite() { writes.push("students"); assert.fail("Assessment imports are disabled"); } },
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const buffer = await workbook({ all: true });
  for (const mode of ["grades", "names", null]) for (const route of ["/preview", ""]) {
    const data = new FormData(); data.append("file", new Blob([buffer]), "records.xlsx");
    data.append("subject_ids", JSON.stringify(mode === "names" ? [] : [subjectId]));
    if (mode) { data.append("import_mode", mode); data.append("grade_level", "7"); data.append("section_id", sectionId); }
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/students/import" + route, { method: "POST", body: data });
    assert.equal(response.status, mode === "grades" || !mode && route ? 400 : 422);
    const result = await response.json();
    assert.match(result.message, !mode && route ? /class details/ : /Only student names/);
  }
  assert.deepEqual(writes, []);
});
