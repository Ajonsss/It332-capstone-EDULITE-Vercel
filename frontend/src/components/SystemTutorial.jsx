import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { tutorialStorageKey } from "../utils/tutorial";

const STEPS = [
  {
    title: "Welcome to EduLITE",
    page: "Dashboard",
    description: "Follow this guide to set up your class and turn assessment results into learning support.",
    instructions: [
      "Use the navigation on the left to open each part of the system. Select the EL button to expand or collapse it.",
      "Choose or create the school year in Settings first, then set up Sections and Subjects, register students, create assessments, and review results.",
      "Use section, subject, and term filters to focus on the class and grading period you want to review.",
    ],
    tip: "You can skip this guide at any time and replay it from Settings.",
  },
  {
    title: "Create your sections",
    page: "Sections",
    description: "Set up the class sections you will use when registering students.",
    instructions: [
      "Open Sections from the navigation.",
      "Enter a section name, such as Rose or Grade 7-A, and select Add Section.",
      "Repeat for each class section you teach. These sections will be available in student forms and filters.",
    ],
  },
  {
    title: "Add your subjects",
    page: "Subjects",
    description: "Create the subjects that will contain your students and assessments.",
    instructions: [
      "Open Subjects and enter a subject name, such as Mathematics.",
      "Select Choose students, select any registered students to enroll, then select Create subject. For a new class, leave the selection empty and create the subject.",
      "For a new class, create the subject first and select it when registering students. Repeat for your other subjects.",
    ],
  },
  {
    title: "Register or import students",
    page: "Students",
    description: "Add your learners and connect them to the right sections and subjects.",
    instructions: [
      "Open Students and select Register Student.",
      "Enter the student's name and grade, choose a section, select their subjects, and save the student.",
      "To add a class in bulk, use the Excel import option in Students. Download the template, fill in its columns, select the subjects, and upload the file.",
      "Review the import results and correct any reported rows before uploading again.",
    ],
  },
  {
    title: "Create an assessment",
    page: "Assessments",
    description: "Record what was assessed so both grades and AI learning support have useful context.",
    instructions: [
      "Open Assessments and select Create Assessment.",
      "Enter the assessment name and Budget of Work. Describe the topics, learning competencies, objectives, and time allocation covered.",
      "Choose the subject, grading term, ECR component, and available ECR slot. Set the date and Highest Possible Score.",
      "Enter each student's score and save. Use 0 for an actual zero score; leave a score blank if it has not been recorded yet.",
    ],
    tip: "A detailed Budget of Work helps AI target practice to the assessed learning scope.",
  },
  {
    title: "Review and update results",
    page: "Records & Dashboard",
    description: "Check scores and follow student progress within the correct grading period.",
    instructions: [
      "Open Records and choose your section, subject, and term filters.",
      "Search for a student or filter by performance level. Select a student to open their assessment record.",
      "Use the score editing controls to update results, then save or cancel before changing filters.",
      "Return to Dashboard to review class summaries. Complete the required assessment data, including the Term Examination score, to calculate official term grades.",
    ],
    tip: "Missing scores are incomplete data, not zero marks.",
  },
  {
    title: "Generate learning support",
    page: "AI Insights",
    description: "Use assessment evidence to plan appropriate intervention or enrichment.",
    instructions: [
      "Open AI Insights and choose the section, subject, and term you want to review.",
      "Select Generate for a student in the intervention or enrichment group. Official term grades must be available before generating a plan.",
      "Review the evidence and recommendations. Intervention plans include easy, medium, and hard activities with tasks, answer keys, mastery checks, and progression guidance.",
      "Choose an appropriate starting activity for the student and check mastery before advancing. Download the PDF or reopen saved insights from the student's record.",
    ],
    tip: "Review the AI plan against your curriculum and your knowledge of the student before using it.",
  },
  {
    title: "You're ready to begin",
    page: "Settings",
    description: "Start with your sections and subjects, then work through the student and assessment steps.",
    instructions: [
      "For printable recognition, open Awards, choose grade or improvement criteria, select eligible recipients, fill in the certificate details, and create a preview before printing.",
      "Use Interventions to assign practice and record completion, baseline scores, and follow-up results. Saved awards can be reopened from Award history.",
      "At the end of the school year, open Year-End & Archives to review readiness and intervention needs. Finish a student only after reviewing complete results; their year-end record remains available in Archives.",
      "Settings also contains grading rules, private recovery-code generation, backups, and change history. Save a recovery code and download a backup before major year-end changes.",
      "Open Settings whenever you need a refresher.",
      "Select Replay Tutorial to restart this walkthrough from the beginning.",
    ],
    tip: "Finishing or skipping this tutorial saves your preference for this account in this browser.",
  },
];

export default function SystemTutorial({ userId, replayRequest = 0 }) {
  return userId ? <TutorialSession key={`${userId}:${replayRequest}`} userId={userId} replay={replayRequest > 0} /> : null;
}

function TutorialSession({ userId, replay }) {
  const [step, setStep] = useState(() => {
    if (replay) return 0;
    try { return localStorage.getItem(tutorialStorageKey(userId)) === "done" ? null : 0; }
    catch { return 0; }
  });

  const close = () => {
    try { localStorage.setItem(tutorialStorageKey(userId), "done"); } catch { /* Tutorial remains usable without storage. */ }
    setStep(null);
  };

  return step === null ? null : <TutorialDialog step={step} setStep={setStep} onClose={close} />;
}

function TutorialDialog({ step, setStep, onClose }) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const siblings = [...document.body.children].filter((element) => !element.contains(dialogRef.current));
    const previousInert = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    document.body.style.overflow = "hidden";
    const handleKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const buttons = [...dialogRef.current.querySelectorAll("button:not(:disabled)")];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !buttons.includes(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      siblings.forEach((element, index) => { element.inert = previousInert[index]; });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  useEffect(() => { titleRef.current?.focus(); }, [step]);

  const content = STEPS[step];
  const lastStep = step === STEPS.length - 1;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#25313C]/50 p-3 backdrop-blur-sm sm:p-6">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="tutorial-title" aria-describedby="tutorial-description" className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-[24px] bg-[var(--ed-surface)] p-5 shadow-2xl sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--ed-color-168cc8)]">Getting started · Step {step + 1} of {STEPS.length}</p>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[var(--ed-color-71808d)] hover:bg-[var(--ed-color-f4f7fa)]">Skip tutorial</button>
        </div>
        <progress aria-label="Tutorial progress" value={step + 1} max={STEPS.length} className="mt-4 h-2 w-full accent-[var(--ed-primary)]" />
        <p className="mt-5 text-sm font-semibold text-[var(--ed-color-168cc8)]">{content.page}</p>
        <h2 ref={titleRef} tabIndex={-1} id="tutorial-title" className="mt-2 text-2xl font-bold text-[var(--ed-color-25313c)] outline-none">{content.title}</h2>
        <p id="tutorial-description" className="mt-3 text-sm leading-6 text-[var(--ed-color-71808d)]">{content.description}</p>
        <ol className="mt-5 list-decimal space-y-3 pl-6 text-sm leading-6 text-[var(--ed-color-52616d)]">
          {content.instructions.map((instruction) => <li key={instruction} className="pl-1">{instruction}</li>)}
        </ol>
        {content.tip && <p className="mt-5 rounded-xl bg-[var(--ed-color-eaf6fc)] p-4 text-sm leading-6 text-[var(--ed-color-52616d)]">{content.tip}</p>}
        <div className="mt-7 flex items-center justify-between gap-3 border-t border-[var(--ed-color-eef2f5)] pt-5">
          <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className="rounded-xl border border-[var(--ed-color-d8e1e7)] px-5 py-3 text-sm font-semibold text-[var(--ed-color-52616d)] disabled:opacity-40">Back</button>
          <button type="button" onClick={() => lastStep ? onClose() : setStep(step + 1)} className="rounded-xl bg-[var(--ed-primary)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)]">{lastStep ? "Finish tutorial" : "Next"}</button>
        </div>
      </section>
    </div>, document.body,
  );
}

export { default as SettingsView } from "./SettingsView";
