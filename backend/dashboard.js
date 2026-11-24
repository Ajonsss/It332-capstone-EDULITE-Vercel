import express from "express";
import { requireAuth, selectAcademicYear } from "./middleware/auth.js";
import { listStudents } from "./student.js";
import { listSections } from "./section.js";
import { listSubjects } from "./subject.js";
import { listAssessments, listAssessmentRecords, listGradeSummaries } from "./assessment.js";
import { listSchoolYears } from "./teacherTools.js";
import { listClasses } from "./classManagement.js";

// Reuse the normal readers and their academic scope without making internal HTTP
// calls or repeating token/account validation for every part of the dashboard.
async function readJson(handler, req) {
  let status = 200, data;
  await handler(req, {
    status(value) { status = value; return this; },
    json(value) { data = value; return this; },
  });
  if (status >= 400 || data === undefined) {
    const error = new Error(data?.message || "Unable to load the dashboard.");
    error.status = status >= 400 ? status : 500;
    throw error;
  }
  return data;
}

const defaultReaders = { students: listStudents, sections: listSections, subjects: listSubjects, assessments: listAssessments,
  assessmentRecords: listAssessmentRecords, gradeSummaries: listGradeSummaries, schoolYears: listSchoolYears, classes: listClasses };

export function createDashboardRouter({ auth = requireAuth, readers = defaultReaders } = {}) {
  const router = express.Router();
  router.get("/dashboard", auth, selectAcademicYear, async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      const readRequest = {
        user: req.user, academicYear: req.academicYear, activeAcademicYear: req.activeAcademicYear,
        includeArchived: req.activeAcademicYear !== undefined, rules: req.rules, query: {}, params: {},
      };
      const entries = await Promise.all(Object.entries(readers).map(async ([key, handler]) => [key, await readJson(handler, readRequest)]));
      return res.json({ ...Object.fromEntries(entries), gradingRules: req.rules });
    } catch (error) {
      return res.status(error.status ?? 500).json({ message: error.message || "Unable to load the dashboard." });
    }
  });
  return router;
}

export default createDashboardRouter();
