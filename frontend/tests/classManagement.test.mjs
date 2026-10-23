import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import axios from "axios";

test("class browser reveals grade, section, subject and students, with guided setup in a right panel", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage;
  globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = () => ({ matches: false }); window.scrollTo = () => {}; window.confirm = () => true;
  localStorage.setItem("eduliteToken", "test-token"); localStorage.setItem("user", "{}");
  const React = await import("react"), { createRoot } = await import("react-dom/client"), { MemoryRouter } = await import("react-router-dom");
  const sections = [{ id: "rose", name: "Rose" }, { id: "lily", name: "Lily" }];
  const subjects = [{ id: "math", name: "Math" }, { id: "science", name: "Science" }];
  const classes = [{ id: "empty", grade: 9, section_id: "lily", subject_ids: ["math"] }];
  const students = [
    { id: "alice", name: "Alice Santos", grade: 7, section: "Rose", section_id: "rose", subject_ids: ["math"], subject_names: ["Math"] },
    { id: "bob", name: "Bob Cruz", grade: 8, section: "Lily", section_id: "lily", subject_ids: ["science"], subject_names: ["Science"] },
    { id: "zoe", name: "Zoe Diaz", grade: 7, section: "Rose", section_id: "rose", subject_ids: [], subject_names: [] },
  ];
  const writes = [];
  let classUpdateError = "";
  const addStudent = (id, data) => {
    const student = { id, ...data, section_id: sections.find((section) => section.name === data.section).id,
      subject_names: subjects.filter((subject) => data.subject_ids.includes(subject.id)).map((subject) => subject.name) };
    students.push(student); return student;
  };
  t.mock.method(axios, "get", async (url) => {
    const key = url.replace("/api/", "");
    const data = key.startsWith("students/") ? key.endsWith("/insights") ? [] : students.find((student) => key === `students/${student.id}`) : {
      students, sections, subjects, classes, assessments: [], "assessment-records": [], "grade-summaries": [],
      "school-years": { years: [{ _id: "year", name: "2026–2027" }], activeId: "year" }, "grading-rules": { passingGrade: 75, highPerformingGrade: 90 },
    }[key];
    assert.notEqual(data, undefined, `Unexpected GET ${url}`); return { data: structuredClone(data) };
  });
  t.mock.method(axios, "post", async (url, body) => {
    if (url === "/api/classes") {
      writes.push({ url, body });
      let section = sections.find((item) => item.id === body.section_id || item.name === body.section_name);
      if (!section) { section = { id: "orchid", name: body.section_name }; sections.push(section); }
      let subject = subjects.find((item) => item.id === body.subject_id || item.name === body.subject_name);
      if (!subject) { subject = { id: body.subject_name.toLowerCase(), name: body.subject_name }; subjects.push(subject); }
      let registration = classes.find((item) => item.grade === body.grade && item.section_id === section.id);
      if (!registration) { registration = { id: "new-class", grade: body.grade, section_id: section.id, subject_ids: [] }; classes.push(registration); }
      if (!registration.subject_ids.includes(subject.id)) registration.subject_ids.push(subject.id);
      for (const student of students.filter((item) => body.student_ids?.includes(item.id))) {
        if (!student.subject_ids.includes(subject.id)) { student.subject_ids.push(subject.id); student.subject_names.push(subject.name); }
      }
      return { data: { ...registration, section, subject, enrolled_student_count: body.student_ids?.length ?? 0 } };
    }
    if (url === "/api/students") { writes.push({ url, body }); return { data: addStudent("nina", body) }; }
    const selected = JSON.parse(body.get("subject_ids"));
    writes.push({ url, grade: body.get("grade_level"), sectionId: body.get("section_id"), subjectIds: selected, token: body.get("confirmation_token"), enrollExisting: body.get("enroll_existing") });
    if (url.endsWith("/preview")) return { data: { grade_level: Number(body.get("grade_level")), section_name: body.get("section_name"), student_count: 1, new_student_count: 1, existing_student_count: 0,
      skipped: [], rows: [{ row: 9, name: "Mateo Cruz", registration: "new" }], confirmation_token: "review-token" } };
    assert.equal(url, "/api/students/import");
    addStudent("mateo", { name: "Mateo Cruz", grade: Number(body.get("grade_level")), section: body.get("section_name"), subject_ids: selected });
    return { data: { imported_count: 1, message: "1 student imported.", issues: [], skipped: [] } };
  });
  t.mock.method(axios, "put", async (url, body) => {
    if (url === "/api/classes") {
      if (classUpdateError) throw { response: { status: 409, data: { message: classUpdateError } } };
      writes.push({ url, body });
      const registration = classes.find((item) => item.grade === body.source_grade && item.section_id === body.source_section_id);
      const section = sections.find((item) => item.id === body.section_id);
      const subjectIds = [...body.subject_ids];
      if (body.new_subject_name) { subjects.push({ id: "arts", name: body.new_subject_name }); subjectIds.push("arts"); }
      for (const student of students.filter((item) => item.grade === body.source_grade && item.section_id === body.source_section_id)) Object.assign(student, { grade: body.grade, section: section.name, section_id: section.id });
      Object.assign(registration, { grade: body.grade, section_id: section.id, subject_ids: subjectIds });
      return { data: { ...registration, section } };
    }
    writes.push({ url, body }); const student = students.find((item) => url === `/api/students/${item.id}`); Object.assign(student, body); return { data: student };
  });
  t.mock.method(axios, "delete", async (url) => { writes.push({ url }); const index = students.findIndex((item) => url === `/api/students/${item.id}`); assert.ok(index >= 0); students.splice(index, 1); return { data: {} }; });
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: Dashboard } = await vite.ssrLoadModule("/src/components/Dashboard.jsx");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  const waitFor = async (predicate) => { for (let count = 0; count < 100 && !predicate(); count++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); assert.ok(predicate(), "Expected interface did not appear"); };
  const button = (text, scope = document) => [...scope.querySelectorAll("button")].find((item) => item.textContent.trim() === text);
  const click = async (element) => { assert.ok(element, "Expected button"); await React.act(async () => element.click()); };
  const change = async (selector, value) => React.act(async () => {
    const input = document.querySelector(selector); assert.ok(input, selector);
    const proto = input.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new dom.window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
  const column = (name) => document.querySelector(`section[aria-label="${name}"]`);
  const choice = (name, label) => [...column(name).querySelectorAll('button[aria-pressed]')].find((item) => item.firstElementChild.firstElementChild.textContent === label);
  const names = () => [...column("Students").querySelectorAll("article h3")].map((heading) => heading.textContent);
  const dialog = () => document.querySelector('[role="dialog"]');
  const newEntry = (label) => click([...dialog().querySelectorAll("label")].find((item) => item.textContent === label).querySelector("input"));
  await React.act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(Dashboard))));
  await click(document.querySelector('[aria-label="Main navigation"] [aria-label="Manage your class"]'));
  await waitFor(() => column("Grade Levels"));

  await t.test("only registered grades appear first and each click reveals only the next scoped column", async () => {
    assert.deepEqual([...document.querySelector('[aria-label="Class management columns"]').children].map((item) => item.getAttribute("aria-label")), ["Grade Levels"]);
    assert.ok(choice("Grade Levels", "Grade 9"), "empty registered classes remain visible");
    assert.equal(document.querySelector('form'), null);
    await click(choice("Grade Levels", "Grade 7")); assert.ok(column("Sections")); assert.equal(column("Subjects"), null);
    assert.ok(choice("Sections", "Rose")); assert.equal(choice("Sections", "Lily"), undefined);
    await click(choice("Sections", "Rose")); assert.ok(column("Subjects")); assert.equal(column("Students"), null);
    assert.ok(choice("Subjects", "Math")); assert.equal(choice("Subjects", "Science"), undefined);
    await click(choice("Subjects", "Math")); assert.deepEqual(names(), ["Alice Santos"]);
    await click(choice("Grade Levels", "Grade 8")); assert.equal(column("Subjects"), null); assert.equal(column("Students"), null);
    await click(choice("Sections", "Lily")); assert.ok(choice("Subjects", "Science")); assert.equal(choice("Subjects", "Math"), undefined);
    await click(button("Grade levels")); assert.equal(column("Sections"), null);
  });
  await t.test("the survey opens on the right and cancels without writes before saving", async () => {
    const opener = button("Add class"); opener.focus(); await click(opener);
    assert.equal(dialog().getAttribute("aria-modal"), "true"); assert.equal(document.getElementById("root").inert, true);
    assert.equal(dialog().parentElement.className.includes("justify-end"), true);
    await change('[aria-label="Class grade level"]', "10"); await click(button("Next", dialog()));
    await newEntry("Create new section"); await change('[aria-label="New class section"]', "Orchid"); await click(button("Next", dialog()));
    await newEntry("Create new subject"); await change('[aria-label="New class subject"]', "Music");
    assert.equal(writes.length, 0); await click(button("Back", dialog())); assert.equal(document.querySelector('[aria-label="New class section"]').value, "Orchid");
    await React.act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(dialog(), null); assert.equal(writes.length, 0); assert.ok(document.activeElement === opener); assert.equal(document.body.style.overflow, "");
  });
  await t.test("Modify class sits beside Add class and can choose a class before a browser selection", async () => {
    const opener = button("Modify class");
    assert.ok(opener.parentElement === button("Add class").parentElement);
    opener.focus(); await click(opener);
    assert.match(dialog().textContent, /Modify class/);
    assert.equal(document.querySelector('[aria-label="Class to modify"]').value, "");
    assert.equal(button("Save changes", dialog()).disabled, true);
    await change('[aria-label="Class to modify"]', "9:lily");
    assert.equal(document.querySelector('[aria-label="Modify class grade level"]').value, "9");
    await change('[aria-label="Modify class grade level"]', "11");
    await click(button("Cancel", dialog()));
    assert.equal(writes.length, 0); assert.equal(dialog(), null); assert.ok(document.activeElement === opener);
  });
  await t.test("saving the grade-section-subject setup creates an empty class and registers students in its context", async () => {
    await click(button("Add class")); await change('[aria-label="Class grade level"]', "10"); await click(button("Next", dialog()));
    await newEntry("Create new section"); await change('[aria-label="New class section"]', "Orchid"); await click(button("Next", dialog()));
    await newEntry("Create new subject"); await change('[aria-label="New class subject"]', "Music"); await click(button("Save class & add students", dialog()));
    assert.deepEqual(writes[0].body, { grade: 10, section_name: "Orchid", subject_name: "Music" });
    assert.match(dialog().textContent, /Class saved: Grade 10/); assert.deepEqual(names(), []);
    await click(button("Register students", dialog())); await waitFor(() => document.querySelector("#student-first-name"));
    assert.equal(document.querySelector("#student-grade").value, "10"); assert.equal(document.querySelector("#student-section").value, "Orchid");
    assert.equal(document.querySelector("#student-grade").closest("section").hidden, true);
    await change("#student-first-name", "Nina"); await change("#student-surname", "Reyes"); await click(button("Save Student", dialog()));
    assert.deepEqual(writes.find((item) => item.url === "/api/students").body, { name: "Nina Reyes", grade: 10, section: "Orchid", subject_ids: ["music"] });
    assert.match(dialog().textContent, /1 student registered/);
    await click(button("Finish", dialog())); assert.deepEqual(names(), ["Nina Reyes"]);
  });
  await t.test("import reuses saved grade, section, and subject and waits for final confirmation", async () => {
    await click(button("Add class")); assert.equal(document.querySelector('[aria-label="Class grade level"]').value, "10");
    await click(button("Next", dialog())); assert.equal(document.querySelector('[aria-label="Class section"]').value, "orchid");
    await click(button("Next", dialog())); assert.equal(document.querySelector('[aria-label="Class subject"]').value, "music");
    await click(button("Save class & add students", dialog())); await click(button("Import students", dialog()));
    assert.equal(document.querySelector("#import-grade").value, "10"); assert.equal(document.querySelector("#import-section").value, "orchid");
    assert.equal(document.querySelector("#import-grade").closest("fieldset").hidden, true);
    await React.act(async () => { const input = document.querySelector("#student-import-file"); Object.defineProperty(input, "files", { configurable: true, value: [new File(["fixture"], "students.xlsx")] }); input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    await click(button("Review import", dialog())); assert.equal(writes.at(-1).url, "/api/students/import/preview"); assert.equal(writes.at(-1).grade, "10"); assert.deepEqual(writes.at(-1).subjectIds, ["music"]);
    assert.equal(students.some((item) => item.id === "mateo"), false);
    assert.equal(writes.at(-1).enrollExisting, "true");
    assert.match(dialog().textContent, /Existing students will also be enrolled/);
    await click(document.querySelector('[aria-labelledby="import-review-title"] input[type="checkbox"]')); await click(button("Confirm and import", dialog()));
    assert.equal(writes.at(-1).token, "review-token"); await click(button("Finish", dialog())); assert.deepEqual(names(), ["Mateo Cruz", "Nina Reyes"]);
  });
  await t.test("modification prefills the current class, preserves enrolled subjects, handles errors and updates the browser", async () => {
    await click(button("Modify class"));
    assert.equal(document.querySelector('[aria-label="Class to modify"]').value, "10:orchid");
    assert.equal(document.querySelector('[aria-label="Modify class grade level"]').value, "10");
    assert.equal(document.querySelector('[aria-label="Modify class section"]').value, "orchid");
    const music = document.querySelector('[aria-label="Register Music for class"]');
    assert.equal(music.checked, true); assert.equal(music.disabled, true);
    await change('[aria-label="Modify class grade level"]', "11");
    await change('[aria-label="Modify class section"]', "rose");
    await click(document.querySelector('[aria-label="Register Science for class"]'));
    await change('[aria-label="Modify class additional subject"]', "Arts");
    classUpdateError = "That destination already has a class.";
    await click(button("Save changes", dialog()));
    assert.match(dialog().querySelector('[role="alert"]').textContent, /destination already/);
    assert.equal(students.find((item) => item.id === "nina").grade, 10);
    classUpdateError = "";
    await click(button("Save changes", dialog())); assert.equal(dialog(), null);
    assert.deepEqual(writes.at(-1).body, { source_grade: 10, source_section_id: "orchid", grade: 11, section_id: "rose", subject_ids: ["music", "science"], new_subject_name: "Arts" });
    assert.deepEqual(names(), ["Mateo Cruz", "Nina Reyes"]);
    assert.equal(students.find((item) => item.id === "nina").grade, 11);
    assert.deepEqual(students.find((item) => item.id === "nina").subject_ids, ["music"]);
    assert.equal(students.find((item) => item.id === "alice").grade, 7);
    assert.ok(choice("Grade Levels", "Grade 11")); assert.equal(choice("Grade Levels", "Grade 10"), undefined);
    assert.ok(choice("Subjects", "Arts")); assert.ok(choice("Subjects", "Science"));
    assert.equal(classes.filter((item) => item.id === "new-class").length, 1);
  });
  await t.test("student editing uses a side panel and saved classes remain browsable after directory actions", async () => {
    await click(document.querySelector('[aria-label="Edit student Nina Reyes"]')); await waitFor(() => document.querySelector("#student-surname"));
    await change("#student-surname", "Rivera"); await click(button("Update Student", dialog())); assert.equal(dialog(), null); assert.deepEqual(names(), ["Mateo Cruz", "Nina Rivera"]);
    await click(document.querySelector('[aria-label="Delete student Nina Rivera"]')); assert.deepEqual(names(), ["Mateo Cruz"]);
    await click(document.querySelector('[aria-label="View records for Mateo Cruz"]')); assert.ok(document.querySelector('[aria-label="View assessment record for Mateo Cruz"]'));
  });
  await t.test("a new subject can enroll individual or all registered students from only its grade and section", async () => {
    await click(document.querySelector('[aria-label="Main navigation"] [aria-label="Manage your class"]'));
    await waitFor(() => column("Grade Levels"));
    await click(button("Add class"));
    await change('[aria-label="Class grade level"]', "7"); await click(button("Next", dialog()));
    await change('[aria-label="Class section"]', "rose"); await click(button("Next", dialog()));
    await newEntry("Create new subject"); await change('[aria-label="New class subject"]', "History");
    const checkboxes = () => [...dialog().querySelectorAll('input[type="checkbox"]')];
    assert.deepEqual(checkboxes().map((input) => input.getAttribute("aria-label")), ["Enroll Alice Santos", "Enroll Zoe Diaz"]);
    assert.ok(checkboxes().every((input) => !input.checked));
    const before = writes.length;
    await click(document.querySelector('[aria-label="Enroll Alice Santos"]'));
    assert.match(dialog().textContent, /1 of 2 selected/);
    await change('[aria-label="Find registered students"]', "Zoe");
    assert.equal(checkboxes().length, 1);
    await click(button("Select all", dialog()));
    assert.match(dialog().textContent, /2 of 2 selected/, "select all includes students hidden by search");
    await click(document.querySelector('[aria-label="Enroll Zoe Diaz"]'));
    assert.match(dialog().textContent, /1 of 2 selected/);
    await click(button("Clear selection", dialog()));
    assert.match(dialog().textContent, /0 of 2 selected/);
    await change('[aria-label="Find registered students"]', "Nobody");
    assert.match(dialog().textContent, /No students match your search/);
    await change('[aria-label="Find registered students"]', "");
    await click(button("Select all", dialog()));
    await click(button("Back", dialog())); await change('[aria-label="Class section"]', "lily"); await click(button("Next", dialog()));
    assert.equal(checkboxes().length, 0, "another section never carries over selected students");
    assert.match(dialog().textContent, /No registered students in this grade and section/);
    await click(button("Back", dialog())); await change('[aria-label="Class section"]', "rose"); await click(button("Next", dialog()));
    await click(button("Select all", dialog()));
    assert.equal(writes.length, before, "choosing students writes nothing before saving");
    await click(button("Save class & add students", dialog()));
    assert.deepEqual(writes.at(-1).body, { grade: 7, section_id: "rose", subject_name: "History", student_ids: ["alice", "zoe"] });
    assert.match(dialog().textContent, /2 registered students enrolled in History/);
    await click(button("Finish", dialog()));
    assert.deepEqual(names(), ["Alice Santos", "Zoe Diaz"]);
    assert.deepEqual(students.find((item) => item.id === "alice").subject_ids, ["math", "history"]);
    assert.equal(students.length, 4, "enrollment reuses existing student records");
  });
  await t.test("existing enrollments are identified and cancelled selections do not save", async () => {
    await click(button("Add class")); await click(button("Next", dialog())); await click(button("Next", dialog()));
    const alice = document.querySelector('[aria-label="Enroll Alice Santos"]');
    assert.equal(alice.checked, true); assert.equal(alice.disabled, true);
    assert.match(dialog().textContent, /Already enrolled/);
    assert.equal(button("Select all", dialog()).disabled, true);
    await newEntry("Create new subject"); await change('[aria-label="New class subject"]', "Geography");
    await click(button("Select all", dialog()));
    const before = writes.length;
    await click(button("Close", dialog()));
    assert.equal(writes.length, before); assert.ok(!subjects.some((item) => item.name === "Geography"));
  });
});
