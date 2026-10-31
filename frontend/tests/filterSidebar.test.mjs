import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("filter sidebar keeps selections, resets results, and supports modal keyboard navigation", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: FilterSidebar } = await vite.ssrLoadModule("/src/components/FilterSidebar.jsx");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });

  function Harness({ disabled = false }) {
    const [section, setSection] = React.useState("ALL");
    return React.createElement(React.Fragment, null,
      React.createElement("p", { role: "status" }, section === "ALL" ? "All students" : "Rose students"),
      React.createElement(FilterSidebar, { disabled, activeCount: section === "ALL" ? 0 : 1, onReset: () => setSection("ALL") },
        React.createElement("label", null, "Section", React.createElement("select", { value: section, onChange: (event) => setSection(event.target.value) },
          React.createElement("option", { value: "ALL" }, "All sections"),
          React.createElement("option", { value: "Rose" }, "Rose")))));
  }
  const render = (disabled = false) => React.act(() => root.render(React.createElement(Harness, { disabled })));
  const toggle = () => document.querySelector('[aria-label="Open filters and sorting"]');
  const dialog = () => document.querySelector('[role="dialog"]');
  const click = (element) => React.act(() => element.click());
  const button = (text) => [...dialog().querySelectorAll("button")].find((element) => element.textContent === text);
  const key = (key, shiftKey = false) => React.act(() => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));

  await render();
  assert.equal(document.querySelector("select"), null, "controls are hidden until the compact button opens the sidebar");
  assert.equal(toggle().getAttribute("aria-expanded"), "false");
  toggle().focus();
  await click(toggle());
  assert.equal(dialog().id, toggle().getAttribute("aria-controls"));
  assert.equal(dialog().getAttribute("aria-modal"), "true");
  assert.equal(document.getElementById("root").inert, true);
  assert.equal(document.body.style.overflow, "hidden");
  assert.equal(document.activeElement, button("Close"));
  await key("Tab", true);
  assert.equal(document.activeElement, button("Done"));
  await key("Tab");
  assert.equal(document.activeElement, button("Close"));
  assert.equal(button("Reset").disabled, true);

  await React.act(() => {
    const select = dialog().querySelector("select");
    select.value = "Rose";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  assert.equal(document.querySelector('[role="status"]').textContent, "Rose students");
  await click(button("Done"));
  assert.equal(dialog(), null);
  assert.equal(document.body.style.overflow, "");
  assert.equal(document.getElementById("root").inert, undefined);
  assert.equal(document.activeElement, toggle());
  assert.ok(toggle().querySelector('[aria-label="1 active options"]'));

  await click(toggle());
  assert.equal(dialog().querySelector("select").value, "Rose");
  await click(button("Reset"));
  assert.equal(document.querySelector('[role="status"]').textContent, "All students");
  assert.equal(dialog().querySelector("select").value, "ALL");
  await key("Escape");
  assert.equal(dialog(), null);
  assert.equal(document.activeElement, toggle());
  await click(toggle());
  await click(dialog().parentElement);
  assert.equal(dialog(), null, "clicking the overlay dismisses the sidebar");

  await render(true);
  assert.equal(toggle().disabled, true);
  await click(toggle());
  assert.equal(dialog(), null);
});
