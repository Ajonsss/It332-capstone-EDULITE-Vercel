import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { createClassManagementRouter, validateClassPayload, validateClassUpdate } from "../classManagement.js";
import ClassOffering from "../models/ClassOffering.js";

const ownerId = "507f1f77bcf86cd799439011", yearId = "507f1f77bcf86cd799439012";
const sectionId = "507f1f77bcf86cd799439013", subjectId = "507f1f77bcf86cd799439014";
const otherId = "507f1f77bcf86cd799439015";

test("class payload validates grade levels, names, and references before any writes", () => {
  assert.equal(validateClassPayload({ grade: 7, section_id: sectionId, subject_name: "Math" }), null);
  assert.equal(validateClassPayload({ grade: 7, section_id: sectionId, subject_id: subjectId, student_ids: [] }), null);
  for (const student_ids of [null, "all", [false], ["bad"], [{ $ne: null }]]) assert.ok(validateClassPayload({ grade: 7, section_id: sectionId, subject_id: subjectId, student_ids }));
  for (const grade of [true, "7", 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.ok(validateClassPayload({ grade, section_id: sectionId, subject_id: subjectId }));
  for (const patch of [{ section_id: "bad" }, { subject_id: [] }, { section_id: undefined, section_name: "" }, { subject_id: undefined, subject_name: "123" }, { section_name: "Rose" }]) {
    assert.ok(validateClassPayload({ grade: 7, section_id: sectionId, subject_id: subjectId, ...patch }));
  }
  assert.ok(new ClassOffering({ ownerId, grade: 1.5, sectionId, subjectIds: [subjectId] }).validateSync().errors.grade);
  const update = { source_grade: 7, source_section_id: sectionId, grade: 8, section_id: sectionId, subject_ids: [subjectId] };
  assert.equal(validateClassUpdate(update), null);
  for (const patch of [{ source_grade: "7" }, { source_section_id: "bad" }, { grade: true }, { subject_ids: "bad" }, { subject_ids: [] }, { subject_ids: [false] }, { new_subject_name: 123 }]) assert.ok(validateClassUpdate({ ...update, ...patch }));
});

test("class setup bulk enrolls only selected current-section students without replacing records", async (t) => {
  const aliceId = "507f1f77bcf86cd7994390aa", zoeId = "507f1f77bcf86cd7994390ab";
  const newSubjectId = "507f1f77bcf86cd7994390ac";
  const base = { ownerId, schoolYearId: yearId, grade: 7, sectionId, subjectIds: [subjectId] };
  const state = {
    sections: [{ _id: sectionId, ownerId, name: "Rose", nameKey: "rose" }],
    subjects: [{ _id: subjectId, ownerId, name: "Math", nameKey: "math" }], classes: [],
    students: [
      { ...structuredClone(base), _id: aliceId, importedGrades: [{ subjectId, term1: 85 }], scores: [5, 8] },
      { ...structuredClone(base), _id: zoeId },
      { ...structuredClone(base), _id: "507f1f77bcf86cd7994390ad" },
      ...[{ grade: 8 }, { sectionId: otherId }, { ownerId: otherId }, { schoolYearId: otherId }, { archived: true }]
        .map((patch, index) => ({ ...structuredClone(base), _id: (index + 100).toString(16).padStart(24, "0"), ...patch })),
    ],
  };
  const original = structuredClone(state);
  const session = {}, matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object") return value.$in ? value.$in.includes(row[key]) : row[key] !== value.$ne;
    return row[key] === value;
  });
  const catalog = (key) => ({
    findOne(filter) { return { async session(value) { assert.equal(value, session); return state[key].find((item) => matches(item, filter)) ?? null; } }; },
    async findOneAndUpdate(filter, update, options) {
      assert.equal(options.session, session);
      let item = state[key].find((row) => matches(row, filter));
      if (!item) { item = { _id: newSubjectId, ...update.$setOnInsert, ...(key === "classes" ? { subjectIds: [] } : {}) }; state[key].push(item); }
      if (update.$addToSet && !item.subjectIds.includes(update.$addToSet.subjectIds)) item.subjectIds.push(update.$addToSet.subjectIds);
      return item;
    },
  });
  let forceRosterChange = false;
  const Students = {
    find(filter) { return { select() { return this; }, async session(value) { assert.equal(value, session); return state.students.filter((row) => matches(row, filter)); } }; },
    async updateMany(filter, update, options) {
      assert.equal(options.session, session);
      assert.deepEqual(update, { $addToSet: { subjectIds: newSubjectId } });
      const selected = state.students.filter((row) => matches(row, filter));
      for (const student of selected) if (!student.subjectIds.includes(update.$addToSet.subjectIds)) student.subjectIds.push(update.$addToSet.subjectIds);
      return { matchedCount: forceRosterChange ? 0 : selected.length };
    },
  };
  const app = express(); app.use(express.json());
  app.use(createClassManagementRouter({ Classes: catalog("classes"), Sections: catalog("sections"), Subjects: catalog("subjects"), Students,
    auth(req, _res, next) { req.user = { id: ownerId }; req.academicYear = yearId; next(); },
    async transaction(work) { const snapshot = structuredClone(state); try { return await work(session); } catch (error) { Object.assign(state, snapshot); throw error; } },
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const post = async (body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/classes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const payload = { grade: 7, section_id: sectionId, subject_name: "History", student_ids: [aliceId, zoeId] };
  for (const student of original.students.slice(3)) {
    const response = await post({ ...payload, student_ids: [aliceId, student._id] });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.deepEqual(state, original, "invalid or out-of-scope students roll back all setup writes");
  }
  assert.equal((await post({ ...payload, student_ids: [aliceId, "507f1f77bcf86cd7994390ff"] })).status, 400, "stale selections are rejected");
  forceRosterChange = true;
  assert.equal((await post(payload)).status, 400);
  assert.deepEqual(state, original, "an enrollment failure rolls back both student updates and class setup");
  forceRosterChange = false;
  const saved = await post({ ...payload, student_ids: [aliceId, aliceId.toUpperCase(), zoeId] });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.enrolled_student_count, 2);
  assert.equal(saved.body.subject.name, "History");
  assert.equal(state.students.length, original.students.length, "existing students are reused");
  for (const id of [aliceId, zoeId]) {
    const student = state.students.find((item) => item._id === id), previous = original.students.find((item) => item._id === id);
    assert.deepEqual(student.subjectIds, [subjectId, newSubjectId]);
    assert.deepEqual({ ...student, subjectIds: previous.subjectIds }, previous, "grades and previous registrations are preserved");
  }
  assert.deepEqual(state.students.slice(2), original.students.slice(2), "unselected and out-of-scope students stay unchanged");
  const repeated = await post({ grade: 7, section_id: sectionId, subject_id: newSubjectId, student_ids: [aliceId, zoeId] });
  assert.equal(repeated.status, 201); assert.equal(state.classes.length, 1);
  assert.deepEqual(state.students[0].subjectIds, [subjectId, newSubjectId], "retrying does not duplicate enrollment");
});

test("class modification moves only the current class roster and preserves grades and enrollments", async (t) => {
  const destinationId = "507f1f77bcf86cd799439016", scienceId = "507f1f77bcf86cd799439017", createdId = "507f1f77bcf86cd799439018";
  const state = {
    sections: [{ _id: sectionId, ownerId, name: "Rose", nameKey: "rose" }, { _id: destinationId, ownerId, name: "Lily", nameKey: "lily" }],
    subjects: [{ _id: subjectId, ownerId, name: "Math", nameKey: "math" }, { _id: scienceId, ownerId, name: "Science", nameKey: "science" }, { _id: otherId, ownerId: otherId, name: "Foreign" }],
    classes: [{ _id: createdId, ownerId, schoolYearId: yearId, grade: 7, sectionId, subjectIds: [subjectId, scienceId] }],
    students: [
      { _id: "alice", ownerId, schoolYearId: yearId, grade: 7, sectionId, subjectIds: [subjectId], importedGrades: [{ subjectId, term1: 85 }], scores: [5, 8] },
      { _id: "bob", ownerId, schoolYearId: yearId, grade: 7, sectionId, subjectIds: [subjectId] },
      { _id: "carlo", ownerId, schoolYearId: yearId, grade: 8, sectionId, subjectIds: [scienceId] },
      { _id: "archived", ownerId, schoolYearId: yearId, grade: 7, sectionId, subjectIds: [subjectId], archived: true },
      { _id: "foreign", ownerId: otherId, schoolYearId: yearId, grade: 7, sectionId, subjectIds: [subjectId] },
      { _id: "other-year", ownerId, schoolYearId: otherId, grade: 7, sectionId, subjectIds: [subjectId] },
    ], transactions: 0, rosterUpdates: 0,
  };
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object") return value.$in ? value.$in.includes(row[key]) : row[key] !== value.$ne;
    return row[key] === value;
  });
  const query = (value) => ({ session() { return this; }, select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
  const model = (key) => ({
    findOne(filter) { assert.equal(filter.ownerId, ownerId); return query(state[key].find((item) => matches(item, filter)) ?? null); },
    find(filter) { assert.equal(filter.ownerId, ownerId); return query(state[key].filter((item) => matches(item, filter))); },
    async findOneAndUpdate(filter, update) {
      let item = state[key].find((row) => matches(row, filter));
      if (!item) { item = { _id: createdId, ...filter, ...update.$setOnInsert }; state[key].push(item); }
      Object.assign(item, update.$set); return item;
    },
  });
  const Students = { ...model("students"), async updateMany(filter, update) { state.rosterUpdates++; for (const student of state.students.filter((item) => matches(item, filter))) Object.assign(student, update.$set); } };
  const assessmentScopes = [{ grade: 7, sectionId }, { grade: 8, sectionId }];
  const Assessments = { findOne() { return query(null); }, async updateMany(filter, update, options) {
    assert.equal(filter.ownerId, ownerId); assert.equal(filter.schoolYearId, yearId); assert.ok(options.session);
    for (const scope of assessmentScopes) if (matches(scope, filter.classSections.$elemMatch)) {
      scope.grade = update.$set["classSections.$[class].grade"]; scope.sectionId = update.$set["classSections.$[class].sectionId"];
    }
  } };
  const app = express(); app.use(express.json());
  app.use(createClassManagementRouter({ Classes: model("classes"), Sections: model("sections"), Subjects: model("subjects"), Students, Assessments,
    auth(req, _res, next) { req.user = { id: ownerId }; req.academicYear = yearId; next(); },
    async transaction(work) { state.transactions++; const snapshot = structuredClone(state); try { return await work({}); } catch (error) { Object.assign(state, snapshot); throw error; } },
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const put = async (body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/classes`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const payload = { source_grade: 7, source_section_id: sectionId, grade: 9, section_id: destinationId, subject_ids: [subjectId] };
  assert.equal((await put({ ...payload, grade: "9" })).status, 400); assert.equal(state.transactions, 0);
  const original = structuredClone(state);
  assert.equal((await put({ ...payload, subject_ids: [scienceId], new_subject_name: "History" })).status, 409);
  assert.equal(state.subjects.length, original.subjects.length, "failed changes roll back new subject creation");
  assert.equal((await put({ ...payload, grade: 8, section_id: sectionId })).status, 409, "do not merge a destination inferred from existing students");
  assert.equal((await put({ ...payload, subject_ids: [otherId] })).status, 400);
  assert.equal((await put({ ...payload, section_id: otherId })).status, 400);
  assert.deepEqual(state.students, original.students);

  const saved = await put({ ...payload, new_subject_name: "History" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.grade, 9); assert.equal(saved.body.section_id, destinationId); assert.equal(saved.body.student_count, 2);
  assert.deepEqual(assessmentScopes, [{ grade: 9, sectionId: destinationId }, { grade: 8, sectionId }], "assessment sections follow a modified class without changing other grades");
  assert.equal(state.classes.length, 1); assert.equal(state.classes[0]._id, createdId);
  assert.equal(state.rosterUpdates, 1);
  for (const id of ["alice", "bob"]) {
    const current = state.students.find((item) => item._id === id);
    assert.equal(current.grade, 9); assert.equal(current.sectionId, destinationId);
    assert.deepEqual({ ...current, grade: 7, sectionId }, original.students.find((item) => item._id === id));
  }
  for (const id of ["archived", "foreign", "other-year", "carlo"]) assert.deepEqual(state.students.find((item) => item._id === id), original.students.find((item) => item._id === id));
  const updated = await put({ source_grade: 9, source_section_id: destinationId, grade: 9, section_id: destinationId, subject_ids: [subjectId] });
  assert.equal(updated.status, 200); assert.deepEqual(state.classes[0].subjectIds, [subjectId]); assert.equal(state.rosterUpdates, 1);

  const legacy = await put({ source_grade: 8, source_section_id: sectionId, grade: 8, section_id: destinationId, subject_ids: [scienceId] });
  assert.equal(legacy.status, 200, JSON.stringify(legacy.body)); assert.equal(state.classes.length, 2);
  assert.equal(state.students.find((item) => item._id === "carlo").sectionId, destinationId);
  const newSection = await put({ source_grade: 9, source_section_id: destinationId, grade: 9, section_name: "  Orchid  ", subject_ids: [subjectId] });
  assert.equal(newSection.status, 200, JSON.stringify(newSection.body));
  assert.equal(newSection.body.section.name, "Orchid");
  assert.equal(state.students.find((item) => item._id === "alice").sectionId, newSection.body.section_id);
  assert.equal((await put({ ...payload, source_grade: 12 })).status, 404);
});

test("class setup persists empty classes, scopes ownership and school year, and rolls back partial setup", async (t) => {
  const state = { year: yearId, sections: [{ _id: sectionId, ownerId, name: "Rose", nameKey: "rose" }], subjects: [{ _id: subjectId, ownerId, name: "Math", nameKey: "math" }, { _id: otherId, ownerId: otherId, name: "Foreign" }], classes: [], transactions: 0 };
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const catalog = (key) => ({
    findOne(filter) { return { session: async () => state[key].find((row) => matches(row, filter)) ?? null }; },
    async findOneAndUpdate(filter, update) {
      let row = state[key].find((row) => matches(row, filter));
      if (!row) { row = { _id: key === "sections" ? "507f1f77bcf86cd799439016" : "507f1f77bcf86cd799439017", ...update.$setOnInsert }; state[key].push(row); }
      return row;
    },
  });
  const Classes = {
    find(filter) { return { sort() { return this; }, lean: async () => state.classes.filter((row) => matches(row, filter)) }; },
    async findOneAndUpdate(filter, update) {
      let row = state.classes.find((row) => matches(row, filter));
      if (!row) { row = { _id: `class-${state.classes.length}`, ...update.$setOnInsert, subjectIds: [] }; state.classes.push(row); }
      if (!row.subjectIds.includes(update.$addToSet.subjectIds)) row.subjectIds.push(update.$addToSet.subjectIds);
      return row;
    },
  };
  const app = express(); app.use(express.json());
  app.use(createClassManagementRouter({ Classes, Sections: catalog("sections"), Subjects: catalog("subjects"),
    auth(req, _res, next) { req.user = { id: ownerId }; req.academicYear = state.year; next(); },
    async transaction(work) {
      state.transactions++; const snapshot = structuredClone({ sections: state.sections, subjects: state.subjects, classes: state.classes });
      try { return await work({}); } catch (error) { Object.assign(state, snapshot); throw error; }
    },
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/classes`;
  const post = async (body) => { const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  assert.equal((await post({ grade: true })).status, 400); assert.equal(state.transactions, 0);
  const first = await post({ grade: 7, section_id: sectionId, subject_id: subjectId });
  assert.equal(first.status, 201); assert.deepEqual(first.body.subject_ids, [subjectId]); assert.equal(first.body.section.name, "Rose");
  const list = await (await fetch(base)).json(); assert.equal(list.length, 1); assert.equal(list[0].grade, 7);
  await post({ grade: 7, section_id: sectionId, subject_id: subjectId });
  assert.equal(state.classes.length, 1); assert.equal(state.classes[0].subjectIds.length, 1);
  const extended = await post({ grade: 7, section_id: sectionId, subject_name: "  Natural   Science  " });
  assert.equal(extended.status, 201); assert.equal(extended.body.subject.name, "Natural Science"); assert.equal(state.classes[0].subjectIds.length, 2);
  state.year = otherId;
  assert.deepEqual(await (await fetch(base)).json(), []);
  await post({ grade: 8, section_id: sectionId, subject_id: subjectId }); assert.equal(state.classes.length, 2);
  state.year = yearId;
  const sectionCount = state.sections.length;
  assert.equal((await post({ grade: 9, section_name: "Orchid", subject_id: otherId })).status, 400);
  assert.equal(state.sections.length, sectionCount); assert.equal(state.classes.length, 2);
  const anotherGrade = await post({ grade: 8, section_id: sectionId, subject_id: subjectId }); assert.equal(anotherGrade.status, 201);
  assert.equal((await (await fetch(base)).json()).length, 2);
});
