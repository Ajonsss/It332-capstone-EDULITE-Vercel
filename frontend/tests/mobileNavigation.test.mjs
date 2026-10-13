import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("phone dock exposes three shortcuts and an accessible full navigation list", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><button id="outside">Outside</button></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const mediaListeners = new Set();
  window.matchMedia = () => ({
    matches: true,
    addEventListener: (_, listener) => mediaListeners.add(listener),
    removeEventListener: (_, listener) => mediaListeners.delete(listener),
  });
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: MobileNavigation } = await vite.ssrLoadModule("/src/components/MobileNavigation.jsx");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  const selections = [];
  let logoutCount = 0;
  function Harness() {
    const [view, setView] = React.useState("dashboard");
    return React.createElement(MobileNavigation, {
      activeView: view,
      onNavigate: (next) => { selections.push(next); setView(next); },
      onLogout: () => { logoutCount++; },
    });
  }
  await React.act(() => root.render(React.createElement(Harness)));
  const toggle = () => document.querySelector(".edulite-mobile-view-all");
  const menu = () => document.querySelector('[aria-label="All navigation"]');
  const click = (button) => React.act(() => button.click());
  const quick = [...document.querySelectorAll('[aria-label="Quick navigation"] button')];
  assert.deepEqual(quick.map((button) => button.getAttribute("aria-label")), ["Dashboard", "Records", "AI Insights"]);
  assert.equal(toggle().getAttribute("aria-expanded"), "false");
  assert.equal(menu(), null);
  await click(quick[1]);
  assert.equal(selections.at(-1), "records");
  assert.equal(quick[1].getAttribute("aria-current"), "page");
  await click(quick[2]);
  assert.equal(selections.at(-1), "aiInsights");

  const destinations = [
    ["Dashboard", "dashboard"], ["Sections", "sections"], ["Subjects", "subjects"],
    ["Students", "students"], ["Assessments", "assessments"], ["Records", "records"],
    ["Interventions", "interventions"], ["Year-End & Archives", "yearEnd"],
    ["Awards", "awards"], ["AI Insights", "aiInsights"], ["Settings", "settings"],
  ];
  for (const [label, view] of destinations) {
    await click(toggle());
    assert.equal(toggle().getAttribute("aria-expanded"), "true");
    assert.ok(document.getElementById(toggle().getAttribute("aria-controls")));
    assert.equal(menu().querySelectorAll("button").length, 12);
    const item = [...menu().querySelectorAll("button")].find((button) => button.textContent === label);
    assert.ok(item, `${label} is reachable from View all`);
    await click(item);
    assert.equal(selections.at(-1), view);
    assert.equal(menu(), null);
    assert.equal(document.activeElement, toggle());
  }
  assert.equal(toggle().dataset.active, "true", "View all reflects a page outside the shortcuts");

  await click(toggle());
  assert.equal(document.activeElement.textContent, "Settings");
  await React.act(() => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(menu(), null);
  assert.equal(document.activeElement, toggle());

  await click(toggle());
  await React.act(() => document.getElementById("outside").dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
  assert.equal(menu(), null);
  await click(toggle());
  await React.act(() => document.getElementById("outside").focus());
  assert.equal(menu(), null, "Tabbing away dismisses the nonmodal list");

  await click(toggle());
  await React.act(() => { for (const listener of mediaListeners) listener({ matches: false }); });
  assert.equal(menu(), null, "Moving to desktop closes the mobile list");
  assert.equal(mediaListeners.size, 0);

  await click(toggle());
  await click([...menu().querySelectorAll("button")].find((button) => button.textContent === "Logout"));
  assert.equal(logoutCount, 1);
  assert.equal(menu(), null);
});
