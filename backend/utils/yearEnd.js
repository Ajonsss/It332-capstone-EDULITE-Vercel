import { currentRules } from "../services/academicContext.js";

export function classifyYearEnd(subjects) {
  const rules = currentRules();
  const failedSubjects = subjects.filter((subject) => typeof subject.final?.finalGrade === "number" && Number.isFinite(subject.final.finalGrade) && subject.final.finalGrade < rules.passingGrade).map((subject) => subject.name);
  const pendingSubjects = subjects.filter((subject) => (rules.requireCompleteScores ? subject.final?.isFullyComplete !== true : subject.final?.isComplete !== true) || typeof subject.final?.finalGrade !== "number" || !Number.isFinite(subject.final.finalGrade)).map((subject) => subject.name);
  const complete = subjects.length > 0 && pendingSubjects.length === 0;
  const average = complete ? subjects.reduce((sum, subject) => sum + subject.final.finalGrade, 0) / subjects.length : null;
  const needsIntervention = rules.requireAllSubjectsPassing ? failedSubjects.length > 0 : average < rules.passingGrade;
  const status = !complete ? "pending" : needsIntervention ? "intervention" : "ready";
  return { status, complete, failedSubjects, pendingSubjects, rules,
    finalAverage: average,
    recommendation: status === "ready" ? "Ready for teacher review: promotion or graduation" : status === "intervention" ? "Further intervention needed" : "Complete missing year-end results first",
  };
}

export function validateFinishDecision(report, body) {
  if (!report.complete) return "Complete all three terms and assessment scores before finishing this student.";
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Submit the finishing details as an object.";
  if (typeof body.school_year !== "string" || !body.school_year.trim() || body.school_year.length > 40 || /[\p{Cc}\p{Cf}]/u.test(body.school_year)) return "Enter a school year of at most 40 characters.";
  if (!["promoted", "graduated", "intervention"].includes(body.outcome)) return "Choose promotion, graduation, or further intervention.";
  if (report.status !== "ready" && body.outcome !== "intervention") return "Students with failing subjects need further intervention before promotion or graduation.";
  if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 2000 || /[\p{Cf}\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(body.notes))) return "Teacher notes must be text of at most 2000 characters.";
  return null;
}
