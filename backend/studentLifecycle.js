import express from "express";
import mongoose from "mongoose";
import Student from "./models/Student.js";
import SchoolYear from "./models/SchoolYear.js";
import Intervention from "./models/Intervention.js";
import Subject from "./models/Subject.js";
import Assessment from "./models/Assessment.js";
import AssessmentScore from "./models/AssessmentScore.js";
import StudentAiInsight from "./models/StudentAiInsight.js";
import { requireAuth } from "./middleware/auth.js";
import { calculateStudentSubjectGrade } from "./utils/grading.js";
import { classifyYearEnd, validateFinishDecision } from "./utils/yearEnd.js";

const router = express.Router();
router.use(["/year-end-report", "/students/:id/finish", "/student-archives"], requireAuth);

export async function buildYearEndReports(ownerId, studentId = null) {
  const students = await Student.find({ ownerId, ...(studentId ? { _id: studentId } : {}) }).populate({ path: "sectionId", select: "name", match: { ownerId } }).sort({ name: 1 }).lean();
  if (!students.length) return [];
  const subjectIds = [...new Set(students.flatMap((student) => student.subjectIds.map(String)))];
  const subjects = await Subject.find({ ownerId, _id: { $in: subjectIds } }).lean();
  const assessments = await Assessment.find({ ownerId, subjectId: { $in: subjectIds }, term: { $in: [1, 2, 3] }, category: { $in: ["written_work", "performance_task", "summative_test", "term_exam"] } }).lean();
  const scores = await AssessmentScore.find({ ownerId, studentId: { $in: students.map((student) => student._id) }, assessmentId: { $in: assessments.map((assessment) => assessment._id) } }).lean();
  const scoreMap = new Map(scores.map((score) => [`${score.studentId}:${score.assessmentId}`, score.score]));
  return students.map((student) => {
    const subjectReports = student.subjectIds.map((id) => {
      const records = assessments.filter((assessment) => String(assessment.subjectId) === String(id)).map((assessment) => ({
        assessmentId: String(assessment._id), name: assessment.name, term: assessment.term, category: assessment.category,
        sequence: assessment.sequence, date: assessment.date, totalItems: assessment.totalItems,
        budgetOfWork: assessment.budgetOfWork ?? "", score: scoreMap.get(`${student._id}:${assessment._id}`) ?? null,
      }));
      const calculation = calculateStudentSubjectGrade(records);
      return { id: String(id), name: subjects.find((subject) => String(subject._id) === String(id))?.name ?? "Unavailable subject", terms: calculation.terms, final: calculation.final, assessments: records };
    });
    return { id: String(student._id), name: student.name, grade: student.grade, section: student.sectionId?.name ?? "", subjects: subjectReports, ...classifyYearEnd(subjectReports) };
  });
}

router.get("/year-end-report", async (req, res) => {
  try { res.json(await buildYearEndReports(req.user.id)); }
  catch (error) { console.error("Year-end review failed:", error); res.status(500).json({ message: "Unable to load the year-end review." }); }
});

router.post("/students/:id/finish", async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ message: "A valid student ID is required." });
  try {
    const [report] = await buildYearEndReports(req.user.id, req.params.id);
    if (!report) return res.status(404).json({ message: "Active student not found." });
    const error = validateFinishDecision(report, req.body);
    if (error) return res.status(400).json({ message: error });
    const insights = await StudentAiInsight.find({ ownerId: req.user.id, studentId: req.params.id }).select("title supportType createdAt result").lean();
    let nextYear = null;
    const source = await Student.findOne({ _id: req.params.id, ownerId: req.user.id });
    if (!source) return res.status(404).json({ message: "Active student not found." });
    if (req.body.outcome === "promoted") {
      if (!mongoose.isObjectIdOrHexString(req.body.next_year_id)) return res.status(400).json({ message: "Choose the next school year for the new enrollment." });
      nextYear = await SchoolYear.findOne({ _id: req.body.next_year_id, ownerId: req.user.id });
      if (!nextYear || String(nextYear._id) === String(source.schoolYearId)) return res.status(400).json({ message: "Choose a different school year for promotion." });
      const duplicate = await Student.findOne({ ownerId: req.user.id, schoolYearId: nextYear._id, previousEnrollmentId: source._id }).setOptions({ acrossSchoolYears: true, includeArchived: true });
      if (duplicate) return res.status(409).json({ message: "A next-year enrollment already exists for this student." });
    }
    const interventions = await Intervention.find({ ownerId: req.user.id, studentId: req.params.id }).lean();
    const archivedAt = new Date();
    const snapshot = { ...report, schoolYear: req.body.school_year.trim(), outcome: req.body.outcome, notes: (req.body.notes ?? "").trim(), archivedAt, insights, interventions, schoolYearId: source.schoolYearId ?? null };
    let archived;
    const saveArchive = async (session) => {
      if (nextYear) {
        const [enrollment] = await Student.create([{ ownerId: req.user.id, name: source.name, grade: source.grade + 1, sectionId: source.sectionId, subjectIds: source.subjectIds, schoolYearId: nextYear._id, previousEnrollmentId: source._id }], { session });
        snapshot.nextEnrollmentId = String(enrollment._id);
      }
      archived = await Student.findOneAndUpdate({ _id: req.params.id, ownerId: req.user.id, archived: { $ne: true } }, { $set: { archived: true, archivedAt, archiveSnapshot: snapshot } }, { new: true, runValidators: true, ...(session ? { session } : {}) });
      if (!archived) throw new Error("The student has already been archived. Refresh the report.");
    };
    if (nextYear) await mongoose.connection.transaction(saveArchive); else await saveArchive(null);
    return res.json({ message: "Student finished and archived. Their year-end records have been preserved.", id: String(archived._id) });
  } catch (error) { console.error("Finish student failed:", error); return res.status(500).json({ message: "Unable to finish the student." }); }
});

router.get("/student-archives", async (req, res) => {
  try {
    const students = await Student.find({ ownerId: req.user.id, archived: true }).setOptions({ includeArchived: true, acrossSchoolYears: true }).select("name grade archivedAt +archiveSnapshot").sort({ archivedAt: -1 }).lean();
    res.json(students.map((student) => ({ id: String(student._id), name: student.archiveSnapshot?.name ?? student.name, grade: student.archiveSnapshot?.grade ?? student.grade, archivedAt: student.archivedAt, section: student.archiveSnapshot?.section ?? "", schoolYear: student.archiveSnapshot?.schoolYear ?? "", outcome: student.archiveSnapshot?.outcome, finalAverage: student.archiveSnapshot?.finalAverage })));
  } catch (error) { console.error("Archives failed:", error); res.status(500).json({ message: "Unable to load archived students." }); }
});

router.get("/student-archives/:id", async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ message: "A valid student ID is required." });
  try {
    const student = await Student.findOne({ _id: req.params.id, ownerId: req.user.id, archived: true }).setOptions({ includeArchived: true, acrossSchoolYears: true }).select("+archiveSnapshot").lean();
    if (!student) return res.status(404).json({ message: "Archived student not found." });
    return res.json(student.archiveSnapshot);
  } catch (error) { console.error("Archive detail failed:", error); return res.status(500).json({ message: "Unable to load archived student records." }); }
});
router.post("/student-archives/:id/restore", async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ message: "Invalid student ID." });
  const student = await Student.findOneAndUpdate({ _id: req.params.id, ownerId: req.user.id, archived: true }, { $set: { archived: false, archivedAt: null } }, { new: true, includeArchived: true, acrossSchoolYears: true });
  if (!student) return res.status(404).json({ message: "Archived student not found." });
  return res.json({ message: "Student restored to their original school year. Any next-year enrollment was kept.", schoolYearId: student.schoolYearId ?? null });
});
export default router;
