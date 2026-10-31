import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

async function setup(t) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import("react"); const { createRoot } = await import("react-dom/client"); const axios = (await import("axios")).default;
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" }); const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(async () => root.unmount()); await vite.close(); dom.window.close(); });
  const input = async (element, value) => React.act(async () => { Object.getOwnPropertyDescriptor(element.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype, "value").set.call(element, value); element.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  const click = async (label) => React.act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === label).click());
  return { dom, React, axios, vite, root, input, click };
}

test("teacher Settings creates school years and offers password and session controls", async (t) => {
  const { React, axios, vite, root, input, click } = await setup(t);
  const { default: TeacherSettings } = await vite.ssrLoadModule("/src/components/TeacherSettings.jsx");
  const years = [{ _id: null, name: "Legacy / unassigned records" }]; const posts = [];
  t.mock.method(axios, "get", async (url) => {
    if (url.endsWith("/school-years")) return { data: { activeId: null, years } };
    if (url.endsWith("/grading-rules")) return { data: { passingGrade: 75, highPerformingGrade: 90, writtenWorkWeight: 20, performanceTaskWeight: 50, examinationWeight: 30, requireAllSubjectsPassing: true, requireCompleteScores: true } };
    return { data: [] };
  });
  t.mock.method(axios, "post", async (url, body) => { assert.ok(url.endsWith("/school-years")); posts.push({ url, body }); years.push({ _id: "year", name: body.name }); return { data: years[1] }; });
  await React.act(async () => root.render(React.createElement(TeacherSettings)));
  await input(document.querySelector('[aria-label="New school year"]'), "2026–2027");
  await click("Create school year");
  assert.equal(posts[0].body.name, "2026–2027"); assert.match(document.querySelector('[aria-label="Active school year"]').textContent, /2026–2027/);
  assert.ok([...document.querySelectorAll("button")].some((item) => item.textContent === "Change password & sign out"));
  assert.ok([...document.querySelectorAll("button")].some((item) => item.textContent === "Sign out all sessions"));
  assert.equal(document.querySelector("code"), null);
  assert.ok(!document.body.textContent.includes("Generate recovery code"));
});

test("saved award certificates can be reopened without recalculating their historical grades", async (t) => {
  const { React, axios, vite, root, input, click } = await setup(t);
  const { default: AwardsView } = await vite.ssrLoadModule("/src/components/AwardsView.jsx");
  const posts = []; const certificate = { studentName: "Alice", gradeLevel: 7, section: "Rose", grade: 95, previousGrade: null, improvement: null, school: "EduLITE School", title: "Academic Excellence", date: "2026-10-08", term: 1, scope: "Mathematics", awardType: "excellence", signatory: "Teacher", role: "Adviser" };
  t.mock.method(axios, "get", async () => ({ data: [] }));
  t.mock.method(axios, "post", async (url, body) => { posts.push({ url, body }); return { data: [{ _id: "certificate", certificate }] }; });
  await React.act(async () => root.render(React.createElement(AwardsView, { persistHistory: true, students: [{ id: "student", name: "Alice", grade: 7, section: "Rose", subject_ids: ["math"] }], sections: [], subjects: [{ id: "math", name: "Mathematics" }], gradeSummaries: [{ student_id: "student", subject_id: "math", term1: { termGrade: 95, isComplete: true } }] })));
  await click("Select all eligible"); await input(document.querySelector('[aria-label="Certificate school"]'), "EduLITE School"); await click("Create certificates (1)");
  assert.deepEqual(posts[0].body.studentIds, ["student"]); assert.equal(posts[0].body.term, 1); assert.equal(posts[0].body.grade, undefined);
  await click("Reopen / reprint"); assert.equal(posts.length, 1); assert.match(document.querySelector(".award-certificate").textContent, /95\.00/);
});
