import test from "node:test";
import assert from "node:assert/strict";
import { generateStudentSupportPlan } from "../services/studentSupportGeneration.js";
import { GoogleGenAI } from "@google/genai";
import { buildGeminiSupportPlanSchema, buildSupportPlanSchema } from "../utils/interventionPlan.js";

function plan() {
  return { title: "Fraction support", overview: "Practice adding fractions based on the supplied quiz.",
    evidence: [{ observation: "Low quiz score", dataPoint: "2 out of 10" }],
    targetedInterventions: Array.from({ length: 3 }, (_, index) => ({
      title: `Fraction practice ${index + 1}`, rationale: "Recorded quiz evidence", actions: ["Model equivalent fractions"], schedule: "Twice weekly", successIndicator: "4 of 5 correct", progressionRule: "Advance after mastery",
      practiceActivities: ["hard", "easy", "medium"].map((difficulty) => ({ difficulty, title: "Add fractions", objective: "Use equivalent fractions", materials: ["Paper"], duration: "10 minutes", instructions: ["Find a common denominator"], tasks: ["Find 1/2 + 1/4"], answerKey: ["3/4"], masteryCheck: "4 of 5 correct" })),
    })), enrichmentActivities: [], monitoringPlan: [{ metric: "Correct answers", frequency: "Weekly", target: "4 of 5" }], teacherNotes: ["Review the curriculum scope"],
  };
}
const response = (value) => ({ text: JSON.stringify(value), candidates: [{ finishReason: "STOP" }] });
function fakeClient(responses) {
  const requests = [];
  return { requests, client: { models: { async generateContent(request) {
    requests.push(request);
    const result = responses.shift();
    if (result instanceof Error) throw result;
    assert.notEqual(result, undefined, "Unexpected extra generation attempt");
    return result;
  } } } };
}
const generate = (client, supportType = "intervention", options = {}) => generateStudentSupportPlan({ client, model: "configured-model", prompt: "Use this synthetic quiz profile only: 2 of 10 on fractions.", supportType, ...options });

const assessmentSources = [
  { assessmentId: "fractions", subjectId: "math", score: 2, budgetOfWork: "Add unlike fractions. Time: 2 lessons." },
  { assessmentId: "unrecorded", subjectId: "math", score: null, budgetOfWork: "Compare unlike fractions." },
  { assessmentId: "no-curriculum", subjectId: "math", score: 3, budgetOfWork: "" },
];
const groundedPlan = () => {
  const value = plan();
  for (const intervention of value.targetedInterventions) Object.assign(intervention, { assessmentIds: ["fractions"], learningFocus: "Add unlike fractions" });
  return value;
};

test("curriculum-based generation requires valid assessment references and an explicit learning focus", async () => {
  const schema = buildSupportPlanSchema("intervention", { assessmentSources }).properties.targetedInterventions.items;
  assert.ok(schema.required.includes("assessmentIds")); assert.ok(schema.required.includes("learningFocus"));
  assert.deepEqual(schema.properties.assessmentIds.items.enum, assessmentSources.map((source) => source.assessmentId));
  const { client, requests } = fakeClient([response(groundedPlan())]);
  const result = await generate(client, "intervention", { assessmentSources });
  assert.equal(requests.length, 1); assert.deepEqual(result.targetedInterventions[0].assessmentIds, ["fractions"]);
});

test("omitted curriculum, invented references and missing-only score evidence regenerate once", async () => {
  for (const patch of [{ assessmentIds: undefined }, { assessmentIds: ["invented"] }, { assessmentIds: ["fractions", "fractions"] }, { assessmentIds: ["unrecorded"] }, { assessmentIds: ["no-curriculum"] }, { learningFocus: "" }]) {
    const invalid = groundedPlan(); Object.assign(invalid.targetedInterventions[0], patch);
    const { client, requests } = fakeClient([response(invalid), response(groundedPlan())]);
    assert.equal((await generate(client, "intervention", { assessmentSources })).targetedInterventions.length, 3);
    assert.equal(requests.length, 2); assert.match(requests[1].contents, /Response validation failed/);
  }
});

test("assessments without Budget of Work still support score-based intervention with a confirmation note", async () => {
  const sources = [{ assessmentId: "fractions", subjectId: "math", score: 2, budgetOfWork: "" }];
  const value = groundedPlan();
  for (const intervention of value.targetedInterventions) intervention.learningFocus = "Confirm fraction competencies with the teacher";
  const { client } = fakeClient([response(value)]);
  assert.equal((await generate(client, "intervention", { assessmentSources: sources })).targetedInterventions.length, 3);
});

test("the application schema describes intervention count and complete differentiated practice", () => {
  const schema = buildSupportPlanSchema("intervention");
  assert.ok(schema.required.includes("targetedInterventions"));
  const interventions = schema.properties.targetedInterventions;
  assert.equal(interventions.minItems, 3); assert.equal(interventions.maxItems, 5);
  const activities = interventions.items.properties.practiceActivities;
  assert.equal(activities.minItems, 3); assert.equal(activities.maxItems, 3);
  assert.deepEqual(activities.items.properties.difficulty.enum, ["easy", "medium", "hard"]);
  for (const key of ["tasks", "answerKey", "instructions", "masteryCheck"]) assert.ok(activities.items.required.includes(key));
  const enrichment = buildSupportPlanSchema("enrichment");
  assert.equal(enrichment.properties.targetedInterventions.maxItems, 0);
  assert.equal(enrichment.properties.enrichmentActivities.minItems, 3);
});

test("valid plans need one request and retain easy-medium-hard ordering", async () => {
  const { client, requests } = fakeClient([response(plan())]);
  const result = await generate(client);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].config.responseMimeType, "application/json");
  assert.equal(requests[0].config.responseJsonSchema.properties.targetedInterventions.type, "array");
  assert.equal(requests[0].config.responseJsonSchema.properties.targetedInterventions.minItems, undefined);
  assert.equal(requests[0].model, "configured-model");
  assert.deepEqual(result.targetedInterventions[0].practiceActivities.map((item) => item.difficulty), ["easy", "medium", "hard"]);
});

test("one-intervention responses automatically regenerate with a precise correction", async () => {
  const incomplete = plan(); incomplete.targetedInterventions.length = 1;
  const { client, requests } = fakeClient([response(incomplete), response(plan())]);
  const result = await generate(client);
  assert.equal(result.targetedInterventions.length, 3); assert.equal(requests.length, 2);
  assert.match(requests[1].contents, /received 1/);
  assert.match(requests[1].contents, /exactly 3 complete targeted interventions/);
  assert.ok(requests[1].contents.includes("synthetic quiz profile"));
});

test("missing lists, invalid JSON, empty output and incomplete practice recover once", async () => {
  const missingTask = plan(); missingTask.targetedInterventions[0].practiceActivities[0].tasks = [];
  const duplicateLevels = plan(); duplicateLevels.targetedInterventions[0].practiceActivities[0].difficulty = "easy";
  for (const invalid of [response({}), { text: "not JSON" }, { text: "" }, response(null), response(missingTask), response(duplicateLevels)]) {
    const { client, requests } = fakeClient([invalid, response(plan())]);
    assert.equal((await generate(client)).targetedInterventions.length, 3);
    assert.equal(requests.length, 2);
  }
});

test("truncated responses retry with more output space instead of accepting a partial plan", async () => {
  const { client, requests } = fakeClient([{ text: JSON.stringify(plan()), candidates: [{ finishReason: "MAX_TOKENS" }] }, response(plan())]);
  await generate(client);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].config.maxOutputTokens > requests[0].config.maxOutputTokens);
  assert.match(requests[1].contents, /cut off/);
});

test("repeated malformed responses stop after two requests with a useful upstream error", async () => {
  const { client, requests } = fakeClient([response({}), response({})]);
  await assert.rejects(generate(client), (error) => error.code === "GEMINI_INVALID_RESPONSE" && /after two attempts/.test(error.message) && error.cause instanceof SyntaxError);
  assert.equal(requests.length, 2);
});

test("API failures and blocked responses are not retried", async () => {
  const apiError = new Error("Rate limit reached"); apiError.status = 429;
  const quota = fakeClient([apiError]);
  await assert.rejects(generate(quota.client), (error) => error === apiError);
  assert.equal(quota.requests.length, 1);
  for (const blocked of [{ candidates: [{ finishReason: "SAFETY" }] }, { promptFeedback: { blockReason: "SAFETY" } }]) {
    const { client, requests } = fakeClient([blocked]);
    await assert.rejects(generate(client), (error) => error.code === "GEMINI_GENERATION_BLOCKED");
    assert.equal(requests.length, 1);
  }
});

test("enrichment requests use their own schema and still accept JSON code fences", async () => {
  const value = plan(); value.targetedInterventions = [];
  value.enrichmentActivities = Array.from({ length: 3 }, () => ({ title: "Explore fractions", description: "Compare methods", implementation: "Create examples", expectedOutcome: "Explain equivalent fractions" }));
  const { client, requests } = fakeClient([{ text: `\u0060\u0060\u0060json\n${JSON.stringify(value)}\n\u0060\u0060\u0060` }]);
  assert.equal((await generate(client, "enrichment")).enrichmentActivities.length, 3);
  assert.equal(requests[0].config.responseJsonSchema.properties.enrichmentActivities.type, "array");
});

test("the Gemini schema stays compact for large class histories and retains required curriculum fields", () => {
  const large = Array.from({ length: 1000 }, (_, index) => ({ assessmentId: index.toString(16).padStart(24, "0") }));
  const schema = buildGeminiSupportPlanSchema("intervention", { assessmentSources });
  assert.deepEqual(schema, buildGeminiSupportPlanSchema("intervention", { assessmentSources: large }));
  assert.ok(schema.properties.targetedInterventions.items.required.includes("learningFocus"));
  assert.ok(schema.properties.targetedInterventions.items.required.includes("assessmentIds"));
  const check = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["minItems", "maxItems", "enum", "additionalProperties"].includes(key), `Unexpected transport constraint: ${key}`);
      check(child);
    }
  };
  check(schema);
});

test("the real Google SDK serializes the compact request and source validation still rejects invented IDs", async (t) => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.match(String(url), /^https:\/\/generativelanguage.googleapis.com\//);
    const body = JSON.parse(init.body); bodies.push(body);
    assert.deepEqual(body.generationConfig.responseJsonSchema, buildGeminiSupportPlanSchema("intervention", { assessmentSources }));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    const value = groundedPlan();
    if (bodies.length === 1) value.targetedInterventions[0].assessmentIds = ["invented"];
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const client = new GoogleGenAI({ apiKey: "synthetic-test-key" });
  const result = await generate(client, "intervention", { assessmentSources });
  assert.equal(bodies.length, 2); assert.deepEqual(result.targetedInterventions[0].assessmentIds, ["fractions"]);
  assert.match(bodies[1].contents[0].parts[0].text, /validation failed/);
});

test("compact output still requires 3 to 5 complete enrichment activities before saving", async () => {
  const valid = plan(); valid.targetedInterventions = [];
  valid.enrichmentActivities = Array.from({ length: 3 }, () => ({ title: "Explore fractions", description: "Compare methods", implementation: "Create examples", expectedOutcome: "Explain equivalent fractions" }));
  for (const activities of [[], valid.enrichmentActivities.slice(0, 1), Array(6).fill(valid.enrichmentActivities[0]), [{ title: "Incomplete" }, {}, {}]]) {
    const { client, requests } = fakeClient([response({ ...valid, enrichmentActivities: activities }), response(valid)]);
    assert.equal((await generate(client, "enrichment")).enrichmentActivities.length, 3);
    assert.equal(requests.length, 2);
  }
});
