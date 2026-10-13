import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("first-use tutorial supports completion, account-specific persistence, skipping, and Settings replay", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: SystemTutorial, SettingsView } = await vite.ssrLoadModule("/src/components/SystemTutorial.jsx");
  const { tutorialStorageKey } = await vite.ssrLoadModule("/src/utils/tutorial.js");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });

  function Harness({ userId }) {
    const [replay, setReplay] = React.useState(0);
    return React.createElement(React.Fragment, null,
      React.createElement(SettingsView, { onReplayTutorial: () => setReplay((value) => value + 1) }),
      React.createElement(SystemTutorial, { userId, replayRequest: replay }),
    );
  }
  const button = (label) => [...document.querySelectorAll("button")].find((element) => element.textContent === label);
  const click = (label) => React.act(() => button(label).click());
  const dialog = () => document.querySelector('[role="dialog"]');
  const render = (userId) => React.act(() => root.render(React.createElement(Harness, { userId })));

  await render("teacher-a");
  assert.ok(dialog());
  assert.equal(dialog().getAttribute("aria-modal"), "true");
  assert.equal(button("Back").disabled, true);
  assert.equal(document.activeElement.id, "tutorial-title");
  assert.equal(document.body.style.overflow, "hidden");
  assert.equal(document.getElementById("root").inert, true);
  await click("Next");
  assert.match(dialog().textContent, /Create your sections/);
  await click("Back");
  assert.match(dialog().textContent, /Welcome to EduLITE/);
  await React.act(() => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  assert.equal(document.activeElement.textContent, "Skip tutorial");
  await React.act(() => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
  assert.equal(document.activeElement.textContent, "Next");

  const content = [];
  while (button("Next")) { content.push(dialog().textContent); await click("Next"); }
  assert.ok(content.some((text) => text.includes("Budget of Work")));
  assert.ok(content.some((text) => text.includes("easy, medium, and hard")));
  await click("Finish tutorial");
  assert.equal(dialog(), null);
  assert.equal(localStorage.getItem(tutorialStorageKey("teacher-a")), "done");
  assert.equal(document.body.style.overflow, "");
  assert.equal(Boolean(document.getElementById("root").inert), false);

  await render("teacher-b");
  assert.ok(dialog());
  await React.act(() => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(dialog(), null);
  assert.equal(localStorage.getItem(tutorialStorageKey("teacher-b")), "done");
  await render("teacher-a");
  assert.equal(dialog(), null);
  button("Replay Tutorial").focus();
  await click("Replay Tutorial");
  assert.match(dialog().textContent, /Step 1 of 8/);
  await click("Skip tutorial");
  assert.equal(dialog(), null);
  assert.equal(document.activeElement.textContent, "Replay Tutorial");
  await React.act(() => root.render(null));
  await render("teacher-a");
  assert.equal(dialog(), null);
});
