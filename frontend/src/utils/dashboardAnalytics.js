import { assessmentIncludesStudent } from "../../../shared/assessmentScope.mjs";
import { parseWholeNumber } from "../../../shared/inputValidation.mjs";
import { buildClassHierarchy } from "./classHierarchy.js";
import { getPerformanceStatus, getTermPerformanceGrade, PERFORMANCE_LEVELS } from "./performance.js";

export const ALL_ASSIGNMENTS = Object.freeze({ grade: "ALL", section: "ALL", subject: "ALL" });

export function buildTeachingAssignments(data) {
  const students = data.students.filter((student) => student.section_id != null);
  // Reporting joins on enrollment and registration IDs within the authorized year.
  return buildClassHierarchy({ ...data, students }).flatMap(({ grade, sections }) =>
    sections.flatMap((section) => {
      const sectionKey = `${grade}:${section.id}`;
      return section.subjects.map((subject) => ({
        id: `${sectionKey}:${subject.id}`, grade, sectionKey,
        sectionId: section.id, sectionName: section.name, subjectId: subject.id, subjectName: subject.name,
        students: [...new Map(subject.students.map((student) => [student.id, student])).values()],
      }));
    }),
  );
}

function optionsFor(assignments, value, label) {
  return [...new Map(assignments.map((assignment) => [value(assignment), label(assignment)]))]
    .map(([value, label]) => ({ value, label }));
}

export function selectTeachingAssignments(assignments, requested) {
  const grades = optionsFor(assignments, (item) => String(item.grade), (item) => `Grade ${item.grade}`);
  const valid = (options, value) => options.some((option) => option.value === value) ? value : "ALL";
  const grade = valid(grades, requested.grade);
  const inGrade = grade === "ALL" ? assignments : assignments.filter((item) => String(item.grade) === grade);
  const sections = optionsFor(inGrade, (item) => item.sectionKey, (item) =>
    grade === "ALL" ? `Grade ${item.grade} · Section ${item.sectionName}` : `Section ${item.sectionName}`);
  const section = valid(sections, requested.section);
  const inSection = section === "ALL" ? inGrade : inGrade.filter((item) => item.sectionKey === section);
  const subjects = optionsFor(inSection, (item) => item.subjectId, (item) => item.subjectName);
  const subject = valid(subjects, requested.subject);
  return {
    selection: { grade, section, subject },
    grades, sections, subjects,
    assignments: subject === "ALL" ? inSection : inSection.filter((item) => item.subjectId === subject),
  };
}

export function indexGradeSummaries(summaries) {
  return new Map(summaries.map((item) => [`${item.student_id}:${item.subject_id}`, item]));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function summarizeAssignment(assignment, summaries, term, passingGrade) {
  const results = assignment.students.map((student) => {
    const summary = summaries.get(`${student.id}:${assignment.subjectId}`)?.[`term${term}`];
    return {
      student, grade: getTermPerformanceGrade(summary),
      isProvisional: Boolean(summary?.performance?.isProvisional),
    };
  });
  const assessed = results.filter((result) => result.grade !== null);
  const below = assessed.filter((result) => result.grade < passingGrade);
  const passingCount = assessed.length - below.length;
  return {
    ...assignment, results, assessed, below, passingCount,
    average: mean(assessed.map((result) => result.grade)),
    passingRate: assessed.length ? passingCount / assessed.length * 100 : null,
    provisionalCount: assessed.filter((result) => result.isProvisional).length,
  };
}

export function summarizeOverview(classes) {
  return {
    gradeLevels: new Set(classes.map((item) => item.grade)).size,
    sections: new Set(classes.map((item) => item.sectionKey)).size,
    students: new Set(classes.flatMap((item) => item.students.map((student) => student.id))).size,
    below: new Set(classes.flatMap((item) => item.below.map(({ student }) => student.id))).size,
  };
}

export function summarizeDistribution(assessed) {
  const counts = new Map();
  for (const { grade } of assessed) {
    const { label } = getPerformanceStatus(grade);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return PERFORMANCE_LEVELS.filter(({ minimum }) => minimum !== null).map(({ label, range, color }) => {
    const count = counts.get(label) ?? 0;
    return { label, range, color, count, percentage: assessed.length ? count / assessed.length * 100 : null };
  });
}

export function listLearningSupport(classes, { passingGrade, highPerformingGrade }) {
  return classes.flatMap((assignment) => assignment.assessed.flatMap((result) => {
    const supportType = result.grade < passingGrade ? "intervention" : result.grade >= highPerformingGrade ? "enrichment" : null;
    return supportType ? [{ ...result, assignment, supportType }] : [];
  })).sort((first, second) => {
    if (first.supportType !== second.supportType) return first.supportType === "intervention" ? -1 : 1;
    const difference = first.grade - second.grade;
    return first.supportType === "intervention" ? difference : -difference;
  });
}

export function indexAssessmentScores(records) {
  return new Map(records.map((record) => [`${record.assessment_id}:${record.student_id}`, record]));
}

function getAssessmentScore(record, totalItems) {
  const score = parseWholeNumber(record?.score);
  const total = parseWholeNumber(totalItems);
  return total > 0 && score >= 0 && score <= total ? score : null;
}

export function summarizeAssessments(assessments, classes, scores, term) {
  const bySubject = new Map();
  for (const item of classes) {
    if (!bySubject.has(item.subjectId)) bySubject.set(item.subjectId, []);
    bySubject.get(item.subjectId).push(item);
  }
  return assessments.filter((assessment) => Number(assessment.term) === Number(term)).flatMap((assessment) => {
    const assignments = (bySubject.get(assessment.subject_id) ?? []).filter((item) =>
      assessmentIncludesStudent(assessment, { grade: item.grade, section_id: item.sectionId }));
    if (!assignments.length) return [];

    const assigned = new Map(assignments.flatMap((item) => item.students.map((student) => [student.id, student])));
    const results = [...assigned.values()].map((student) => {
      const score = getAssessmentScore(scores.get(`${assessment.id}:${student.id}`), assessment.total_items);
      return { student, score, percentage: score === null ? null : score / assessment.total_items * 100 };
    });
    const percentages = results.flatMap(({ percentage }) => percentage === null ? [] : [percentage]);
    return [{ assessment, assignments, results, assessedCount: percentages.length, average: mean(percentages) }];
  }).sort((first, second) => String(second.assessment.date).localeCompare(String(first.assessment.date)));
}

export function buildStudentAssessmentHistory(student, assessments, scores) {
  return assessments.filter((assessment) => student.subject_ids?.includes(assessment.subject_id) &&
    assessmentIncludesStudent(assessment, student)).map((assessment) => {
    const record = scores.get(`${assessment.id}:${student.id}`);
    return {
      ...assessment, id: record?.id ?? assessment.id, assessment_name: assessment.name,
      score: getAssessmentScore(record, assessment.total_items),
    };
  }).sort((first, second) => (first.term ?? 99) - (second.term ?? 99) ||
    String(second.date).localeCompare(String(first.date)));
}
