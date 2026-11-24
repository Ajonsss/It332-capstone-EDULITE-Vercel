import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import axios from "axios";

test("dashboard keeps reporting filters, assessment actions, and generated support in their selected scope", async (t) => {
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
  const student = { id: "learner", name: "Maria Santos", grade: 7, section: "Rose", section_id: "rose", subject_ids: ["math", "science"] };
  const pastStudent = { ...student, id: "grade-8-student", grade: 8, subject_ids: ["math"] };
  const pastAssessment = {
    id: "past-quiz", name: "Fractions quiz", subject_id: "math", subject_name: "Math", term: 2,
    category: "written_work", sequence: 1, date: "2025-10-01", total_items: 10,
    class_sections: [{ grade: 8, section_id: "rose" }], budget_of_work: "Add unlike fractions", is_structured: true,
  };
  const registeredSections = Array.from({ length: 10 }, (_, index) => ({ id: `group-${index + 1}`, name: `Group ${index + 1}` }));
  const responses = {
    students: [student, { ...student, id: "unassessed", name: "No Scores" }],
    sections: [{ id: "rose", name: "Rose" }, ...registeredSections], subjects: [{ id: "math", name: "Math" }, { id: "science", name: "Science" }],
    assessments: [], "assessment-records": [], insights: [],
    classes: registeredSections.map(({ id }) => ({ grade: 7, section_id: id, subject_ids: ["math"] })),
    "grade-summaries": [
      { student_id: student.id, subject_id: "math", term1: { termGrade: null, performance: { grade: 64, isProvisional: true } }, term3: { termGrade: 92 }, final: { finalGrade: null } },
      { student_id: "unassessed", subject_id: "math", term3: { termGrade: 62 } },
      { student_id: student.id, subject_id: "science", term1: { termGrade: 0 } },
    ],
    "school-years": {
      years: [{ _id: null, name: "Legacy / unassigned records" }, { _id: "older", name: "Earlier year" }, { _id: "recent", name: "More recent year" }],
      activeId: null,
    },
    "grading-rules": { passingGrade: 75, highPerformingGrade: 90 },
  };
  const reads = [];
  const reportingYears = [];
  const assessmentWrites = [];
  let resolveOlder;
  let olderSignal;
  t.mock.method(axios, "get", async (url, config) => {
    reads.push(url);
    if (url === "/api/dashboard" && config?.params?.school_year_id) reportingYears.push(config.params.school_year_id);
    if (url === "/api/assessments/past-quiz") {
      assert.equal(config.params.school_year_id, "recent");
      return { data: { ...pastAssessment, students: [{ ...pastStudent, score: 0 }] } };
    }
    const data = structuredClone(url === "/api/dashboard" ? {
      students: responses.students, sections: responses.sections, subjects: responses.subjects, assessments: responses.assessments,
      assessmentRecords: responses["assessment-records"], gradeSummaries: responses["grade-summaries"], classes: responses.classes,
      schoolYears: responses["school-years"], gradingRules: responses["grading-rules"],
    } : responses[url.split("/").at(-1)]);
    if (url === "/api/dashboard" && config?.params?.school_year_id === "older") {
      olderSignal = config.signal;
      return new Promise((resolve) => { resolveOlder = () => resolve({ data }); });
    }
    if (url === "/api/dashboard" && config?.params?.school_year_id === "recent") {
      data.classes = [];
      data.students = [pastStudent];
      data.assessments = [pastAssessment];
      data.assessmentRecords = [{ student_id: pastStudent.id, assessment_id: pastAssessment.id, score: 0 }];
      data.gradeSummaries = [{ student_id: pastStudent.id, subject_id: "math", term2: { performance: { grade: 60, isProvisional: true } } }];
    }
    return { data };
  });
  t.mock.method(axios, "put", async (url, payload, config) => {
    assessmentWrites.push({ url, payload, year: config?.params?.school_year_id });
    return { data: {} };
  });
  const generated = [];
  const finished = [];
  const savedInsight = { id: "ai-plan", studentId: student.id, supportType: "intervention", title: "Fraction support", status: "active", completedAt: null, pdfUrl: "/api/gemini/insights/ai-plan/pdf" };
  t.mock.method(axios, "post", async (url, body, config) => {
    generated.push({ url, body, config });
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
  const metric = (label) => [...document.querySelectorAll("h3")].find((element) => element.textContent === label).parentElement.textContent;
  assert.match(metric("Unique Students Handled"), /Unique Students Handled2/);
  const chooseClass = (grade = 7) => React.act(async () => document.querySelector(`[aria-label="View Grade ${grade} · Section Rose · Math"]`).click());
  const folderTab = (name) => [...document.querySelectorAll('[aria-label="Dashboard reports"] [role="tab"]')]
    .find((tab) => tab.textContent === name);
  const folderPanel = (name) => document.getElementById(folderTab(name).getAttribute("aria-controls"));
  const selectFolder = (name) => React.act(async () => folderTab(name).click());
  const assertVisibleFolder = (name) => {
    assert.equal(folderTab(name).getAttribute("aria-selected"), "true");
    assert.deepEqual([...document.querySelectorAll('[role="tabpanel"]:not([hidden])')].map((panel) => panel.id),
      [folderPanel(name).id]);
  };
  const dashboardHeading = document.querySelector("header h1");
  assert.equal(dashboardHeading.textContent, "Dashboard");
  assert.ok(dashboardHeading.parentElement.contains(folderTab("Student List")));
  assert.ok(folderPanel("Student List").closest("main"));
  assertVisibleFolder("Dashboard");
  const getFilter = (label) => [...document.querySelectorAll('[aria-label="Dashboard filters"] label')].find((element) =>
    element.querySelector("span").textContent === label).querySelector("select");
  assert.equal(document.querySelectorAll('[aria-label="Dashboard filters"] select').length, 5);
  const distribution = () => folderPanel("Dashboard").querySelector('figure[aria-label="Distribution by performance band"]');
  const donut = () => distribution().querySelector('div[aria-hidden="true"] > div');
  const changeFilter = (label, value) => React.act(async () => {
    const select = getFilter(label);
    select.value = value;
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  const subjectChart = () => folderPanel("Dashboard").querySelector('figure[aria-label="Subject Performance bar chart"]');
  const chartFilter = (name) => [...folderPanel("Dashboard").querySelectorAll("label")]
    .find((label) => label.querySelector("span")?.textContent === name).querySelector("select");
  const changeChartFilter = (name, value) => React.act(async () => {
    const select = chartFilter(name);
    select.value = value;
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.equal(subjectChart().querySelectorAll("li").length, 10);
  const mathColumn = subjectChart().querySelector("li button");
  assert.equal(mathColumn.parentElement.style.height, "64%");
  assert.equal(mathColumn.getAttribute("aria-label"), "Math, Grade 7 · Section Rose. Average 64.0.");
  assert.equal(mathColumn.querySelector("span"), null);
  await React.act(async () => mathColumn.dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true })));
  assert.equal(mathColumn.querySelector("span").textContent, "64.0");
  await React.act(async () => mathColumn.dispatchEvent(new window.PointerEvent("pointerout", { bubbles: true })));
  assert.equal(mathColumn.querySelector("span"), null);
  await React.act(async () => mathColumn.focus());
  assert.equal(mathColumn.querySelector("span").textContent, "64.0");
  await React.act(async () => mathColumn.blur());
  assert.equal(mathColumn.querySelector("span"), null);
  await React.act(async () => [...subjectChart().querySelectorAll("button")].find((item) => item.textContent === "Next").click());
  assert.equal(subjectChart().querySelectorAll("li").length, 2);
  await changeChartFilter("Chart subject", "science");
  assert.equal(getFilter("Subject").value, "ALL", "the chart filter applies within the dashboard scope");
  const scienceBar = () => subjectChart().querySelector("li");
  assert.equal(subjectChart().querySelectorAll("li").length, 1);
  assert.match(scienceBar().textContent, /ScienceGrade 7 · Section RoseOfficial term grades · 1 assessed/);
  const zeroColumn = scienceBar().querySelector("button");
  assert.equal(zeroColumn.parentElement.style.height, "0%");
  t.mock.method(zeroColumn.closest('[role="region"]'), "getBoundingClientRect", () => ({ left: 0, right: 150 }));
  t.mock.method(zeroColumn, "getBoundingClientRect", () => ({ left: 118, right: 174 }));
  await React.act(async () => zeroColumn.click());
  assert.equal(zeroColumn.querySelector("span").textContent, "0.0");
  assert.equal(zeroColumn.querySelector("span").style.left, "-24px", "the amount stays inside the plot when the bar is clipped");
  await changeChartFilter("Chart view", "categories");
  const categoryBars = () => [...subjectChart().querySelectorAll('[aria-label="Subject performance columns"] button')];
  assert.match(subjectChart().querySelector('[aria-label="Student performance categories"]').textContent, /Advancing.*Benchmarking.*Connecting.*Developing.*Emerging.*Incomplete/);
  assert.deepEqual(categoryBars().map((bar) => bar.getAttribute("aria-label")), [
    "Science, Grade 7 · Section Rose. Incomplete. 1 student.",
    "Science, Grade 7 · Section Rose. Emerging. 1 student.",
  ]);
  assert.deepEqual(categoryBars().map((bar) => bar.parentElement.style.height), ["50%", "50%"]);
  await React.act(async () => categoryBars()[1].dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true })));
  assert.equal(categoryBars()[1].querySelector("span").textContent, "1");
  await changeFilter("Term", "2");
  assert.equal(chartFilter("Chart subject").value, "science");
  assert.equal(categoryBars().length, 1);
  assert.match(categoryBars()[0].getAttribute("aria-label"), /Incomplete\. 2 students\./);
  await changeChartFilter("Chart view", "averages");
  assert.match(scienceBar().textContent, /No recorded results · 0 assessed/);
  assert.equal(scienceBar().querySelector("button"), null);
  await changeFilter("Term", "1");
  await changeChartFilter("Chart subject", "ALL");
  const classCards = () => [...folderPanel("My Classes").querySelectorAll("article")];
  const roseCard = () => document.querySelector('article[aria-label="Grade 7 · Section Rose · Math"]');
  assert.equal(folderPanel("Dashboard").querySelector('[aria-label="My Classes"]'), null);
  assert.equal(folderPanel("My Classes").hidden, true);
  await selectFolder("My Classes");
  assertVisibleFolder("My Classes");
  assert.equal(classCards().length, 12, "all assignments have open cards, including empty classes beyond the table page size");
  assert.match(roseCard().textContent, /Assessed \/ Enrolled1 \/ 2Class Average64.0In progress/);
  assert.ok(roseCard().querySelector('figure[aria-label="Distribution by performance band"]'));
  assert.match(roseCard().textContent, /Term Performance Trend/);
  assert.match(document.querySelector('article[aria-label="Grade 7 · Section Group 10 · Math"]').textContent, /0 \/ 0.*No recorded results/);
  await changeFilter("Term", "2");
  assert.equal(classCards().length, 12);
  assert.match(roseCard().textContent, /Assessed \/ Enrolled0 \/ 2Class Average—No recorded results/);
  await changeFilter("Grade Level", "7");
  assert.equal(classCards().length, 12, "a grade filter keeps all matching cards open");
  await changeFilter("Section", "7:rose");
  assert.equal(classCards().length, 2, "a section filter immediately shows both matching subject cards");
  await changeFilter("Subject", "math");
  assertVisibleFolder("My Classes");
  assert.deepEqual(classCards(), [roseCard()], "a single matching assignment still has an open card");
  await chooseClass();
  assertVisibleFolder("Dashboard");
  assert.equal(subjectChart().querySelectorAll("li").length, 1);
  assert.match(subjectChart().querySelector("li").textContent, /MathGrade 7 · Section Rose/);
  await React.act(async () => folderTab("Dashboard").dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
  ));
  assert.equal(document.activeElement, folderTab("My Classes"), "arrow keys focus the new folder in order");
  assertVisibleFolder("My Classes");
  await selectFolder("Student List");
  assertVisibleFolder("Student List");
  await selectFolder("Learning Support");
  assertVisibleFolder("Learning Support");
  await selectFolder("Dashboard");
  assertVisibleFolder("Dashboard");
  assert.equal(getFilter("Term").value, "2", "opening a class keeps the term");
  assert.match(metric("Passing Rate"), /Passing Rate—/);
  assert.match(metric("Assessed / Enrolled Students"), /0 \/ 2/);
  assert.equal(donut().style.background, "var(--ed-border)");
  assert.match(distribution().textContent, /No recorded averages/);
  await changeFilter("Term", "3");
  assert.match(donut().style.background, /^conic-gradient\(.+ 0% 50%, .+ 50% 100%\)$/);
  assert.match(distribution().textContent, /Advancing90 and above1 · 50\.0%/);
  assert.match(distribution().textContent, /EmergingBelow 651 · 50\.0%/);
  const clickButton = (label) => React.act(async () => [...document.querySelectorAll("button")].find((element) => element.textContent === label).click());
  await clickButton("Reset class filters");
  await selectFolder("My Classes");
  assert.equal(classCards().length, 12);
  assert.equal(getFilter("Term").value, "3", "returning to all classes keeps the term");
  await changeFilter("Term", "2");
  await changeFilter("School Year", "older");
  await changeFilter("School Year", "recent");
  assert.equal(olderSignal.aborted, true);
  assert.equal(getFilter("Grade Level").value, "ALL");
  assert.equal(getFilter("Section").value, "ALL");
  assert.equal(getFilter("Term").value, "2");
  assert.deepEqual([...getFilter("Grade Level").options].map((option) => option.value), ["ALL", "8"]);
  await React.act(async () => resolveOlder());
  assert.deepEqual([...getFilter("Grade Level").options].map((option) => option.value), ["ALL", "8"], "an older response cannot replace this report");
  assertVisibleFolder("My Classes");
  await chooseClass(8);
  assert.match(document.querySelector('[aria-label="Dashboard filters"]').textContent, /Grade 8 · Section Rose · Math · Term 2/);
  assert.equal(donut().style.background, "rgb(255, 59, 48)");
  const tabList = document.querySelector('[aria-label="Dashboard reports"]');
  Object.defineProperties(tabList, { clientWidth: { value: 263 }, scrollWidth: { value: 311 } });
  tabList.style.paddingLeft = tabList.style.paddingRight = "5px";
  t.mock.method(tabList, "getBoundingClientRect", () => ({ left: 0, right: 263 }));
  t.mock.method(folderTab("Assessment Results"), "getBoundingClientRect", () => ({ left: 242, right: 306 }));
  await selectFolder("Assessment Results");
  assertVisibleFolder("Assessment Results");
  assert.equal(tabList.scrollLeft, 48, "the selected tab scrolls into view within the strip");
  await clickButton("View results");
  const scoreCells = document.querySelector('[aria-label="Individual assessment results"] tbody tr').cells;
  assert.deepEqual([...scoreCells].slice(-2).map((cell) => cell.textContent), ["0 / 10", "0.0%"]);
  await clickButton("Edit assessment");
  for (let count = 0; count < 50 && !document.querySelector("#assessment-name"); count++) {
    await React.act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  assert.equal(document.querySelector("#assessment-name")?.value, "Fractions quiz");
  await clickButton("Update Assessment");
  assert.deepEqual(assessmentWrites.map(({ url, year, payload }) => [url, year, payload.scores]), [
    ["/api/assessments/past-quiz", "recent", [{ student_id: pastStudent.id, score: 0 }]],
  ]);
  assert.equal(getFilter("School Year").value, "recent");
  assert.equal(getFilter("Section").value, "8:rose");
  assert.equal(folderPanel("Assessment Results").hidden, false, "returning from the assessment editor keeps its folder open");
  await changeFilter("School Year", "legacy");
  assert.equal(reportingYears.at(-1), "legacy", "returning to the active year reloads its records");
  assertVisibleFolder("Assessment Results");
  await changeFilter("Term", "1");
  await selectFolder("My Classes");
  await clickButton("Reset class filters");
  await chooseClass();
  assert.match(document.querySelector('[aria-label="Dashboard filters"]').textContent, /Grade 7 · Section Rose · Math · Term 1/);
  assert.match(document.querySelector('[aria-label="Learning Support"]').textContent, /Maria SantosGrade 7 · Section RoseMath64.0In progressNeeds intervention/);
  assert.match(metric("Assessed / Enrolled Students"), /1 \/ 2/);
  assert.match(metric("Students Below Threshold"), /Students Below Threshold1/);
  await selectFolder("Student List");
  const search = document.querySelector('[aria-label="Search students in selected class"]');
  await React.act(async () => {
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    nativeSet.call(search, "Maria");
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  assert.equal(document.querySelector('[aria-label="View profile for No Scores"]'), null);
  assert.match(metric("Assessed / Enrolled Students"), /1 \/ 2/, "search only narrows the roster");
  await React.act(async () => document.querySelector('[aria-label="View profile for Maria Santos"]').click());
  assert.match(document.querySelector('[aria-label="Dashboard details"]').textContent, /Maria SantosGrade 7 · Section Rose.*Subject & Term Results.*Complete Record.*Saved Recommendations/);
  const back = [...document.querySelectorAll("button")].find((element) => element.textContent === "Back to dashboard");
  await React.act(async () => back.click());
  assert.match(document.querySelector('[aria-label="Dashboard filters"]').textContent, /Grade 7 · Section Rose · Math · Term 1/);
  assert.equal(document.querySelector('[aria-label="Search students in selected class"]').value, "Maria");
  assert.equal(folderPanel("Student List").hidden, false, "returning from a profile keeps the student folder open");
  await selectFolder("Learning Support");
  const button = [...document.querySelectorAll("button")].find((element) => element.textContent === "Generate");
  assert.equal(button.disabled, false);
  await React.act(async () => button.click());
  assert.equal(generated.length, 1);
  assert.equal(generated[0].url, "/api/gemini/student-support/learner");
  assert.equal(generated[0].body.support_type, "intervention");
  assert.equal(generated[0].body.term, 1);
  assert.equal(generated[0].body.focus_subject_id, "math");
  assert.equal(generated[0].config.params.school_year_id, "legacy");
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
