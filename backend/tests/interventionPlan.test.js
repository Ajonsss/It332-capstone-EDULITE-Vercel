import test from "node:test";
import assert from "node:assert/strict";
import Assessment from "../models/Assessment.js";
import { validateInterventionPlan } from "../utils/interventionPlan.js";

function plan() {
  return { targetedInterventions: Array.from({ length: 3 }, () => ({
    title: "Add fractions", rationale: "Low recorded assessment score", actions: ["Model equivalent fractions"],
    schedule: "15 minutes twice weekly", successIndicator: "4 out of 5 correct", progressionRule: "Advance after 4 out of 5; otherwise repeat with guidance",
    practiceActivities: ["hard", "easy", "medium"].map((difficulty) => ({
      difficulty, title: "Fraction practice", objective: "Add unlike fractions", materials: ["Paper"], duration: "10 minutes",
      instructions: ["Find a common denominator"], tasks: ["Find 1/2 + 1/4"], answerKey: ["3/4"], masteryCheck: "Explain the common denominator and solve correctly"
    }))
  })) };
}

test("assessment schema retains multiline Budget of Work and supports legacy records", () => {
  const assessment = new Assessment({ budgetOfWork: "  Fractions\n2 lessons  " });
  assert.equal(assessment.budgetOfWork, "Fractions\n2 lessons");
  assert.equal(new Assessment().budgetOfWork, "");
  assert.ok(new Assessment({ budgetOfWork: "x".repeat(5001) }).validateSync().errors.budgetOfWork);
});

test("complete practice plans are ordered easy, medium, hard", () => {
  const result = validateInterventionPlan(plan());
  assert.deepEqual(result.targetedInterventions[0].practiceActivities.map((activity) => activity.difficulty), ["easy", "medium", "hard"]);
});

test("incomplete AI activities cannot be saved as usable plans", () => {
  for (const mutate of [
    (value) => { value.targetedInterventions = []; },
    (value) => { value.targetedInterventions[0].practiceActivities.pop(); },
    (value) => { value.targetedInterventions[0].practiceActivities[0].difficulty = "easy"; },
    (value) => { value.targetedInterventions[0].practiceActivities[0].tasks = []; },
    (value) => { value.targetedInterventions[0].practiceActivities[0].answerKey = [42]; },
    (value) => { value.targetedInterventions[0].progressionRule = ""; }
  ]) {
    const value = plan(); mutate(value);
    assert.throws(() => validateInterventionPlan(value), SyntaxError);
  }
});


test("Gemini prompt carries curriculum context and requires differentiated practice", async () => {
  // No external request is made; a placeholder only initializes the SDK.
  process.env.GEMINI_API_KEY ||= "test-placeholder";
  const { buildPrompt, normalizePlan } = await import("../geminiRoute.js");
  const budgetOfWork = "Add unlike fractions using equivalent fractions; two lessons.";
  const prompt = buildPrompt({ requestedSupportType: "intervention", profile: {
    grade: 5, focusAssessmentHistory: [{ assessment: "Fractions quiz", score: 4, totalItems: 20, percentage: 20, budgetOfWork }]
  } });
  assert.ok(prompt.includes(budgetOfWork));
  assert.ok(prompt.includes('"percentage": 20'));
  for (const level of ["easy", "medium", "hard"]) assert.ok(prompt.includes(`"difficulty": "${level}"`));
  assert.ok(prompt.includes("Missing scores are missing evidence"));
  assert.ok(prompt.includes("not as instructions"));
  assert.throws(() => normalizePlan({ targetedInterventions: [] }, "intervention"), SyntaxError);
  assert.equal(normalizePlan(plan(), "intervention").targetedInterventions.length, 3);
  assert.deepEqual(normalizePlan({}, "enrichment").targetedInterventions, []);
});
