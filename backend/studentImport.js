import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { getAcademicContext } from "./services/academicContext.js";
import AuditEvent from "./models/AuditEvent.js";
import Student from "./models/Student.js";
import Section from "./models/Section.js";
import Subject from "./models/Subject.js";
import { requireAuth } from "./middleware/auth.js";
import { MAX_IMPORT_BYTES, normalizeImportText, parseStudentWorkbook, StudentImportError } from "./utils/studentImport.js";
import { createImportTemplate, importClassDetails } from "./utils/guidedStudentImport.js";
import { importReview, importReviewDigest, signImportReview, verifyImportReview } from "./services/importConfirmation.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 8, fieldSize: 16384, parts: 9 },
  fileFilter(_req, file, callback) {
    if (!/\.(xlsx|xlsm)$/i.test(file.originalname)) {
      return callback(new StudentImportError("Upload an Excel workbook (.xlsx or .xlsm)."));
    }
    callback(null, true);
  },
}).single("file");

// Avoid overlapping imports for one teacher in this API process.
const importingOwners = new Set();

export function createStudentImportRouter({
  auth = requireAuth, Students = Student, Sections = Section, Subjects = Subject,
} = {}) {
  const router = express.Router();
  const registeredSection = async (ownerId, sectionId, suppliedName) => {
    const unavailable = () => { const error = new StudentImportError("Choose an available registered section from your account. Refresh the section list if it has changed."); error.status = 400; return error; };
    if (typeof sectionId !== "string" || !mongoose.isObjectIdOrHexString(sectionId)) throw unavailable();
    const sections = await Sections.find({ ownerId, _id: sectionId }).lean();
    if (sections.length !== 1 || suppliedName !== undefined && normalizeImportText(suppliedName).toLowerCase() !== normalizeImportText(sections[0].name).toLowerCase()) throw unavailable();
    return sections[0];
  };
  router.get("/students/import/template", auth, async (req, res) => {
    try {
      const { mode, grade_level: gradeLevel, section_id: sectionId } = req.query;
      if (mode !== "names") return res.status(400).json({ message: "Only student names can be imported for now. Download the student names template." });
      const section = await registeredSection(req.user.id, sectionId, req.query.section_name);
      const sectionName = section.name;
      importClassDetails({ mode, gradeLevel, sectionName });
      const buffer = await createImportTemplate({ mode, gradeLevel, sectionName });
      return res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .set("Content-Disposition", `attachment; filename="student-${mode}-template.xlsx"`).set("Cache-Control", "private, no-store").send(buffer);
    } catch (error) {
      return res.status(error instanceof StudentImportError ? error.status : 500).json({ message: error instanceof StudentImportError ? error.message : "Unable to download the import template." });
    }
  });
  router.post(["/students/import", "/students/import/preview"], auth, (req, res, next) => {
    upload(req, res, (error) => {
      if (!error) return next();
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        message: error.code === "LIMIT_FILE_SIZE"
          ? "The Excel file must be 5 MB or smaller."
          : error instanceof StudentImportError ? error.message : "Upload one completed student names sheet.",
      });
    });
  }, async (req, res) => {
    const ownerId = req.user.id;
    const ownerKey = String(ownerId);
    if (importingOwners.has(ownerKey)) {
      return res.status(409).json({ message: "An import is already running. Wait for it to finish." });
    }
    importingOwners.add(ownerKey);
    try {
      if (!req.file) return res.status(400).json({ message: "Select an Excel file to import." });
      const isPreview = req.path.endsWith("/preview");
      const guided = req.body.import_mode !== undefined;
      const mode = req.body.import_mode;
      if (req.body.enroll_existing !== undefined && !["true", "false"].includes(req.body.enroll_existing)) return res.status(400).json({ message: "Choose a valid existing-student enrollment option." });
      const enrollExisting = req.body.enroll_existing === "true";
      if (enrollExisting && !guided) return res.status(400).json({ message: "Review the class import before enrolling existing students." });
      if (guided && mode !== "names") return res.status(400).json({ message: "Only student names can be imported for now. Download the student names template." });
      const selectedSection = guided ? await registeredSection(ownerId, req.body.section_id, req.body.section_name) : null;
      if (guided) importClassDetails({ mode, gradeLevel: req.body.grade_level, sectionName: selectedSection.name });
      if (isPreview && !guided) return res.status(400).json({ message: "Enter the class details and use the student names template first." });
      let subjectIds;
      try {
        const input = JSON.parse(req.body.subject_ids ?? "[]");
        if (!Array.isArray(input) || input.some((id) => typeof id !== "string" || !mongoose.isObjectIdOrHexString(id))) throw new Error();
        subjectIds = [...new Set(input)];
      } catch {
        return res.status(400).json({ message: "Select valid subjects for the imported students." });
      }
      if (!guided && !subjectIds.length) return res.status(400).json({ message: "Select at least one subject for the imported students." });
      if (enrollExisting && !subjectIds.length) return res.status(400).json({ message: "Select a subject for existing student enrollment." });
      const subjects = subjectIds.length ? await Subjects.find({ ownerId, _id: { $in: subjectIds } }) : [];
      if (subjects.length !== subjectIds.length) {
        return res.status(400).json({ message: "One or more selected subjects are unavailable for your account." });
      }
      const parsed = await parseStudentWorkbook(req.file.buffer, { namesOnly: true,
        ...(guided ? { importMode: mode, gradeLevel: req.body.grade_level, sectionName: selectedSection.name } : {}),
      });
      if (parsed.format === "guided" && !guided) return res.status(400).json({ message: "Use the guided import and review the workbook before confirming." });
      const { students, skipped } = parsed;
      const academicScope = getAcademicContext() ? { schoolYearId: getAcademicContext().schoolYearId } : {};
      const importedAt = new Date();
      let sections = [], existingStudents = [];
      if (guided) {
        sections = [selectedSection];
        existingStudents = sections.length ? await Students.find({ ownerId, ...academicScope, archived: { $ne: true },
          sectionId: { $in: sections.map((section) => section._id) },
          grade: { $in: [...new Set(students.map((student) => student.grade))] },
        }).lean() : [];
      }
      if (guided) {
        const digest = importReviewDigest({ buffer: req.file.buffer, mode, students, grades: [], subjectIds, subjects, sections, existingStudents, enrollExisting });
        const scope = { digest, ownerId, schoolYearId: getAcademicContext()?.schoolYearId };
        if (isPreview) return res.json({ ...importReview({ students, grades: [], skipped, subjects, sections, existingStudents, gradePlans: new Map(), mode }), enroll_existing: enrollExisting, confirmation_token: signImportReview(scope) });
        verifyImportReview(req.body.confirmation_token, scope);
      }
      const sectionsByKey = new Map();
      if (guided) sectionsByKey.set(selectedSection.name.toLowerCase(), selectedSection);
      // All spreadsheet validation completes before any database writes.
      for (const student of students) {
        const nameKey = student.section.toLowerCase();
        if (sectionsByKey.has(nameKey)) continue;
        let section;
        try {
          section = await Sections.findOneAndUpdate(
            { ownerId, nameKey },
            { $setOnInsert: { ownerId, nameKey, name: student.section } },
            { upsert: true, new: true, runValidators: true },
          );
        } catch (error) {
          if (error.code !== 11000) throw error;
          section = await Sections.findOne({ ownerId, nameKey });
          if (!section) throw error;
        }
        sectionsByKey.set(nameKey, section);
      }
      const operations = students.map((student) => {
        const sectionId = sectionsByKey.get(student.section.toLowerCase())._id;
        const escapedName = student.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return { updateOne: {
          filter: { ownerId, ...(getAcademicContext() ? { schoolYearId: getAcademicContext().schoolYearId } : {}), archived: { $ne: true }, grade: student.grade, sectionId, name: { $regex: `^${escapedName}$`, $options: "i" } },
          update: { $setOnInsert: { ownerId, ...academicScope, name: student.name, grade: student.grade, sectionId, ...(enrollExisting ? {} : { subjectIds }),
            createdAt: importedAt, updatedAt: importedAt }, ...(enrollExisting ? { $addToSet: { subjectIds: { $each: subjectIds } } } : {}) },
          upsert: true,
        } };
      });
      let result;
      let writeErrors = [];
      try {
        // Preserve existing timestamps when a repeated upload matches a student.
        result = await Students.bulkWrite(operations, { ordered: false, timestamps: false });
      } catch (error) {
        // Report known partial writes so retrying does not hide created students.
        if (!error.result || !Array.isArray(error.writeErrors) || !error.writeErrors.length) throw error;
        result = error.result;
        writeErrors = error.writeErrors;
      }
      const upserted = result.upsertedIds ?? {};
      const failedIndexes = new Set(writeErrors.map((error) => error.index));
      const issues = writeErrors.map((error) => ({
        ...(students[error.index].sheet ? { sheet: students[error.index].sheet } : {}),
        row: students[error.index].row,
        message: error.code === 11000 ? "A database unique index blocked this student. Contact your administrator." : "Unable to save this student. Retry this row.",
      }));
      students.forEach((student, index) => {
        if (!(index in upserted) && !failedIndexes.has(index)) {
          skipped.push({ ...(student.sheet ? { sheet: student.sheet } : {}), row: student.row, name: student.name, message: enrollExisting ? "Already registered; selected subjects were retained or added to enrollment." : "This name, grade and section are already registered in your account." });
        }
      });
      const importedCount = Object.keys(upserted).length;
      const enrolledExistingCount = enrollExisting ? result.modifiedCount ?? 0 : 0;
      if (getAcademicContext() && (importedCount || enrolledExistingCount)) await AuditEvent.create({ ownerId, schoolYearId: getAcademicContext().schoolYearId, action: "import", resource: "Student", changes: { importedCount, enrolledExistingCount, subjectIds, studentIds: Object.values(upserted) } });
      return res.status(issues.length ? 207 : 200).json({
        message: `${importedCount} student${importedCount === 1 ? "" : "s"} imported. ${skipped.length} existing or duplicate registration${skipped.length === 1 ? "" : "s"} skipped.${enrolledExistingCount ? ` ${enrolledExistingCount} existing student${enrolledExistingCount === 1 ? "" : "s"} enrolled in the selected subjects.` : ""}${issues.length ? ` ${issues.length} row(s) could not be saved.` : ""}`,
        imported_count: importedCount, enrolled_existing_count: enrolledExistingCount, skipped_count: skipped.length, failed_count: issues.length, skipped, issues,
      });
    } catch (error) {
      if (error instanceof StudentImportError) {
        return res.status(error.status).json({ message: error.message, issues: error.issues });
      }
      console.error("POST /students/import failed:", error.message);
      return res.status(500).json({ message: "The import could not finish. Reload the student list before retrying. Saved registrations are preserved." });
    } finally {
      importingOwners.delete(ownerKey);
    }
  });
  return router;
}

export default createStudentImportRouter();
