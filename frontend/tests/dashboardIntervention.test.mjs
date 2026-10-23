import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import axios from "axios";

test("dashboard shows ongoing intervention needs and allows generating support before term grades exist", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = () => ({ matches: false });
  window.scrollTo = () => {};
  localStorage.setItem("eduliteToken", "test-token");
  localStorage.setItem("user", "{}");
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { MemoryRouter } = await import("react-router-dom");
  const student = { id: "learner", name: "Maria Santos", grade: 7, section: "Rose", subject_ids: ["math"] };
  const responses = {
    students: [student, { ...student, id: "unassessed", name: "No Scores" }],
    sections: [{ id: "rose", name: "Rose" }], subjects: [{ id: "math", name: "Math" }],
    assessments: [], "assessment-records": [], classes: [],
    "grade-summaries": [{ student_id: student.id, subject_id: "math", term1: { termGrade: null, performance: { grade: 64, isProvisional: true } }, final: { finalGrade: null } }],
    "school-years": { years: [], activeId: null }, "grading-rules": { passingGrade: 75, highPerformingGrade: 90 },
  };
  t.mock.method(axios, "get", async (url) => ({ data: responses[url.split("/").at(-1)] }));
  const generated = [];
  t.mock.method(axios, "post", async (url, body) => {
    generated.push({ url, body });
    return { data: { student, classification: "At Risk", analytics: { isProvisional: true, focusAveragePercentage: 64 }, plan: { title: "Fraction support", targetedInterventions: [{
      title: "Guided fraction practice", rationale: "Low score on the fractions assessment", learningFocus: "Add unlike fractions", actions: [],
      curriculumBasis: [{ assessmentId: "quiz", assessment: "Fractions quiz", subject: "Math", term: 1, score: 2, totalItems: 10, budgetOfWork: "Competency: Add unlike fractions.\nTime: 2 lessons." }],
    }] } } };
  });
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: Dashboard } = await vite.ssrLoadModule("/src/components/Dashboard.jsx");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  await React.act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(Dashboard))));
  assert.match(document.body.textContent, /Needs interventionMaria SantosTerm 1: 64.0 · In progress/);
  const metric = (label) => [...document.querySelectorAll("p")].find((element) => element.textContent === label).parentElement.textContent;
  assert.match(metric("Students Assessed"), /Students Assessed1/);
  assert.match(metric("Needs Support"), /Needs Support1/);
  const button = [...document.querySelectorAll("button")].find((element) => element.textContent === "Generate");
  assert.equal(button.disabled, false);
  await React.act(async () => button.click());
  assert.equal(generated.length, 1);
  assert.equal(generated[0].url, "/api/gemini/student-support/learner");
  assert.equal(generated[0].body.support_type, "intervention");
  assert.equal(generated[0].body.term, 1);
  assert.match(document.body.textContent, /Focus Average · In progress/);
  assert.match(document.body.textContent, /Learning focusAdd unlike fractions/);
  const basis = [...document.querySelectorAll("details")].find((element) => element.querySelector("summary")?.textContent === "Assessment and Budget of Work basis");
  assert.ok(basis); await React.act(async () => basis.querySelector("summary").click());
  assert.equal(basis.open, true);
  assert.match(basis.textContent, /Math · Fractions quiz · Term 1/);
  assert.match(basis.textContent, /Recorded score: 2\/10/);
  assert.match(basis.textContent, /Competency: Add unlike fractions.\nTime: 2 lessons./);
});
