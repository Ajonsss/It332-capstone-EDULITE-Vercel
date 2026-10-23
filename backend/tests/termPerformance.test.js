import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { calculateTermGrade, transmuteInitialGrade } from "../utils/grading.js";
import { calculateTermPerformance } from "../utils/termPerformance.js";
import { academicContext, DEFAULT_RULES } from "../services/academicContext.js";
import Student from "../models/Student.js";
import Assessment from "../models/Assessment.js";
import AssessmentScore from "../models/AssessmentScore.js";
import StudentAiInsight from "../models/StudentAiInsight.js";
import assessmentRouter from "../assessment.js";
import geminiRouter from "../geminiRoute.js";
import getGeminiClient from "../gemini.js";

const record = (category, score, sequence = 1, term = 1, totalItems = 10) => ({ category, score, sequence, term, totalItems });

test("each component can show intervention needs before the term exam", () => {
  for (const category of ["written_work", "performance_task", "summative_test", "term_exam"]) {
    const records = [record(category, 2)];
    const result = calculateTermPerformance(records, 1);
    assert.equal(result.grade, transmuteInitialGrade(20));
    assert.ok(result.grade < 75);
    assert.equal(result.isProvisional, true);
    if (category !== "term_exam") assert.equal(calculateTermGrade(records, 1).termGrade, null);
  }
});

test("unrecorded work is excluded, while an actual zero is evidence", () => {
  const records = [record("written_work", 10), record("written_work", null, 2), record("performance_task", null)];
  assert.equal(calculateTermPerformance(records, 1).grade, 100);
  assert.equal(calculateTermPerformance([record("written_work", 0)], 1).grade, transmuteInitialGrade(0));
  for (const score of [null, undefined, "", NaN, -1, 11]) {
    assert.equal(calculateTermPerformance([record("written_work", score)], 1).grade, null);
  }
  assert.equal(calculateTermPerformance([record("written_work", 5, 1, 1, 0)], 1).grade, null);
});

test("estimates normalize available category and examination weights", () => {
  const records = [record("written_work", 0), record("performance_task", 10), record("summative_test", 5)];
  assert.equal(calculateTermPerformance(records, 1).initialGrade, 65);
  const examOnly = [record("summative_test", 0), record("summative_test", null, 2), record("term_exam", 10)];
  assert.equal(calculateTermPerformance(examOnly, 1).initialGrade, 57.14);
  academicContext.run({ rules: { ...DEFAULT_RULES, writtenWorkWeight: 60, performanceTaskWeight: 20, examinationWeight: 20 } }, () => {
    assert.equal(calculateTermPerformance(records, 1).initialGrade, 30);
  });
});

test("term filtering and subjects without evidence never fabricate results", () => {
  const records = [record("written_work", 0), record("written_work", 10, 1, 2)];
  assert.equal(calculateTermPerformance(records, 1).grade, transmuteInitialGrade(0));
  assert.equal(calculateTermPerformance(records, 2).grade, 100);
  for (const term of [3, 4]) assert.equal(calculateTermPerformance(records, term).grade, null);
  assert.equal(calculateTermPerformance([], 1).grade, null);
});

test("complete and imported grades retain their official values", () => {
  const records = [record("written_work", 8), record("performance_task", 9), record("summative_test", 6), record("summative_test", 7, 2), record("term_exam", 9)];
  const official = calculateTermGrade(records, 1);
  const performance = calculateTermPerformance(records, 1, official);
  assert.equal(performance.grade, official.termGrade);
  assert.equal(performance.isProvisional, false);
  assert.equal(calculateTermPerformance([], 1, calculateTermGrade([], 1, 72)).grade, 72);
});

const query = (value) => ({ populate() { return this; }, select() { return this; }, sort() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const ownerId = "507f1f77bcf86cd799439011";
const subjectId = "507f1f77bcf86cd799439012";
const studentId = "507f1f77bcf86cd799439015";
const assessmentId = "507f1f77bcf86cd799439016";

test("summary API and intervention generation use the same ongoing result", async (t) => {
  const student = { _id: studentId, name: "Maria Santos", grade: 7, sectionId: { _id: "507f1f77bcf86cd799439018", name: "Rose" },
    subjectIds: [{ _id: subjectId, name: "Math" }] };
  const budgetOfWork = "Week 1: Fractions\nCompetency: Add unlike fractions.\nTime: 2 lessons.";
  const assessment = { _id: assessmentId, subjectId, name: "Fractions", budgetOfWork, ...record("written_work", undefined), date: new Date("2026-10-01") };
  const otherSectionAssessment = { ...assessment, _id: "507f1f77bcf86cd799439019", budgetOfWork: "Other grade curriculum: algebra", sequence: 2, classSections: [{ grade: 8, sectionId: student.sectionId._id }] };
  let hasScore = true;
  t.mock.method(Student, "find", (filter) => query([filter.sectionId ? { ...student, subjectIds: [subjectId] } : student]));
  t.mock.method(Student, "findOne", () => query(student));
  t.mock.method(Assessment, "find", () => {
    const result = query([assessment, otherSectionAssessment]);
    result.populate = () => query([assessment, otherSectionAssessment].map((entry) => ({ ...entry, subjectId: { _id: subjectId, name: "Math" } })));
    return result;
  });
  t.mock.method(AssessmentScore, "find", () => query(hasScore ? [{ studentId, assessmentId, score: 2 }, { studentId, assessmentId: otherSectionAssessment._id, score: 10 }] : []));
  process.env.GEMINI_API_KEY ||= "test-placeholder";
  const prompts = [];
  const queuedResponses = [];
  t.mock.method(getGeminiClient().models, "generateContent", async (request) => {
    prompts.push(request.contents);
    assert.equal(request.config.responseJsonSchema.properties.targetedInterventions.type, "array");
    assert.ok(request.config.responseJsonSchema.properties.targetedInterventions.items.required.includes("assessmentIds"));
    assert.equal(request.config.responseJsonSchema.properties.targetedInterventions.items.properties.assessmentIds.items.enum, undefined);
    if (queuedResponses.length) return queuedResponses.shift();
    return { text: JSON.stringify({ title: "Fraction support", targetedInterventions: Array.from({ length: 3 }, () => ({
      title: "Practice fractions", rationale: "Low quiz score", actions: ["Model fractions"], schedule: "Weekly", successIndicator: "4 of 5", progressionRule: "Repeat until mastery",
      assessmentIds: [assessmentId], learningFocus: "Add unlike fractions",
      practiceActivities: ["easy", "medium", "hard"].map((difficulty) => ({ difficulty, title: "Fractions", objective: "Add fractions", duration: "10 minutes", masteryCheck: "4 of 5", materials: ["Paper"], instructions: ["Add"], tasks: ["1/2 + 1/2"], answerKey: ["1"] })),
    })) }) };
  });
  const saveInsight = t.mock.method(StudentAiInsight, "create", async (value) => ({ toObject: () => ({ ...value, _id: "507f1f77bcf86cd799439017", createdAt: new Date() }) }));
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: ownerId }; req.rules = DEFAULT_RULES; next(); });
  app.use(assessmentRouter); app.use(geminiRouter);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/grade-summaries`);
  assert.equal(response.status, 200);
  const [summary] = await response.json();
  assert.equal(summary.term1.termGrade, null);
  assert.equal(summary.final.finalGrade, null);
  assert.equal(summary.is_complete, false);
  assert.equal(summary.term1.performance.isProvisional, true);
  assert.equal(summary.term2.performance.grade, null);

  for (const focus_subject_id of [subjectId, null]) {
    const generated = await fetch(`${base}/gemini/student-support/${studentId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ support_type: "intervention", focus_subject_id, term: 1 }) });
    const result = await generated.json();
    assert.equal(generated.status, 201, JSON.stringify(result));
    assert.equal(result.classification, "At Risk");
    assert.equal(result.analytics.focusAveragePercentage, summary.term1.performance.grade);
    assert.equal(result.analytics.isProvisional, true);
    assert.equal(result.analytics.focusOfficialTermGrade, null);
    assert.equal(result.analytics.sectionComparison.sectionAveragePercentage, summary.term1.performance.grade);
    for (const intervention of result.plan.targetedInterventions) {
      assert.equal(intervention.learningFocus, "Add unlike fractions");
      assert.equal(intervention.curriculumBasis[0].budgetOfWork, budgetOfWork);
      assert.equal(intervention.curriculumBasis[0].score, 2);
      assert.equal(intervention.curriculumBasis[0].assessmentId, assessmentId);
    }
  }
  assert.equal(prompts.length, 2);
  assert.ok(prompts.every((prompt) => prompt.includes('"isProvisional": true')));
  for (const prompt of prompts) {
    const profile = JSON.parse(prompt.split("Academic profile:\n\n")[1]);
    assert.equal(profile.interventionAssessmentSources[0].budgetOfWork, budgetOfWork);
    assert.equal(profile.interventionAssessmentSources[0].score, 2);
    assert.equal(profile.focusAssessmentHistory[0].budgetOfWork, budgetOfWork);
    assert.ok(!prompt.includes("Other grade curriculum"), "another grade's curriculum is not a basis for this learner's intervention");
  }
  assert.equal(saveInsight.mock.calls[0].arguments[0].result.plan.targetedInterventions[0].curriculumBasis[0].budgetOfWork, budgetOfWork, "saved insights preserve the teacher's curriculum text");
  queuedResponses.push({ text: JSON.stringify({ targetedInterventions: [] }) });
  const recovered = await fetch(`${base}/gemini/student-support/${studentId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ support_type: "intervention", term: 1 }) });
  assert.equal(recovered.status, 201);
  assert.equal((await recovered.json()).plan.targetedInterventions.length, 3);
  assert.equal(prompts.length, 4);
  assert.equal(saveInsight.mock.callCount(), 3, "only the validated retry is saved");

  queuedResponses.push({ text: "{}" }, { text: "{}" });
  const errorLog = t.mock.method(console, "error", () => {});
  const invalid = await fetch(`${base}/gemini/student-support/${studentId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ support_type: "intervention", term: 1 }) });
  assert.equal(invalid.status, 502);
  assert.match((await invalid.json()).message, /after two attempts/);
  assert.equal(saveInsight.mock.callCount(), 3, "invalid plans never create saved insights or PDFs");
  assert.equal(prompts.length, 6);
  errorLog.mock.restore();
  hasScore = false;
  const empty = await fetch(`${base}/gemini/student-support/${studentId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ support_type: "intervention", term: 1 }) });
  assert.equal(empty.status, 400);
  assert.equal(prompts.length, 6);
});
