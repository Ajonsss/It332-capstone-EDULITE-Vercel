import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import mongoose from "mongoose";
import Assessment from "../models/Assessment.js";
import AssessmentScore from "../models/AssessmentScore.js";
import Student from "../models/Student.js";
import Section from "../models/Section.js";
import Subject from "../models/Subject.js";
import ClassOffering from "../models/ClassOffering.js";
import assessmentRouter from "../assessment.js";
import studentRouter from "../student.js";
import { buildYearEndReports } from "../studentLifecycle.js";
import { assessmentIncludesStudent, assessmentStudentFilter } from "../../shared/assessmentScope.mjs";

const ownerId = "507f1f77bcf86cd799439011", yearId = "507f1f77bcf86cd799439012";
const subjectId = "507f1f77bcf86cd799439013", roseId = "507f1f77bcf86cd799439014", lilyId = "507f1f77bcf86cd799439015";
const aliceId = "507f1f77bcf86cd799439016", bobId = "507f1f77bcf86cd799439017", olderId = "507f1f77bcf86cd799439018";
const foreignId = "507f1f77bcf86cd799439019";
const section = (grade, section_id) => ({ grade, section_id });

test("assessment scope distinguishes grade and section, supports multiple groups, and retains legacy scope", () => {
  const student = { grade: 7, section_id: roseId };
  for (const assessment of [{}, { classSections: null }, { class_sections: null }]) assert.equal(assessmentIncludesStudent(assessment, student), true);
  const scoped = { class_sections: [section(7, roseId), section(7, lilyId)] };
  assert.equal(assessmentIncludesStudent(scoped, student), true);
  assert.equal(assessmentIncludesStudent(scoped, { grade: 7, sectionId: { _id: lilyId, name: "Lily" } }), true);
  assert.equal(assessmentIncludesStudent(scoped, { grade: 8, section_id: roseId }), false);
  assert.equal(assessmentIncludesStudent(scoped, { grade: 7, section_id: foreignId }), false);
  assert.deepEqual(assessmentStudentFilter([{ grade: 7, sectionId: roseId }]), { $or: [{ grade: 7, sectionId: roseId }] });
  assert.equal(new Assessment({ classSections: [{ grade: 7.5, sectionId: roseId }] }).validateSync().errors["classSections.0.grade"].name, "ValidatorError");
});

test("assessment creation, edits, scores, summaries and archives enforce selected sections", async (t) => {
  const state = {
    sections: [{ _id: roseId, ownerId, name: "Rose" }, { _id: lilyId, ownerId, name: "Lily" }, { _id: foreignId, ownerId: foreignId, name: "Foreign" }],
    subjects: [{ _id: subjectId, ownerId, name: "Math" }],
    classes: [section(7, roseId), section(7, lilyId), section(8, roseId), section(9, lilyId)]
      .map((entry) => ({ ownerId, schoolYearId: yearId, grade: entry.grade, sectionId: entry.section_id, subjectIds: [subjectId] })),
    students: [
      { _id: aliceId, name: "Alice", grade: 7, sectionId: roseId },
      { _id: bobId, name: "Bob", grade: 7, sectionId: lilyId },
      { _id: olderId, name: "Older learner", grade: 8, sectionId: roseId },
    ].map((entry) => ({ ...entry, ownerId, schoolYearId: yearId, subjectIds: [subjectId] })),
    assessments: [], scores: [],
  };
  const idOf = (value) => String(value?._id ?? value);
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some((entry) => matches(row, entry));
    const field = row[key];
    if (value == null) return field == null;
    if (typeof value === "object") {
      if ("$in" in value) return (Array.isArray(field) ? field : [field]).some((entry) => value.$in.map(idOf).includes(idOf(entry)));
      if ("$ne" in value) return idOf(field) !== idOf(value.$ne);
      if ("$size" in value) return Array.isArray(field) && field.length === value.$size;
      if ("$elemMatch" in value) return field?.some((entry) => matches(entry, value.$elemMatch)) ?? false;
    }
    return (Array.isArray(field) ? field : [field]).some((entry) => idOf(entry) === idOf(value));
  });
  const query = (key, filter, one = false) => {
    const populate = [];
    const result = () => {
      const found = structuredClone(state[key].filter((row) => matches(row, filter)));
      for (const row of found) for (const { path } of populate) {
        if (path === "sectionId") row.sectionId = state.sections.find((entry) => entry._id === row.sectionId);
        if (path === "subjectId") row.subjectId = state.subjects.find((entry) => entry._id === row.subjectId);
        if (path === "subjectIds") row.subjectIds = row.subjectIds.map((id) => state.subjects.find((entry) => entry._id === id));
      }
      return one ? found[0] ?? null : found;
    };
    return { session() { return this; }, select() { return this; }, sort() { return this; }, populate(value) { populate.push(value); return this; },
      async lean() { return result(); }, then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } };
  };
  for (const [Model, key] of [[Assessment, "assessments"], [AssessmentScore, "scores"], [Student, "students"], [Section, "sections"], [Subject, "subjects"], [ClassOffering, "classes"]]) {
    t.mock.method(Model, "find", (filter) => query(key, filter));
    t.mock.method(Model, "findOne", (filter) => query(key, filter, true));
  }
  let counter = 32;
  const createId = () => (counter++).toString(16).padStart(24, "0");
  t.mock.method(Assessment, "create", async (rows) => rows.map((entry) => { const row = { ...entry, _id: createId(), schoolYearId: yearId }; state.assessments.push(row); return row; }));
  t.mock.method(Assessment, "findOneAndUpdate", async (filter, update) => { const row = state.assessments.find((entry) => matches(entry, filter)); Object.assign(row, update.$set); return row; });
  t.mock.method(AssessmentScore, "insertMany", async (rows) => { state.scores.push(...rows.map((row) => ({ ...row, _id: createId() }))); });
  t.mock.method(AssessmentScore, "deleteMany", async (filter) => { state.scores = state.scores.filter((row) => !matches(row, filter)); });
  t.mock.method(AssessmentScore, "countDocuments", async (filter) => state.scores.filter((row) => matches(row, filter)).length);
  t.mock.method(mongoose.connection, "transaction", async (work) => {
    const snapshot = structuredClone(state);
    try { return await work({}); } catch (error) { Object.assign(state, snapshot); throw error; }
  });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: ownerId }; req.academicYear = yearId; next(); });
  app.use(assessmentRouter); app.use(studentRouter);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (path, body, method = "POST") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const payload = { name: "Fractions", budget_of_work: "Adding fractions", subject_id: subjectId, term: 1, category: "written_work", sequence: 1, total_items: 10, date: "2026-10-23", class_sections: [section(7, roseId)], scores: [{ student_id: aliceId, score: 2 }] };
  for (const class_sections of [undefined, null, [], [null], [section("7", roseId)], [section(7, "bad")], [section(7, foreignId)], [section(10, roseId)]]) {
    const response = await request("/assessments", { ...payload, class_sections });
    assert.equal(response.status, 400, JSON.stringify(response.body));
  }
  const first = await request("/assessments", payload);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const lily = await request("/assessments", { ...payload, class_sections: [section(7, lilyId)], scores: [{ student_id: bobId, score: 9 }] });
  assert.equal(lily.status, 201, "different sections can use the same ECR slot");
  assert.equal((await request("/assessments", payload)).status, 400, "overlapping slots are rejected");
  assert.equal((await request("/assessments", { ...payload, class_sections: [section(8, roseId)], scores: [] })).status, 201, "shared section names in different grades have separate slots");
  assert.equal((await request("/assessments", { ...payload, sequence: 2, scores: [{ student_id: bobId, score: 5 }] })).status, 400, "cross-section scores cannot be submitted");
  assert.equal((await request("/assessments", { ...payload, sequence: 2, scores: [{ student_id: olderId, score: 5 }] })).status, 400, "cross-grade scores cannot be submitted");
  const multi = await request("/assessments", { ...payload, sequence: 2, class_sections: [section(7, roseId), section(7, lilyId), section(7, roseId)], scores: [{ student_id: aliceId, score: 0 }, { student_id: bobId, score: null }] });
  assert.equal(multi.status, 201, JSON.stringify(multi.body));
  const read = await request(`/assessments/${first.body.id}`, null, "GET");
  assert.deepEqual(read.body.class_sections, [section(7, roseId)]);
  assert.deepEqual(read.body.students.map((row) => row.id), [aliceId]);
  assert.equal((await request(`/assessments/${first.body.id}/scores/${bobId}`, { score: 5 }, "PUT")).status, 400);
  assert.equal((await request(`/students/${bobId}/assessment-scores`, { scores: [{ assessment_id: first.body.id, score: 5 }] }, "PUT")).status, 400);
  assert.equal((await request(`/assessments/${first.body.id}`, { ...payload, class_sections: [section(7, lilyId)] }, "PUT")).status, 400, "changing sections cannot overwrite another section's slot");
  const edited = await request(`/assessments/${first.body.id}`, { ...payload, class_sections: undefined, scores: [{ student_id: aliceId, score: 4 }] }, "PUT");
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(state.assessments.find((row) => row._id === first.body.id).classSections, [{ grade: 7, sectionId: roseId }], "omitted scope on edits retains the original selection");
  const summaries = await request("/grade-summaries", null, "GET");
  assert.equal(summaries.status, 200);
  const alice = summaries.body.find((row) => row.student_id === aliceId), bob = summaries.body.find((row) => row.student_id === bobId), older = summaries.body.find((row) => row.student_id === olderId);
  assert.equal(alice.term1.performance.initialGrade, 20, "only Alice's two assessments contribute");
  assert.equal(bob.term1.performance.initialGrade, 90, "another section's scores and missing work do not contribute");
  assert.equal(older.term1.performance.grade, null);
  const reports = await buildYearEndReports(ownerId);
  assert.equal(reports.find((row) => row.id === aliceId).subjects[0].assessments.length, 2);
  assert.equal(reports.find((row) => row.id === bobId).subjects[0].assessments.length, 2);
  assert.equal(reports.find((row) => row.id === olderId).subjects[0].assessments.length, 1);
  const empty = await request("/assessments", { ...payload, class_sections: [section(9, lilyId)], scores: [] });
  assert.equal(empty.status, 201, "registered empty sections can have assessments");
  const legacy = { ...structuredClone(state.assessments[0]), _id: createId(), sequence: 3, classSections: null };
  state.assessments.push(legacy);
  assert.equal((await request("/assessments", { ...payload, sequence: 3, class_sections: [section(7, lilyId)], scores: [] })).status, 400, "older subject-wide slots still overlap selected sections");
  assert.equal((await request(`/assessments/${legacy._id}`, { ...payload, sequence: 3, class_sections: undefined, scores: [] }, "PUT")).status, 200, "older assessments remain editable");
});
