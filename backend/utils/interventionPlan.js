const LEVELS = ["easy", "medium", "hard"];
const isText = (value) => typeof value === "string" && Boolean(value.trim());
const isTextList = (value) => Array.isArray(value) && value.length > 0 && value.every(isText);

const text = { type: "string", description: "Non-empty text." };
const textList = { type: "array", minItems: 1, items: text };
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

// Complete application contract; use the compact transport schema with Gemini.
export function buildSupportPlanSchema(supportType, { assessmentSources = [] } = {}) {
  const intervention = object({ title: text, rationale: text, actions: textList, schedule: text,
    successIndicator: text, progressionRule: text,
    ...(assessmentSources.length ? {
      assessmentIds: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", enum: assessmentSources.map((source) => source.assessmentId) }, description: "Saved assessments supporting this intervention. Use their Budget of Work as the curriculum basis." },
      learningFocus: { type: "string", description: "The topic or competency from the referenced Budget of Work targeted by the practice activities. If unavailable, state that teacher confirmation is needed." },
    } : {}),
    practiceActivities: { type: "array", minItems: 3, maxItems: 3,
      items: object({ difficulty: { type: "string", enum: LEVELS, description: "Use easy, medium, or hard, once each and in that order." }, title: text, objective: text,
        materials: textList, duration: text, instructions: textList, tasks: textList, answerKey: textList, masteryCheck: text }),
    },
  });
  const isIntervention = supportType === "intervention";
  return object({ title: text, overview: text,
    evidence: { type: "array", minItems: 1, items: object({ observation: text, dataPoint: text }) },
    targetedInterventions: { type: "array", minItems: isIntervention ? 3 : 0, maxItems: isIntervention ? 5 : 0, items: intervention },
    enrichmentActivities: { type: "array", minItems: isIntervention ? 0 : 3, maxItems: isIntervention ? 0 : 5,
      items: object({ title: text, description: text, implementation: text, expectedOutcome: text }),
    },
    monitoringPlan: { type: "array", minItems: 1, items: object({ metric: text, frequency: text, target: text }) },
    teacherNotes: { type: "array", items: text },
  });
}

// Gemini can reject the combination of nested array bounds and assessment-ID
// enums with a generic 400 INVALID_ARGUMENT. Send only the output structure;
// keep counts, difficulty levels and source checks in our runtime validators.
export function buildGeminiSupportPlanSchema(supportType, options = {}) {
  const compact = (value) => {
    if (Array.isArray(value)) return value.map(compact);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["minItems", "maxItems", "enum", "additionalProperties"].includes(key))
      .map(([key, child]) => [key, compact(child)]));
  };
  return compact(buildSupportPlanSchema(supportType, options));
}

export function validateEnrichmentPlan(plan) {
  const activities = plan?.enrichmentActivities;
  if (!Array.isArray(activities) || activities.length < 3 || activities.length > 5 ||
      activities.some((activity) => !["title", "description", "implementation", "expectedOutcome"].every((key) => isText(activity?.[key])))) {
    throw new SyntaxError("An enrichment plan must contain 3 to 5 complete enrichment activities with a title, description, implementation, and expectedOutcome.");
  }
  return plan;
}

// Reject incomplete AI worksheets rather than saving an unusable support plan.
export function validateInterventionPlan(plan, { assessmentSources = [] } = {}) {
  const interventions = plan?.targetedInterventions;
  if (!Array.isArray(interventions) || interventions.length < 3 || interventions.length > 5) {
    throw new SyntaxError(`An intervention plan must contain 3 to 5 interventions (received ${Array.isArray(interventions) ? interventions.length : "a missing or invalid list"}).`);
  }
  for (const intervention of interventions) {
    if (!["title", "rationale", "schedule", "successIndicator", "progressionRule"].every((key) => isText(intervention?.[key])) || !isTextList(intervention.actions)) {
      throw new SyntaxError("The intervention is missing teacher guidance.");
    }
    if (assessmentSources.length) {
      const ids = intervention.assessmentIds;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || new Set(ids).size !== ids.length || ids.some((id) => !assessmentSources.some((source) => source.assessmentId === id))) {
        throw new SyntaxError("Each intervention must reference 1 to 3 unique assessmentIds from interventionAssessmentSources in the academic profile.");
      }
      if (!isText(intervention.learningFocus)) throw new SyntaxError("Each intervention must include a learningFocus tied to the referenced Budget of Work, or state that teacher confirmation is needed when it is unavailable.");
      const referenced = assessmentSources.filter((source) => ids.includes(source.assessmentId));
      if (assessmentSources.some((source) => source.score !== null) && !referenced.some((source) => source.score !== null)) {
        throw new SyntaxError("Base each intervention on at least one recorded score. Unrecorded assessments may supply curriculum context but do not demonstrate a weakness.");
      }
      for (const subjectId of new Set(referenced.map((source) => source.subjectId))) {
        if (assessmentSources.some((source) => source.subjectId === subjectId && source.budgetOfWork) && !referenced.some((source) => source.subjectId === subjectId && source.budgetOfWork)) {
          throw new SyntaxError("Reference a provided Budget of Work for the intervention's subject as well as its score evidence. Do not omit available curriculum context.");
        }
      }
    }
    const activities = intervention.practiceActivities;
    if (!Array.isArray(activities) || activities.length !== 3) {
      throw new SyntaxError("Each intervention needs easy, medium, and hard practice.");
    }
    for (const level of LEVELS) {
      const matching = activities.filter((activity) => activity?.difficulty === level);
      if (matching.length !== 1) throw new SyntaxError("Practice levels must be unique and complete.");
      const activity = matching[0];
      if (!["title", "objective", "duration", "masteryCheck"].every((key) => isText(activity[key])) ||
          !["materials", "instructions", "tasks", "answerKey"].every((key) => isTextList(activity[key]))) {
        throw new SyntaxError("Practice activities need complete tasks, steps, and assessment criteria.");
      }
    }
    intervention.practiceActivities = LEVELS.map((level) => activities.find((activity) => activity.difficulty === level));
  }
  return plan;
}
