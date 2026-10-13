import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import SchoolYear from "./models/SchoolYear.js";
import User from "./models/User.js";
import Student from "./models/Student.js";
import Subject from "./models/Subject.js";
import Section from "./models/Section.js";
import Assessment from "./models/Assessment.js";
import AssessmentScore from "./models/AssessmentScore.js";
import StudentAiInsight from "./models/StudentAiInsight.js";
import Intervention from "./models/Intervention.js";
import AwardCertificate from "./models/AwardCertificate.js";
import AuditEvent from "./models/AuditEvent.js";
import { requireAuth } from "./middleware/auth.js";
import { DEFAULT_RULES } from "./services/academicContext.js";
import { validateInput, isCalendarDate } from "../shared/inputValidation.mjs";
import { buildYearEndReports } from "./studentLifecycle.js";

const router = express.Router();
router.use(["/school-years", "/grading-rules", "/interventions", "/award-history", "/change-history", "/backups"], requireAuth);
export function validateRules(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Submit grading rules as an object.";
  for (const key of ["passingGrade", "highPerformingGrade", "writtenWorkWeight", "performanceTaskWeight", "examinationWeight"]) if (typeof input[key] !== "number" || !Number.isFinite(input[key]) || input[key] < 0 || input[key] > 100) return "Grade thresholds and weights must be numbers from 0 to 100.";
  if (input.passingGrade >= input.highPerformingGrade) return "The high-performing grade must exceed the passing grade.";
  if (Math.abs(input.writtenWorkWeight + input.performanceTaskWeight + input.examinationWeight - 100) > 0.00001) return "Written work, performance task, and examination weights must total 100%.";
  if (typeof input.requireAllSubjectsPassing !== "boolean" || typeof input.requireCompleteScores !== "boolean") return "Choose the promotion completeness requirements.";
  return null;
}
const safeRules = (input) => Object.fromEntries(Object.keys(DEFAULT_RULES).map((key) => [key, input[key]]));
const fail = (res, error, message) => { console.error(message, error); return res.status(500).json({ message }); };
router.get("/school-years", async (req, res) => {
  const years = await SchoolYear.find({ ownerId: req.user.id }).sort({ createdAt: -1 }).lean();
  res.json({ activeId: req.academicYear, years: [{ _id: null, name: "Legacy / unassigned records" }, ...years] });
});
router.post("/school-years", async (req, res) => {
  const error = validateInput(req.body?.name, { label: "School year", maxLength: 40 });
  if (error) return res.status(400).json({ message: error });
  try {
    if (await SchoolYear.exists({ ownerId: req.user.id, name: req.body.name.trim() })) return res.status(409).json({ message: "That school year already exists." });
    const year = await SchoolYear.create({ ownerId: req.user.id, name: req.body.name.trim(), rules: req.rules });
    await AuditEvent.create({ ownerId: req.user.id, schoolYearId: year._id, action: "school-year-created", resource: "SchoolYear", recordId: String(year._id), changes: { name: year.name } });
    return res.status(201).json(year);
  } catch (error) { if (error.code === 11000) return res.status(409).json({ message: "That school year already exists." }); return fail(res, error, "Unable to create the school year."); }
});
router.post("/school-years/assign-legacy", async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.body?.id) || !await SchoolYear.exists({ _id: req.body.id, ownerId: req.user.id })) return res.status(400).json({ message: "Select a valid school year." });
  const academicModels = [Student, Assessment, AssessmentScore, StudentAiInsight, Intervention, AwardCertificate];
  for (const Model of academicModels) if (await Model.exists({ ownerId: req.user.id, schoolYearId: req.body.id }).setOptions({ acrossSchoolYears: true, includeArchived: true })) return res.status(409).json({ message: "Assign legacy records to an empty school year." });
  await mongoose.connection.transaction(async (session) => {
    for (const Model of academicModels) await Model.updateMany({ ownerId: req.user.id, schoolYearId: null }, { $set: { schoolYearId: req.body.id } }, { session, acrossSchoolYears: true, includeArchived: true });
    await User.updateOne({ _id: req.user.id }, { $set: { activeSchoolYearId: req.body.id } }, { session });
  });
  res.json({ message: "Legacy records assigned to the selected school year." });
});
router.put("/school-years/active", async (req, res) => {
  const id = req.body?.id;
  if (id !== null && !mongoose.isObjectIdOrHexString(id)) return res.status(400).json({ message: "Select a valid school year." });
  if (id && !await SchoolYear.exists({ _id: id, ownerId: req.user.id })) return res.status(404).json({ message: "School year not found." });
  await User.updateOne({ _id: req.user.id }, { $set: { activeSchoolYearId: id } });
  await AuditEvent.create({ ownerId: req.user.id, schoolYearId: id, action: "active-year-changed", resource: "SchoolYear" });
  res.json({ message: "Active school year changed." });
});
router.get("/grading-rules", (req, res) => res.json(req.rules));
router.put("/grading-rules", async (req, res) => {
  const error = validateRules(req.body); if (error) return res.status(400).json({ message: error });
  const rules = safeRules(req.body);
  if (req.academicYear) await SchoolYear.updateOne({ _id: req.academicYear, ownerId: req.user.id }, { $set: { rules } });
  else await User.updateOne({ _id: req.user.id }, { $set: { legacyRules: rules } });
  await AuditEvent.create({ ownerId: req.user.id, schoolYearId: req.academicYear, action: "grading-rules-changed", resource: "SchoolYear", before: req.rules, changes: rules });
  res.json({ message: "Rules saved. Reopen the dashboard to refresh calculations.", rules });
});

export function interventionPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Submit an intervention as an object." };
  for (const [key, maxLength] of [["title", 200], ["activities", 5000]]) {
    const error = validateInput(body[key], { kind: key === "activities" ? "budgetOfWork" : "text", label: key === "title" ? "Activity title" : "Practice activities", maxLength });
    if (error) return { error };
  }
  if (!["easy", "medium", "hard"].includes(body.difficulty) || !["assigned", "in_progress", "completed"].includes(body.status)) return { error: "Select valid difficulty and progress settings." };
  if (body.dueDate && !isCalendarDate(body.dueDate)) return { error: "Enter a valid due date." };
  const value = { title: body.title.trim(), activities: body.activities.trim(), difficulty: body.difficulty, status: body.status, dueDate: body.dueDate || null, notes: body.notes ?? "" };
  if (typeof value.notes !== "string" || value.notes.length > 2000) return { error: "Notes must be text of at most 2000 characters." };
  for (const key of ["baselineScore", "followUpScore"]) {
    const input = body[key];
    if (input === "" || input === null || input === undefined) { value[key] = null; continue; }
    if (typeof input !== "number" || !Number.isFinite(input) || input < 0 || input > 100) return { error: "Progress scores must be percentages from 0 to 100." };
    value[key] = input;
  }
  return { value };
}
router.get("/interventions", async (req, res) => res.json(await Intervention.find({ ownerId: req.user.id }).populate({ path: "studentId", select: "name grade", options: { includeArchived: true } }).sort({ updatedAt: -1 }).lean()));
router.post("/interventions", async (req, res) => {
  const validation = interventionPayload(req.body); if (validation.error) return res.status(400).json({ message: validation.error });
  if (!mongoose.isObjectIdOrHexString(req.body.studentId) || !await Student.exists({ _id: req.body.studentId, ownerId: req.user.id })) return res.status(400).json({ message: "Choose an active student in the current school year." });
  res.status(201).json(await Intervention.create({ ownerId: req.user.id, studentId: req.body.studentId, ...validation.value }));
});
router.put("/interventions/:id", async (req, res) => {
  const validation = interventionPayload(req.body); if (validation.error) return res.status(400).json({ message: validation.error });
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ message: "Invalid intervention ID." });
  const item = await Intervention.findOneAndUpdate({ _id: req.params.id, ownerId: req.user.id }, { $set: validation.value }, { new: true, runValidators: true });
  if (!item) return res.status(404).json({ message: "Intervention not found." }); res.json(item);
});
router.get("/award-history", async (req, res) => res.json(await AwardCertificate.find({ ownerId: req.user.id }).sort({ createdAt: -1 }).lean()));
router.post("/award-history", async (req, res) => {
  // Derive grades from server records rather than trusting certificate grades submitted by the browser.
  const body = req.body;
  if (!body || !Array.isArray(body.studentIds) || !body.studentIds.length || body.studentIds.length > 1000 || body.studentIds.some((id) => !mongoose.isObjectIdOrHexString(id))) return res.status(400).json({ message: "Select valid certificate recipients." });
  if (![1, 2, 3].includes(body.term) || !["excellence", "performance", "improvement"].includes(body.awardType) || typeof body.minimum !== "number" || !Number.isFinite(body.minimum) || body.minimum < (body.awardType === "improvement" ? 1 : 0) || body.minimum > 100 || (body.subjectId !== "ALL" && !mongoose.isObjectIdOrHexString(body.subjectId))) return res.status(400).json({ message: "Invalid award criteria." });
  for (const [key, maxLength, required] of [["school", 150, true], ["title", 100, true], ["schoolYear", 40, false], ["signatory", 100, false], ["role", 80, false]]) {
    const error = validateInput(body[key], { label: key, maxLength, required }); if (error) return res.status(400).json({ message: error });
  }
  if (!isCalendarDate(body.date)) return res.status(400).json({ message: "Enter a valid certificate date." });
  const reports = await buildYearEndReports(req.user.id);
  const certificates = [];
  for (const id of [...new Set(body.studentIds)]) {
    const student = reports.find((item) => item.id === id);
    if (!student) return res.status(400).json({ message: "One or more recipients are unavailable in this school year." });
    const scoped = student.subjects.filter((subject) => body.subjectId === "ALL" || subject.id === body.subjectId);
    const average = (term) => scoped.length && scoped.every((subject) => subject.terms[`term${term}`]?.isComplete && typeof subject.terms[`term${term}`]?.termGrade === "number") ? scoped.reduce((sum, subject) => sum + subject.terms[`term${term}`].termGrade, 0) / scoped.length : null;
    const grade = average(body.term); const previousGrade = body.term > 1 ? average(body.term - 1) : null; const improvement = grade !== null && previousGrade !== null ? grade - previousGrade : null;
    const score = body.awardType === "improvement" ? improvement : grade;
    if (score === null || score < body.minimum) return res.status(400).json({ message: `${student.name} does not meet the award criteria.` });
    certificates.push({ ownerId: req.user.id, studentId: id, certificate: { studentName: student.name, gradeLevel: student.grade, section: student.section, grade, previousGrade, improvement, scope: body.subjectId === "ALL" ? "all enrolled subjects" : scoped[0].name, term: body.term, awardType: body.awardType, school: body.school.trim(), title: body.title.trim(), schoolYear: body.schoolYear ?? "", signatory: body.signatory ?? "", role: body.role ?? "", date: body.date } });
  }
  const saved = await AwardCertificate.create(certificates); res.status(201).json(saved);
});
router.get("/change-history", async (req, res) => res.json(await AuditEvent.find({ ownerId: req.user.id }).sort({ createdAt: -1 }).limit(200).lean()));

const models = { schoolYears: SchoolYear, sections: Section, subjects: Subject, students: Student, assessments: Assessment, scores: AssessmentScore, insights: StudentAiInsight, interventions: Intervention, awards: AwardCertificate, history: AuditEvent };
router.get("/backups", async (req, res) => {
  const collections = {};
  for (const [key, Model] of Object.entries(models)) {
    let query = Model.find({ ownerId: req.user.id }).setOptions({ acrossSchoolYears: true, includeArchived: true });
    if (key === "students") query = query.select("+archiveSnapshot");
    collections[key] = await query.lean();
    if (key === "insights") collections[key] = collections[key].map((doc) => ({ ...doc, pdfData: (Buffer.isBuffer(doc.pdfData) ? doc.pdfData : doc.pdfData?._bsontype === "Binary" ? doc.pdfData.value(true) : Buffer.alloc(0)).toString("base64") }));
  }
  const user = await User.findById(req.user.id).select("legacyRules").lean();
  res.set("Cache-Control", "no-store").set("Content-Disposition", 'attachment; filename="edulite-backup.json"').json({ format: "edulite-backup", version: 1, exportedAt: new Date(), legacyRules: user.legacyRules, collections });
});
router.post("/backups/restore", async (req, res) => {
  const body = req.body;
  if (typeof body?.password !== "string") return res.status(400).json({ message: "Confirm your password before restoring." });
  const user = await User.findById(req.user.id);
  if (!await bcrypt.compare(body.password, user.password)) return res.status(400).json({ message: "The current password is incorrect." });
  const backup = body.backup;
  if (backup?.format !== "edulite-backup" || backup.version !== 1 || !backup.collections || typeof backup.collections !== "object") return res.status(400).json({ message: "Choose a valid EduLITE backup." });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const idMap = new Map(); const idTypes = new Map(); const prepared = {};
  let total = 0;
  for (const key of Object.keys(models)) {
    const rows = backup.collections[key] ?? [];
    if (!Array.isArray(rows) || (total += rows.length) > 50000) return res.status(400).json({ message: "The backup is invalid or exceeds 50,000 records." });
    for (const row of rows) {
      if (!row || !mongoose.isObjectIdOrHexString(row._id) || idMap.has(row._id)) return res.status(400).json({ message: "Backup record IDs are invalid or duplicated." });
      idMap.set(row._id, new mongoose.Types.ObjectId()); idTypes.set(row._id, key);
    }
  }
  const legacyYearId = new mongoose.Types.ObjectId();
  const remap = (value) => {
    if (typeof value === "string" && idMap.has(value)) return idMap.get(value);
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
    return value;
  };
  try {
    const legacyRules = { ...DEFAULT_RULES, ...backup.legacyRules };
    if (validateRules(legacyRules)) throw new Error("Invalid legacy grading rules.");
    const references = { schoolYearId: "schoolYears", studentId: "students", assessmentId: "assessments", subjectId: "subjects", sectionId: "sections", focusSubjectId: "subjects", previousEnrollmentId: "students" };
    for (const [key, Model] of Object.entries(models)) {
      prepared[key] = [];
      for (const row of backup.collections[key] ?? []) {
        for (const [ref, type] of Object.entries(references)) if (row[ref] && idTypes.get(row[ref]) !== type) throw new Error(`Missing or invalid backup reference: ${ref}`);
        for (const ref of row.subjectIds ?? []) if (idTypes.get(ref) !== "subjects") throw new Error("Missing subject reference.");
        if (key === "schoolYears" && validateRules({ ...DEFAULT_RULES, ...row.rules })) throw new Error("Invalid school-year grading rules.");
        const data = remap(row); data.ownerId = req.user.id; delete data.legacyId;
        if (!["schoolYears", "sections", "subjects", "history"].includes(key) && !data.schoolYearId) data.schoolYearId = legacyYearId;
        if (["schoolYears", "sections", "subjects"].includes(key)) { const suffix = ` [restored ${Date.now().toString(36)}-${String(data._id).slice(-6)}]`; data.name = `${row.name.slice(0, (key === "schoolYears" ? 40 : 100) - suffix.length)}${suffix}`; data.nameKey = data.name.toLowerCase(); }
        if (key === "insights") data.pdfData = Buffer.from(row.pdfData ?? "", "base64");
        if (key === "history") { data.action = "restored-history"; data.changes = { original: remap(row) }; data.before = undefined; }
        const doc = new Model(data); await doc.validate(); prepared[key].push(doc);
      }
    }
    await mongoose.connection.transaction(async (session) => {
      await SchoolYear.create([{ _id: legacyYearId, ownerId: req.user.id, name: `Restored legacy ${stamp}`, rules: { ...DEFAULT_RULES, ...backup.legacyRules } }], { session });
      for (const key of Object.keys(models)) for (const doc of prepared[key]) await doc.save({ session });
      await AuditEvent.create([{ ownerId: req.user.id, action: "backup-restored", resource: "Backup", changes: { records: total, legacyYearId } }], { session });
    });
    res.json({ message: "Backup restored as separate school years and records. Existing data was kept. Select a restored year in Settings.", records: total });
  } catch (error) { return res.status(400).json({ message: `The backup could not be restored: ${error.message}` }); }
});
export default router;
