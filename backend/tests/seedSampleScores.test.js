import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Assessment from "../models/Assessment.js";
import AssessmentScore from "../models/AssessmentScore.js";
import AuditEvent from "../models/AuditEvent.js";
import Student from "../models/Student.js";
import { generateScore, planSampleScores, runSampleScores } from "../scripts/seedSampleScores.js";

const id = (number) => new mongoose.Types.ObjectId(number.toString(16).padStart(24, "0"));
const target = { ownerId: id(1), schoolYearId: id(2) };
const subjectId = id(3);
const sectionId = id(4);
const assessment = { ...target, _id: id(5), subjectId, totalItems: 20, classSections: [{ grade: 7, sectionId }] };
const student = (number, overrides) => ({ ...target, _id: id(number), grade: 7, sectionId, subjectIds: [subjectId], ...overrides });
const seed = "test-sample-seed";

test("sample scores are repeatable, bounded, mixed and correlated within a student", () => {
  const math = { ...assessment, totalItems: 100 };
  const otherAssessment = { ...math, _id: id(6) };
  const otherSubject = { ...otherAssessment, subjectId: id(7) };
  const results = Array.from({ length: 200 }, (_, index) => {
    const studentId = id(100 + index);
    const points = generateScore(seed, studentId, math);
    assert.equal(points, generateScore(seed, studentId, math));
    for (const totalItems of [1, 7, 20, 100]) {
      const score = generateScore(seed, studentId, { ...assessment, totalItems });
      assert.ok(Number.isInteger(score) && score >= 0 && score <= totalItems);
    }
    return {
      points,
      sameSubject: generateScore(seed, studentId, otherAssessment),
      differentSubject: generateScore(seed, studentId, otherSubject),
      differentSeed: generateScore("another seed", studentId, math),
    };
  });
  for (const band of [(score) => score < 65, (score) => score >= 65 && score < 85, (score) => score >= 85]) {
    assert.ok(results.filter(({ points }) => band(points)).length > 25);
  }
  assert.ok(results.filter(({ points, sameSubject }) => Math.abs(points - sameSubject) <= 12).length > 180);
  assert.ok(results.some(({ points, sameSubject }) => points !== sameSubject));
  assert.ok(results.some(({ sameSubject, differentSubject }) => sameSubject !== differentSubject));
  assert.ok(results.some(({ points, differentSeed }) => points !== differentSeed));
  assert.throws(() => generateScore(seed, id(100), { ...assessment, totalItems: 2.5 }), /invalid highest possible score/);
});

test("the plan respects active enrollment, section and grade, legacy scopes and existing scores", () => {
  const legacyAssessment = { ...assessment, _id: id(6), classSections: null };
  const emptyAssessment = { ...assessment, _id: id(7), subjectId: id(90) };
  const students = [
    student(10, { subjectIds: [subjectId, subjectId] }),
    student(11, { grade: 8 }),
    student(12, { sectionId: id(88) }),
    student(13, { subjectIds: [id(89)] }),
    student(14, { archived: true }),
  ];
  const scores = [
    { ...target, studentId: id(10), assessmentId: assessment._id, score: 0 },
    { ...target, schoolYearId: null, studentId: id(11), assessmentId: legacyAssessment._id, score: 7 },
  ];
  const plan = planSampleScores([assessment, legacyAssessment, emptyAssessment], students, scores, target.schoolYearId);
  assert.equal(plan.assessmentsWithoutEligibleStudents, 1);
  assert.equal(plan.eligible.size, 4);
  assert.equal(plan.outOfYearScores, 1);
  assert.deepEqual(plan.missing.map(({ studentId, assessmentId }) => [String(studentId), String(assessmentId)]),
    [[String(id(10)), String(legacyAssessment._id)], [String(id(12)), String(legacyAssessment._id)]]);
});

test("schema-validated upserts and audit entries commit together, preserve scores, and rerun cleanly", async (t) => {
  const timestamps = { createdAt: new Date(0), updatedAt: new Date(1000) };
  const zero = { ...target, ...timestamps, _id: id(40), studentId: id(10), assessmentId: assessment._id, score: 0 };
  const concurrent = { ...zero, _id: id(41), studentId: id(12), score: 8 };
  let scores = [zero];
  let audits = [];
  let rejectAudit = true;
  let addConcurrentScore = false;
  const session = new mongoose.mongo.MongoClient("mongodb://localhost").startSession();
  t.after(() => session.endSession());
  const matches = (row, filter) => Object.entries(filter).every(([field, value]) => {
    if (field === "$or") return value.some((branch) => matches(row, branch));
    if (value?.$in) return value.$in.some((entry) => String(entry) === String(row[field]));
    if (value?.$ne !== undefined) return row[field] !== value.$ne;
    return String(row[field] ?? null) === String(value);
  });
  for (const [model, rows] of [
    [Assessment, () => [assessment, { ...assessment, _id: id(80), schoolYearId: id(81) }]],
    [Student, () => [student(10), student(11), student(12), student(13, { archived: true }), student(14, { ownerId: id(81) })]],
    [AssessmentScore, () => scores],
    [AuditEvent, () => audits],
  ]) {
    t.mock.method(model.collection, "find", (filter) => ({
      toArray: async () => rows().filter((row) => matches(row, filter)),
    }));
  }
  t.mock.method(AssessmentScore.collection, "indexes", async () => [
    { key: { ownerId: 1, studentId: 1, assessmentId: 1 }, unique: true },
  ]);
  t.mock.method(mongoose.connection, "transaction", async (work) => {
    if (addConcurrentScore) {
      scores.push(concurrent);
      addConcurrentScore = false;
    }
    const priorScores = [...scores];
    const priorAudits = [...audits];
    try {
      return await work(session);
    } catch (error) {
      scores = priorScores;
      audits = priorAudits;
      throw error;
    }
  });
  t.mock.method(AssessmentScore.collection, "bulkWrite", async (writes, options) => {
    assert.equal(options.session, session);
    const upsertedIds = {};
    for (const [index, { updateOne }] of writes.entries()) {
      assert.equal(updateOne.upsert, true);
      assert.deepEqual(Object.keys(updateOne.update), ["$setOnInsert"]);
      const doc = updateOne.update.$setOnInsert;
      assert.equal(String(doc.ownerId), String(target.ownerId));
      assert.equal(String(doc.schoolYearId), String(target.schoolYearId));
      assert.ok(doc.createdAt instanceof Date && doc.updatedAt instanceof Date);
      assert.ok(Number.isInteger(doc.score) && doc.score >= 0 && doc.score <= assessment.totalItems);
      if (scores.some((row) => matches(row, updateOne.filter))) continue;
      scores.push(doc);
      upsertedIds[index] = doc._id;
    }
    return { modifiedCount: 0, upsertedIds, upsertedCount: Object.keys(upsertedIds).length };
  });
  t.mock.method(AuditEvent.collection, "insertOne", async (record, options) => {
    assert.equal(options.session, session);
    if (rejectAudit) throw new Error("test audit failure");
    assert.equal(record.actorName, "Sample score generator");
    audits.push(record);
    return { acknowledged: true, insertedId: record._id };
  });

  const preview = await runSampleScores(target, { seed });
  assert.equal(preview.missing.length, 2);
  assert.deepEqual(scores, [zero]);
  await assert.rejects(runSampleScores(target, { seed, apply: true }), /test audit failure/);
  assert.deepEqual(scores, [zero]);
  assert.equal(audits.length, 0);

  rejectAudit = false;
  addConcurrentScore = true;
  const applied = await runSampleScores(target, { seed, apply: true });
  assert.equal(applied.scoresInserted, 1);
  assert.equal(applied.existingScoresVerifiedUnchanged, 1);
  assert.equal(applied.auditEntriesVerified, 1);
  assert.deepEqual(scores.slice(0, 2), [zero, concurrent]);
  assert.equal(scores[2].score, generateScore(seed, id(11), assessment));
  assert.equal(audits[0].changes[0].id, String(scores[2]._id));
  assert.equal((await runSampleScores(target, { seed })).missing.length, 0);
  const repeated = await runSampleScores(target, { apply: true, seed: "different seed" });
  assert.equal(repeated.scoresInserted, 0);
  assert.equal(repeated.existingScoresVerifiedUnchanged, 3);
  assert.equal(repeated.auditEntriesVerified, 0);
  assert.equal(audits.length, 1);
});
