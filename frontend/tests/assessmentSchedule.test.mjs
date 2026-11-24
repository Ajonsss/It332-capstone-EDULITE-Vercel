import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import axios from "axios";
import { SCHEDULE_REMINDER_DISMISSED, todayAsInputValue } from "../src/utils/assessmentSchedule.js";

test("assessment reminders persist until dismissed and library tabs combine filters", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
  });
  window.matchMedia = () => ({ matches: false });
  window.scrollTo = () => {};
  window.confirm = () => true;
  window.sessionStorage.setItem(SCHEDULE_REMINDER_DISMISSED, "true");
  const delayedCloses = [];
  const setTimeout = window.setTimeout.bind(window);
  t.mock.method(window, "setTimeout", (callback, delay, ...args) => {
    if (delay >= 4000) delayedCloses.push(callback);
    return setTimeout(callback, delay, ...args);
  });

  const assessment = (id, name, date, status, term = 1, section = "rose", subject = "math") => ({
    id, name, date, status, term, is_structured: true,
    subject_id: subject, total_items: 10, class_sections: [{ grade: 7, section_id: section }],
  });
  const report = {
    students: [],
    sections: [{ id: "rose", name: "Rose" }, { id: "lily", name: "Lily" }],
    subjects: [{ id: "math", name: "Math" }, { id: "science", name: "Science" }],
    classes: [
      { grade: 7, section_id: "rose", subject_ids: ["math", "science"] },
      { grade: 7, section_id: "lily", subject_ids: ["math"] },
    ],
    assessments: [
      assessment("today", "Today quiz", todayAsInputValue(), "scheduled"),
      assessment("future", "Upcoming exam", "2099-12-01", "scheduled", 2),
      assessment("draft", "Unscheduled draft", todayAsInputValue(), "not_conducted"),
      assessment("complete", "Completed quiz", todayAsInputValue(), "done"),
      assessment("lily-quiz", "Lily math quiz", todayAsInputValue(), "done", 2, "lily"),
      assessment("science-quiz", "Rose science quiz", todayAsInputValue(), "done", 2, "rose", "science"),
    ],
    assessmentRecords: [], gradeSummaries: [],
    schoolYears: { activeId: "current-year", years: [{ _id: "current-year", name: "School year" }] },
    gradingRules: { passingGrade: 75, highPerformingGrade: 90 },
  };
  t.mock.method(axios, "post", async (url) => {
    assert.equal(url, "/api/login");
    return { data: { token: "test-token", user: {} } };
  });
  t.mock.method(axios, "get", async (url) => {
    assert.equal(url, "/api/dashboard");
    return { data: structuredClone(report) };
  });
  const writes = [];
  t.mock.method(axios, "patch", async (url, body, config) => {
    writes.push({ url, body, config });
    const item = report.assessments.find(({ id }) => url === `/api/assessments/${id}/status`);
    item.status = body.status;
    return { data: { id: item.id, status: item.status } };
  });
  t.mock.method(axios, "delete", async (url) => {
    assert.equal(url, "/api/assessments/draft");
    report.assessments = report.assessments.filter(({ id }) => id !== "draft");
    return { data: {} };
  });

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { MemoryRouter, Route, Routes } = await import("react-router-dom");
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: Login } = await vite.ssrLoadModule("/src/components/Login.jsx");
  const { default: Dashboard } = await vite.ssrLoadModule("/src/components/Dashboard.jsx");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  const render = (path) => React.act(async () => root.render(
    React.createElement(MemoryRouter, { key: path, initialEntries: [path] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: "/", element: React.createElement(Login) }),
        React.createElement(Route, { path: "/dashboard", element: React.createElement(Dashboard) }),
      )),
  ));
  const change = (field, value) => React.act(async () => {
    const proto = field.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
    field.dispatchEvent(new window.Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
  const click = (element) => React.act(async () => element.click());
  const closeReminder = () => document.querySelector('[aria-label="Dismiss scheduled assessments notification"]');
  const reminder = () => closeReminder()?.closest(".mac-notification-card");
  const status = (name) => document.querySelector(`[aria-label="Status for ${name}"]`);
  const filterTab = (group, label) => [...document.querySelectorAll(`[aria-label="Assessment ${group}"] button`)]
    .find((button) => button.textContent === label);

  await render("/");
  await change(document.querySelector("#username"), "teacher");
  await change(document.querySelector("#password"), "test-password");
  await click(document.querySelector('button[type="submit"]'));
  assert.ok(reminder());
  assert.deepEqual([...reminder().querySelectorAll("li p:first-child > span:last-child")].map((item) => item.textContent), ["Today quiz", "Upcoming exam"]);
  assert.deepEqual([...reminder().querySelectorAll("[data-assessment-indicator]")].map((item) => item.dataset.assessmentIndicator),
    ["today", "scheduled"]);
  assert.deepEqual([...reminder().querySelectorAll(".assessment-status-label")].map((item) => item.textContent), ["Today", "Scheduled"]);
  assert.deepEqual(delayedCloses, [], "the reminder has no dismissal timer");

  const assessmentsTab = [...document.querySelectorAll('[aria-label="Dashboard reports"] [role="tab"]')]
    .find((tab) => tab.textContent === "Assessment Results");
  await click(assessmentsTab);
  assert.equal(status("Today quiz").selectedOptions[0].textContent, "Today");
  const todayStatus = status("Today quiz");
  assert.equal(todayStatus.closest("td"), todayStatus.closest("tr").cells[0]);
  assert.ok(todayStatus.parentElement.querySelector(".assessment-status-dot"));
  assert.equal(todayStatus.parentElement.querySelector(".assessment-status-label").textContent, "Today");
  assert.equal(status("Unscheduled draft").parentElement.querySelector(".assessment-status-label").textContent, "Not yet conducted");
  assert.equal(status("Today quiz").parentElement.dataset.assessmentIndicator, "today");
  assert.equal(status("Unscheduled draft").parentElement.dataset.assessmentIndicator, "not_conducted");
  await change(status("Today quiz"), "done");
  assert.equal(status("Today quiz").value, "done");
  assert.equal(status("Today quiz").parentElement.dataset.assessmentIndicator, "done");
  assert.equal(status("Today quiz").parentElement.querySelector(".assessment-status-label").textContent, "Done");
  assert.deepEqual(writes, [{ url: "/api/assessments/today/status", body: { status: "done" }, config: { params: { school_year_id: "current-year" } } }]);
  assert.match(reminder().textContent, /Upcoming exam/);
  assert.doesNotMatch(reminder().textContent, /Today quiz/);

  await click(document.querySelector('[aria-label="Main navigation"] [aria-label="Assessments"]'));
  assert.equal(status("Today quiz").value, "done");
  assert.equal(status("Today quiz").closest("td"), status("Today quiz").closest("tr").cells[0]);

  await click(filterTab("status", "Done"));
  assert.equal(status("Completed quiz").value, "done");
  assert.equal(status("Unscheduled draft"), null);
  await change(status("Today quiz"), "scheduled");
  assert.equal(status("Today quiz"), null, "changing status updates the filtered list");
  await click(filterTab("status", "Today"));
  assert.equal(status("Today quiz").value, "scheduled");
  await click(filterTab("term", "Term 2"));
  assert.equal(status("Today quiz"), null);
  assert.equal(status("Upcoming exam"), null);
  assert.match(document.body.textContent, /No assessments match the current filters/);
  await click(filterTab("status", "Scheduled"));
  assert.equal(status("Upcoming exam").value, "scheduled");
  assert.equal(filterTab("status", "Scheduled").getAttribute("aria-pressed"), "true");

  await click(filterTab("section", "Lily"));
  assert.equal(status("Upcoming exam"), null, "the selected section narrows the scheduled results");
  await click(filterTab("status", "Done"));
  assert.equal(status("Lily math quiz").value, "done");
  assert.equal(status("Rose science quiz"), null);
  await click(filterTab("subject", "Science"));
  assert.equal(status("Lily math quiz"), null, "the selected subject narrows the section results");
  await click(filterTab("section", "All Sections"));
  assert.equal(status("Rose science quiz").value, "done");
  assert.equal(filterTab("subject", "Science").getAttribute("aria-pressed"), "true");
  assert.equal(filterTab("term", "Term 2").getAttribute("aria-pressed"), "true");
  await click(filterTab("subject", "All Subjects"));
  await click(filterTab("term", "Term 1"));
  await click(filterTab("status", "Not yet conducted"));
  const draftRow = status("Unscheduled draft").closest("tr");
  await click([...draftRow.querySelectorAll("button")].find((button) => button.textContent === "Delete"));
  assert.ok(delayedCloses.length, "regular notifications still time out");
  await React.act(async () => delayedCloses.at(-1)());
  assert.ok(reminder(), "a transient notification does not dismiss the schedule");

  await click(closeReminder());
  assert.equal(reminder(), undefined);
  await render("/dashboard");
  assert.equal(reminder(), undefined, "dismissal survives a reload during the same sign-in session");
});
