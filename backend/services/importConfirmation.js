import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { StudentImportError, studentImportKey } from "../utils/studentImport.js";

const testSecret = randomBytes(32).toString("hex");
const audience = "edulite-student-import-confirmation";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sorted = (rows) => [...rows].sort((a, b) => String(a._id).localeCompare(String(b._id)));

export function importReview({ students, grades, skipped, subjects, sections, existingStudents, gradePlans, mode }) {
  const sectionNames = new Map(sections.map((section) => [String(section._id), section.name]));
  const existingKeys = new Set(existingStudents.map((student) => studentImportKey({ ...student, section: sectionNames.get(String(student.sectionId)) ?? "" })));
  const gradeByKey = new Map(grades.map((entry) => [entry.studentKey, entry]));
  const rows = students.map((student) => {
    const key = studentImportKey(student), record = gradeByKey.get(key), plan = gradePlans.get(key);
    return { ...student, registration: existingKeys.has(key) ? "existing" : "new",
      term1: record?.term1 ?? null, term2: record?.term2 ?? null, term3: record?.term3 ?? null,
      new_grade_count: plan?.termCount ?? 0, enroll: Boolean(plan?.enrollSubjectIds.length),
    };
  });
  return { mode, grade_level: students[0].grade, section_name: students[0].section,
    subject: mode === "grades" ? { id: String(subjects[0]._id), name: subjects[0].name } : null,
    student_count: rows.length, new_student_count: rows.filter((row) => row.registration === "new").length,
    existing_student_count: rows.filter((row) => row.registration === "existing").length,
    new_grade_count: rows.reduce((sum, row) => sum + row.new_grade_count, 0),
    enrollment_count: rows.filter((row) => row.enroll).length,
    rows, skipped,
  };
}

export function importReviewDigest({ buffer, mode, students, grades, subjectIds, subjects, sections, existingStudents, enrollExisting = false,
  assessments = [], scores = [], existingAssessments = [], existingScores = [] }) {
  return hash(JSON.stringify({ file: hash(buffer), mode, students, grades, subjectIds: [...subjectIds].sort(), enrollExisting,
    subjects: sorted(subjects).map((subject) => [String(subject._id), subject.name]),
    sections: sorted(sections).map((section) => [String(section._id), section.name]),
    assessments, scores,
    assessmentState: sorted(existingAssessments).map((row) => [String(row._id), row.name, row.term, row.category, row.sequence, row.totalItems, row.date, row.budgetOfWork ?? ""]),
    scoreState: sorted(existingScores).map((row) => [String(row._id), String(row.studentId), String(row.assessmentId), row.score]),
    existing: sorted(existingStudents).map((student) => [String(student._id), student.name, student.grade,
      String(student.sectionId), student.subjectIds?.map(String).sort() ?? [], student.importedGrades ?? []]),
  }));
}

export function signImportReview({ digest, ownerId, schoolYearId }) {
  return jwt.sign({ digest, schoolYearId: schoolYearId == null ? null : String(schoolYearId) }, process.env.JWT_SECRET || testSecret,
    { algorithm: "HS256", issuer: "edulite-api", audience, subject: String(ownerId), expiresIn: "15m" });
}

export function verifyImportReview(token, { digest, ownerId, schoolYearId }) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || testSecret, { algorithms: ["HS256"], issuer: "edulite-api", audience, subject: String(ownerId) });
    if (payload.digest !== digest || payload.schoolYearId !== (schoolYearId == null ? null : String(schoolYearId))) throw new Error();
  } catch {
    const error = new StudentImportError("Review the import again before confirming. The file, class, subject, school year or saved records may have changed, or the review expired.");
    error.status = 409;
    throw error;
  }
}
