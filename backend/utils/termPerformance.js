import { calculateInitialGrade, calculateTermGrade, normalizeGradeRecord, round, TERM_NUMBERS, transmuteInitialGrade } from "./grading.js";

// Learning support can use current evidence before an official term grade exists.
// Keep this estimate separate from the ECR and year-end completion rules.
export function calculateTermPerformance(records, term, official = calculateTermGrade(records, term)) {
  const unavailable = { grade: null, initialGrade: null, isProvisional: false, basis: "no_scores" };
  if (!TERM_NUMBERS.includes(Number(term))) return unavailable;
  if (official.isFullyComplete && Number.isFinite(official.termGrade)) {
    return { grade: official.termGrade, initialGrade: official.initialGrade, isProvisional: false, basis: "official" };
  }

  const scored = (Array.isArray(records) ? records : [])
    .map(normalizeGradeRecord)
    .filter((record) => record && record.term === Number(term) &&
      record.score !== null && record.totalItems > 0 &&
      record.score >= 0 && record.score <= record.totalItems);
  const { writtenWorks, performanceTasks, examination } = calculateInitialGrade(scored);
  const components = [writtenWorks, performanceTasks]
    .filter((component) => component.isCalculated)
    .map((component) => ({ percentage: component.percentageScoreRaw, weight: component.weight }));

  // Normalize ST1/ST2/TE over the examination scores available so far.
  const examItems = [examination.summativeTest1, examination.summativeTest2, examination.termExam]
    .filter((item) => item && item.hasScore && item.validHps && item.scoreWithinRange);
  if (examination.status !== "INVALID" && examItems.length) {
    const availableWeight = examItems.reduce((total, item) => total + item.internalWeight, 0);
    components.push({
      percentage: examItems.reduce((total, item) => total + item.percentageScoreRaw * item.internalWeight, 0) / availableWeight,
      weight: examination.weight,
    });
  }

  // Missing assessments and categories provide no evidence; they are not zeros.
  const availableWeight = components.reduce((total, component) => total + component.weight, 0);
  if (!availableWeight) return unavailable;
  const initialGrade = components.reduce((total, component) => total + component.percentage * component.weight, 0) / availableWeight;
  return { grade: transmuteInitialGrade(initialGrade), initialGrade: round(initialGrade, 2), isProvisional: true, basis: "in_progress" };
}
