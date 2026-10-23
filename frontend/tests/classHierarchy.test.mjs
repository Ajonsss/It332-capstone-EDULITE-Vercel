import test from "node:test";
import assert from "node:assert/strict";
import { buildClassHierarchy } from "../src/utils/classHierarchy.js";

test("hierarchy includes existing enrollments and empty class registrations with exact grade and section scope", () => {
  const sections = [{ id: "rose", name: "Rose" }, { id: "lily", name: "Lily" }];
  const subjects = [{ id: "math", name: "Math" }, { id: "science", name: "Science" }, { id: "music", name: "Music" }];
  const students = [
    { id: "a", name: "Alice", grade: 7, section_id: "rose", subject_ids: ["math"] },
    { id: "b", name: "Bob", grade: 8, section_id: "rose", subject_ids: ["science"] },
    { id: "c", name: "Carlo", grade: 7, section: "Lily", subject_ids: ["science"] },
  ];
  const hierarchy = buildClassHierarchy({ sections, subjects, students, classes: [{ grade: 9, section_id: "lily", subject_ids: ["music"] }] });
  assert.deepEqual(hierarchy.map((item) => item.grade), [7, 8, 9]);
  const rose7 = hierarchy[0].sections.find((item) => item.id === "rose");
  assert.deepEqual(rose7.subjects.map((item) => item.id), ["math"]);
  assert.deepEqual(rose7.subjects[0].students.map((item) => item.id), ["a"]);
  assert.deepEqual(hierarchy[1].sections[0].subjects.map((item) => item.id), ["science"]);
  assert.deepEqual(hierarchy[2].sections[0].subjects[0].students, []);
  assert.deepEqual(buildClassHierarchy(), []);
  assert.deepEqual(buildClassHierarchy({ sections, subjects, classes: [{ grade: 7, section_id: "missing", subject_ids: ["math"] }] }), []);
  const empty = buildClassHierarchy({ sections, subjects, classes: [{ grade: 10, section_id: null, subject_ids: [] }, { grade: 11, section_id: "rose", subject_ids: [] }] });
  assert.deepEqual(empty.map((entry) => entry.grade), [10, 11]);
  assert.deepEqual(empty[0].sections, []); assert.deepEqual(empty[1].sections[0].subjects, []);
});
