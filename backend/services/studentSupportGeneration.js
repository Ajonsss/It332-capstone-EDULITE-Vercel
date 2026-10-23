import { buildGeminiSupportPlanSchema, validateEnrichmentPlan, validateInterventionPlan } from "../utils/interventionPlan.js";

function responseError(code, message, cause) {
  const error = new Error(message, { cause });
  error.code = code;
  return error;
}

function parsePlan(response, supportType, assessmentSources) {
  const finishReason = response?.candidates?.[0]?.finishReason;
  if (response?.promptFeedback?.blockReason || (finishReason && !["STOP", "MAX_TOKENS", "FINISH_REASON_UNSPECIFIED"].includes(finishReason))) {
    throw responseError("GEMINI_GENERATION_BLOCKED", "Gemini could not complete this recommendation. No plan was saved.");
  }
  if (finishReason === "MAX_TOKENS") throw new SyntaxError("The response was cut off before the complete plan was generated.");
  const text = response?.text;
  if (typeof text !== "string" || !text.trim()) throw new SyntaxError("Gemini returned an empty response.");
  let parsed;
  try { parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()); }
  catch (error) { throw new SyntaxError("Gemini returned malformed JSON.", { cause: error }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError("The plan must be a JSON object.");
  if (supportType === "intervention") validateInterventionPlan(parsed, { assessmentSources });
  else validateEnrichmentPlan(parsed);
  return parsed;
}

export async function generateStudentSupportPlan({ client, model, prompt, supportType, assessmentSources = [] }) {
  let validationError;
  // Retry malformed content once. API/auth/quota errors and blocked generations
  // propagate immediately, rather than spending another request on the same error.
  for (let attempt = 0; attempt < 2; attempt++) {
    const correction = attempt ? `\n\nResponse validation failed: ${validationError.message}\nGenerate the complete plan again from the academic profile above. Return exactly 3 complete ${supportType === "intervention" ? "targeted interventions, each with easy, medium, and hard practice" : "enrichment activities"}. Keep wording concise while including every required field. Missing scores remain missing evidence; do not invent student results.` : "";
    const response = await client.models.generateContent({ model, contents: prompt + correction,
      config: { responseMimeType: "application/json", responseJsonSchema: buildGeminiSupportPlanSchema(supportType, { assessmentSources }), maxOutputTokens: attempt ? 32768 : 16384 },
    });
    try { return parsePlan(response, supportType, assessmentSources); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      validationError = error;
    }
  }
  throw responseError("GEMINI_INVALID_RESPONSE", `Gemini could not produce a complete ${supportType} plan after two attempts. Please try again. No plan was saved.`, validationError);
}
