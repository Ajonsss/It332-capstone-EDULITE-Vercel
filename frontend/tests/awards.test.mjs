import test from "node:test";
import assert from "node:assert/strict";
import { buildAwardCandidates } from "../src/utils/awards.js";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const students = [
  { id: "a", name: "Alice", grade: 7, section: "Rose", subject_ids: ["math", "science"] },
  { id: "b", name: "Bob", grade: 7, section: "Rose", subject_ids: ["math"] },
  { id: "c", name: "Carlo", grade: 7, section: "Lily", subject_ids: ["math", "science"] },
];
const result = (termGrade, isComplete = true) => ({ termGrade, isComplete });
const summaries = [
  { student_id: "a", subject_id: "math", term1: result(94), term2: result(97) },
  { student_id: "a", subject_id: "science", term1: result(90), term2: result(93) },
  { student_id: "b", subject_id: "math", term1: result(89.99), term2: result(92) },
  { student_id: "c", subject_id: "math", term1: result(98), term2: result(99) },
  { student_id: "c", subject_id: "science", term1: result(null, false), term2: result(90) },
];

test("awards use complete official grades and unrounded eligibility thresholds", () => {
  const candidates = buildAwardCandidates(students, summaries);
  assert.equal(candidates.find((student) => student.id === "a").awardGrade, 92);
  assert.equal(candidates.find((student) => student.id === "b").eligible, false);
  assert.equal(candidates.find((student) => student.id === "c").eligible, false);
  assert.equal(candidates.find((student) => student.id === "c").awardGrade, null);
  assert.deepEqual(buildAwardCandidates(students, summaries, { section: "Lily", subjectId: "math" }).filter((student) => student.eligible).map((student) => student.id), ["c"]);
  for (const invalid of ["", " ", -1, 101, "bad"]) assert.ok(buildAwardCandidates(students, summaries, { minimum: invalid }).every((student) => !student.eligible));
  assert.equal(buildAwardCandidates([students[1]], [{ student_id: "b", subject_id: "math", term1: result("95") }])[0].eligible, false);
});

test("improvement requires complete matching subjects in consecutive terms", () => {
  const candidates = buildAwardCandidates(students, summaries, { term: "2", awardType: "improvement", minimum: 3 });
  assert.equal(candidates.find((student) => student.id === "a").improvement, 3);
  assert.equal(candidates.find((student) => student.id === "a").eligible, true);
  assert.equal(candidates.find((student) => student.id === "b").eligible, false);
  assert.equal(candidates.find((student) => student.id === "c").eligible, false);
  assert.ok(buildAwardCandidates(students, summaries, { term: "1", awardType: "improvement", minimum: 3 }).every((student) => !student.eligible));
});

test("teacher creates reviewed certificate batches and prints only on request", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: AwardsView } = await vite.ssrLoadModule("/src/components/AwardsView.jsx");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  let printed = 0;
  window.print = () => printed++;
  await React.act(() => root.render(React.createElement(AwardsView, { students, gradeSummaries: summaries, sections: [{ id: "rose", name: "Rose" }, { id: "lily", name: "Lily" }], subjects: [{ id: "math", name: "Mathematics" }, { id: "science", name: "Science" }] })));
  const control = (label) => document.querySelector(`[aria-label="${label}"]`);
  const click = (text) => React.act(() => [...document.querySelectorAll("button")].find((button) => button.textContent.includes(text)).click());
  assert.equal(control("Award recipient Carlo").disabled, true);
  await React.act(() => { control("Award term").value = "2"; control("Award term").dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await click("Select all eligible");
  assert.equal(control("Award recipient Alice").checked, true);
  assert.equal(control("Award recipient Bob").checked, true);
  await React.act(() => {
    const school = control("Certificate school");
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(school, "EduLITE School");
    school.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await click("Create certificates");
  const certificates = document.querySelectorAll(".awards-print-root .award-certificate");
  assert.equal(certificates.length, 3);
  assert.match(certificates[0].textContent, /EduLITE School/);
  assert.match(certificates[0].textContent, /Alice/);
  assert.match(certificates[0].textContent, /95\.00/);
  assert.match(certificates[0].textContent, /Term 2/);
  assert.equal(printed, 0);
  await click("Print certificates");
  assert.equal(printed, 1);
  await React.act(() => { control("Award section").value = "Lily"; control("Award section").dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  assert.equal(control("Award recipient Carlo").checked, false);
  // Already generated certificates retain their reviewed snapshot until recreated.
  assert.equal(document.querySelectorAll(".awards-print-root .award-certificate").length, 3);
});
