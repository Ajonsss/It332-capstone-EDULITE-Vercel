import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { createClassManagementRouter } from "../classManagement.js";
import ClassOffering from "../models/ClassOffering.js";

const ownerId = "507f1f77bcf86cd799439011", yearId = "507f1f77bcf86cd799439012", otherId = "507f1f77bcf86cd799439013";
const roseId = "507f1f77bcf86cd799439014", mathId = "507f1f77bcf86cd799439015";

test("grade-only and section-only registrations validate without students or subjects", () => {
  assert.equal(new ClassOffering({ ownerId, grade: 10, sectionId: null, subjectIds: [] }).validateSync(), undefined);
  assert.equal(new ClassOffering({ ownerId, grade: 10, sectionId: roseId, subjectIds: [] }).validateSync(), undefined);
});

test("class structure CRUD persists independent levels and protects scoped students, scores and assessments", async (t) => {
  const state = {
    sections: [{ _id: roseId, ownerId, name: "Rose", nameKey: "rose" }],
    subjects: [{ _id: mathId, ownerId, name: "Math", nameKey: "math" }],
    classes: [{ _id: "class7", ownerId, schoolYearId: yearId, grade: 7, sectionId: roseId, subjectIds: [mathId] }],
    students: [{ _id: "alice", ownerId, schoolYearId: yearId, grade: 7, sectionId: roseId, subjectIds: [mathId], importedGrades: [{ subjectId: mathId, term1: 88 }], scores: [5, 8] }],
    assessments: [{ _id: "quiz7", ownerId, schoolYearId: yearId, subjectId: mathId, classSections: [{ grade: 7, sectionId: roseId }] }],
  };
  const values = (row, path) => {
    if (!path.length) return [row];
    if (Array.isArray(row)) return row.flatMap((entry) => values(entry, path));
    return values(row?.[path[0]], path.slice(1));
  };
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some((entry) => matches(row, entry));
    const candidates = values(row, key.split("."));
    if (value === null) return candidates.some((entry) => entry == null);
    if (value && typeof value === "object") {
      if ("$ne" in value) return candidates.every((entry) => entry !== value.$ne);
      if ("$size" in value) return candidates.some((entry) => entry?.length === value.$size);
      if ("$elemMatch" in value) return candidates.some((entry) => entry?.some((child) => matches(child, value.$elemMatch)));
      if ("$in" in value) return candidates.flat().some((entry) => value.$in.includes(entry));
    }
    return candidates.flat().includes(value);
  });
  let counter = 100, failClassWrite = false, failAssessmentWrite = false;
  const session = {};
  const query = (key, filter, one = false) => {
    let includeArchived = false;
    const result = () => { const rows = state[key].filter((row) => matches(row, filter) && (key !== "students" || includeArchived || !row.archived)); return one ? rows[0] ?? null : rows; };
    return { session(value) { assert.equal(value, session); return this; }, setOptions(options) { includeArchived = options.includeArchived; return this; }, select() { return this; }, sort() { return this; },
      async lean() { return result(); }, then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } };
  };
  const apply = (row, update, options) => {
    for (const [key, value] of Object.entries(update.$set ?? {})) {
      if (key.includes(".$[")) {
        const grade = options.arrayFilters[0]["entry.grade"];
        for (const entry of row.classSections ?? []) if (entry.grade === grade) entry.grade = value;
      } else row[key] = value;
    }
    if (update.$addToSet && !row.subjectIds.includes(update.$addToSet.subjectIds)) row.subjectIds.push(update.$addToSet.subjectIds);
    if (update.$pull) row.subjectIds = row.subjectIds.filter((id) => id !== update.$pull.subjectIds);
  };
  const model = (key) => ({
    findOne(filter) { return query(key, filter, true); }, find(filter) { return query(key, filter); },
    async findOneAndUpdate(filter, update, options) {
      assert.equal(options.session, session);
      if (key === "classes" && failClassWrite) throw Object.assign(new Error("Simulated class write failure"), { status: 409 });
      let row = state[key].find((entry) => matches(entry, filter));
      if (!row && !options.upsert) return null;
      if (update.$set?.nameKey && state[key].some((entry) => entry !== row && entry.ownerId === ownerId && entry.nameKey === update.$set.nameKey)) throw Object.assign(new Error("Duplicate name"), { code: 11000 });
      if (!row) { row = { _id: (++counter).toString(16).padStart(24, "0"), ...update.$setOnInsert, ...(key === "classes" ? { subjectIds: [] } : {}) }; state[key].push(row); }
      apply(row, update, options); return row;
    },
    async updateMany(filter, update, options) {
      assert.equal(options.session, session);
      if (key === "assessments" && failAssessmentWrite) throw Object.assign(new Error("Simulated assessment write failure"), { status: 409 });
      for (const row of state[key].filter((entry) => matches(entry, filter))) apply(row, update, options);
    },
    async updateOne(filter, update, options) { const row = state[key].find((entry) => matches(entry, filter)); if (row) apply(row, update, options); },
    async deleteMany(filter, options) { assert.equal(options.session, session); state[key] = state[key].filter((row) => !matches(row, filter)); },
  });
  const app = express(); app.use(express.json());
  app.use(createClassManagementRouter({ Classes: model("classes"), Sections: model("sections"), Subjects: model("subjects"), Students: model("students"), Assessments: model("assessments"),
    auth(req, _res, next) { req.user = { id: ownerId }; req.academicYear = yearId; next(); },
    async transaction(work) { const snapshot = structuredClone(state); try { return await work(session); } catch (error) { Object.assign(state, snapshot); throw error; } },
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const send = async (path, body, method = "POST") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const root = "/class-structure";
  assert.equal((await send(`${root}/grades`, { grade: 7 })).status, 409);
  for (const grade of [true, "10", -1, 1.5, null]) assert.equal((await send(`${root}/grades`, { grade })).status, 400);
  assert.equal((await send(`${root}/grades`, { grade: 10 })).status, 201);
  assert.equal((await send(`${root}/grades`, { grade: 10 })).status, 409);
  const listed = await send("/classes", null, "GET");
  assert.deepEqual(listed.body.find((row) => row.grade === 10), { id: state.classes[1]._id, grade: 10, section_id: null, subject_ids: [] });
  const section = await send(`${root}/sections`, { grade: 10, name: "  Orchid  " });
  assert.equal(section.status, 201, JSON.stringify(section.body));
  const orchidId = section.body.section_id;
  assert.equal((await send(`${root}/sections`, { grade: 10, name: "Orchid" })).status, 409);
  assert.equal((await send(`${root}/sections`, { grade: 10, name: "Rose" })).status, 201);
  assert.equal((await send(`${root}/sections`, { grade: 99, name: "Unknown" })).status, 404);
  assert.ok(!state.sections.some((row) => row.name === "Unknown"));
  const history = await send(`${root}/subjects`, { grade: 10, section_id: orchidId, name: "History" });
  assert.equal(history.status, 201, JSON.stringify(history.body));
  const historyId = history.body.subject_id;
  assert.equal((await send(`${root}/subjects`, { grade: 10, section_id: orchidId, name: "History" })).status, 409);
  assert.equal((await send(`${root}/subjects`, { grade: 10, section_id: orchidId, name: "Math" })).status, 201);
  assert.equal((await send(`${root}/subjects`, { grade: 10, section_id: orchidId, name: "123" })).status, 400);
  assert.equal((await send(`${root}/sections/${orchidId}`, { grade: 10, name: "Daisy" }, "PUT")).status, 200);
  assert.equal((await send(`${root}/sections/${orchidId}`, { grade: 10, name: "Rose" }, "PUT")).status, 409);
  assert.equal(state.sections.find((row) => row._id === orchidId).name, "Daisy");
  assert.equal((await send(`${root}/subjects/${historyId}`, { grade: 10, section_id: orchidId, name: "World History" }, "PUT")).status, 200);
  assert.equal((await send(`${root}/subjects/${historyId}`, { grade: 10, section_id: orchidId, name: "Math" }, "PUT")).status, 409);

  const scoped = { ownerId, schoolYearId: yearId, grade: 10, sectionId: orchidId, subjectIds: [historyId], importedGrades: [{ subjectId: historyId, term1: 80 }], scores: [5, 8] };
  state.students.push({ ...structuredClone(scoped), _id: "new-student" }, { ...structuredClone(scoped), archived: true, _id: "archived-student" }, { ...structuredClone(scoped), ownerId: otherId, _id: "foreign" }, { ...structuredClone(scoped), schoolYearId: otherId, _id: "other-year" });
  state.classes.push({ _id: "other-year-class", ownerId, schoolYearId: otherId, grade: 10, sectionId: orchidId, subjectIds: [historyId] });
  state.assessments.push({ _id: "shared-quiz", ownerId, schoolYearId: yearId, subjectId: historyId, classSections: [{ grade: 10, sectionId: orchidId }, { grade: 8, sectionId: roseId }] });
  const before = structuredClone(state);
  failAssessmentWrite = true;
  assert.equal((await send(`${root}/grades/10`, { grade: 11 }, "PUT")).status, 409);
  assert.deepEqual(state, before, "a failure rolls back all moved class and student records"); failAssessmentWrite = false;
  assert.equal((await send(`${root}/grades/10`, { grade: 7 }, "PUT")).status, 409);
  assert.equal((await send(`${root}/grades/10`, { grade: 11 }, "PUT")).status, 200);
  const moved = state.students.find((row) => row._id === "new-student");
  assert.deepEqual({ ...moved, grade: 10 }, before.students.find((row) => row._id === "new-student"));
  assert.deepEqual(state.assessments.at(-1).classSections, [{ grade: 11, sectionId: orchidId }, { grade: 8, sectionId: roseId }]);
  assert.deepEqual(state.students.filter((row) => ["foreign", "other-year"].includes(row._id)), before.students.filter((row) => ["foreign", "other-year"].includes(row._id)));
  assert.equal(state.students.find((row) => row._id === "archived-student").grade, 10, "historical archive grades do not change");
  const deleteGrade = () => send(`${root}/grades/11`, null, "DELETE");
  const deleteSection = () => send(`${root}/sections/${orchidId}?grade=11`, null, "DELETE");
  const deleteSubject = () => send(`${root}/subjects/${historyId}?grade=11&section_id=${orchidId}`, null, "DELETE");
  state.students.find((row) => row._id === "new-student").subjectIds = [];
  assert.equal((await deleteSubject()).status, 409, "imported grades protect a subject even when its enrollment is absent");
  state.students.find((row) => row._id === "new-student").subjectIds = [historyId];
  for (const remove of [deleteGrade, deleteSection, deleteSubject]) assert.equal((await remove()).status, 409);
  state.students.find((row) => row._id === "new-student").archived = true;
  for (const remove of [deleteGrade, deleteSection, deleteSubject]) assert.equal((await remove()).status, 409, "archives also prevent destructive deletion");
  state.students = state.students.filter((row) => row._id !== "new-student");
  for (const remove of [deleteGrade, deleteSection, deleteSubject]) assert.equal((await remove()).status, 409, "assessment references are protected even without active students");
  assert.equal((await send("/classes", { source_grade: 11, source_section_id: orchidId, grade: 11, section_id: orchidId, subject_ids: [mathId] }, "PUT")).status, 409, "class-details edits cannot bypass assessment protection");
  state.assessments = state.assessments.filter((row) => row._id !== "shared-quiz");
  assert.equal((await deleteSubject()).status, 200);
  assert.ok(!state.classes.find((row) => row.grade === 11 && row.sectionId === orchidId).subjectIds.includes(historyId));
  assert.ok(state.subjects.some((row) => row._id === historyId), "shared subject catalog entries are preserved");
  assert.equal((await deleteSection()).status, 200);
  assert.ok(state.classes.some((row) => row.grade === 11 && row.sectionId === null));
  assert.equal((await send(`${root}/sections/${roseId}?grade=11`, null, "DELETE")).status, 200);
  assert.equal((await deleteGrade()).status, 200);
  assert.ok(!state.classes.some((row) => row.grade === 11));
  assert.ok(state.classes.some((row) => row._id === "other-year-class" && row.grade === 10));
  assert.equal((await send(`${root}/sections/${otherId}`, { grade: 7, name: "Foreign" }, "PUT")).status, 404);
  assert.equal((await send(`${root}/subjects/${otherId}`, { grade: 7, section_id: roseId, name: "Foreign" }, "PUT")).status, 404);
  assert.equal((await send(`${root}/grades/99`, null, "DELETE")).status, 404);
  state.students.push({ ...structuredClone(scoped), _id: "legacy-student", grade: 9, sectionId: roseId });
  assert.equal((await send(`${root}/grades`, { grade: 9 })).status, 409, "legacy enrollment grades are already registered");
  assert.equal((await send(`${root}/grades/9`, { grade: 12 }, "PUT")).status, 200);
  assert.equal(state.students.find((row) => row._id === "legacy-student").grade, 12);
  const catalogBefore = structuredClone(state.subjects);
  failClassWrite = true;
  assert.equal((await send(`${root}/subjects`, { grade: 7, section_id: roseId, name: "Unsaved subject" })).status, 409);
  assert.deepEqual(state.subjects, catalogBefore, "failed registration does not leave a new subject behind");
});
