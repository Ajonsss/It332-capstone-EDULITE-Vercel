import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("Settings applies and remembers Light, Dark, and true-black AMOLED themes", async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const vite = await createServer({ server: { middlewareMode: true, ws: false, hmr: false }, appType: "custom" });
  const { default: SettingsView } = await vite.ssrLoadModule("/src/components/SettingsView.jsx");
  const theme = await vite.ssrLoadModule("/src/utils/theme.js");
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(() => root.unmount()); await vite.close(); dom.window.close(); });
  const style = document.createElement("style");
  style.textContent = (await readFile(new URL("../src/index.css", import.meta.url), "utf8")).replace('@import "tailwindcss";', "");
  document.head.appendChild(style);
  let replays = 0;
  theme.initializeTheme();
  await React.act(() => root.render(React.createElement(SettingsView, { onReplayTutorial: () => replays++ })));
  const radio = (value) => document.querySelector(`input[value="${value}"]`);
  const palette = (name) => window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  assert.equal(radio("light").checked, true);
  assert.equal(palette("--ed-surface"), "#ffffff");
  for (const selected of [...theme.THEMES.filter((value) => value !== "light"), "light"]) {
    await React.act(() => radio(selected).click());
    assert.equal(document.documentElement.dataset.theme, selected);
    assert.equal(localStorage.getItem(theme.THEME_KEY), selected);
    assert.equal(document.documentElement.style.colorScheme, ["dark", "amoled"].includes(selected) ? "dark" : "light");
    assert.equal(radio(selected).checked, true);
    assert.equal([...document.querySelectorAll('input[type="radio"]')].filter((input) => input.checked).length, 1);
    if (selected === "amoled") {
      assert.equal(palette("--ed-page"), "#000000");
      assert.equal(palette("--ed-surface"), "#000000");
    }
    if (["ocean", "forest", "lavender", "rose", "sunset"].includes(selected)) {
      assert.equal(palette("--ed-surface"), "#ffffff");
      assert.notEqual(palette("--ed-primary"), "#36a9e1");
      assert.notEqual(palette("--ed-page"), "#f4f7fa");
      document.documentElement.dataset.theme = "light";
      theme.initializeTheme();
      assert.equal(document.documentElement.dataset.theme, selected);
    }
    if (selected === "dark") assert.equal(palette("--ed-surface"), "#19232e");
  }
  await React.act(() => theme.setTheme("amoled"));
  document.documentElement.dataset.theme = "light";
  theme.initializeTheme();
  assert.equal(document.documentElement.dataset.theme, "amoled");
  await React.act(() => {
    localStorage.setItem(theme.THEME_KEY, "dark");
    window.dispatchEvent(new dom.window.StorageEvent("storage", { key: theme.THEME_KEY, newValue: "dark" }));
  });
  assert.equal(radio("dark").checked, true);
  assert.equal(document.documentElement.dataset.theme, "dark");
  await React.act(() => {
    localStorage.setItem(theme.THEME_KEY, "invalid");
    window.dispatchEvent(new dom.window.StorageEvent("storage", { key: theme.THEME_KEY, newValue: "invalid" }));
  });
  assert.equal(radio("light").checked, true);
  const replay = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Replay Tutorial"));
  await React.act(() => replay.click());
  assert.equal(replays, 1);
});
