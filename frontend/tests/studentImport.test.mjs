import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import axios from "axios";

test("student names import prepares one class and requires final confirmation", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import("react"), { createRoot } = await import("react-dom/client");
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: StudentImport } = await vite.ssrLoadModule("/src/components/StudentImport.jsx");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  const requests = [], downloads = [];
  let refreshed = 0, sectionError = "";
  t.mock.method(axios, "get", async (url, config) => { downloads.push({ url, ...config.params }); return { data: new Blob(["template"]) }; });
  t.mock.method(URL, "createObjectURL", () => "blob:test-template");
  t.mock.method(URL, "revokeObjectURL", () => {});
  t.mock.method(dom.window.HTMLAnchorElement.prototype, "click", () => {});
  t.mock.method(axios, "post", async (url, data) => {
    if (url.endsWith("/sections")) {
      requests.push({ url, data });
      if (sectionError) throw { response: { status: 409, data: { message: sectionError } } };
      return { data: { id: "new-section", name: data.name.trim().replace(/\s+/g, " "), student_count: 0 } };
    }
    const mode = data.get("import_mode");
    requests.push({ url, mode, grade: data.get("grade_level"), sectionId: data.get("section_id"), section: data.get("section_name"), ids: JSON.parse(data.get("subject_ids")), token: data.get("confirmation_token") });
    if (url.endsWith("/preview")) return { data: { mode, grade_level: 7, section_name: data.get("section_name"),
      student_count: 1, new_student_count: 1, existing_student_count: 0, skipped: [], confirmation_token: "review-token",
      rows: [{ row: 9, name: "Maria Santos", registration: "new" }],
    } };
    return { data: { imported_count: 1, message: "Import completed.", issues: [], skipped: [] } };
  });
  const wait = () => new Promise((resolve) => setTimeout(resolve, 0));
  const click = async (text) => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === text);
    assert.ok(button, `Missing button: ${text}`);
    await React.act(async () => { button.click(); await wait(); });
  };
  const change = async (selector, value) => React.act(() => {
    const input = document.querySelector(selector);
    const prototype = input.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
    input.dispatchEvent(new dom.window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
  const choose = async (filename) => React.act(() => {
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["fixture"], filename)] });
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  const mount = async (key, sections = [{ id: "rose", name: "Rose" }, { id: "orchid", name: "Orchid" }]) => {
    await React.act(() => root.render(React.createElement(StudentImport, { key, sections, schoolYearName: "2026–2027", onImported: async () => { refreshed++; } })));
    await click("Start import");
  };

  await t.test("names-only imports need no subject and do not save during review or cancellation", async () => {
    await mount("names");
    assert.ok(document.querySelector('input[type="file"]'));
    assert.equal(document.querySelector("#import-subject"), null);
    assert.doesNotMatch(document.body.textContent, /Students with assessment records|What would you like to import|Create a subject/);
    assert.deepEqual([...document.querySelectorAll("#import-section option")].map((option) => [option.value, option.textContent]), [["", "Choose a registered section"], ["rose", "Rose"], ["orchid", "Orchid"]]);
    await change("#import-grade", "7"); await change("#import-section", "rose");
    assert.equal(document.querySelector("#import-subject"), null);
    await click("Download class template");
    assert.deepEqual(downloads[0], { url: "/api/students/import/template", mode: "names", grade_level: "7", section_id: "rose", section_name: "Rose" });
    await choose("students.xlsm"); assert.match(document.querySelector('[role="alert"]').textContent, /xlsx/);
    await choose("students.xlsx"); await click("Review import");
    assert.equal(requests.length, 1); assert.deepEqual(requests[0].ids, []); assert.equal(requests[0].token, null); assert.equal(requests[0].mode, "names");
    assert.equal(requests[0].sectionId, "rose"); assert.equal(requests[0].section, "Rose");
    assert.match(document.querySelector('[role="region"]').textContent, /2026–2027/);
    assert.equal([...document.querySelectorAll("button")].find((button) => button.textContent === "Confirm and import").disabled, true);
    await click("Back to edit"); assert.equal(requests.length, 1);
    assert.match(document.body.textContent, /Selected file: students.xlsx/);
    await click("Review import");
    await React.act(() => document.querySelector('[role="region"] input[type="checkbox"]').click());
    await click("Confirm and import");
    assert.equal(requests.length, 3); assert.equal(requests[2].url, "/api/students/import"); assert.equal(requests[2].token, "review-token"); assert.equal(refreshed, 1);
  });

  await t.test("no registered sections blocks template download and explains where to add one", async () => {
    await mount("no-sections", []);
    assert.equal(document.querySelectorAll("#import-section option").length, 1);
    assert.match(document.querySelector('[role="status"]').textContent, /Create a section below/);
    await change("#import-grade", "7");
    const previousDownloads = downloads.length;
    await click("Download class template");
    assert.equal(downloads.length, previousDownloads);
    assert.match(document.querySelector('[role="alert"]').textContent, /registered sections/);
  });

  await t.test("imports can register and select a section without importing students until confirmation", async () => {
    requests.length = 0; downloads.length = 0; refreshed = 0;
    await mount("create-section", []);
    await change("#import-grade", "7");
    await click("Section not listed? Create a section");
    await click("Create section");
    assert.equal(requests.length, 0); assert.match(document.querySelector('[role="alert"]').textContent, /Section Name is required/);
    await change("#import-new-section", "  Lily   Class  "); await click("Create section");
    assert.deepEqual(requests, [{ url: "/api/sections", data: { name: "Lily   Class" } }]);
    assert.equal(document.querySelector("#import-section").value, "new-section");
    assert.equal(document.querySelector("#import-section option:checked").textContent, "Lily Class");
    assert.equal(document.querySelector("#import-new-section"), null); assert.equal(document.querySelector('[role="status"]'), null);
    assert.equal(document.querySelector("#import-grade").value, "7"); assert.equal(refreshed, 1);
    await click("Download class template");
    assert.equal(downloads[0].section_id, "new-section"); assert.equal(downloads[0].section_name, "Lily Class");
    await choose("students.xlsx"); await click("Review import");
    assert.equal(requests[1].sectionId, "new-section"); assert.equal(requests[1].section, "Lily Class");
    assert.match(document.querySelector('[role="region"]').textContent, /Lily Class/);
    assert.equal(requests.length, 2);
    await React.act(() => document.querySelector('[role="region"] input[type="checkbox"]').click());
    await click("Confirm and import");
    assert.equal(requests[2].url, "/api/students/import"); assert.equal(requests[2].sectionId, "new-section");
    assert.equal(requests[2].token, "review-token"); assert.equal(refreshed, 2);
  });

  await t.test("failed or cancelled section creation preserves the selected registered section", async () => {
    requests.length = 0; refreshed = 0;
    await mount("duplicate-section");
    await change("#import-section", "rose");
    await click("Section not listed? Create a section"); await change("#import-new-section", "Rose");
    sectionError = "A section with this name already exists.";
    try { await click("Create section"); } finally { sectionError = ""; }
    assert.match(document.querySelector('[role="alert"]').textContent, /already exists/);
    assert.equal(document.querySelector("#import-section").value, "rose");
    assert.equal(document.querySelector("#import-new-section").value, "Rose");
    assert.equal(document.querySelectorAll("#import-section option").length, 3);
    assert.equal(refreshed, 0); assert.equal(requests.length, 1);
    await click("Cancel new section");
    assert.equal(document.querySelector("#import-new-section"), null); assert.equal(requests.length, 1);
    assert.equal(document.querySelector("#import-section").value, "rose");
  });

  await t.test("changing a registered section discards the old review and requires confirmation again", async () => {
    requests.length = 0;
    await mount("change-section");
    await change("#import-grade", "7"); await change("#import-section", "rose");
    await choose("students.xlsx"); await click("Review import");
    await React.act(() => document.querySelector('[role="region"] input[type="checkbox"]').click());
    await click("Back to edit"); await change("#import-section", "orchid");
    assert.equal(document.querySelector('[role="region"]'), null);
    await click("Review import");
    assert.equal(requests[1].sectionId, "orchid"); assert.equal(requests[1].section, "Orchid");
    assert.match(document.querySelector('[role="region"]').textContent, /Orchid/);
    assert.equal([...document.querySelectorAll("button")].find((button) => button.textContent === "Confirm and import").disabled, true);
    assert.ok(requests.every((request) => request.url.endsWith("/preview")));
  });
});
