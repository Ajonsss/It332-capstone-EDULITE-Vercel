import express from "express";
import mongoose from "mongoose";
import { parseWholeNumber, validateInput } from "../shared/inputValidation.mjs";
import { assessmentOverlapFilter } from "../shared/assessmentScope.mjs";

const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const normalize = (value) => value.trim().replace(/\s+/g, " ");
const validGrade = (value) => Number.isSafeInteger(value) && value > 0;
const validId = (value) => typeof value === "string" && mongoose.isObjectIdOrHexString(value);

export function createClassStructureRouter({ auth, Classes, Sections, Subjects, Students, Assessments, transaction }) {
  const router = express.Router();
  router.use("/class-structure", auth);
  const scope = (req) => ({ ownerId: req.user.id, schoolYearId: req.academicYear ?? null });
  const readGrade = (value) => { const grade = parseWholeNumber(value); if (!validGrade(grade)) fail(400, "Choose a valid grade level."); return grade; };
  const readId = (value) => { if (!validId(value)) fail(400, "Choose a valid section or subject."); return value.toLowerCase(); };
  const readName = (body, kind) => {
    const message = validateInput(body?.name, { kind, label: `${kind === "section" ? "Section" : "Subject"} name`, required: true });
    if (message) fail(400, message);
    return normalize(body.name);
  };
  const gradeExists = async (filter, session) => await Classes.findOne(filter).session(session) || await Students.findOne(filter).session(session);
  const classExists = async (req, grade, sectionId, session) => {
    const filter = { ...scope(req), grade, sectionId };
    const registration = await Classes.findOne(filter).session(session);
    const roster = await Students.find(filter).select("subjectIds").session(session);
    if (!registration && !roster.length) fail(404, "This section is not registered in the selected grade and school year.");
    return { filter, registration, roster };
  };
  const resolveNamed = (Model, ownerId, name, session) => Model.findOneAndUpdate({ ownerId, nameKey: name.toLowerCase() },
    { $setOnInsert: { ownerId, name, nameKey: name.toLowerCase() } }, { upsert: true, new: true, runValidators: true, session });
  const action = (handler, status = 200) => async (req, res) => {
    try { const result = await transaction((session) => handler(req, session)); return res.status(status).json(result); }
    catch (error) {
      if ([400, 404, 409].includes(error.status)) return res.status(error.status).json({ message: error.message });
      if (error.code === 11000) return res.status(409).json({ message: "An entry with that name or grade already exists. Choose another value." });
      console.error("Class structure change failed:", error);
      return res.status(500).json({ message: "Unable to update the class structure. No changes were saved; try again." });
    }
  };

  router.post("/class-structure/grades", action(async (req, session) => {
    const grade = req.body?.grade;
    if (!validGrade(grade)) fail(400, "Enter a positive whole-number grade level.");
    const filter = { ...scope(req), grade };
    if (await gradeExists(filter, session)) fail(409, "This grade level is already registered.");
    await Classes.findOneAndUpdate({ ...filter, sectionId: null }, { $setOnInsert: { ...filter, sectionId: null, subjectIds: [] } }, { upsert: true, new: true, runValidators: true, session });
    return { grade, message: `Grade ${grade} created. Add its sections next.` };
  }, 201));

  router.put("/class-structure/grades/:grade", action(async (req, session) => {
    const previous = readGrade(req.params.grade), grade = req.body?.grade;
    if (!validGrade(grade)) fail(400, "Enter a positive whole-number grade level.");
    const filter = { ...scope(req), grade: previous };
    if (!await gradeExists(filter, session)) fail(404, "Grade level not found in the current school year.");
    if (grade !== previous) {
      if (await gradeExists({ ...scope(req), grade }, session)) fail(409, "That grade level already exists. Choose another grade to keep the classes separate.");
      await Classes.updateMany(filter, { $set: { grade } }, { session, runValidators: true });
      await Students.updateMany({ ...filter, archived: { $ne: true } }, { $set: { grade } }, { session, runValidators: true });
      await Assessments.updateMany({ ...scope(req), "classSections.grade": previous }, { $set: { "classSections.$[entry].grade": grade } }, { session, runValidators: true, arrayFilters: [{ "entry.grade": previous }] });
    }
    return { grade, message: `Grade level updated to Grade ${grade}.` };
  }));

  router.delete("/class-structure/grades/:grade", action(async (req, session) => {
    const grade = readGrade(req.params.grade), filter = { ...scope(req), grade };
    if (!await gradeExists(filter, session)) fail(404, "Grade level not found in the current school year.");
    if (await Students.findOne(filter).setOptions({ includeArchived: true }).session(session)) fail(409, "This grade level has student records. Move its students before deleting the grade level.");
    if (await Assessments.findOne({ ...scope(req), "classSections.grade": grade }).session(session)) fail(409, "This grade level is used by assessments. Update those assessment sections before deleting it.");
    await Classes.deleteMany(filter, { session });
    return { grade, message: `Grade ${grade} and its empty class setups removed.` };
  }));

  router.post("/class-structure/sections", action(async (req, session) => {
    const grade = req.body?.grade, name = readName(req.body, "section");
    if (!validGrade(grade)) fail(400, "Choose a valid grade level.");
    if (!await gradeExists({ ...scope(req), grade }, session)) fail(404, "Create the grade level first.");
    const section = await resolveNamed(Sections, req.user.id, name, session);
    const filter = { ...scope(req), grade, sectionId: section._id };
    if (await gradeExists(filter, session)) fail(409, "This section is already registered in that grade level.");
    await Classes.findOneAndUpdate(filter, { $setOnInsert: { ...filter, subjectIds: [] } }, { upsert: true, new: true, runValidators: true, session });
    return { grade, section_id: String(section._id), message: `${section.name} added to Grade ${grade}.` };
  }, 201));

  router.put("/class-structure/sections/:id", action(async (req, session) => {
    const grade = req.body?.grade, sectionId = readId(req.params.id), name = readName(req.body, "section");
    if (!validGrade(grade)) fail(400, "Choose a valid grade level.");
    await classExists(req, grade, sectionId, session);
    const section = await Sections.findOneAndUpdate({ ownerId: req.user.id, _id: sectionId }, { $set: { name, nameKey: name.toLowerCase() } }, { new: true, runValidators: true, session });
    if (!section) fail(404, "Section not found in your account.");
    return { grade, section_id: sectionId, message: `Section renamed to ${section.name} wherever it is used.` };
  }));

  router.delete("/class-structure/sections/:id", action(async (req, session) => {
    const grade = readGrade(req.query.grade), sectionId = readId(req.params.id);
    const { filter } = await classExists(req, grade, sectionId, session);
    if (await Students.findOne(filter).setOptions({ includeArchived: true }).session(session)) fail(409, "This section has student records. Move its students before removing the section.");
    if (await Assessments.findOne({ ...scope(req), classSections: { $elemMatch: { grade, sectionId } } }).session(session)) fail(409, "This section is used by assessments. Update those assessment sections first.");
    await Classes.deleteMany(filter, { session });
    // Keep the grade visible even when its last section is removed.
    await Classes.findOneAndUpdate({ ...scope(req), grade, sectionId: null }, { $setOnInsert: { ...scope(req), grade, sectionId: null, subjectIds: [] } }, { upsert: true, new: true, runValidators: true, session });
    return { grade, message: "Section removed from this grade. Its shared catalog entry and historical records are kept." };
  }));

  router.post("/class-structure/subjects", action(async (req, session) => {
    const grade = req.body?.grade, sectionId = readId(req.body?.section_id), name = readName(req.body, "subject");
    if (!validGrade(grade)) fail(400, "Choose a valid grade level.");
    const { filter, registration, roster } = await classExists(req, grade, sectionId, session);
    const subject = await resolveNamed(Subjects, req.user.id, name, session);
    if ((registration?.subjectIds ?? []).some((id) => String(id) === String(subject._id)) || roster.some((student) => student.subjectIds.some((id) => String(id) === String(subject._id)))) fail(409, "This subject is already registered for that section.");
    await Classes.findOneAndUpdate(filter, { $setOnInsert: filter, $addToSet: { subjectIds: subject._id } }, { upsert: true, new: true, runValidators: true, session });
    return { grade, section_id: sectionId, subject_id: String(subject._id), message: `${subject.name} registered for this class. Enroll students using Add class.` };
  }, 201));

  const requireSubject = async (req, grade, sectionId, subjectId, session) => {
    const current = await classExists(req, grade, sectionId, session);
    if (!(current.registration?.subjectIds ?? []).some((id) => String(id) === subjectId) && !current.roster.some((student) => student.subjectIds.some((id) => String(id) === subjectId))) fail(404, "This subject is not registered for the selected class.");
    return current;
  };
  router.put("/class-structure/subjects/:id", action(async (req, session) => {
    const grade = req.body?.grade, sectionId = readId(req.body?.section_id), subjectId = readId(req.params.id), name = readName(req.body, "subject");
    if (!validGrade(grade)) fail(400, "Choose a valid grade level.");
    await requireSubject(req, grade, sectionId, subjectId, session);
    const subject = await Subjects.findOneAndUpdate({ ownerId: req.user.id, _id: subjectId }, { $set: { name, nameKey: name.toLowerCase() } }, { new: true, runValidators: true, session });
    if (!subject) fail(404, "Subject not found in your account.");
    return { grade, section_id: sectionId, subject_id: subjectId, message: `Subject renamed to ${subject.name} wherever it is used.` };
  }));

  router.delete("/class-structure/subjects/:id", action(async (req, session) => {
    const grade = readGrade(req.query.grade), sectionId = readId(req.query.section_id), subjectId = readId(req.params.id);
    const { filter } = await requireSubject(req, grade, sectionId, subjectId, session);
    if (await Students.findOne({ ...filter, $or: [{ subjectIds: subjectId }, { "importedGrades.subjectId": subjectId }] }).setOptions({ includeArchived: true }).session(session)) fail(409, "This subject has enrolled students or imported grades. Update their enrollments before removing it.");
    if (await Assessments.findOne({ ...scope(req), subjectId, ...assessmentOverlapFilter([{ grade, sectionId }]) }).session(session)) fail(409, "This subject is used by assessments for this class. Update or remove those assessments first.");
    await Classes.updateOne(filter, { $pull: { subjectIds: subjectId } }, { session, runValidators: true });
    return { grade, section_id: sectionId, message: "Subject removed from this class. Its shared catalog entry and historical records are kept." };
  }));
  return router;
}
