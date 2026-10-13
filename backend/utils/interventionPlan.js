const LEVELS = ["easy", "medium", "hard"];
const isText = (value) => typeof value === "string" && Boolean(value.trim());
const isTextList = (value) => Array.isArray(value) && value.length > 0 && value.every(isText);

// Reject incomplete AI worksheets rather than saving an unusable support plan.
export function validateInterventionPlan(plan) {
  const interventions = plan?.targetedInterventions;
  if (!Array.isArray(interventions) || interventions.length < 3 || interventions.length > 5) {
    throw new SyntaxError("An intervention plan must contain 3 to 5 interventions.");
  }
  for (const intervention of interventions) {
    if (!["title", "rationale", "schedule", "successIndicator", "progressionRule"].every((key) => isText(intervention?.[key])) || !isTextList(intervention.actions)) {
      throw new SyntaxError("The intervention is missing teacher guidance.");
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
