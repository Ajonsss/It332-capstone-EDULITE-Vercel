// Preserve the teacher's curriculum text with the score it describes. Records
// have already been scoped to the learner's sections, term and selected subject.
export function buildInterventionSources(records) {
  return records.map((record) => ({
    assessmentId: String(record.assessment_id),
    assessment: record.assessment_name,
    subjectId: record.subject_id,
    subject: record.subject_name,
    term: record.term,
    score: record.score ?? null,
    totalItems: record.total_items,
    percentage: record.percentage ?? null,
    budgetOfWork: typeof record.budget_of_work === "string" ? record.budget_of_work.trim() : "",
  })).sort((first, second) => {
    const firstRecorded = first.score !== null, secondRecorded = second.score !== null;
    return Number(secondRecorded) - Number(firstRecorded) ||
      (first.percentage ?? Infinity) - (second.percentage ?? Infinity) ||
      first.assessmentId.localeCompare(second.assessmentId);
  });
}

export function attachInterventionBasis(plan, sources) {
  const byId = new Map(sources.map((source) => [source.assessmentId, source]));
  for (const intervention of plan.targetedInterventions) {
    // These details come from saved assessments, rather than AI-written quotes.
    intervention.curriculumBasis = (intervention.assessmentIds ?? []).filter((id) => byId.has(id)).map((id) => ({ ...byId.get(id) }));
  }
  if (!sources.some((source) => source.budgetOfWork)) {
    plan.teacherNotes.push("Budget of Work is unavailable for the assessments in this focus. Confirm the topics and competencies with the teacher before using the proposed practice activities.");
  }
  return plan;
}
