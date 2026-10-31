import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import axios from "axios";

test("finished interventions offer the student's previous assessment scores for review", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage;
  globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = () => ({ matches: false }); window.scrollTo = () => {};
  localStorage.setItem("eduliteToken", "test-token"); localStorage.setItem("user", "{}");
  const React = await import("react"), { createRoot } = await import("react-dom/client"), { MemoryRouter } = await import("react-router-dom");
  const alice = { id: "alice", name: "Alice Santos", grade: 7, section: "Rose", section_id: "rose", subject_ids: ["math"] };
  const bob = { id: "bob", name: "Bob Cruz", grade: 8, section: "Lily", section_id: "lily", subject_ids: ["math", "science"] };
  const assessment = (id, name, term = 2, subject = "math", grade = 8, section = "lily") => ({ id, name, term, subject_id: subject,
    subject_name: subject === "math" ? "Math" : "Science", total_items: 10, class_sections: [{ grade, section_id: section }] });
  const assessments = [assessment("old", "Term 1 quiz", 1), assessment("quiz", "Fractions quiz"), assessment("zero", "Zero score quiz"),
    assessment("blank", "Unrecorded quiz"), assessment("foreign", "Other class quiz", 2, "math", 7, "rose"),
    assessment("science-quiz", "Science quiz", 2, "science"), assessment("future", "Term 3 quiz", 3)];
  const records = [{ student_id: "bob", assessment_id: "quiz", score: 3 }, { student_id: "bob", assessment_id: "zero", score: 0 }];
  const responses = { students: [alice, bob], sections: [{ id: "rose", name: "Rose" }, { id: "lily", name: "Lily" }],
    subjects: [{ id: "math", name: "Math" }, { id: "science", name: "Science" }], assessments, "assessment-records": records,
    "grade-summaries": [], classes: [], "school-years": { years: [], activeId: null }, "grading-rules": { passingGrade: 75, highPerformingGrade: 90 } };
  const plan = { id: "plan", studentId: "bob", supportType: "intervention", title: "Fraction support", focusSubjectId: "math",
    status: "active", result: { student: bob, analytics: { gradingTerm: 2 }, plan: { title: "Fraction support" } } };
  let acceptGrades = false, failFinish = false;
  const prompts = [], writes = [], completions = [];
  window.confirm = (message) => { prompts.push(message); return message.includes("Would you like to update") ? acceptGrades : true; };
  t.mock.method(axios, "get", async (url) => {
    const data = url === "/api/dashboard" ? {
      students: responses.students, sections: responses.sections, subjects: responses.subjects, assessments: responses.assessments,
      assessmentRecords: responses["assessment-records"], gradeSummaries: responses["grade-summaries"], classes: responses.classes,
      schoolYears: responses["school-years"], gradingRules: responses["grading-rules"],
    } : url.endsWith("/insights") ? url.includes("/bob/") ? [plan] : [] : responses[url.split("/").at(-1)];
    assert.notEqual(data, undefined, url); return { data: structuredClone(data) };
  });
  t.mock.method(axios, "patch", async (url) => {
    assert.equal(url, "/api/gemini/insights/plan/finish"); completions.push(url);
    if (failFinish) throw { response: { data: { message: "Unable to close intervention." } } };
    Object.assign(plan, { status: "completed", completedAt: "2026-10-31T10:00:00Z" });
    return { data: structuredClone(plan) };
  });
  t.mock.method(axios, "put", async (url, body) => {
    writes.push({ url, body });
    assert.equal(url, "/api/students/bob/assessment-scores");
    return { data: { message: "Scores updated." } };
  });
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: Dashboard } = await vite.ssrLoadModule("/src/components/Dashboard.jsx");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  const button = (label) => [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
  const click = async (element) => { assert.ok(element); await React.act(async () => element.click()); };
  const score = (name) => document.querySelector(`[aria-label="Score for ${name}"]`);
  const finish = () => [...document.querySelectorAll('[aria-label="Finish intervention Fraction support"]')].at(-1);
  let version = 0;
  const openInsightList = async () => {
    plan.status = "active"; plan.completedAt = null; prompts.length = 0;
    await React.act(async () => root.render(React.createElement(MemoryRouter, { key: ++version }, React.createElement(Dashboard))));
    await click(document.querySelector('[aria-label="Main navigation"] [aria-label="Records"]'));
    await click(document.querySelector('[aria-label="View assessment record for Bob Cruz"]'));
    await click(button("AI Insights"));
  };

  await t.test("declining a grade update keeps the intervention closed without changing scores", async () => {
    await openInsightList(); await click(finish());
    assert.equal(prompts.length, 2); assert.match(prompts[1], /update Bob Cruz's grades/);
    assert.match(document.body.textContent, /Closed · Intervention finished/);
    assert.equal(score("Fractions quiz"), null); assert.equal(button("Save scores"), undefined);
    assert.deepEqual(writes, []);
  });
  await t.test("accepting from saved insights opens the correct term with recorded, zero and missing scores ready to edit", async () => {
    acceptGrades = true; await openInsightList(); await click(finish());
    assert.equal(document.querySelector("h1").textContent, "Student Assessment Records");
    assert.equal(document.querySelector('button[aria-current="true"]').getAttribute("aria-label"), "View assessment record for Bob Cruz");
    assert.equal(score("Fractions quiz").value, "3"); assert.equal(score("Zero score quiz").value, "0"); assert.equal(score("Unrecorded quiz").value, "");
    for (const name of ["Term 1 quiz", "Other class quiz", "Science quiz", "Term 3 quiz"]) assert.equal(score(name), null);
    assert.deepEqual(writes, [], "opening the profile does not save grades");
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(score("Fractions quiz"), "8");
      score("Fractions quiz").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await click(button("Save scores"));
    assert.deepEqual(writes, [{ url: "/api/students/bob/assessment-scores", body: { scores: [
      { assessment_id: "quiz", score: 8 }, { assessment_id: "zero", score: 0 }, { assessment_id: "blank", score: null },
    ] } }]);
    assert.equal(score("Fractions quiz"), null); assert.equal(plan.status, "completed");
  });
  await t.test("accepting from the insight viewer closes the viewer and allows cancelling edits without saving", async () => {
    await openInsightList();
    await click([...document.querySelectorAll("button")].find((item) => item.querySelector("h4")));
    await click(finish());
    assert.ok(button("Save scores")); assert.equal(score("Fractions quiz").value, "3");
    const before = writes.length; await click(button("Cancel"));
    assert.equal(writes.length, before); assert.equal(plan.status, "completed"); assert.equal(score("Fractions quiz"), null);
  });
  await t.test("failed completion never prompts for grades or opens the score editor", async () => {
    failFinish = true; await openInsightList(); await click(finish());
    assert.equal(prompts.length, 1); assert.equal(plan.status, "active");
    assert.equal(score("Fractions quiz"), null); assert.ok(finish());
    assert.match(document.querySelector('[role="alert"]').textContent, /Unable to close intervention/);
    assert.equal(completions.length, 4);
  });
  await t.test("students without previous assessments open their profile without an empty save operation", async () => {
    failFinish = false; responses.assessments = [];
    await openInsightList(); await click(finish());
    assert.equal(document.querySelector("h1").textContent, "Student Assessment Records");
    assert.equal(document.querySelector('button[aria-current="true"]').getAttribute("aria-label"), "View assessment record for Bob Cruz");
    assert.equal(button("Save scores"), undefined); assert.equal(plan.status, "completed");
    assert.match(document.body.textContent, /No previous assessments are available/);
    assert.equal(writes.length, 1);
  });
});
