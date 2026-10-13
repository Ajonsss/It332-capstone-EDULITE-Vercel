export const AWARD_TYPES = [
  { value: "excellence", label: "Academic Excellence", minimum: 90 },
  { value: "performance", label: "Performance Recognition", minimum: 75 },
  { value: "improvement", label: "Academic Improvement", minimum: 3 },
];

function officialAverage(student, summaries, term, subjectId) {
  const expected = subjectId === "ALL" ? (student.subject_ids ?? []).map(String) : [String(subjectId)];
  if (!expected.length || (subjectId !== "ALL" && !(student.subject_ids ?? []).map(String).includes(String(subjectId)))) return null;
  const grades = expected.map((id) => {
    const summary = summaries.find((entry) => String(entry.student_id) === String(student.id) && String(entry.subject_id) === id);
    const result = summary?.[`term${term}`];
    const grade = result?.termGrade;
    return result?.isComplete === true && typeof grade === "number" && Number.isFinite(grade) && grade >= 0 && grade <= 100 ? grade : null;
  });
  if (grades.some((grade) => grade === null)) return null;
  return grades.reduce((sum, grade) => sum + grade, 0) / grades.length;
}

export function buildAwardCandidates(students, summaries, { section = "ALL", subjectId = "ALL", term = "1", awardType = "excellence", minimum = 90 } = {}) {
  const numericTerm = Number(term);
  const threshold = Number(minimum);
  const validCriteria = [1, 2, 3].includes(numericTerm) && AWARD_TYPES.some((type) => type.value === awardType) && String(minimum).trim() !== "" && Number.isFinite(threshold) && threshold >= (awardType === "improvement" ? 1 : 0) && threshold <= 100;
  return students.filter((student) => (section === "ALL" || student.section === section) &&
    (subjectId === "ALL" || (student.subject_ids ?? []).map(String).includes(String(subjectId))))
    .map((student) => {
      const grade = officialAverage(student, summaries, numericTerm, subjectId);
      const previousGrade = numericTerm > 1 ? officialAverage(student, summaries, numericTerm - 1, subjectId) : null;
      const improvement = grade !== null && previousGrade !== null ? grade - previousGrade : null;
      let reason = "";
      if (!validCriteria) reason = "Enter valid award criteria.";
      else if (grade === null) reason = "Complete official grades are required for every subject in this scope.";
      else if (awardType === "improvement" && numericTerm === 1) reason = "Choose Term 2 or 3 to compare with the previous term.";
      else if (awardType === "improvement" && previousGrade === null) reason = "The previous term must also have complete official grades.";
      else if ((awardType === "improvement" ? improvement : grade) < threshold) reason = "Below the selected award threshold.";
      return { ...student, awardGrade: grade, previousGrade, improvement, eligible: !reason, reason };
    }).sort((first, second) => Number(second.eligible) - Number(first.eligible) || first.name.localeCompare(second.name));
}
