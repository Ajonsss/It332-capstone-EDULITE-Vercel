import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { getAcademicContext } from "./services/academicContext.js";
import AuditEvent from "./models/AuditEvent.js";
import Student from "./models/Student.js";
import Section from "./models/Section.js";
import Subject from "./models/Subject.js";
import { requireAuth } from "./middleware/auth.js";
import { MAX_IMPORT_BYTES, parseStudentWorkbook, StudentImportError } from "./utils/studentImport.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 1, fieldSize: 16384, parts: 2 },
  fileFilter(_req, file, callback) {
    if (!file.originalname.toLowerCase().endsWith(".xlsx")) {
      return callback(new StudentImportError("Upload an Excel workbook (.xlsx)."));
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
  router.post("/students/import", auth, (req, res, next) => {
    upload(req, res, (error) => {
      if (!error) return next();
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        message: error.code === "LIMIT_FILE_SIZE"
          ? "The Excel file must be 5 MB or smaller."
          : error instanceof StudentImportError ? error.message : "Upload one .xlsx file and the selected subjects.",
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
      let subjectIds;
      try {
        const input = JSON.parse(req.body.subject_ids ?? "[]");
        if (!Array.isArray(input) || input.some((id) => typeof id !== "string" || !mongoose.isObjectIdOrHexString(id))) throw new Error();
        subjectIds = [...new Set(input)];
      } catch {
        return res.status(400).json({ message: "Select valid subjects for the imported students." });
      }
      if (!subjectIds.length) return res.status(400).json({ message: "Select at least one subject for the imported students." });
      const subjects = await Subjects.find({ ownerId, _id: { $in: subjectIds } });
      if (subjects.length !== subjectIds.length) {
        return res.status(400).json({ message: "One or more selected subjects are unavailable for your account." });
      }
      const { students, skipped } = await parseStudentWorkbook(req.file.buffer);
      const sectionsByKey = new Map();
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
      const importedAt = new Date();
      const operations = students.map((student) => {
        const sectionId = sectionsByKey.get(student.section.toLowerCase())._id;
        const escapedName = student.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return { updateOne: {
          filter: { ownerId, ...(getAcademicContext() ? { schoolYearId: getAcademicContext().schoolYearId } : {}), archived: { $ne: true }, grade: student.grade, sectionId, name: { $regex: `^${escapedName}$`, $options: "i" } },
          update: { $setOnInsert: { ownerId, ...(getAcademicContext() ? { schoolYearId: getAcademicContext().schoolYearId } : {}), name: student.name, grade: student.grade, sectionId, subjectIds, createdAt: importedAt, updatedAt: importedAt } },
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
        row: students[error.index].row,
        message: error.code === 11000 ? "A database unique index blocked this student. Contact your administrator." : "Unable to save this student. Retry this row.",
      }));
      students.forEach((student, index) => {
        if (!(index in upserted) && !failedIndexes.has(index)) {
          skipped.push({ row: student.row, name: student.name, message: "This name, grade and section are already registered in your account." });
        }
      });
      const importedCount = Object.keys(upserted).length;
      if (getAcademicContext() && importedCount) await AuditEvent.create({ ownerId, schoolYearId: getAcademicContext().schoolYearId, action: "import", resource: "Student", changes: { importedCount, studentIds: Object.values(upserted) } });
      return res.status(issues.length ? 207 : 200).json({
        message: `${importedCount} student${importedCount === 1 ? "" : "s"} imported. ${skipped.length} duplicate${skipped.length === 1 ? "" : "s"} skipped.${issues.length ? ` ${issues.length} row(s) could not be saved.` : ""}`,
        imported_count: importedCount, skipped_count: skipped.length, failed_count: issues.length, skipped, issues,
      });
    } catch (error) {
      if (error instanceof StudentImportError) {
        return res.status(error.status).json({ message: error.message, issues: error.issues });
      }
      console.error("POST /students/import failed:", error.message);
      return res.status(500).json({ message: "The import could not finish. Reload the student list before retrying; already registered students will be skipped." });
    } finally {
      importingOwners.delete(ownerKey);
    }
  });
  return router;
}

export default createStudentImportRouter();
