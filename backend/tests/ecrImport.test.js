import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseStudentWorkbook } from "../utils/studentImport.js";
import { ecrWorkbook, completedTerm, templateUrl } from "./helpers/ecrWorkbook.js";

const roster = { J7: "Grade 7 - Rose", Y7: "Mathematics", B12: "José Santos", B63: "Maria Dela Cruz" };

test("downloadable ECR is an unchanged copy of the supplied macro-enabled template", async () => {
  const buffer = await fs.readFile(templateUrl);
  assert.equal(createHash("sha256").update(buffer).digest("hex"), "a03bf43ef0f26942d1261d8a199715edd53ccde4d9be521eb1270f5d09fa41f7");
  await assert.rejects(parseStudentWorkbook(buffer), /INPUT roster is empty/);
});

test("ECR roster-only import uses both learner groups and does not import sample scores", async () => {
  const parsed = await parseStudentWorkbook(await ecrWorkbook({ 2: roster }));
  assert.deepEqual(parsed.students.map(({ row, grade, section, name, sheet }) => [sheet, row, grade, section, name]), [
    ["INPUT", 12, 7, "Rose", "José Santos"], ["INPUT", 63, 7, "Rose", "Maria Dela Cruz"],
  ]);
  assert.deepEqual(parsed.grades, []);
});

test("ECR imports selected saved final term grades, including zero, rather than raw scores or formula evaluation", async () => {
  const buffer = await ecrWorkbook({ 2: roster,
    3: { ...completedTerm(12, roster.B12, 85.25), ...completedTerm(63, roster.B63, 90) },
    4: { ...completedTerm(12, roster.B12, 0), ...completedTerm(63, roster.B63, 91) },
    5: { ...completedTerm(12, roster.B12, 95), ...completedTerm(63, roster.B63, 92) },
  });
  const parsed = await parseStudentWorkbook(buffer, { ecrTerms: [1, 2, 3] });
  assert.equal(parsed.grades[0].subject, "Mathematics");
  assert.deepEqual(parsed.grades.map((entry) => [entry.term1, entry.term2, entry.term3]), [[85.25, 0, 95], [90, 91, 92]]);
  const partial = await parseStudentWorkbook(buffer, { ecrTerms: [2, 2] });
  assert.deepEqual(partial.grades.map((entry) => [entry.term1, entry.term2, entry.term3]), [[null, 0, null], [null, 91, null]]);
});

test("ECR leaves untouched blank terms pending and never uses blank roster slots", async () => {
  const buffer = await ecrWorkbook({ 2: { ...roster, B63: "" }, 3: completedTerm(12, roster.B12, 85) });
  const parsed = await parseStudentWorkbook(buffer, { ecrTerms: [1, 2, 3] });
  assert.equal(parsed.students.length, 1);
  assert.equal(parsed.grades.length, 1);
  assert.deepEqual([parsed.grades[0].term1, parsed.grades[0].term2, parsed.grades[0].term3], [85, null, null]);
});

test("ECR rejects sample defaults, unsaved formula results, incomplete scores and stale learner links", async () => {
  const cases = [
    { 3: { B12: { formula: "INPUT!B12", result: roster.B12 } } }, // original cached 60, no maxima
    { 3: { ...completedTerm(12, roster.B12, 85), AA12: { formula: "1+1" } } },
    { 3: { ...completedTerm(12, roster.B12, 85), V12: "" } },
    { 3: { ...completedTerm(12, roster.B12, 85), F12: 101 } },
    { 3: { ...completedTerm(12, "Different Learner", 85) } },
  ];
  for (const changes of cases) {
    await assert.rejects(parseStudentWorkbook(await ecrWorkbook({ 2: roster, ...changes }), { ecrTerms: [1] }),
      (error) => error.issues.some((issue) => issue.sheet === "TERM1" && issue.row === 12));
  }
});

test("ECR rejects invalid final grades and identity fields with worksheet locations", async () => {
  for (const grade of [-1, 101, 80.123, "#DIV/0!", "85%"])
    await assert.rejects(parseStudentWorkbook(await ecrWorkbook({ 2: roster, 3: completedTerm(12, roster.B12, grade) }), { ecrTerms: [1] }),
      (error) => error.issues.some((issue) => issue.sheet === "TERM1" && /AA12/.test(issue.message)));
  for (const values of [{ J7: "www.teachpinas.com" }, { J7: "11 - Rose" }, { B12: "Student123" }, { B12: { formula: '"Learner"', result: "Learner" } }, { Y7: "ENG/FIL/MATH/SCI/AP/GMRC/VALUES" }, { B63: roster.B12 }])
    await assert.rejects(parseStudentWorkbook(await ecrWorkbook({ 2: { ...roster, ...values } }), { ecrTerms: [2] }),
      (error) => error.issues.some((issue) => issue.sheet === "INPUT"));
});

test("ECR rejects changed layout, invalid term selection and oversized expanded XML", async () => {
  await assert.rejects(parseStudentWorkbook(await ecrWorkbook({ 2: { ...roster, B8: "Other layout" } })), /layout/);
  await assert.rejects(parseStudentWorkbook(await ecrWorkbook({ 2: roster }), { ecrTerms: [4] }), /valid ECR terms/);
  const buffer = await ecrWorkbook({ 2: roster }, (zip) => {
    zip.file("xl/worksheets/sheet2.xml", `<worksheet><!--${" ".repeat(9 * 1024 * 1024)}--></worksheet>`);
  });
  await assert.rejects(parseStudentWorkbook(buffer), /Unable to read/);
});
