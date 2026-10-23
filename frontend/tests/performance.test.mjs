import test from "node:test";
import assert from "node:assert/strict";
import { buildPerformanceRoster, getPerformanceStatus, PERFORMANCE_LEVELS, getTermPerformanceGrade, summarizeTermPerformance } from "../src/utils/performance.js";

const learner = (id, name, averagePercentage, section = "Rose") => ({ id, name, averagePercentage, section, grade: 7, subject_names: ["Science"] });
const students = [learner("e", "Ella", 62), learner("d", "Diego", 70), learner("f", "Faye", null), learner("a", "Alice", 92), learner("c", "Carlo", 77), learner("b", "Bob", 85)];

test("ongoing evidence classifies learners before official grades and excludes unassessed subjects", () => {
  const summaries = [
    { term1: { termGrade: null, performance: { grade: 64, isProvisional: true } }, term2: { termGrade: 90 } },
    { term1: { termGrade: null, performance: { grade: null, isProvisional: false } } },
  ];
  const result = summarizeTermPerformance(summaries, "term1");
  assert.equal(result.averagePercentage, 64);
  assert.equal(result.isProvisional, true);
  assert.equal(getPerformanceStatus(result.averagePercentage).label, "Emerging");
  assert.equal(summarizeTermPerformance(summaries, "term2").averagePercentage, 90);
  assert.equal(summarizeTermPerformance(summaries, "term3").averagePercentage, null);
  assert.equal(summarizeTermPerformance([], "term1").averagePercentage, null);
  assert.equal(getTermPerformanceGrade({ termGrade: 60, performance: { grade: 95, isProvisional: true } }), 95);
  assert.equal(getTermPerformanceGrade({ termGrade: 60, performance: { grade: null } }), null);
  assert.equal(getTermPerformanceGrade({ performance: { grade: 0 } }), 0);
});

test("performance uses existing cutoffs without rounding grades across a boundary", () => {
  for (const [grade, label] of [[100, "Advancing"], [90, "Advancing"], [89.99, "Benchmarking"], [80, "Benchmarking"], [79.99, "Connecting"], [75, "Connecting"], [74.99, "Developing"], [65, "Developing"], [64.99, "Emerging"], [0, "Emerging"]]) {
    assert.equal(getPerformanceStatus(grade).label, label);
  }
  for (const grade of [null, undefined, NaN, Infinity, "", "90"]) assert.equal(getPerformanceStatus(grade).label, "Incomplete");
});

test("sorting supports both performance directions and keeps incomplete students last", () => {
  assert.deepEqual(buildPerformanceRoster(students, { sort: "highest" }).students.map(({ id }) => id), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(buildPerformanceRoster(students, { sort: "lowest" }).students.map(({ id }) => id), ["e", "d", "c", "b", "a", "f"]);
  assert.deepEqual(students.map(({ id }) => id), ["e", "d", "f", "a", "c", "b"]);
});

test("equal grades sort by name, and a real zero grade sorts before incomplete data", () => {
  const tied = [learner("b", "Bob", 90), learner("a", "Alice", 90), learner("x", "No grade", null), learner("z", "Zero", 0)];
  assert.deepEqual(buildPerformanceRoster(tied, { sort: "highest" }).students.map(({ id }) => id), ["a", "b", "z", "x"]);
  assert.deepEqual(buildPerformanceRoster(tied, { sort: "lowest" }).students.map(({ id }) => id), ["z", "a", "b", "x"]);
});

test("level filtering shows the matching total while preserving the scoped category counts", () => {
  const roster = buildPerformanceRoster(students, { level: "Developing", sort: "highest" });
  assert.deepEqual(roster.students.map(({ id }) => id), ["d"]);
  assert.equal(roster.total, 6);
  assert.deepEqual(Object.values(roster.counts), [1, 1, 1, 1, 1, 1]);
  assert.equal(buildPerformanceRoster(students, { level: "Incomplete" }).students[0].id, "f");
});

test("counts follow the search and incoming section/subject/term scope", () => {
  const scoped = students.filter(({ id }) => ["a", "d"].includes(id));
  const roster = buildPerformanceRoster(scoped, { search: "alice" });
  assert.equal(roster.total, 1);
  assert.equal(roster.counts.Advancing, 1);
  assert.equal(roster.counts.Developing, 0);
  assert.equal(Object.values(roster.counts).reduce((sum, value) => sum + value, 0), roster.total);
  assert.equal(buildPerformanceRoster(students, { search: "science" }).total, 6);
});

test("no matches and empty rosters return zero counts for every level", () => {
  for (const roster of [buildPerformanceRoster([]), buildPerformanceRoster(students, { search: "Nobody" })]) {
    assert.equal(roster.total, 0);
    assert.deepEqual(roster.students, []);
    for (const { label } of PERFORMANCE_LEVELS) assert.equal(roster.counts[label], 0);
  }
});
