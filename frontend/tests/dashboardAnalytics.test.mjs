import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_ASSIGNMENTS, buildTeachingAssignments, indexAssessmentScores, indexGradeSummaries,
  listLearningSupport, selectTeachingAssignments, summarizeAssessments, summarizeAssignment,
  summarizeDistribution, summarizeOverview,
} from "../src/utils/dashboardAnalytics.js";

const enrollment = (id, grade, section_id, subject_ids) => ({ id, name: id, grade, section_id, section: "Rose", subject_ids });
const data = {
  sections: [{ id: "rose", name: "Rose" }, { id: "lily", name: "Lily" }],
  subjects: [{ id: "math", name: "Math" }, { id: "science", name: "Science" }],
  classes: [{ grade: 7, section_id: "lily", subject_ids: ["math"] }],
  students: [
    enrollment("Ana", 7, "rose", ["math", "science"]),
    enrollment("Ben", 7, "rose", ["math", "science"]),
    enrollment("Cora", 8, "rose", ["math"]),
    enrollment("Unassigned", 9, null, ["math"]),
  ],
};

const assignments = buildTeachingAssignments(data);
const math = assignments.find((item) => item.id === "7:rose:math");
const summaries = indexGradeSummaries([
  { student_id: "Ana", subject_id: "math", term1: { termGrade: 0 }, term3: { termGrade: 84 } },
  { student_id: "Ana", subject_id: "science", term1: { performance: { grade: 74.5, isProvisional: true } } },
  { student_id: "Ben", subject_id: "math", term1: { termGrade: null } },
  { student_id: "Ben", subject_id: "science", term1: { performance: { grade: 96, isProvisional: true } } },
  { student_id: "Cora", subject_id: "math", term1: { termGrade: 90 } },
]);

test("overview counts distinct enrollments and intervention flags across authorized subjects", () => {
  assert.deepEqual(assignments.map((item) => item.id), ["7:lily:math", "7:rose:math", "7:rose:science", "8:rose:math"]);
  const classes = assignments.map((item) => summarizeAssignment(item, summaries, 1, 80));
  assert.deepEqual(summarizeOverview(classes), { gradeLevels: 2, sections: 3, students: 3, below: 1 });
  assert.deepEqual(
    listLearningSupport(classes, { passingGrade: 80, highPerformingGrade: 94 })
      .map(({ student, assignment, supportType }) => [student.id, assignment.subjectId, supportType]),
    [["Ana", "math", "intervention"], ["Ana", "science", "intervention"], ["Ben", "science", "enrichment"]],
  );
  const empty = classes[0];
  assert.equal(empty.students.length, 0);
  assert.equal(empty.average, null);
  assert.equal(empty.passingRate, null);
  assert.deepEqual(summarizeOverview(assignments.map((item) => summarizeAssignment(item, summaries, 2, 80))),
    { gradeLevels: 2, sections: 3, students: 3, below: 0 });
});

test("sections use grade and section IDs and filters keep only valid downstream selections", () => {
  const all = selectTeachingAssignments(assignments, ALL_ASSIGNMENTS);
  assert.deepEqual(all.sections.map((section) => section.label), ["Grade 7 · Section Lily", "Grade 7 · Section Rose", "Grade 8 · Section Rose"]);
  const gradeChanged = selectTeachingAssignments(assignments, { grade: "8", section: "7:rose", subject: "science" });
  assert.deepEqual(gradeChanged.selection, { grade: "8", section: "ALL", subject: "ALL" });
  assert.deepEqual(gradeChanged.subjects.map(({ value }) => value), ["math"]);
  const sectionChanged = selectTeachingAssignments(assignments, { grade: "7", section: "7:lily", subject: "math" });
  assert.deepEqual(sectionChanged.selection, { grade: "7", section: "7:lily", subject: "math" });
  assert.equal(sectionChanged.assignments.length, 1);
});

test("class and assessment averages keep missing results separate and retain valid zeroes", () => {
  const result = summarizeAssignment(math, summaries, 1, 80);
  assert.equal(result.average, 0);
  assert.equal(result.passingRate, 0);
  assert.deepEqual(result.results.map(({ grade }) => grade), [0, null]);
  assert.deepEqual(result.below.map(({ student }) => student.id), ["Ana"]);
  const bands = summarizeDistribution(result.assessed);
  assert.equal(bands.reduce((total, band) => total + band.count, 0), 1);
  assert.equal(bands.find((band) => band.label === "Emerging").percentage, 100);
  assert.ok(summarizeDistribution([]).every((band) => band.count === 0 && band.percentage === null));
  assert.deepEqual([1, 2, 3].map((term) => summarizeAssignment(math, summaries, term, 80).average), [0, null, 84]);

  const assessments = [
    { id: "quiz", term: 1, subject_id: "math", total_items: 20, class_sections: [{ grade: 7, section_id: "rose" }] },
    { id: "legacy", term: 1, subject_id: "math", total_items: 10 },
    { id: "other-term", term: 2, subject_id: "math", total_items: 10 },
  ];
  const scores = indexAssessmentScores([
    { assessment_id: "quiz", student_id: "Ana", score: 0 },
    { assessment_id: "quiz", student_id: "Ben", score: 21 },
    { assessment_id: "quiz", student_id: "Cora", score: 20 },
    { assessment_id: "legacy", student_id: "Ana", score: 5 },
    { assessment_id: "legacy", student_id: "Ben", score: null },
    { assessment_id: "legacy", student_id: "Cora", score: 9 },
  ]);
  const [quiz, legacy] = summarizeAssessments(assessments, assignments, scores, 1);
  assert.deepEqual([quiz.assessedCount, quiz.results.length, quiz.average], [1, 2, 0]);
  assert.deepEqual([legacy.assessedCount, legacy.results.length, legacy.average], [2, 3, 70]);
  assert.deepEqual(summarizeAssessments(assessments, [math], scores, 1).map(({ average }) => average), [0, 50]);
});
