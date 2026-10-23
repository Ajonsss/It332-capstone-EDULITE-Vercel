import express from "express";
import mongoose from "mongoose";
import ClassOffering from "./models/ClassOffering.js";
import Section from "./models/Section.js";
import Subject from "./models/Subject.js";
import Student from "./models/Student.js";
import Assessment from "./models/Assessment.js";
import { requireAuth } from "./middleware/auth.js";
import { validateInput } from "../shared/inputValidation.mjs";
import { createClassStructureRouter } from "./classStructure.js";
import { assessmentOverlapFilter } from "../shared/assessmentScope.mjs";

const formatClass = (item) => ({ id: String(item._id), grade: item.grade, section_id: item.sectionId ? String(item.sectionId) : null, subject_ids: item.subjectIds.map(String) });
const normalize = (value) => value.trim().replace(/\s+/g, " ");

function validateClassFields(body, keys) {
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.grade !== "number" || !Number.isSafeInteger(body.grade) || body.grade < 1) return "Enter a positive whole-number grade level.";
  for (const key of keys) {
    const id = body[`${key}_id`], name = body[`${key}_name`];
    if (id && name) return `Choose an existing ${key} or enter a new name, not both.`;
    if (id) { if (typeof id !== "string" || !mongoose.isObjectIdOrHexString(id)) return `Choose a valid ${key}.`; }
    else {
      const error = validateInput(name, { kind: key, label: `${key[0].toUpperCase()}${key.slice(1)} name`, required: true });
      if (error) return error;
    }
  }
  return null;
}

export function validateClassPayload(body) {
  const error = validateClassFields(body, ["section", "subject"]);
  if (error) return error;
  if (body.student_ids !== undefined && (!Array.isArray(body.student_ids) || body.student_ids.some((id) => typeof id !== "string" || !mongoose.isObjectIdOrHexString(id)))) return "Choose valid registered students for the subject.";
  return null;
}

export function validateClassUpdate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Submit the class changes as an object.";
  if (typeof body.source_grade !== "number" || !Number.isSafeInteger(body.source_grade) || body.source_grade < 1 || typeof body.source_section_id !== "string" || !mongoose.isObjectIdOrHexString(body.source_section_id)) return "Choose a valid class to modify.";
  const error = validateClassFields(body, ["section"]);
  if (error) return error;
  if (!Array.isArray(body.subject_ids) || body.subject_ids.some((id) => typeof id !== "string" || !mongoose.isObjectIdOrHexString(id))) return "Choose valid subjects for the class.";
  const subjectError = validateInput(body.new_subject_name, { kind: "subject", label: "Additional subject", required: false });
  if (subjectError) return subjectError;
  if (!body.subject_ids.length && !body.new_subject_name?.trim()) return "Choose at least one subject for the class.";
  return null;
}

const failUpdate = (status, message) => { const error = new Error(message); error.status = status; throw error; };

export function createClassManagementRouter({ auth = requireAuth, Classes = ClassOffering, Sections = Section, Subjects = Subject, Students = Student, Assessments = Assessment,
  transaction = (work) => mongoose.connection.transaction(work) } = {}) {
  const router = express.Router();
  router.get("/classes", auth, async (req, res) => {
    try {
      const items = await Classes.find({ ownerId: req.user.id, schoolYearId: req.academicYear ?? null }).sort({ grade: 1, createdAt: 1 }).lean();
      res.json(items.map(formatClass));
    } catch (error) { console.error("GET /classes failed:", error); res.status(500).json({ message: "Unable to load registered classes." }); }
  });
  router.post("/classes", auth, async (req, res) => {
    const message = validateClassPayload(req.body);
    if (message) return res.status(400).json({ message });
    try {
      const ownerId = req.user.id;
      const result = await transaction(async (session) => {
        const resolveEntry = async (Model, key) => {
          const id = req.body[`${key}_id`];
          if (id) {
            const entry = await Model.findOne({ _id: id, ownerId }).session(session);
            if (!entry) { const error = new Error(`The selected ${key} is unavailable. Choose one from your account.`); error.status = 400; throw error; }
            return entry;
          }
          const name = normalize(req.body[`${key}_name`]);
          return Model.findOneAndUpdate({ ownerId, nameKey: name.toLowerCase() }, { $setOnInsert: { ownerId, name, nameKey: name.toLowerCase() } }, { upsert: true, new: true, runValidators: true, session });
        };
        // Keep dependent writes together so validation or database failures leave no partial class.
        const section = await resolveEntry(Sections, "section");
        const subject = await resolveEntry(Subjects, "subject");
        const studentIds = [...new Set((req.body.student_ids ?? []).map((id) => id.toLowerCase()))];
        const studentScope = { ownerId, schoolYearId: req.academicYear ?? null, grade: req.body.grade, sectionId: section._id, archived: { $ne: true }, _id: { $in: studentIds } };
        if (studentIds.length) {
          const roster = await Students.find(studentScope).select("_id").session(session);
          if (roster.length !== studentIds.length) failUpdate(400, "Some selected students are no longer registered in this grade and section for the current school year. Refresh the class list and choose again.");
        }
        const item = await Classes.findOneAndUpdate({ ownerId, schoolYearId: req.academicYear ?? null, grade: req.body.grade, sectionId: section._id },
          { $setOnInsert: { ownerId, schoolYearId: req.academicYear ?? null, grade: req.body.grade, sectionId: section._id }, $addToSet: { subjectIds: subject._id } },
          { upsert: true, new: true, runValidators: true, session });
        if (studentIds.length) {
          const enrolled = await Students.updateMany(studentScope, { $addToSet: { subjectIds: subject._id } }, { session, runValidators: true });
          if (enrolled.matchedCount !== studentIds.length) failUpdate(400, "The selected roster changed while saving. Refresh the class list and choose students again.");
        }
        return { ...formatClass(item), section: { id: String(section._id), name: section.name }, subject: { id: String(subject._id), name: subject.name }, enrolled_student_count: studentIds.length };
      });
      return res.status(201).json(result);
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: "This class was just updated. Refresh and try again." });
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("POST /classes failed:", error);
      return res.status(500).json({ message: "Unable to save this class. Your class setup was not saved; try again." });
    }
  });
  router.put("/classes", auth, async (req, res) => {
    const message = validateClassUpdate(req.body);
    if (message) return res.status(400).json({ message });
    try {
      const ownerId = req.user.id, schoolYearId = req.academicYear ?? null;
      const result = await transaction(async (session) => {
        const source = { ownerId, schoolYearId, grade: req.body.source_grade, sectionId: req.body.source_section_id };
        const registration = await Classes.findOne(source).session(session);
        const roster = await Students.find({ ...source, archived: { $ne: true } }).select("_id subjectIds").session(session);
        if (!registration && !roster.length) failUpdate(404, "This class is no longer available in the current school year. Refresh the class list.");
        if (!await Sections.findOne({ ownerId, _id: source.sectionId }).session(session)) failUpdate(400, "The original section is unavailable in your account.");

        const subjectIds = [...new Set(req.body.subject_ids)];
        const ownedSubjects = await Subjects.find({ ownerId, _id: { $in: subjectIds } }).session(session);
        if (ownedSubjects.length !== subjectIds.length) failUpdate(400, "One or more selected subjects are unavailable in your account.");
        if (req.body.new_subject_name?.trim()) {
          const name = normalize(req.body.new_subject_name);
          const added = await Subjects.findOneAndUpdate({ ownerId, nameKey: name.toLowerCase() }, { $setOnInsert: { ownerId, name, nameKey: name.toLowerCase() } }, { upsert: true, new: true, runValidators: true, session });
          if (!subjectIds.includes(String(added._id))) subjectIds.push(String(added._id));
        }
        if (roster.some((student) => (student.subjectIds ?? []).some((id) => !subjectIds.includes(String(id))))) failUpdate(409, "A subject with enrolled students cannot be removed from the class. Update those students' enrollments first.");
        const removedSubjects = (registration?.subjectIds ?? []).filter((id) => !subjectIds.includes(String(id)));
        if (removedSubjects.length && await Assessments.findOne({ ownerId, schoolYearId, subjectId: { $in: removedSubjects }, ...assessmentOverlapFilter([{ grade: source.grade, sectionId: source.sectionId }]) }).session(session)) failUpdate(409, "A subject used by this class's assessments cannot be removed. Update or remove those assessments first.");

        let section;
        if (req.body.section_id) section = await Sections.findOne({ ownerId, _id: req.body.section_id }).session(session);
        else {
          const name = normalize(req.body.section_name);
          section = await Sections.findOneAndUpdate({ ownerId, nameKey: name.toLowerCase() }, { $setOnInsert: { ownerId, name, nameKey: name.toLowerCase() } }, { upsert: true, new: true, runValidators: true, session });
        }
        if (!section) failUpdate(400, "The selected section is unavailable in your account.");
        const moving = req.body.grade !== source.grade || String(section._id) !== source.sectionId;
        if (moving) {
          const destination = { ownerId, schoolYearId, grade: req.body.grade, sectionId: section._id };
          if (await Classes.findOne(destination).session(session) || await Students.findOne({ ...destination, archived: { $ne: true } }).session(session)) failUpdate(409, "A class already exists at that grade level and section. Choose another destination to keep the classes separate.");
        }
        const item = await Classes.findOneAndUpdate(source, { $set: { grade: req.body.grade, sectionId: section._id, subjectIds }, $setOnInsert: { ownerId, schoolYearId } }, { upsert: true, new: true, runValidators: true, session });
        if (moving && roster.length) await Students.updateMany({ ...source, archived: { $ne: true } }, { $set: { grade: req.body.grade, sectionId: section._id } }, { session, runValidators: true });
        if (moving) await Assessments.updateMany({ ownerId, schoolYearId, classSections: { $elemMatch: { grade: source.grade, sectionId: source.sectionId } } },
          { $set: { "classSections.$[class].grade": req.body.grade, "classSections.$[class].sectionId": section._id } },
          { session, runValidators: true, arrayFilters: [{ "class.grade": source.grade, "class.sectionId": source.sectionId }] });
        return { ...formatClass(item), section: { id: String(section._id), name: section.name }, student_count: roster.length };
      });
      return res.json(result);
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: "The destination class was just updated. Refresh and try again." });
      if ([400, 404, 409].includes(error.status)) return res.status(error.status).json({ message: error.message });
      console.error("PUT /classes failed:", error);
      return res.status(500).json({ message: "Unable to modify the class. Your changes were not saved; try again." });
    }
  });
  router.use(createClassStructureRouter({ auth, Classes, Sections, Subjects, Students, Assessments, transaction }));
  return router;
}

export default createClassManagementRouter();
