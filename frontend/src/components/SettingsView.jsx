import TeacherSettings from "./TeacherSettings";
import { useTheme } from "../utils/theme";

const OPTIONS = [
  { value: "light", label: "Light", description: "Bright surfaces and a clean daytime look.", background: "#f4f7fa", surface: "#ffffff", line: "#d8e1e7", ink: "#52616d" },
  { value: "dark", label: "Dark", description: "Soft charcoal surfaces for comfortable viewing.", background: "#101820", surface: "#19232e", line: "#344454", ink: "#bccbd9" },
  { value: "amoled", label: "AMOLED", description: "True black backgrounds for OLED and AMOLED displays.", background: "#000000", surface: "#000000", line: "#303030", ink: "#c5c5c5" },
  { value: "ocean", label: "Ocean", description: "Cool blue surfaces with deep ocean accents.", background: "#edf5ff", surface: "#ffffff", line: "#c6daf2", ink: "#365777", accent: "#2563b5" },
  { value: "forest", label: "Forest", description: "Fresh green tones inspired by nature.", background: "#eef6f0", surface: "#ffffff", line: "#c8dfce", ink: "#375c45", accent: "#287348" },
  { value: "lavender", label: "Lavender", description: "Soft violet surfaces and purple accents.", background: "#f5f1fc", surface: "#ffffff", line: "#ddcfef", ink: "#605077", accent: "#7651ab" },
  { value: "rose", label: "Rose", description: "Gentle pink surfaces with berry accents.", background: "#fff1f5", surface: "#ffffff", line: "#efceda", ink: "#774b5e", accent: "#ad3d69" },
  { value: "sunset", label: "Sunset", description: "Warm peach surfaces and terracotta accents.", background: "#fff5eb", surface: "#ffffff", line: "#edd3b9", ink: "#78543d", accent: "#a95124" },
];

export default function SettingsView({ onReplayTutorial, teacherTools = false }) {
  const [theme, changeTheme] = useTheme();
  return (
    <div className="max-w-4xl space-y-6">
      {teacherTools && <TeacherSettings />}
      <section className="rounded-[22px] border border-[var(--ed-border)] bg-[var(--ed-surface)] p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--ed-accent-text)]">Personalize your workspace</p>
        <h2 className="mt-2 text-xl font-bold text-[var(--ed-text)]">Appearance</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ed-muted)]">Choose your theme. Changes apply immediately and are remembered in this browser.</p>
        <fieldset className="mt-6">
          <legend className="sr-only">Color theme</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            {OPTIONS.map((option) => (
              <label key={option.value} className={`relative cursor-pointer rounded-2xl border-2 p-3 transition-colors hover:border-[var(--ed-primary)] ${theme === option.value ? "border-[var(--ed-primary)] bg-[var(--ed-accent-soft)]" : "border-[var(--ed-border)] bg-[var(--ed-surface)]"}`}>
                <input type="radio" aria-label={option.label} name="color-theme" value={option.value} checked={theme === option.value} onChange={() => changeTheme(option.value)} className="peer sr-only" />
                <span className="pointer-events-none absolute inset-0 rounded-2xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[var(--ed-primary)]" />
                <div aria-hidden="true" className="flex h-28 gap-2 overflow-hidden rounded-xl border p-2" style={{ background: option.background, borderColor: option.line }}>
                  <div className="w-7 rounded-md border" style={{ background: option.surface, borderColor: option.line }} />
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="h-2 w-1/2 rounded-full" style={{ background: option.accent ?? "#36A9E1" }} />
                    <div className="flex flex-1 gap-2">
                      {[0, 1].map((item) => <div key={item} className="flex-1 rounded-md border p-2" style={{ background: option.surface, borderColor: option.line }}><div className="h-1.5 w-3/4 rounded-full" style={{ background: option.ink }} /><div className="mt-2 h-1 w-1/2 rounded-full" style={{ background: option.line }} /></div>)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-[var(--ed-text)]">{option.label}</span>
                  <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${theme === option.value ? "border-[var(--ed-primary)] bg-[var(--ed-primary)] text-white" : "border-[var(--ed-border)]"}`}>{theme === option.value ? "✓" : ""}</span>
                </div>
                <span className="mt-1 block text-xs leading-5 text-[var(--ed-muted)]">{option.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>
      <section className="flex flex-col justify-between gap-5 rounded-[22px] border border-[var(--ed-border)] bg-[var(--ed-surface)] p-6 sm:flex-row sm:items-center sm:p-8">
        <div>
          <h2 className="text-xl font-bold text-[var(--ed-text)]">Getting started</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--ed-muted)]">Revisit the step-by-step guide to class setup, assessments, and AI learning support.</p>
        </div>
        <button type="button" onClick={onReplayTutorial} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--ed-accent-border)] bg-[var(--ed-accent-soft)] px-5 py-3 text-sm font-semibold text-[var(--ed-accent-text)] transition-colors hover:bg-[var(--ed-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ed-primary)]">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></svg>
          Replay Tutorial
        </button>
      </section>
    </div>
  );
}
