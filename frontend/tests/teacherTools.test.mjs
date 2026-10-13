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

test("intervention drafts require teacher assignment and track follow-up gains", async (t) => {
  const { dom, React, axios, vite, root, input, click } = await setup(t);
  const { default: InterventionsView } = await vite.ssrLoadModule("/src/components/InterventionsView.jsx");
  let stored = []; const posts = []; const updates = [];
  t.mock.method(axios, "get", async () => ({ data: stored }));
  t.mock.method(axios, "post", async (url, body) => { posts.push({ url, body }); stored = [{ ...body, _id: "activity", studentId: { _id: "student", name: "Alice" } }]; return { data: stored[0] }; });
  t.mock.method(axios, "put", async (url, body) => { updates.push({ url, body }); stored = [{ ...stored[0], ...body, studentId: { _id: "student", name: "Alice" } }]; return { data: stored[0] }; });
  await React.act(async () => root.render(React.createElement(InterventionsView, { students: [{ id: "student", name: "Alice" }], initialDraft: { studentId: "student", title: "Fractions", activities: "Find 1/2 + 1/4", difficulty: "easy" } })));
  assert.equal(posts.length, 0); assert.equal(document.querySelector("textarea").value, "Find 1/2 + 1/4");
  await input(document.querySelectorAll('input[type="number"]')[0], "40");
  await click("Assign intervention");
  assert.equal(posts[0].body.baselineScore, 40); assert.equal(posts[0].body.followUpScore, null);
  await click("Update progress");
  await input(document.querySelectorAll('input[type="number"]')[1], "80");
  await React.act(async () => { const select = [...document.querySelectorAll("select")].find((item) => item.querySelector('option[value="completed"]')); select.value = "completed"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await click("Save progress");
  assert.equal(updates[0].body.status, "completed"); assert.equal(updates[0].body.followUpScore, 80); assert.match(document.body.textContent, /Change: 40\.0 points/);
});

test("teacher Settings creates school years and generates a private recovery code", async (t) => {
  const { React, axios, vite, root, input, click } = await setup(t);
  const { default: TeacherSettings } = await vite.ssrLoadModule("/src/components/TeacherSettings.jsx");
  const years = [{ _id: null, name: "Legacy / unassigned records" }]; const posts = [];
  t.mock.method(axios, "get", async (url) => {
    if (url.endsWith("/school-years")) return { data: { activeId: null, years } };
    if (url.endsWith("/grading-rules")) return { data: { passingGrade: 75, highPerformingGrade: 90, writtenWorkWeight: 20, performanceTaskWeight: 50, examinationWeight: 30, requireAllSubjectsPassing: true, requireCompleteScores: true } };
    return { data: [] };
  });
  t.mock.method(axios, "post", async (url, body) => { posts.push({ url, body }); if (url.endsWith("/school-years")) { years.push({ _id: "year", name: body.name }); return { data: years[1] }; } return { data: { recoveryCode: "a".repeat(64), message: "Save this code privately." } }; });
  await React.act(async () => root.render(React.createElement(TeacherSettings)));
  await input(document.querySelector('[aria-label="New school year"]'), "2026–2027");
  await click("Create school year");
  assert.equal(posts[0].body.name, "2026–2027"); assert.match(document.querySelector('[aria-label="Active school year"]').textContent, /2026–2027/);
  await input(document.querySelector('input[type="password"]'), "CurrentPassword1!");
  await click("Generate recovery code");
  assert.equal(posts[1].body.password, "CurrentPassword1!"); assert.equal(document.querySelector("code").textContent, "a".repeat(64));
  assert.equal(localStorage.length, 0);
  await click("Hide code"); assert.equal(document.querySelector("code"), null);
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

test("forgotten passwords can be reset from the recovery form using a private code", async (t) => {
  const { React, axios, vite, root, input } = await setup(t);
  const { default: PasswordRecovery } = await vite.ssrLoadModule("/src/components/PasswordRecovery.jsx");
  const posts = []; t.mock.method(axios, "post", async (url, body) => { posts.push({ url, body }); return { data: { message: "Password reset. Sign in again." } }; });
  await React.act(async () => root.render(React.createElement(PasswordRecovery, { onClose() {} })));
  await input(document.querySelector('input[autocomplete="username"]'), "teacher");
  await input(document.querySelector('input[autocomplete="off"]'), "a".repeat(64));
  await input(document.querySelector('input[type="password"]'), "NewPassword1!");
  await React.act(async () => document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  assert.ok(posts[0].url.endsWith("/account/reset-password")); assert.equal(posts[0].body.recovery_code, "a".repeat(64));
  assert.match(document.body.textContent, /Password reset/); assert.equal(document.querySelector('input[type="password"]').value, ""); assert.equal(document.querySelector('input[autocomplete="off"]').value, "");
});
