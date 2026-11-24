import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import SchoolYear from "../models/SchoolYear.js";
import Student from "../models/Student.js";
import Section from "../models/Section.js";
import Subject from "../models/Subject.js";
import Assessment from "../models/Assessment.js";
import AssessmentScore from "../models/AssessmentScore.js";
import { createDashboardRouter } from "../dashboard.js";
import { getAcademicContext, DEFAULT_RULES } from "../services/academicContext.js";
import { listSections } from "../section.js";
import { listSubjects } from "../subject.js";
import { listAssessments } from "../assessment.js";

const query = (data) => ({ select() { return this; }, sort() { return this; }, populate() { return this; }, lean: async () => data });

test("dashboard authenticates once, preserves owner/year scope and never caches account permissions", async (t) => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = "dashboard-performance-test-secret";
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  const teachers = [0, 1].map(() => ({ _id: new mongoose.Types.ObjectId(), name: "Teacher", sessionVersion: 0, activeSchoolYearId: new mongoose.Types.ObjectId() }));
  let lookups = 0, yearLookups = 0, readCalls = 0, failRead = false;
  t.mock.method(User, "findById", (id) => { lookups++; return query(teachers.find((item) => String(item._id) === String(id))); });
  t.mock.method(SchoolYear, "findOne", (filter) => {
    yearLookups++;
    assert.ok(teachers.some((item) => String(item._id) === String(filter.ownerId) && String(item.activeSchoolYearId) === String(filter._id)));
    return query({ _id: filter._id, rules: DEFAULT_RULES });
  });
  const keys = ["students", "sections", "subjects", "assessments", "assessmentRecords", "gradeSummaries", "schoolYears", "classes"];
  const readers = Object.fromEntries(keys.map((key) => [key, async (req, res) => {
    readCalls++;
    const context = getAcademicContext();
    assert.equal(String(context.ownerId), String(req.user.id)); assert.equal(String(context.schoolYearId), String(req.academicYear));
    assert.deepEqual(req.query, {}, "dashboard reads cannot inherit client filters");
    if (failRead && key === "students") return res.status(503).json({ message: "Students unavailable." });
    return res.json({ ownerId: String(req.user.id), year: String(req.academicYear), key });
  }]));
  const app = express(); app.use(createDashboardRouter({ readers }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/dashboard?subject_id=foreign`;
  const token = (user) => jwt.sign({ sub: String(user._id), sessionVersion: user.sessionVersion }, process.env.JWT_SECRET, { issuer: "edulite-api", audience: "edulite-frontend" });
  const firstToken = token(teachers[0]);
  const send = (value) => fetch(base, { headers: value ? { Authorization: `Bearer ${value}` } : {} });
  assert.equal((await send()).status, 401); assert.equal(readCalls, 0);
  const responses = await Promise.all([send(firstToken), send(token(teachers[1]))]);
  for (const [index, response] of responses.entries()) {
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json(); assert.deepEqual(body.gradingRules, DEFAULT_RULES);
    for (const key of keys) assert.deepEqual(body[key], { ownerId: String(teachers[index]._id), year: String(teachers[index].activeSchoolYearId), key });
  }
  assert.equal(lookups, 2); assert.equal(yearLookups, 2); assert.equal(readCalls, 16);
  teachers[0].sessionVersion++;
  assert.equal((await send(firstToken)).status, 401); assert.equal(readCalls, 16, "revoked tokens never reach readers");
  teachers[0].activeSchoolYearId = new mongoose.Types.ObjectId();
  const changed = await (await send(token(teachers[0]))).json();
  assert.equal(changed.students.year, String(teachers[0].activeSchoolYearId));
  failRead = true;
  const failed = await send(token(teachers[0])); assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { message: "Students unavailable." });
});

test("dashboard reporting years are owner-scoped and use their own rules without changing the active year", async (t) => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "dashboard-school-year-test-secret";
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });

  const id = () => new mongoose.Types.ObjectId();
  const teacher = { _id: id(), activeSchoolYearId: id(), legacyRules: { passingGrade: 70 } };
  const older = { _id: id(), ownerId: teacher._id, rules: { passingGrade: 81 } };
  const years = [{ _id: teacher.activeSchoolYearId, ownerId: teacher._id, rules: { passingGrade: 76 } }, older,
    { _id: id(), ownerId: id(), rules: { passingGrade: 90 } }];
  t.mock.method(User, "findById", () => query(teacher));
  t.mock.method(SchoolYear, "findOne", (filter) => query(years.find((year) =>
    String(year._id) === String(filter._id) && String(year.ownerId) === String(filter.ownerId))));
  t.mock.method(User, "updateOne", () => assert.fail("Reporting must not change the account's active year"));

  let reads = 0;
  const readers = { students: (req, res) => {
    reads++;
    const context = getAcademicContext();
    assert.deepEqual(req.query, {}, "client IDs cannot widen the scope of the readers");
    assert.equal(String(context.ownerId), String(teacher._id));
    assert.equal(String(context.schoolYearId), String(req.academicYear));
    assert.equal(context.rules.passingGrade, req.rules.passingGrade);
    res.json({ year: req.academicYear, includeArchived: req.includeArchived });
  } };
  const app = express();
  app.use(createDashboardRouter({ readers }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const token = jwt.sign({ sub: String(teacher._id) }, process.env.JWT_SECRET, { issuer: "edulite-api", audience: "edulite-frontend" });
  const send = (query = "") => fetch(`http://127.0.0.1:${server.address().port}/dashboard${query}`, { headers: { Authorization: `Bearer ${token}` } });

  const historic = await (await send(`?school_year_id=${older._id}`)).json();
  assert.deepEqual(historic.students, { year: String(older._id), includeArchived: true });
  assert.equal(historic.gradingRules.passingGrade, 81);
  const legacy = await (await send("?school_year_id=legacy")).json();
  assert.deepEqual(legacy.students, { year: null, includeArchived: true });
  assert.equal(legacy.gradingRules.passingGrade, 70);
  const active = await (await send()).json();
  assert.deepEqual(active.students, { year: String(teacher.activeSchoolYearId), includeArchived: false });
  assert.equal(active.gradingRules.passingGrade, 76);
  assert.equal((await send(`?school_year_id=${years[2]._id}&student_id=${id()}`)).status, 404);
  assert.equal((await send("?school_year_id=invalid")).status, 400);
  assert.equal(reads, 3);
});

test("list counts use a fixed number of scoped queries rather than queries per card", async (t) => {
  const ownerId = new mongoose.Types.ObjectId(), section = new mongoose.Types.ObjectId(), subject = new mongoose.Types.ObjectId();
  const assessments = Array.from({ length: 40 }, (_, index) => ({ _id: new mongoose.Types.ObjectId(), name: `Quiz ${index}`, subjectId: { _id: subject, name: "Math" }, term: 1, category: "written_work", sequence: 1, totalItems: 10 }));
  const rows = [{ _id: "student", sectionId: section, subjectIds: [subject, subject] }];
  let studentReads = 0, scoreReads = 0;
  t.mock.method(Section, "find", (filter) => { assert.equal(filter.ownerId, ownerId); return query([{ _id: section, name: "Rose" }]); });
  t.mock.method(Subject, "find", (filter) => { assert.equal(filter.ownerId, ownerId); return query([{ _id: subject, name: "Math" }]); });
  t.mock.method(Student, "find", (filter) => { assert.equal(filter.ownerId, ownerId); studentReads++; return query(rows); });
  t.mock.method(Assessment, "find", (filter) => { assert.equal(filter.ownerId, ownerId); return query(filter.subjectId ? assessments.map((item) => ({ ...item, subjectId: subject })) : assessments); });
  t.mock.method(AssessmentScore, "find", (filter) => {
    assert.equal(filter.ownerId, ownerId); assert.equal(filter.assessmentId.$in.length, 40); scoreReads++;
    return query([{ assessmentId: assessments[0]._id, score: 0 }, { assessmentId: assessments[0]._id, score: 8 }]);
  });
  for (const Model of [Student, Assessment, AssessmentScore]) t.mock.method(Model, "countDocuments", () => { throw new Error("Per-item counts must not run"); });
  const read = async (handler) => {
    let result;
    await handler({ user: { id: ownerId }, query: {} }, { json(data) { result = data; return this; }, status(code) { assert.fail(`Unexpected status ${code}`); } });
    return result;
  };
  assert.equal((await read(listSections))[0].student_count, 1);
  const subjects = await read(listSubjects); assert.equal(subjects[0].student_count, 1); assert.equal(subjects[0].assessment_count, 40);
  const listed = await read(listAssessments); assert.equal(listed.length, 40);
  assert.equal(listed[0].score_count, 2); assert.equal(listed[1].score_count, 0);
  assert.equal(studentReads, 2); assert.equal(scoreReads, 1);
});
