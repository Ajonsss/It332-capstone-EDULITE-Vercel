import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import ExcelJS from "exceljs";
import { validateInput, validateInputDraft, parseWholeNumber, isCalendarDate } from "../../shared/inputValidation.mjs";
import { validateRequestInputs } from "../middleware/inputValidation.js";
import { parseStudentWorkbook } from "../utils/studentImport.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import studentRouter from "../student.js";
import User from "../models/User.js";
import Student from "../models/Student.js";
import Assessment from "../models/Assessment.js";
import AssessmentScore from "../models/AssessmentScore.js";

test("names accept Unicode letters and normal name punctuation", () => {
  for (const name of ["María Dela Cruz", "Jose Jr.", "Anne-Marie O’Neill", "D'Angelo", "李明", "Jose\u0301 Santos", "Santos, Maria", "Jose (Jr.)"]) {
    assert.equal(validateInput(name, { kind: "personName" }), "", name);
  }
});

test("names reject digits, numeric values, non-text objects, symbols and invisible controls", () => {
  for (const value of ["Juan2", "123", "Juan٢", 123, true, [], {}, "***", "...", "Juan\nSantos", "Juan\u200BSantos", "Juan😀"]) {
    assert.notEqual(validateInput(value, { kind: "personName" }), "", JSON.stringify(value));
  }
  assert.match(validateInputDraft("Juan2", { kind: "personName", label: "First Name" }), /Numbers are not allowed/);
  assert.equal(validateInput("", { kind: "personName", required: false }), "");
});

test("whole numbers reject boolean coercion, arrays, decimals, exponents, signs and unsafe integers", () => {
  for (const value of [true, false, [], [7], {}, "", " ", "7.0", "1e2", "0x10", "+7", "-7", "1,000", "٧", NaN, Infinity, 7.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.ok(Number.isNaN(parseWholeNumber(value)), JSON.stringify(value));
  }
  for (const value of [7, "7", "007", " 7 "]) assert.equal(parseWholeNumber(value), 7);
  assert.match(validateInput(" ", { kind: "integer", required: false }), /whole number/);
  assert.equal(validateInput("", { kind: "integer", required: false }), "");
});

test("numeric drafts reject invalid pasted and typed content with a message", () => {
  for (const value of ["1e2", "1.2", "-1", "+1", "3a", "1 2", "9007199254740992"]) {
    assert.notEqual(validateInputDraft(value, { kind: "integer", label: "Grade" }), "");
  }
  assert.equal(validateInputDraft("", { kind: "integer" }), "");
  assert.equal(validateInputDraft("007", { kind: "integer" }), "");
});

test("grade, HPS, and score boundaries preserve zero versus blank", () => {
  assert.notEqual(validateInput(0, { kind: "integer", min: 1 }), "");
  for (const value of [0, "0", 50, "50"]) assert.equal(validateInput(value, { kind: "integer", min: 0, max: 50 }), "");
  assert.notEqual(validateInput(51, { kind: "integer", min: 0, max: 50 }), "");
  assert.notEqual(validateInput(-1, { kind: "integer", min: 0, max: 50 }), "");
  assert.notEqual(validateInput("", { kind: "integer", required: true }), "");
});

test("sections allow numeric identifiers; subjects and titles need letters", () => {
  for (const value of ["101", "Section 1", "7-Rose", "St. Mary's", "STEM (A)"]) assert.equal(validateInput(value, { kind: "section" }), "");
  assert.equal(validateInput("Science 7", { kind: "subject" }), "");
  assert.equal(validateInput("Quiz 2: Reading / Writing", { kind: "assessment" }), "");
  for (const kind of ["subject", "assessment"]) assert.notEqual(validateInput("123", { kind }), "");
  assert.notEqual(validateInput("###", { kind: "section" }), "");
});

test("dates reject impossible dates and year zero, including leap-year boundaries", () => {
  for (const date of ["2024-02-29", "2026-10-08", "2000-02-29"]) assert.equal(isCalendarDate(date), true);
  for (const date of ["2026-02-29", "2026-04-31", "1900-02-29", "0000-01-01", "2026-13-01", "10/08/2026", true, new Date()]) assert.equal(isCalendarDate(date), false);
});

test("passwords allow numbers and symbols while enforcing minimum and bcrypt byte limit", () => {
  assert.equal(validateInput("123456", { kind: "password", minLength: 6 }), "");
  assert.equal(validateInput("Pa$$ word!", { kind: "password", minLength: 6 }), "");
  assert.notEqual(validateInput("12345", { kind: "password", minLength: 6 }), "");
  assert.notEqual(validateInput("      ", { kind: "password", minLength: 6 }), "");
  assert.equal(validateInput("a".repeat(72), { kind: "password" }), "");
  assert.notEqual(validateInput("a".repeat(73), { kind: "password" }), "");
  assert.equal(validateInput("é".repeat(36), { kind: "password" }), "");
  assert.notEqual(validateInput("é".repeat(37), { kind: "password" }), "");
});

test("usernames allow sensible identifiers and reject invalid types and punctuation", () => {
  for (const value of ["teacher_01", "teacher@example.com", "Juan Dela Cruz", "123"]) assert.equal(validateInput(value, { kind: "username" }), "");
  for (const value of [123, true, {}, "teacher<script>", "..."]) assert.notEqual(validateInput(value, { kind: "username" }), "");
});

test("field lengths have exact boundaries and required text cannot be spaces", () => {
  assert.equal(validateInput("a".repeat(200), { kind: "personName" }), "");
  assert.notEqual(validateInput("a".repeat(201), { kind: "personName" }), "");
  assert.notEqual(validateInput(" ", { kind: "section" }), "");
  assert.equal(validateInput(" ", { kind: "personName", required: false }), "");
});

const validId = "507f1f77bcf86cd799439011";
const student = { name: "Maria Santos", grade: 7, section: "Rose", subject_ids: [validId] };
const assessment = { name: "Quiz 1", term: 1, category: "written_work", sequence: 1, date: "2026-10-08", total_items: 50, subject_id: validId, scores: [{ student_id: validId, score: 0 }] };

async function apiFor(t) {
  const app = express();
  app.use(express.json());
  app.use(validateRequestInputs);
  let accepted = 0;
  app.use((_req, res) => { accepted += 1; res.sendStatus(204); });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return {
    get accepted() { return accepted; },
    async send(path, body, method = "POST") {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    },
  };
}

test("API rejects invalid text and number types before route/database code", async (t) => {
  const api = await apiFor(t);
  for (const patch of [{ name: "Maria123" }, { grade: true }, { grade: [7] }, { grade: "1e2" }, { grade: 0 }, { section: { name: "Rose" } }, { subject_ids: [123] }]) {
    const response = await api.send("/students", { ...student, ...patch });
    assert.equal(response.status, 400, JSON.stringify(patch));
    assert.ok(Object.keys(response.body.fields).length);
  }
  assert.equal(api.accepted, 0);
  assert.equal((await api.send("/students", student)).status, 204);
  assert.equal((await api.send(`/students/${validId}`, { ...student, name: "Juan2" }, "PUT")).status, 400);
  assert.equal((await api.send("/STUDENTS/", { ...student, name: "Juan2" })).status, 400);
});

test("API validates every assessment input and score range", async (t) => {
  const api = await apiFor(t);
  for (const patch of [{ name: "123" }, { term: true }, { term: "1.0" }, { term: 4 }, { category: "__proto__" }, { category: { toString: null } }, { sequence: 6 }, { sequence: [1] }, { date: "2026-02-29" }, { total_items: "1e2" }, { total_items: false }, { scores: [{ student_id: validId, score: 51 }] }, { scores: [{ student_id: validId, score: true }] }]) {
    assert.equal((await api.send("/assessments", { ...assessment, ...patch })).status, 400, JSON.stringify(patch));
  }
  assert.equal(api.accepted, 0);
  assert.equal((await api.send("/assessments", assessment)).status, 204);
});

test("API score edits reject coercion and malformed/duplicate entries but allow clearing", async (t) => {
  const api = await apiFor(t);
  const path = `/students/${validId}/assessment-scores`;
  for (const score of [true, false, " ", "1e2", "1.5", -1, [5], {}]) {
    assert.equal((await api.send(path, { scores: [{ assessment_id: validId, score }] }, "PUT")).status, 400);
    assert.equal((await api.send(`/assessments/${validId}/scores/${validId}`, { score }, "PUT")).status, 400);
  }
  for (const scores of [[null], [{ assessment_id: validId }, { assessment_id: validId }], [{}], {}]) {
    assert.equal((await api.send(path, { scores }, "PUT")).status, 400);
  }
  for (const score of [null, "", 0, "0"]) assert.equal((await api.send(path, { scores: [{ assessment_id: validId, score }] }, "PUT")).status, 204);
});

test("API enforces catalog, account and support-plan rules", async (t) => {
  const api = await apiFor(t);
  assert.equal((await api.send("/sections", { name: "Section 1" })).status, 204);
  assert.equal((await api.send("/sections", { name: false })).status, 400);
  assert.equal((await api.send("/subjects", { name: "123" })).status, 400);
  assert.equal((await api.send(`/subjects/${validId}`, { name: "Math 7" }, "PUT")).status, 204);
  assert.equal((await api.send("/register", { name: "teacher_1", password: "12345" })).status, 400);
  assert.equal((await api.send("/register", { name: "teacher_1", password: "a".repeat(73) })).status, 400);
  assert.equal((await api.send("/register", { name: "teacher_1", password: "123456" })).status, 204);
  assert.equal((await api.send("/login", { name: 123, password: "123456" })).status, 400);
  assert.equal((await api.send(`/api/gemini/student-support/${validId}`, { term: true, support_type: "enrichment" })).status, 400);
  assert.equal((await api.send(`/api/gemini/student-support/${validId}`, { term: 1, support_type: "enrichment" })).status, 204);
  assert.equal((await api.send("/students", [])).status, 400);
});

test("Excel import rejects name digits and invalid section punctuation with row numbers", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Students");
  sheet.addRows([["Grade Level", "Section", "Student Name"], [7, "Rose", "Maria123"], [7, "Rose<script>", "Maria Santos"]]);
  await assert.rejects(parseStudentWorkbook(await workbook.xlsx.writeBuffer()), (error) => {
    assert.deepEqual(error.issues.map((issue) => issue.row), [2, 3]);
    assert.match(error.issues[0].message, /Numbers are not allowed/);
    return true;
  });
});

test("actual score endpoint validates the entire batch before saving or clearing scores", async (t) => {
  const previousSecret = process.env.JWT_SECRET;
  const testSecret = "local-validation-test-secret-only";
  process.env.JWT_SECRET = testSecret;
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const owner = new mongoose.Types.ObjectId(validId);
  t.mock.method(User, "findById", () => ({ select: () => ({ lean: async () => ({ _id: owner, name: "Teacher" }) }) }));
  t.mock.method(Student, "findOne", async () => ({ _id: owner, subjectIds: [owner] }));
  t.mock.method(Assessment, "findOne", async ({ _id }) => ({ _id, totalItems: 10 }));
  const writes = [];
  t.mock.method(AssessmentScore, "deleteOne", async (filter) => { writes.push({ delete: filter }); });
  t.mock.method(AssessmentScore, "findOneAndUpdate", async (filter, update) => { writes.push({ filter, update }); });
  const app = express();
  app.use(express.json(), validateRequestInputs, studentRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/students/${validId}/assessment-scores`;
  const token = jwt.sign({ sub: validId }, testSecret, { issuer: "edulite-api", audience: "edulite-frontend" });
  const secondId = "507f1f77bcf86cd799439012";
  const send = (scores) => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ scores }) });
  assert.equal((await send([{ assessment_id: validId, score: null }, { assessment_id: secondId, score: 11 }])).status, 400);
  assert.equal(writes.length, 0);
  assert.equal((await send([{ assessment_id: validId, score: null }, { assessment_id: secondId, score: 0 }])).status, 200);
  assert.equal(writes.length, 2);
  assert.ok(writes[0].delete);
  assert.equal(writes[1].update.$set.score, 0);
});


test("Budget of Work accepts multiline curriculum text and rejects invalid payloads", async (t) => {
  const api = await apiFor(t);
  const budget = "Week 1: Fractions\nCompetency: Add unlike fractions.\nTime: 2 lessons.";
  assert.equal((await api.send("/assessments", { ...assessment, budget_of_work: budget })).status, 204);
  for (const value of [42, {}, [], "x".repeat(5001), "Topic\u0000hidden"]) {
    const response = await api.send("/assessments", { ...assessment, budget_of_work: value });
    assert.equal(response.status, 400);
    assert.ok(response.body.fields.budget_of_work);
  }
});
