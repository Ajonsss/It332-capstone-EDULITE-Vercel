import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import axios from "axios";
import { getPerformanceStatus } from "../src/utils/performance.js";

test("assessment records sorting, performance counts, and selection work together", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { RecordsView } = await vite.ssrLoadModule("/src/components/Dashboard.jsx");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  const students = [
    { id: "a", name: "Alice", section: "Rose", grade: 7, subject_ids: ["science"], subject_names: ["Science"], result: { 1: 92, 2: 70 } },
    { id: "b", name: "Bob", section: "Rose", grade: 7, subject_ids: ["science"], subject_names: ["Science"], result: { 1: 85, 2: 80 } },
    { id: "c", name: "Carlo", section: "Rose", grade: 7, subject_ids: ["math"], subject_names: ["Mathematics"], result: { 1: 77, 2: 75 } },
    { id: "d", name: "Diego", section: "Lily", grade: 8, subject_ids: ["science"], subject_names: ["Science"], result: { 1: 70, 2: 90 } },
    { id: "e", name: "Ella", section: "Lily", grade: 8, subject_ids: ["math"], subject_names: ["Mathematics"], result: { 1: 62, 2: 60 } },
    { id: "f", name: "Faye", section: "Lily", grade: 8, subject_ids: ["science"], subject_names: ["Science"], result: { 1: null, 2: null } },
  ];
  let deleteError = false, finishError = false, confirmed = false;
  const deletes = [], finishes = [], openedInsights = [];
  window.confirm = () => confirmed;
  t.mock.method(axios, "delete", async (url) => {
    deletes.push(url);
    if (deleteError) throw { response: { data: { message: "Deletion failed. Try again." } } };
    return { data: {} };
  });
  t.mock.method(axios, "patch", async (url) => {
    finishes.push(url);
    if (finishError) throw { response: { data: { message: "Unable to finish intervention." } } };
    return { data: { status: "completed", completedAt: "2026-10-31T10:00:00.000Z" } };
  });
  function Harness({ locked = false }) {
    const [section, setSection] = React.useState("ALL");
    const [subject, setSubject] = React.useState("ALL");
    const [term, setTerm] = React.useState("1");
    const [selected, setSelected] = React.useState(null);
    const [insights, setInsights] = React.useState([{ id: "saved-plan", title: "Learning plan", supportType: "intervention", focusLabel: "Science" }]);
    const selectStudent = React.useCallback(async (student) => setSelected(student.id), []);
    const analytics = React.useMemo(() => students
      .filter((student) => (section === "ALL" || student.section === section) && (subject === "ALL" || student.subject_ids.includes(subject)))
      .map((student) => ({ ...student, averagePercentage: student.result[term] })), [section, subject, term]);
    return React.createElement(RecordsView, {
      sections: [{ id: "rose", name: "Rose" }, { id: "lily", name: "Lily" }],
      subjects: [{ id: "science", name: "Science" }, { id: "math", name: "Mathematics" }],
      assessments: [], studentAnalytics: analytics,
      selectedSection: section, setSelectedSection: setSection,
      selectedSubject: subject, setSelectedSubject: setSubject,
      selectedTerm: term, setSelectedTerm: setTerm,
      currentSectionLabel: section === "ALL" ? "All Sections" : section,
      currentSubjectLabel: subject === "ALL" ? "All Subjects" : subject,
      currentTermLabel: `Term ${term}`,
      scoreMap: {}, editedScores: {}, savingScores: false, editingStudentId: locked ? selected : null,
      getPerformanceStatus, handleEditedScoreChange() {}, startEditingScores() {}, cancelEditingScores() {}, saveStudentScores() {},
      getStudentAssessments: () => [], onEditStudent() {}, assessmentRecords: [], gradeSummaries: [],
      expandedStudentId: selected, toggleStudentProfile: selectStudent,
      studentInsightsById: { [selected]: insights }, loadingStudentInsightsId: null, studentInsightErrors: {},
      openSavedInsight: (insight) => openedInsights.push(insight.id), reloadStudentInsights() {},
      onDeleteInsight: async (studentId, insightId) => {
        assert.equal(studentId, selected);
        await axios.delete(`/api/gemini/insights/${insightId}`);
        setInsights((current) => current.filter((item) => item.id !== insightId));
      },
      onFinishInsight: async (insight) => {
        const { data } = await axios.patch(`/api/gemini/insights/${insight.id}/finish`);
        setInsights((current) => current.map((item) => item.id === insight.id ? { ...item, ...data } : item));
      },
    });
  }
  await React.act(() => root.render(React.createElement(Harness)));
  const control = (label) => document.querySelector(`[aria-label="${label}"]`);
  const card = (level) => document.querySelector(`[aria-label^="Filter ${level}:"]`);
  const names = () => [...document.querySelectorAll('[aria-label^="View assessment record for "]')].map((button) => button.getAttribute("aria-label").replace("View assessment record for ", ""));
  const select = async (label, value) => {
    await click(control("Open filters and sorting"));
    await React.act(() => { const element = control(label); element.value = value; element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    await click(control("Close filters and sorting"));
  };
  const click = (button) => React.act(async () => button.click());
  const search = async (value) => {
    await click(control("Open filters and sorting"));
    await React.act(() => {
      const input = control("Search records students");
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await click(control("Close filters and sorting"));
  };

  await t.test("overview shows all existing levels and a reconciled total", () => {
    assert.match(document.body.textContent, /Showing 6 of 6 students/);
    for (const level of ["Advancing", "Benchmarking", "Connecting", "Developing", "Emerging", "Incomplete"]) {
      assert.equal(card(level).getAttribute("aria-label"), `Filter ${level}: 1 student`);
    }
  });
  await t.test("performance sorting changes the roster order and leaves incomplete students last", async () => {
    await select("Sort records students", "lowest");
    assert.deepEqual(names(), ["Ella", "Diego", "Carlo", "Bob", "Alice", "Faye"]);
    await select("Sort records students", "highest");
    assert.deepEqual(names(), ["Alice", "Bob", "Carlo", "Diego", "Ella", "Faye"]);
    assert.match(document.body.textContent, /Showing 6 of 6 students/);
  });
  await t.test("clicking a count filters the list and opens a matching student", async () => {
    await click(card("Developing"));
    assert.deepEqual(names(), ["Diego"]);
    assert.equal(card("Developing").getAttribute("aria-pressed"), "true");
    assert.match(document.body.textContent, /Showing 1 of 6 students/);
    assert.equal(document.querySelector('button[aria-current="true"]').getAttribute("aria-label"), "View assessment record for Diego");
    assert.equal([...document.querySelectorAll("h2")].find((heading) => heading.className.includes("text-4xl")).textContent, "Diego");
  });
  await t.test("search updates all counts and clears stale details when no students match", async () => {
    await search("Nobody");
    assert.deepEqual(names(), []);
    assert.match(document.body.textContent, /Showing 0 of 0 students/);
    assert.match(document.body.textContent, /No matching students/);
    assert.equal(document.querySelector("h2.text-4xl"), null);
    await click(card("All students"));
    await search("Alice");
    assert.deepEqual(names(), ["Alice"]);
    assert.match(document.body.textContent, /Showing 1 of 1 student/);
    assert.equal(card("Advancing").getAttribute("aria-label"), "Filter Advancing: 1 student");
    assert.equal(card("Developing").getAttribute("aria-label"), "Filter Developing: 0 students");
    await search("");
  });
  await t.test("section, subject and term changes recompute performance counts", async () => {
    await select("Filter records by section", "Rose");
    assert.match(document.body.textContent, /Showing 3 of 3 students/);
    await select("Filter records by subject", "science");
    assert.deepEqual(names(), ["Alice", "Bob"]);
    await select("Filter records by term", "2");
    assert.deepEqual(names(), ["Bob", "Alice"]);
    assert.equal(card("Advancing").getAttribute("aria-label"), "Filter Advancing: 0 students");
    assert.equal(card("Developing").getAttribute("aria-label"), "Filter Developing: 1 student");
    await select("Filter records by performance", "Developing");
    assert.deepEqual(names(), ["Alice"]);
    assert.match(document.body.textContent, /Showing 1 of 2 students/);
  });
  await t.test("incomplete filtering shows missing results without assigning an emerging grade", async () => {
    await select("Filter records by section", "ALL");
    await select("Filter records by subject", "ALL");
    await click(card("Incomplete"));
    assert.deepEqual(names(), ["Faye"]);
    assert.match(document.body.textContent, /Showing 1 of 6 students/);
    assert.match(control("View assessment record for Faye").textContent, /Incomplete/);
  });
  await t.test("interventions can be closed after confirmation, with failures preserved for retry", async () => {
    assert.equal([...document.querySelectorAll("button")].find((item) => item.textContent === "Interventions"), undefined);
    await click([...document.querySelectorAll("button")].find((item) => item.textContent === "AI Insights"));
    const finish = () => control("Finish intervention Learning plan");
    await click(finish()); assert.deepEqual(finishes, []);
    confirmed = true; finishError = true;
    await click(finish()); assert.ok(finish());
    assert.match(document.querySelector('[role="alert"]').textContent, /Unable to finish/);
    finishError = false; await click(finish());
    assert.equal(finish(), null);
    assert.match(document.body.textContent, /Closed · Intervention finished/);
    assert.ok(control("Delete recommendation Learning plan"));
    assert.equal(finishes.at(-1), "/api/gemini/insights/saved-plan/finish");
    confirmed = false;
  });
  await t.test("saved recommendations still open and support cancellation, failure and successful deletion", async () => {
    const button = (label) => [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
    await click(button("AI Insights"));
    await click([...document.querySelectorAll("button")].find((item) => item.querySelector("h4")));
    assert.deepEqual(openedInsights, ["saved-plan"]);
    const remove = () => control("Delete recommendation Learning plan");
    await click(remove()); assert.deepEqual(deletes, []);
    confirmed = true; deleteError = true;
    await click(remove()); assert.match(document.querySelector('[role="alert"]').textContent, /Deletion failed/);
    assert.ok(remove());
    deleteError = false; await click(remove());
    assert.equal(remove(), null); assert.match(document.body.textContent, /No saved AI insights yet/);
    assert.deepEqual(deletes, ["/api/gemini/insights/saved-plan", "/api/gemini/insights/saved-plan"]);
  });
  await t.test("score editing locks filters until edits are saved or cancelled", async () => {
    assert.equal(control("Filter records by section"), null);
    await click(control("Open filters and sorting"));
    await React.act(() => root.render(React.createElement(Harness, { locked: true })));
    for (const label of ["Filter records by section", "Filter records by subject", "Filter records by term", "Filter records by performance", "Sort records students", "Search records students"]) assert.equal(control(label).disabled, true);
    assert.equal(card("All students").disabled, true);
    assert.match(document.body.textContent, /Save or cancel score edits/);
    await click(control("Close filters and sorting"));
    assert.equal(control("Open filters and sorting").disabled, true);
    assert.equal(document.querySelector('[role="dialog"]'), null);
  });
});
