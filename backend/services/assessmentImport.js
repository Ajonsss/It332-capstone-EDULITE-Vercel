import mongoose from "mongoose";
import AuditEvent from "../models/AuditEvent.js";
import { StudentImportError, normalizeImportText, studentImportKey } from "../utils/studentImport.js";
import { importReviewDigest, signImportReview, verifyImportReview } from "./importConfirmation.js";

const sameId = (a, b) => String(a) === String(b);
const nameKey = (name) => normalizeImportText(name).toLowerCase();
const day = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10); };
const id = () => new mongoose.Types.ObjectId();
async function find(Model, filter, session) {
  let query = Model.find(filter);
  if (session) query = query.session(session);
  return query.lean();
}
const stale = () => { const error = new StudentImportError("The assessment records changed. Review the import again before confirming."); error.status = 409; return error; };

export async function readAssessmentImport({ parsed, ownerId, academicScope, subject, section, models, session }) {
  const { Students, Sections, Subjects, Assessments, Scores } = models;
  const { students, assessments, scores } = parsed;
  const owned = await find(Subjects, { ownerId, _id: { $in: [subject._id] } }, session);
  if (owned.length !== 1 || nameKey(owned[0].name) !== nameKey(subject.name)) throw stale();
  const sections = await find(Sections, { ownerId, _id: section._id, nameKey: students[0].section.toLowerCase() }, session);
  if (sections.length !== 1) throw stale();
  const existingStudents = sections.length ? await find(Students, { ownerId, ...academicScope, archived: { $ne: true }, grade: students[0].grade, sectionId: sections[0]._id }, session) : [];
  const existingAssessments = await find(Assessments, { ownerId, ...academicScope, subjectId: subject._id }, session);
  const existingScores = existingStudents.length && existingAssessments.length ? await find(Scores, { ownerId, ...academicScope,
    studentId: { $in: existingStudents.map((row) => row._id) }, assessmentId: { $in: existingAssessments.map((row) => row._id) },
  }, session) : [];
  const studentsByKey = new Map(), ambiguous = new Set();
  for (const student of existingStudents) {
    const key = studentImportKey({ ...student, section: sections[0].name });
    if (studentsByKey.has(key)) ambiguous.add(key);
    studentsByKey.set(key, student);
  }
  const issues = [];
  for (const student of students) if (ambiguous.has(studentImportKey(student))) issues.push({ sheet: "Students", row: student.row, message: "Multiple registered students have this name, grade and section. Resolve these registrations before importing scores." });
  const assessmentPlans = new Map();
  for (const definition of assessments) {
    const inCategory = existingAssessments.filter((row) => row.term === definition.term && row.category === definition.category);
    const matches = inCategory.filter((row) => row.sequence === definition.sequence);
    let message;
    if (inCategory.some((row) => row.sequence == null)) message = "This category has legacy assessments without slots. Assign their ECR slots in Assessments before importing.";
    else if (matches.length > 1) message = "Multiple existing assessments use this slot. Resolve duplicate slots first.";
    const existing = matches[0];
    if (existing && (nameKey(existing.name) !== nameKey(definition.name) || existing.totalItems !== definition.totalItems || day(existing.date) !== definition.date ||
        definition.budgetOfWork && (existing.budgetOfWork ?? "").trim() !== definition.budgetOfWork)) message = `${definition.label} already exists with different details. Match its name, date, maximum score and any supplied Budget of Work. Existing assessments are preserved.`;
    if (message) issues.push({ sheet: definition.sheet, row: 3, message: `${definition.column}3: ${message}` });
    assessmentPlans.set(definition.key, { definition, existing });
  }
  const scoreByIds = new Map();
  for (const row of existingScores) {
    const key = `${row.studentId}:${row.assessmentId}`;
    if (scoreByIds.has(key)) throw new StudentImportError("Duplicate saved score records were found. Resolve them before importing.");
    scoreByIds.set(key, row);
  }
  const scorePlans = scores.map((row) => {
    const student = studentsByKey.get(row.studentKey), assessment = assessmentPlans.get(row.assessmentKey)?.existing;
    const existing = student && assessment ? scoreByIds.get(`${student._id}:${assessment._id}`) : undefined;
    if (existing && existing.score !== row.score) issues.push({ sheet: row.sheet, row: row.row, message: `${row.column}${row.row}: A score (${existing.score}) is already saved for this student and assessment. Existing scores are never overwritten. Correct or clear the incoming cell.` });
    return { ...row, existing };
  });
  if (issues.length) throw new StudentImportError("Fix the listed assessment records. Nothing has been imported.", issues);
  return { sections, existingStudents, existingAssessments, existingScores, studentsByKey, assessmentPlans, scorePlans };
}

export function assessmentImportReview(parsed, state, subject) {
  const incoming = new Map(parsed.scores.map((row) => [`${row.studentKey}:${row.assessmentKey}`, row.score]));
  const definitions = [...state.assessmentPlans.values()].map(({ definition, existing }) => ({ ...definition, budgetOfWork: definition.budgetOfWork || existing?.budgetOfWork || "", status: existing ? "existing" : "new" }));
  const savedScores = new Map(state.existingScores.map((row) => [`${row.studentId}:${row.assessmentId}`, row.score]));
  const rows = parsed.students.map((student) => {
    const existing = state.studentsByKey.get(studentImportKey(student));
    const values = definitions.map((definition) => {
      const assessment = state.assessmentPlans.get(definition.key).existing;
      const saved = existing && assessment ? savedScores.get(`${existing._id}:${assessment._id}`) : undefined;
      const supplied = incoming.get(`${studentImportKey(student)}:${definition.key}`);
      return { value: supplied ?? saved ?? null, action: saved !== undefined ? "kept" : supplied !== undefined ? "new" : "missing" };
    });
    return { ...student, registration: existing ? "existing" : "new", enroll: Boolean(existing && !(existing.subjectIds ?? []).some((savedId) => sameId(savedId, subject._id))),
      scores: values.map((row) => row.value), score_actions: values.map((row) => row.action),
    };
  });
  return { mode: "grades", record_type: "assessments", grade_level: parsed.students[0].grade, section_name: parsed.students[0].section,
    subject: { id: String(subject._id), name: subject.name }, rows, assessments: definitions, skipped: parsed.skipped,
    student_count: rows.length, new_student_count: rows.filter((row) => row.registration === "new").length, existing_student_count: rows.filter((row) => row.registration === "existing").length,
    enrollment_count: rows.filter((row) => row.enroll).length, new_assessment_count: definitions.filter((row) => row.status === "new").length,
    reused_assessment_count: definitions.filter((row) => row.status === "existing").length,
    new_score_count: state.scorePlans.filter((row) => !row.existing).length, unchanged_score_count: state.scorePlans.filter((row) => row.existing).length,
  };
}

export async function handleAssessmentImport({ req, res, parsed, ownerId, academicScope, subject, section, models, transaction, isPreview }) {
  const state = await readAssessmentImport({ parsed, ownerId, academicScope, subject, section, models });
  const scopeFor = (state) => ({ ownerId, schoolYearId: academicScope.schoolYearId, digest: importReviewDigest({ buffer: req.file.buffer, mode: "grades", students: parsed.students, grades: [],
    subjectIds: [String(subject._id)], subjects: [subject], assessments: parsed.assessments, scores: parsed.scores, ...state,
  }) });
  if (isPreview) return res.json({ ...assessmentImportReview(parsed, state, subject), confirmation_token: signImportReview(scopeFor(state)) });
  verifyImportReview(req.body.confirmation_token, scopeFor(state));
  const result = await transaction(async (session) => {
    // Re-read and revalidate inside the transaction as well as before preview.
    const fresh = await readAssessmentImport({ parsed, ownerId, academicScope, subject, section, models, session });
    verifyImportReview(req.body.confirmation_token, scopeFor(fresh));
    const { Students, Assessments, Scores } = models;
    const importedAt = new Date();
    const registeredSection = fresh.sections[0];
    const studentIds = new Map(), studentWrites = [];
    const studentsWithNewScores = new Set(fresh.scorePlans.filter((row) => !row.existing).map((row) => row.studentKey));
    let importedCount = 0, enrolledCount = 0;
    for (const student of parsed.students) {
      const key = studentImportKey(student), existing = fresh.studentsByKey.get(key);
      studentIds.set(key, existing?._id ?? id());
      if (!existing) {
        importedCount++;
        studentWrites.push({ insertOne: { document: { _id: studentIds.get(key), ownerId, ...academicScope, name: student.name, grade: student.grade, sectionId: registeredSection._id,
          subjectIds: [subject._id], importedGrades: [], createdAt: importedAt, updatedAt: importedAt } } });
      } else {
        const enroll = !(existing.subjectIds ?? []).some((value) => sameId(value, subject._id));
        if (enroll) enrolledCount++;
        // A write also locks students receiving new scores against concurrent
        // deletion, archival or removal from the subject during this import.
        if (enroll || studentsWithNewScores.has(key)) studentWrites.push({ updateOne: {
          filter: { _id: existing._id, ownerId, ...academicScope, archived: { $ne: true } },
          update: { ...(enroll ? { $addToSet: { subjectIds: subject._id } } : {}), $set: { updatedAt: importedAt } },
        } });
      }
    }
    if (studentWrites.length) {
      const saved = await Students.bulkWrite(studentWrites, { session, ordered: true, timestamps: false });
      if (saved.matchedCount !== studentWrites.filter((write) => write.updateOne).length) throw stale();
    }
    const assessmentIds = new Map(), assessmentWrites = [];
    let assessmentCount = 0;
    const usedForNewScores = new Set(fresh.scorePlans.filter((row) => !row.existing).map((row) => row.assessmentKey));
    for (const [key, { definition, existing }] of fresh.assessmentPlans) {
      assessmentIds.set(key, existing?._id ?? id());
      if (!existing) {
        assessmentCount++;
        const { name, term, category, sequence, totalItems, date, budgetOfWork } = definition;
        assessmentWrites.push({ insertOne: { document: { _id: assessmentIds.get(key), ownerId, ...academicScope, subjectId: subject._id, name, term, category, sequence, totalItems,
          date: new Date(`${date}T00:00:00.000Z`), budgetOfWork, createdAt: importedAt, updatedAt: importedAt } } });
      } else if (usedForNewScores.has(key)) {
        // Lock reused definitions against simultaneous changes to their HPS,
        // date or category while scores are being imported in this transaction.
        assessmentWrites.push({ updateOne: { filter: { _id: existing._id, ownerId, ...academicScope }, update: { $set: { updatedAt: importedAt } } } });
      }
    }
    if (assessmentWrites.length) await Assessments.bulkWrite(assessmentWrites, { session, ordered: true, timestamps: false });
    const newScores = fresh.scorePlans.filter((row) => !row.existing);
    if (newScores.length) {
      const writes = newScores.map((row) => ({ updateOne: {
        filter: { ownerId, ...academicScope, studentId: studentIds.get(row.studentKey), assessmentId: assessmentIds.get(row.assessmentKey) },
        update: { $setOnInsert: { ownerId, ...academicScope, studentId: studentIds.get(row.studentKey), assessmentId: assessmentIds.get(row.assessmentKey), score: row.score, createdAt: importedAt, updatedAt: importedAt } }, upsert: true,
      } }));
      const saved = await Scores.bulkWrite(writes, { session, ordered: true, timestamps: false });
      if (saved.upsertedCount !== newScores.length) throw stale();
    }
    if (importedCount || enrolledCount || assessmentCount || newScores.length) await AuditEvent.create([{ ownerId, ...academicScope, action: "import-assessments", resource: "AssessmentScore",
      changes: { importedCount, enrolledCount, assessmentCount, scoreCount: newScores.length, subjectId: subject._id, studentIds: [...studentIds.values()] },
    }], { session });
    return { message: `${importedCount} students imported. ${assessmentCount} assessments created. ${newScores.length} individual scores imported.`,
      imported_count: importedCount, imported_grade_count: 0, imported_assessment_count: assessmentCount,
      reused_assessment_count: fresh.assessmentPlans.size - assessmentCount, imported_score_count: newScores.length, unchanged_score_count: fresh.scorePlans.length - newScores.length,
      enrolled_count: enrolledCount, skipped_count: parsed.students.length - importedCount + parsed.skipped.length, failed_count: 0, issues: [],
      skipped: [...parsed.skipped, ...parsed.students.filter((student) => fresh.studentsByKey.has(studentImportKey(student))).map((student) => ({ sheet: "Students", row: student.row, name: student.name, message: "Existing registration kept. Assessment scores and subject enrollment were processed." }))],
    };
  });
  return res.json(result);
}
