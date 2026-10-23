import mongoose from "mongoose";
import Section from "../models/Section.js";
import ClassOffering from "../models/ClassOffering.js";
import Student from "../models/Student.js";
import { assessmentIncludesStudent, assessmentStudentFilter } from "../../shared/assessmentScope.mjs";

export async function validateAssessmentSections(input, { ownerId, subjectId, schoolYearId, session = null, existingAssessment = null }) {
  if (input === undefined && existingAssessment) return { value: existingAssessment.classSections ?? null };
  if (!Array.isArray(input) || !input.length) return { error: "Choose at least one section that will take this assessment." };
  const unique = new Map();
  for (const entry of input) {
    if (!entry || !Number.isSafeInteger(entry.grade) || entry.grade < 1 || typeof entry.section_id !== "string" || !mongoose.isObjectIdOrHexString(entry.section_id)) return { error: "Choose valid grade levels and sections for the assessment." };
    const sectionId = entry.section_id.toLowerCase();
    unique.set(`${entry.grade}:${sectionId}`, { grade: entry.grade, sectionId });
  }
  const classSections = [...unique.values()];
  const sections = await Section.find({ ownerId, _id: { $in: classSections.map((entry) => entry.sectionId) } }).session(session).lean();
  const scope = { ownerId, schoolYearId: schoolYearId ?? null, ...assessmentStudentFilter(classSections) };
  const registrations = await ClassOffering.find({ ...scope, subjectIds: subjectId }).session(session).lean();
  const roster = await Student.find({ ...scope, subjectIds: subjectId, archived: { $ne: true } }).select("grade sectionId").session(session).lean();
  if (classSections.some((entry) => !sections.some((section) => String(section._id) === entry.sectionId) ||
    ![...registrations, ...roster].some((row) => assessmentIncludesStudent({ classSections: [entry] }, row)))) {
    return { error: "One or more sections do not have this subject registered in the current school year. Update Manage your class or choose another section." };
  }
  return { value: classSections };
}
