import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import axios from "axios";

test("assessment form prompts for sections and limits score entry to selected grade-and-section groups", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage;
  globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem("eduliteToken", "test-token"); localStorage.setItem("user", "{}");
  const React = await import("react"), { createRoot } = await import("react-dom/client"), { MemoryRouter } = await import("react-router-dom");
  const subjects = [{ id: "math", name: "Math" }, { id: "science", name: "Science" }];
  const sections = [{ id: "rose", name: "Rose" }, { id: "lily", name: "Lily" }];
  const students = [
    { id: "alice", name: "Alice", grade: 7, section: "Rose", section_id: "rose", subject_ids: ["math"] },
    { id: "bob", name: "Bob", grade: 7, section: "Lily", section_id: "lily", subject_ids: ["math", "science"] },
    { id: "older", name: "Older learner", grade: 8, section: "Rose", section_id: "rose", subject_ids: ["math"] },
  ];
  const classes = [{ grade: 9, section_id: "lily", subject_ids: ["math"] }];
  const assessment = { name: "Fractions", budget_of_work: "Adding fractions", term: 1, category: "written_work", sequence: 1, date: "2026-10-23", status: "scheduled", total_items: 10, subject_id: "math", class_sections: [{ grade: 7, section_id: "rose" }], students: [{ ...students[0], score: 8 }] };
  const writes = [], saved = [];
  const registeredAssessments = [];
  t.mock.method(axios, "get", async (url) => {
    const data = { "/api/subjects": subjects, "/api/sections": sections, "/api/students": students, "/api/classes": classes, "/api/assessments": registeredAssessments,
      "/api/grading-rules": { writtenWorkWeight: 20, performanceTaskWeight: 50, examinationWeight: 30 },
      "/api/assessments/existing": assessment,
      "/api/assessments/legacy": { ...assessment, class_sections: null },
    }[url];
    assert.notEqual(data, undefined, url); return { data: structuredClone(data) };
  });
  for (const method of ["post", "put"]) t.mock.method(axios, method, async (url, body) => { writes.push({ method, url, body }); return { data: { id: "saved" } }; });
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: AssessmentForm } = await vite.ssrLoadModule("/src/components/AssessmentForm.jsx");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  let version = 0;
  const render = async (assessmentId = null) => {
    await React.act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(AssessmentForm, { key: ++version, assessmentId, embedded: true, onSaved: (data) => saved.push(data) }))));
    for (let count = 0; count < 100 && !document.querySelector("#assessment-name"); count++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    assert.ok(document.querySelector("#assessment-name"));
  };
  const click = async (element) => { assert.ok(element); await React.act(async () => element.click()); };
  const button = (label) => [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
  const group = (grade, name) => document.querySelector(`[aria-label="Assessment section Grade ${grade} ${name}"]`);
  const scoreNames = () => [...document.querySelectorAll('[aria-label^="Score for "]')].map((input) => input.getAttribute("aria-label").replace("Score for ", ""));
  const change = async (selector, value) => React.act(async () => {
    const input = document.querySelector(selector); assert.ok(input, selector);
    const proto = input.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : input.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new dom.window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
  await render();
  await t.test("new assessments require an explicit selection and can combine sections", async () => {
    assert.deepEqual(scoreNames(), []);
    assert.ok(group(7, "Rose")); assert.ok(group(7, "Lily")); assert.ok(group(8, "Rose")); assert.ok(group(9, "Lily"));
    assert.ok([...document.querySelectorAll('input[type="checkbox"]')].every((input) => !input.checked));
    assert.equal(document.querySelector("#assessment-status").value, "not_conducted");
    await change("#assessment-status", "scheduled");
    await change("#assessment-name", "Fractions"); await change("#assessment-budget-of-work", "Adding fractions"); await change("#assessment-total-items", "10");
    await click(button("Save Assessment"));
    assert.match(document.querySelector('[role="alert"]').textContent, /Choose at least one section/); assert.equal(writes.length, 0);
    await click(group(7, "Rose")); assert.deepEqual(scoreNames(), ["Alice"]);
    await change('[aria-label="Score for Alice"]', "8");
    await click(group(7, "Lily")); assert.deepEqual(scoreNames(), ["Alice", "Bob"]);
    await change('[aria-label="Score for Bob"]', "0");
    await click(group(7, "Lily")); assert.deepEqual(scoreNames(), ["Alice"]);
    assert.match(document.body.textContent, /1 of 1 entered/);
    await click(group(7, "Lily")); assert.equal(document.querySelector('[aria-label="Score for Bob"]').value, "0");
    await click(button("Save Assessment"));
    assert.equal(writes.at(-1).method, "post");
    assert.equal(writes.at(-1).body.status, "scheduled");
    assert.deepEqual(writes.at(-1).body.class_sections, [{ grade: 7, section_id: "rose" }, { grade: 7, section_id: "lily" }]);
    assert.deepEqual(writes.at(-1).body.scores, [{ student_id: "alice", score: 8 }, { student_id: "bob", score: 0 }]);
    assert.equal(saved.length, 1);
  });
  await t.test("changing subjects resets sections and only offers registered classes for that subject", async () => {
    await change("#assessment-subject", "science");
    assert.equal(group(7, "Rose"), null); assert.ok(group(7, "Lily")); assert.equal(group(7, "Lily").checked, false);
    assert.deepEqual(scoreNames(), []);
    await click(button("Select all sections")); assert.deepEqual(scoreNames(), ["Bob"]);
    assert.equal(document.querySelector('[aria-label="Score for Bob"]').value, "");
    await click(button("Clear sections")); assert.deepEqual(scoreNames(), []);
  });
  await t.test("empty registered sections can be chosen without enrolling another section's students", async () => {
    await change("#assessment-subject", "math"); await click(group(9, "Lily"));
    assert.deepEqual(scoreNames(), []); await click(button("Save Assessment"));
    assert.deepEqual(writes.at(-1).body.class_sections, [{ grade: 9, section_id: "lily" }]);
    assert.deepEqual(writes.at(-1).body.scores, []);
  });
  await t.test("editing restores saved sections and scores while keeping other groups out of the roster", async () => {
    await render("existing");
    assert.equal(document.querySelector("#assessment-status").value, "scheduled");
    await change("#assessment-status", "done");
    assert.equal(group(7, "Rose").checked, true); assert.equal(group(7, "Lily").checked, false);
    assert.deepEqual(scoreNames(), ["Alice"]); assert.equal(document.querySelector('[aria-label="Score for Alice"]').value, "8");
    await click(group(7, "Lily")); await click(button("Update Assessment"));
    assert.equal(writes.at(-1).method, "put");
    assert.equal(writes.at(-1).body.status, "done");
    assert.deepEqual(writes.at(-1).body.scores, [{ student_id: "alice", score: 8 }, { student_id: "bob", score: null }]);
  });
  await t.test("older subject-wide assessments remain editable until sections are explicitly chosen", async () => {
    await render("legacy"); assert.deepEqual(scoreNames(), ["Alice", "Bob", "Older learner"]);
    assert.match(document.body.textContent, /existing assessment applies to all sections/);
    await click(button("Update Assessment")); assert.equal(writes.at(-1).body.class_sections, undefined);
    await click(button("Clear sections"));
    await click(group(8, "Rose")); assert.deepEqual(scoreNames(), ["Older learner"]);
    await click(button("Update Assessment"));
    assert.deepEqual(writes.at(-1).body.class_sections, [{ grade: 8, section_id: "rose" }]);
    assert.deepEqual(writes.at(-1).body.scores, [{ student_id: "older", score: null }]);
  });
  const slotValues = () => [...document.querySelector("#assessment-sequence").options].map((item) => item.value).filter(Boolean);
  const registered = (id, category, sequence, scope = [{ grade: 7, section_id: "rose" }], term = 1, subject = "math") =>
    ({ ...assessment, id, category, sequence, class_sections: scope, term, subject_id: subject });
  await t.test("each component hides occupied slots and saves the automatically selected next free position", async () => {
    registeredAssessments.push(registered("existing", "written_work", 1), registered("pt1", "performance_task", 1),
      registered("st1", "summative_test", 1), registered("exam", "term_exam", 1));
    await render();
    assert.equal(document.querySelector("#assessment-sequence").disabled, true);
    await click(group(7, "Rose"));
    assert.deepEqual(slotValues(), ["2", "3", "4", "5"]);
    assert.equal(document.querySelector("#assessment-sequence").value, "2");
    await change("#assessment-name", "Fractions practice"); await change("#assessment-budget-of-work", "Adding fractions"); await change("#assessment-total-items", "10");
    await click(button("Save Assessment")); assert.equal(writes.at(-1).body.sequence, 2);
    await change("#assessment-category", "performance_task"); assert.deepEqual(slotValues(), ["2", "3"]);
    assert.equal(document.querySelector("#assessment-sequence").value, "2");
    await change("#assessment-category", "summative_test"); assert.deepEqual(slotValues(), ["2"]);
    await change("#assessment-category", "term_exam"); assert.deepEqual(slotValues(), []);
    assert.equal(document.querySelector("#assessment-sequence").disabled, true);
    assert.equal(button("Save Assessment").disabled, true);
    assert.match(document.querySelector("#assessment-slot-help").textContent, /All Term Examination slots are already used/);
    await change("#assessment-term", "2"); assert.deepEqual(slotValues(), ["1"]);
    assert.equal(button("Save Assessment").disabled, false);
  });
  await t.test("slot availability follows subjects, terms, grades and all selected sections", async () => {
    registeredAssessments.push(registered("lily2", "written_work", 2, [{ grade: 7, section_id: "lily" }]),
      registered("older4", "written_work", 4, [{ grade: 8, section_id: "rose" }]),
      registered("term2", "written_work", 2, [{ grade: 7, section_id: "rose" }], 2),
      registered("science3", "written_work", 3, [{ grade: 7, section_id: "lily" }], 1, "science"));
    await render(); await click(group(7, "Rose")); await click(group(7, "Lily"));
    assert.deepEqual(slotValues(), ["3", "4", "5"], "the slot must be free in every selected section");
    await click(group(8, "Rose")); assert.deepEqual(slotValues(), ["3", "5"]);
    await click(button("Clear sections")); await click(group(8, "Rose"));
    assert.deepEqual(slotValues(), ["1", "2", "3", "5"], "the same section name in another grade has its own slots");
    await change("#assessment-term", "2"); assert.deepEqual(slotValues(), ["1", "2", "3", "4", "5"]);
    await click(group(8, "Rose")); await click(group(7, "Rose")); assert.deepEqual(slotValues(), ["1", "3", "4", "5"]);
    await change("#assessment-subject", "science"); assert.deepEqual(slotValues(), []);
    await click(group(7, "Lily")); await change("#assessment-term", "1");
    assert.deepEqual(slotValues(), ["1", "2", "4", "5"]);
  });
  await t.test("editing keeps its own slot available while still excluding other assessments", async () => {
    registeredAssessments.push(registered("rose2", "written_work", 2));
    await render("existing");
    assert.deepEqual(slotValues(), ["1", "3", "4", "5"]);
    assert.equal(document.querySelector("#assessment-sequence").value, "1");
    await click(button("Update Assessment")); assert.equal(writes.at(-1).body.sequence, 1);
    await click(group(7, "Lily")); assert.deepEqual(slotValues(), ["1", "3", "4", "5"]);
    await change("#assessment-category", "performance_task"); assert.deepEqual(slotValues(), ["2", "3"]);
  });
  await t.test("subject-wide assessments block occupied slots in all sections and full components cannot be submitted", async () => {
    registeredAssessments.splice(0, registeredAssessments.length, ...[1, 2, 3, 4, 5].map((sequence) => registered(`wide${sequence}`, "written_work", sequence, null)));
    await render(); await click(group(9, "Lily"));
    assert.deepEqual(slotValues(), []); assert.equal(button("Save Assessment").disabled, true);
    assert.match(document.querySelector("#assessment-slot-help").textContent, /All Written \/ Oral Works slots are already used/);
    await change("#assessment-name", "No free slot"); await change("#assessment-budget-of-work", "Adding fractions"); await change("#assessment-total-items", "10");
    const before = writes.length;
    await React.act(async () => document.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(writes.length, before); assert.match(document.querySelector('[role="alert"]').textContent, /Select a valid ECR assessment slot/);
  });
});
