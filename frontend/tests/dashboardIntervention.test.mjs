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
  window.confirm = (message) => !message.includes("Would you like to update");
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
  const reads = [];
  t.mock.method(axios, "get", async (url) => {
    reads.push(url);
    return { data: structuredClone(url === "/api/dashboard" ? {
      students: responses.students, sections: responses.sections, subjects: responses.subjects, assessments: responses.assessments,
      assessmentRecords: responses["assessment-records"], gradeSummaries: responses["grade-summaries"], classes: responses.classes,
      schoolYears: responses["school-years"], gradingRules: responses["grading-rules"],
    } : responses[url.split("/").at(-1)]) };
  });
  const generated = [];
  const finished = [];
  const savedInsight = { id: "ai-plan", studentId: student.id, supportType: "intervention", title: "Fraction support", status: "active", completedAt: null, pdfUrl: "/api/gemini/insights/ai-plan/pdf" };
  t.mock.method(axios, "post", async (url, body) => {
    generated.push({ url, body });
    const result = { student, classification: "At Risk", analytics: { isProvisional: true, focusAveragePercentage: 64 }, plan: { title: "Fraction support", targetedInterventions: [{
      title: "Guided fraction practice", rationale: "Low score on the fractions assessment", learningFocus: "Add unlike fractions", actions: [],
      curriculumBasis: [{ assessmentId: "quiz", assessment: "Fractions quiz", subject: "Math", term: 1, score: 2, totalItems: 10, budgetOfWork: "Competency: Add unlike fractions.\nTime: 2 lessons." }],
    }] } };
    responses.insights = [{ ...savedInsight, result }];
    return { data: { ...result, savedInsight: { ...savedInsight } } };
  });
  t.mock.method(axios, "patch", async (url) => {
    finished.push(url);
    Object.assign(responses.insights[0], { status: "completed", completedAt: "2026-10-31T10:00:00.000Z" });
    return { data: structuredClone(responses.insights[0]) };
  });
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: Dashboard } = await vite.ssrLoadModule("/src/components/Dashboard.jsx");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  await React.act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(Dashboard))));
  assert.deepEqual(reads, ["/api/dashboard"], "initial dashboard data arrives in one request");
  assert.equal(document.querySelector('[aria-label="Main navigation"] [aria-label="Interventions"]'), null);
  assert.match(document.body.textContent, /64.0Maria SantosNeeds intervention · Term 1 · In progress/);
  const metric = (label) => [...document.querySelectorAll("h3")].find((element) => element.textContent === label).parentElement.parentElement.textContent;
  assert.match(metric("Students Assessed"), /^1Students Assessed/);
  assert.match(metric("Needs Support"), /^1Needs Support/);
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
  assert.ok(!document.body.textContent.includes("Use in intervention tracker"));
  const finish = () => document.querySelector('[aria-label="Finish intervention Fraction support"]');
  assert.ok(finish());
  await React.act(async () => finish().click());
  assert.deepEqual(finished, ["/api/gemini/insights/ai-plan/finish"]);
  assert.equal(finish(), null);
  assert.match(document.body.textContent, /Closed · Intervention finished/);
  assert.ok([...document.querySelectorAll("button")].some((item) => item.textContent === "Download PDF"));
  // Remount to discard cached UI state and verify the saved status is read again.
  await React.act(async () => root.render(React.createElement(MemoryRouter, { key: "reloaded" }, React.createElement(Dashboard))));
  await React.act(async () => document.querySelector('[aria-label="Main navigation"] [aria-label="Records"]').click());
  const tab = () => [...document.querySelectorAll("button")].find((item) => item.textContent === "AI Insights");
  await React.act(async () => tab().click());
  assert.match(document.body.textContent, /Closed · Intervention finished/);
  assert.equal(finish(), null);
  await React.act(async () => [...document.querySelectorAll("button")].find((item) => item.querySelector("h4")).click());
  assert.match(document.body.textContent, /Closed · Intervention finished/);
  assert.ok([...document.querySelectorAll("button")].some((item) => item.textContent === "Download PDF"));
});
