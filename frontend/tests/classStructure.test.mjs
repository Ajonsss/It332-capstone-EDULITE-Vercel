import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import axios from "axios";

test("Modify class supports grade, section and subject CRUD from an empty directory", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import("react"), { createRoot } = await import("react-dom/client");
  const state = { sections: [], subjects: [], students: [], classes: [] }, writes = [];
  let deleteBlocked = false;
  const entry = (grade, sectionId) => state.classes.find((row) => row.grade === grade && row.section_id === sectionId);
  t.mock.method(axios, "post", async (url, body) => {
    writes.push({ method: "post", url, body });
    if (url.endsWith("/grades")) state.classes.push({ id: `grade-${body.grade}`, grade: body.grade, section_id: null, subject_ids: [] });
    if (url.endsWith("/sections")) {
      const section = { id: body.name.toLowerCase(), name: body.name }; state.sections.push(section);
      state.classes.push({ id: `section-${section.id}`, grade: body.grade, section_id: section.id, subject_ids: [] });
    }
    if (url.endsWith("/subjects")) {
      let subject = state.subjects.find((row) => row.name === body.name);
      if (!subject) { subject = { id: body.name.toLowerCase(), name: body.name }; state.subjects.push(subject); }
      entry(body.grade, body.section_id).subject_ids.push(subject.id);
    }
    return { data: { message: "Entry created." } };
  });
  t.mock.method(axios, "put", async (url, body) => {
    writes.push({ method: "put", url, body });
    const id = url.split("/").at(-1);
    if (url.includes("/grades/")) state.classes.filter((row) => row.grade === Number(id)).forEach((row) => { row.grade = body.grade; });
    if (url.includes("/sections/")) state.sections.find((row) => row.id === id).name = body.name;
    if (url.includes("/subjects/")) state.subjects.find((row) => row.id === id).name = body.name;
    return { data: { message: "Entry updated." } };
  });
  t.mock.method(axios, "delete", async (url, config) => {
    const body = config.params, id = url.split("/").at(-1); writes.push({ method: "delete", url, body });
    if (deleteBlocked) throw { response: { status: 409, data: { message: "This subject has enrolled students. Update their enrollments first." } } };
    if (url.includes("/grades/")) state.classes = state.classes.filter((row) => row.grade !== Number(id));
    if (url.includes("/sections/")) state.classes = state.classes.filter((row) => row.grade !== body.grade || row.section_id !== id);
    if (url.includes("/subjects/")) { const current = entry(body.grade, body.section_id); current.subject_ids = current.subject_ids.filter((subjectId) => subjectId !== id); }
    return { data: { message: "Entry removed." } };
  });
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: ClassManagementView } = await vite.ssrLoadModule("/src/components/ClassManagementView.jsx");
  const Host = () => {
    const [, refresh] = React.useState(0);
    return React.createElement(ClassManagementView, { ...structuredClone(state), schoolYearName: "2026–2027", onRefresh: async () => refresh((value) => value + 1) });
  };
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  await React.act(async () => root.render(React.createElement(Host)));
  const dialog = () => document.querySelector('[role="dialog"]');
  const button = (label, scope = dialog()) => [...scope.querySelectorAll("button")].find((row) => row.textContent.trim() === label);
  const click = async (element) => { assert.ok(element, "Expected interface control"); await React.act(async () => element.click()); };
  const change = async (label, value) => React.act(async () => {
    const input = dialog().querySelector(`[aria-label="${label}"]`); assert.ok(input, label);
    const prototype = input.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
    input.dispatchEvent(new dom.window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
  const named = (label) => dialog().querySelector(`[aria-label="${label}"]`);
  const registered = (kind) => dialog().querySelector(`[aria-label="Registered ${kind}"]`);
  const visibleNames = (kind) => [...registered(kind).querySelectorAll("h4")].map((node) => node.textContent);
  await t.test("an empty directory can register a grade without sections or students", async () => {
    const modify = button("Modify class", document); assert.equal(modify.disabled, false); await click(modify);
    assert.equal(button("Grade levels").getAttribute("aria-pressed"), "true");
    assert.deepEqual(visibleNames("grades"), []);
    await change("New grade level", "10"); await click(button("Add grade level"));
    assert.deepEqual(writes.at(-1).body, { grade: 10 }); assert.deepEqual(visibleNames("grades"), ["Grade 10"]);
    assert.equal(state.classes[0].section_id, null); assert.equal(state.students.length, 0);
    assert.ok(dialog(), "management stays open after saving");
  });
  await t.test("sections and subjects can be created, listed and renamed while preserving identities", async () => {
    await click(button("Sections")); assert.equal(named("Manage sections grade level").value, "10");
    await change("New section name", "Orchid"); await click(button("Add section"));
    assert.deepEqual(visibleNames("sections"), ["Orchid"]);
    await click(named("Rename Orchid")); await change("Edit Orchid", "Daisy"); await click(button("Save section"));
    assert.deepEqual(writes.at(-1).body, { grade: 10, name: "Daisy" });
    assert.deepEqual(visibleNames("sections"), ["Daisy"]); assert.equal(state.sections[0].id, "orchid");
    assert.match(dialog().textContent, /renaming updates the name wherever it is used/);
    await click(button("Subjects")); assert.equal(named("Manage subjects section").value, "orchid");
    await change("New subject name", "History"); await click(button("Add subject"));
    assert.deepEqual(writes.at(-1).body, { grade: 10, section_id: "orchid", name: "History" });
    await click(named("Rename History")); await change("Edit History", "World History"); await click(button("Save subject"));
    assert.deepEqual(visibleNames("subjects"), ["World History"]); assert.equal(state.subjects[0].id, "history");
    await click(button("Grade levels")); await click(named("Rename Grade 10")); await change("Edit Grade 10", "11"); await click(button("Save grade level"));
    assert.deepEqual(visibleNames("grades"), ["Grade 11"]); assert.ok(state.classes.every((row) => row.grade === 11));
    await change("New grade level", "7"); await click(button("Add grade level"));
    await click(named("Rename Grade 11")); await click(button("Save grade level"));
    await click(button("Subjects")); assert.equal(named("Manage subjects grade level").value, "11", "tabs keep the selected grade rather than switching to the first grade");
  });
  await t.test("deletes require a review, can be cancelled and display protections returned by the API", async () => {
    await click(button("Subjects"));
    const before = writes.length; await click(named("Delete World History"));
    assert.equal(writes.length, before); assert.ok(named("Confirm delete World History"));
    await click(button("Keep subject")); assert.equal(writes.length, before); assert.deepEqual(visibleNames("subjects"), ["World History"]);
    deleteBlocked = true; await click(named("Delete World History")); await click(button("Confirm delete"));
    assert.match(dialog().querySelector('[role="alert"]').textContent, /enrolled students/);
    assert.deepEqual(visibleNames("subjects"), ["World History"]);
    deleteBlocked = false; await click(button("Confirm delete"));
    assert.deepEqual(writes.at(-1).body, { grade: 11, section_id: "orchid" }); assert.deepEqual(visibleNames("subjects"), []);
    assert.equal(state.subjects.length, 1, "removing from one class keeps the shared catalog entry");
  });
  await t.test("empty sections and grades can be removed and the browser refreshes", async () => {
    await click(button("Sections")); await click(named("Delete Daisy")); await click(button("Confirm delete"));
    assert.deepEqual(visibleNames("sections"), []);
    await click(button("Grade levels")); assert.deepEqual(visibleNames("grades"), ["Grade 7", "Grade 11"]);
    await click(named("Delete Grade 11")); await click(button("Confirm delete"));
    assert.deepEqual(visibleNames("grades"), ["Grade 7"]);
    await click(named("Delete Grade 7")); await click(button("Confirm delete"));
    assert.deepEqual(visibleNames("grades"), []);
    await click(button("Close")); assert.equal(dialog(), null);
    assert.match(document.querySelector('[aria-label="Grade Levels"]').textContent, /No registered classes yet/);
  });
});
