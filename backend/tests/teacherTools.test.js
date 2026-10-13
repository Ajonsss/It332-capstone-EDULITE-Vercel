import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Student from "../models/Student.js";
import AssessmentScore from "../models/AssessmentScore.js";
import AuditEvent from "../models/AuditEvent.js";
import accountRoutes from "../accountRoutes.js";
import { requireAuth } from "../middleware/auth.js";
import { academicContext, DEFAULT_RULES } from "../services/academicContext.js";
import { hashRecoveryCode, matchesRecoveryCode } from "../services/accountSecurity.js";
import { validateRules, interventionPayload } from "../teacherTools.js";
import { calculateTermGrade, getSupportClassification } from "../utils/grading.js";
import { classifyYearEnd } from "../utils/yearEnd.js";

const query = (value) => ({ select() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });

test("school-year scope isolates default document writes and academic reads", async (t) => {
  const ownerId = new mongoose.Types.ObjectId(); const yearId = new mongoose.Types.ObjectId();
  const filters = [];
  t.mock.method(Student.collection, "find", (filter) => { filters.push(filter); return { toArray: async () => [] }; });
  await academicContext.run({ ownerId, schoolYearId: yearId }, async () => {
    const student = new Student({ name: "Alice" }); assert.equal(String(student.schoolYearId), String(yearId));
    await Student.find({ ownerId: new mongoose.Types.ObjectId() }).lean();
    assert.equal(String(filters[0].ownerId), String(ownerId));
    assert.equal(String(filters[0].schoolYearId), String(yearId));
    assert.deepEqual(filters[0].archived, { $ne: true });
    await Student.find({ ownerId }).setOptions({ acrossSchoolYears: true, includeArchived: true }).lean();
    assert.equal(filters[1].schoolYearId, undefined);
    assert.equal(filters[1].archived, undefined);
  });
  await academicContext.run({ ownerId, schoolYearId: null }, async () => { await Student.find({ ownerId }).lean(); assert.equal(filters[2].schoolYearId, null); });
});

test("configured weights and promotion thresholds change real calculations", () => {
  assert.equal(validateRules(DEFAULT_RULES), null);
  for (const patch of [{ passingGrade: true }, { highPerformingGrade: 60 }, { writtenWorkWeight: 70 }, { requireCompleteScores: "false" }]) assert.ok(validateRules({ ...DEFAULT_RULES, ...patch }));
  const records = [ ["written_work", 1, 0], ["performance_task", 1, 10], ["summative_test", 1, 10], ["summative_test", 2, 10], ["term_exam", 1, 10] ].map(([category, sequence, score]) => ({ term: 1, category, sequence, score, totalItems: 10 }));
  assert.equal(calculateTermGrade(records, 1).initialGrade, 80);
  academicContext.run({ rules: { ...DEFAULT_RULES, writtenWorkWeight: 60, performanceTaskWeight: 20, examinationWeight: 20, passingGrade: 85, highPerformingGrade: 95 } }, () => {
    assert.equal(calculateTermGrade(records, 1).initialGrade, 40);
    assert.equal(getSupportClassification(84), "At Risk");
    assert.equal(getSupportClassification(94), "Within Expected Range");
    assert.equal(classifyYearEnd([{ name: "Math", final: { finalGrade: 80, isComplete: true, isFullyComplete: true } }]).status, "intervention");
  });
  academicContext.run({ rules: { ...DEFAULT_RULES, requireAllSubjectsPassing: false, requireCompleteScores: false } }, () => {
    const result = classifyYearEnd([{ name: "Math", final: { finalGrade: 70, isComplete: true } }, { name: "Science", final: { finalGrade: 90, isComplete: true } }]);
    assert.equal(result.status, "ready"); assert.equal(result.finalAverage, 80);
  });
});

test("intervention progress validates scores, difficulty, and actual calendar dates", () => {
  const body = { title: "Fraction practice", activities: "1. Find 1/2 + 1/4", difficulty: "easy", status: "completed", dueDate: "2026-10-08", baselineScore: 40, followUpScore: 80, notes: "Improving" };
  assert.equal(interventionPayload(body).value.followUpScore, 80);
  for (const patch of [{ baselineScore: true }, { followUpScore: 101 }, { dueDate: "2026-02-29" }, { difficulty: "expert" }, { activities: "" }]) assert.ok(interventionPayload({ ...body, ...patch }).error);
});

test("score changes record teacher identity, old values, and new values", async (t) => {
  const ownerId = new mongoose.Types.ObjectId(); const id = new mongoose.Types.ObjectId(); const studentId = new mongoose.Types.ObjectId(); const assessmentId = new mongoose.Types.ObjectId(); const yearId = new mongoose.Types.ObjectId();
  const original = { _id: id, ownerId, studentId, assessmentId, schoolYearId: yearId, score: 4 };
  t.mock.method(AssessmentScore.collection, "find", () => ({ limit() { return this; }, toArray: async () => [original] }));
  t.mock.method(AssessmentScore.collection, "findOneAndUpdate", async () => ({ ...original, score: 8 }));
  const events = []; t.mock.method(AuditEvent, "create", async (items) => { events.push(...items); return items; });
  await academicContext.run({ ownerId, schoolYearId: yearId }, async () => { await AssessmentScore.findOneAndUpdate({ _id: id }, { $set: { score: 8 } }, { new: true }); });
  assert.equal(events.length, 1); assert.equal(String(events[0].ownerId), String(ownerId)); assert.equal(events[0].before[0].score, 4); assert.equal(events[0].changes.$set.score, 8);
});

test("private recovery codes are consumed once and revoke existing sessions", async (t) => {
  const originalSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = "account-test-secret";
  t.after(() => { if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; });
  const user = { _id: new mongoose.Types.ObjectId(), name: "Teacher", nameKey: "teacher", password: await bcrypt.hash("OldPassword1!", 4), sessionVersion: 0, activeSchoolYearId: null };
  t.mock.method(User, "findById", () => query(user)); t.mock.method(User, "findOne", ({ nameKey }) => query(nameKey === user.nameKey ? user : null));
  t.mock.method(User, "updateOne", async (filter, update) => {
    if (filter.recoveryHash && filter.recoveryHash !== user.recoveryHash) return { modifiedCount: 0 };
    Object.assign(user, update.$set); if (update.$unset?.recoveryHash) delete user.recoveryHash; user.sessionVersion += update.$inc?.sessionVersion ?? 0;
    return { modifiedCount: 1 };
  });
  t.mock.method(AuditEvent, "create", async () => ({}));
  const app = express(); app.use(express.json(), accountRoutes); app.get("/private", requireAuth, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ sub: String(user._id), sessionVersion: 0 }, process.env.JWT_SECRET, { issuer: "edulite-api", audience: "edulite-frontend" });
  const send = (path, body, auth = true) => fetch(url + path, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await send("/account/recovery-code", { password: "wrong" })).status, 400);
  const generated = await (await send("/account/recovery-code", { password: "OldPassword1!" })).json();
  assert.match(generated.recoveryCode, /^[a-f0-9]{64}$/); assert.notEqual(user.recoveryHash, generated.recoveryCode); assert.equal(user.recoveryHash, hashRecoveryCode(generated.recoveryCode));
  assert.equal(matchesRecoveryCode(crypto.randomBytes(32).toString("hex"), user.recoveryHash), false);
  assert.equal((await send("/account/reset-password", { name: "teacher", recovery_code: "bad", password: "NewPassword1!" }, false)).status, 400);
  assert.equal((await send("/account/reset-password", { name: "teacher", recovery_code: generated.recoveryCode, password: "NewPassword1!" }, false)).status, 200);
  assert.equal(await bcrypt.compare("NewPassword1!", user.password), true); assert.equal(user.sessionVersion, 1); assert.equal(user.recoveryHash, undefined);
  assert.equal((await send("/account/reset-password", { name: "teacher", recovery_code: generated.recoveryCode, password: "AnotherPassword1!" }, false)).status, 400);
  assert.equal((await fetch(url + "/private", { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  const wrongAudience = jwt.sign({ sub: String(user._id), sessionVersion: 1 }, process.env.JWT_SECRET, { issuer: "edulite-api", audience: "other-app" });
  assert.equal((await fetch(url + "/private", { headers: { Authorization: `Bearer ${wrongAudience}` } })).status, 401);
});

test("backup exports exclude credentials and restores remap references without overwriting data", async (t) => {
  const { default: toolsRouter } = await import("../teacherTools.js");
  const { default: SchoolYear } = await import("../models/SchoolYear.js");
  const { default: Section } = await import("../models/Section.js");
  const { default: Subject } = await import("../models/Subject.js");
  const { default: Assessment } = await import("../models/Assessment.js");
  const { default: StudentAiInsight } = await import("../models/StudentAiInsight.js");
  const { default: Intervention } = await import("../models/Intervention.js");
  const { default: AwardCertificate } = await import("../models/AwardCertificate.js");
  const originalSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = "backup-test-secret";
  t.after(() => { if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; });
  const owner = new mongoose.Types.ObjectId(); const sectionId = new mongoose.Types.ObjectId(); const subjectId = new mongoose.Types.ObjectId(); const studentId = new mongoose.Types.ObjectId();
  const user = { _id: owner, name: "Teacher", password: await bcrypt.hash("BackupPassword1!", 4), recoveryHash: "DO-NOT-EXPORT", legacyRules: DEFAULT_RULES };
  t.mock.method(User, "findById", () => query(user));
  const rows = {
    schoolYears: [{ _id: new mongoose.Types.ObjectId(), ownerId: owner, name: "2026–2027", rules: DEFAULT_RULES }], sections: [{ _id: sectionId, ownerId: owner, name: "Rose", nameKey: "rose" }], subjects: [{ _id: subjectId, ownerId: owner, name: "Mathematics", nameKey: "mathematics" }],
    students: [{ _id: studentId, ownerId: owner, name: "Alice", grade: 7, sectionId, subjectIds: [subjectId], schoolYearId: null, archived: true, archiveSnapshot: { name: "Alice", schoolYear: "2026–2027", outcome: "promoted", subjects: [] } }],
    assessments: [], scores: [], insights: [{ _id: new mongoose.Types.ObjectId(), ownerId: owner, studentId, supportType: "intervention", classification: "At Risk", focusLabel: "Mathematics", model: "test-model", title: "Fractions plan", result: { plan: { title: "Fractions plan" } }, pdfData: Buffer.from("%PDF-test") }], interventions: [], awards: [], history: [],
  };
  const models = { schoolYears: SchoolYear, sections: Section, subjects: Subject, students: Student, assessments: Assessment, scores: AssessmentScore, insights: StudentAiInsight, interventions: Intervention, awards: AwardCertificate, history: AuditEvent };
  const saved = [];
  for (const [key, Model] of Object.entries(models)) {
    t.mock.method(Model, "find", (filter) => { assert.equal(String(filter.ownerId), String(owner)); const q = query(rows[key]); q.setOptions = function(options) { assert.equal(options.acrossSchoolYears, true); return this; }; return q; });
    t.mock.method(Model.prototype, "save", async function () { saved.push({ key, doc: this.toObject() }); return this; });
  }
  t.mock.method(SchoolYear, "create", async (docs) => docs);
  t.mock.method(AuditEvent, "create", async () => ({}));
  let transactions = 0; t.mock.method(mongoose.connection, "transaction", async (work) => { transactions++; return work({}); });
  const app = express(); app.use(express.json(), toolsRouter); const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const token = jwt.sign({ sub: String(owner) }, process.env.JWT_SECRET, { issuer: "edulite-api", audience: "edulite-frontend" });
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const backup = await (await fetch(url + "/backups", { headers })).json();
  assert.equal(backup.format, "edulite-backup"); assert.equal(backup.collections.students.length, 1);
  assert.equal(backup.collections.insights[0].pdfData, Buffer.from("%PDF-test").toString("base64"));
  assert.ok(!JSON.stringify(backup).includes(user.password)); assert.ok(!JSON.stringify(backup).includes("DO-NOT-EXPORT"));
  const restore = (body) => fetch(url + "/backups/restore", { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal((await restore({ password: "wrong", backup })).status, 400); assert.equal(transactions, 0);
  const broken = structuredClone(backup); broken.collections.students[0].sectionId = String(subjectId);
  assert.equal((await restore({ password: "BackupPassword1!", backup: broken })).status, 400); assert.equal(saved.length, 0);
  const response = await restore({ password: "BackupPassword1!", backup });
  assert.equal(response.status, 200, JSON.stringify(await response.json())); assert.equal(transactions, 1);
  const student = saved.find((item) => item.key === "students").doc;
  const section = saved.find((item) => item.key === "sections").doc;
  const subject = saved.find((item) => item.key === "subjects").doc;
  assert.notEqual(String(student._id), String(studentId)); assert.equal(String(student.sectionId), String(section._id)); assert.equal(String(student.subjectIds[0]), String(subject._id));
  assert.equal(String(student.ownerId), String(owner)); assert.ok(student.schoolYearId); assert.equal(student.archiveSnapshot.schoolYear, "2026–2027");
});

test("authentication rate limiting blocks repeated attempts with a retry interval", async () => {
  const { limitAuthentication } = await import("../services/accountSecurity.js");
  const req = { ip: "security-test-ip" }; let accepted = 0; let status; let retry;
  const res = { set(_key, value) { retry = value; return this; }, status(value) { status = value; return this; }, json(value) { return value; } };
  for (let attempt = 0; attempt < 31; attempt++) limitAuthentication(req, res, () => accepted++);
  assert.equal(accepted, 30); assert.equal(status, 429); assert.ok(Number(retry) > 0);
});

test("student deletion protects next-year links and keeps certificate history", async (t) => {
  const { default: studentRouter } = await import("../student.js");
  const { default: StudentAiInsight } = await import("../models/StudentAiInsight.js");
  const { default: Intervention } = await import("../models/Intervention.js");
  const { default: AwardCertificate } = await import("../models/AwardCertificate.js");
  const originalSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = "student-delete-test-secret";
  t.after(() => { if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; });
  const owner = new mongoose.Types.ObjectId(); const studentId = new mongoose.Types.ObjectId();
  t.mock.method(User, "findById", () => query({ _id: owner, name: "Teacher" }));
  t.mock.method(Student, "findOne", async (filter) => { assert.equal(String(filter.ownerId), String(owner)); return { _id: studentId }; });
  let linked = true;
  t.mock.method(Student, "exists", (filter) => { assert.equal(String(filter.previousEnrollmentId), String(studentId)); const q = query(linked ? { _id: new mongoose.Types.ObjectId() } : null); q.setOptions = function (options) { assert.equal(options.acrossSchoolYears, true); return this; }; return q; });
  const deleted = [];
  for (const Model of [AssessmentScore, StudentAiInsight, Intervention]) t.mock.method(Model, "deleteMany", async (filter) => { assert.equal(String(filter.studentId), String(studentId)); deleted.push(Model.modelName); });
  t.mock.method(Student, "deleteOne", async () => { deleted.push("Student"); });
  let detached = false;
  t.mock.method(AwardCertificate, "updateMany", async (filter, update) => { assert.equal(String(filter.studentId), String(studentId)); assert.equal(update.$set.studentId, null); detached = true; });
  const app = express(); app.use(express.json(), studentRouter); const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const token = jwt.sign({ sub: String(owner) }, process.env.JWT_SECRET, { issuer: "edulite-api", audience: "edulite-frontend" });
  const send = () => fetch(`http://127.0.0.1:${server.address().port}/students/${studentId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await send()).status, 409); assert.equal(deleted.length, 0); assert.equal(detached, false);
  linked = false;
  assert.equal((await send()).status, 200); assert.equal(detached, true); assert.deepEqual(deleted.sort(), ["AssessmentScore", "Intervention", "Student", "StudentAiInsight"].sort());
});
