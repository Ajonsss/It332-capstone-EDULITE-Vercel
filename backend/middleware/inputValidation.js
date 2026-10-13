import { parseWholeNumber, validateInput } from "../../shared/inputValidation.mjs";

const OBJECT_ID = /^[a-f\d]{24}$/i;
const isId = (value) => typeof value === "string" && OBJECT_ID.test(value);

// Validate raw values before Mongoose or Number() can coerce their types.
export function validateRequestInputs(req, res, next) {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return next();
  // Express accepts trailing slashes and case-insensitive route names.
  const path = req.path.replace(/\/+$/, "").toLowerCase();
  const fields = {};
  const body = req.body;
  const known = /^\/(register|login|students(?:\/[^/]+(?:\/assessment-scores)?)?|sections|subjects(?:\/[^/]+)?|assessments(?:\/[^/]+(?:\/scores\/[^/]+)?)?|api\/gemini\/student-support\/[^/]+)$/.test(path);
  // The multipart import validates its workbook after upload middleware.
  if (!known || path === "/students/import") return next();
  if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ message: "Submit the form fields as an object." });

  const check = (key, rules) => {
    const error = validateInput(body[key], rules);
    if (error) fields[key] = error;
  };
  const id = (key, label) => {
    if (!isId(body[key])) fields[key] = `Select a valid ${label}.`;
  };
  const ids = (key, label, required = false) => {
    const values = body[key] === undefined && !required ? [] : body[key];
    if (!Array.isArray(values) || (required && !values.length) || values.some((value) => !isId(value))) fields[key] = `Select ${required ? "at least one valid" : "valid"} ${label}.`;
  };
  const scores = (idKey, max = Number.MAX_SAFE_INTEGER) => {
    if (body.scores === undefined && idKey === "student_id") return;
    if (!Array.isArray(body.scores)) { fields.scores = "Scores must be an array."; return; }
    const seen = new Set();
    body.scores.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || !isId(entry[idKey])) {
        fields[`scores.${index}`] = `Score row ${index + 1} must include a valid ${idKey}.`;
        return;
      }
      if (seen.has(entry[idKey])) fields[`scores.${index}`] = `Score row ${index + 1} repeats the same ${idKey}.`;
      seen.add(entry[idKey]);
      const error = validateInput(entry.score, { kind: "integer", label: `Score in row ${index + 1}`, required: false, min: 0, max });
      if (error) fields[`scores.${index}.score`] = error;
    });
  };

  if (["/register", "/login"].includes(path)) {
    check("name", { kind: "username", label: "Username" });
    check("password", { kind: "password", label: "Password", minLength: path === "/register" ? 6 : 1 });
  } else if (path === "/sections") {
    check("name", { kind: "section", label: "Section name" });
  } else if (/^\/subjects(?:\/[^/]+)?$/.test(path)) {
    check("name", { kind: "subject", label: "Subject name" });
    if (path === "/subjects") ids("student_ids", "students");
  } else if (/^\/students\/[^/]+\/assessment-scores$/.test(path)) {
    scores("assessment_id");
  } else if (/^\/students(?:\/[^/]+)?$/.test(path)) {
    check("name", { kind: "personName", label: "Student name" });
    check("grade", { kind: "integer", label: "Grade", min: 1 });
    check("section", { kind: "section", label: "Section" });
    ids("subject_ids", "subjects", true);
  } else if (/^\/assessments\/[^/]+\/scores\/[^/]+$/.test(path)) {
    check("score", { kind: "integer", label: "Score", required: false, min: 0 });
  } else if (/^\/assessments(?:\/[^/]+)?$/.test(path)) {
    check("name", { kind: "assessment", label: "Assessment name" });
    check("term", { kind: "integer", label: "Term", min: 1, max: 3 });
    const limits = { written_work: 5, performance_task: 3, summative_test: 2, term_exam: 1 };
    if (typeof body.category !== "string" || !Object.hasOwn(limits, body.category)) fields.category = "Select a valid ECR grading category.";
    const sequenceLimit = typeof body.category === "string" && Object.hasOwn(limits, body.category) ? limits[body.category] : 1;
    check("sequence", { kind: "integer", label: "ECR slot", min: 1, max: sequenceLimit });
    check("budget_of_work", { kind: "budgetOfWork", label: "Budget of Work", required: false });
    check("total_items", { kind: "integer", label: "Highest Possible Score", min: 1 });
    check("date", { kind: "date", label: "Assessment date" });
    id("subject_id", "subject");
    scores("student_id", parseWholeNumber(body.total_items));
  } else if (/^\/api\/gemini\/student-support\/[^/]+$/.test(path)) {
    check("term", { kind: "integer", label: "Term", min: 1, max: 3 });
    if (!["intervention", "enrichment"].includes(body.support_type)) fields.support_type = "Select intervention or enrichment.";
    if (body.focus_subject_id != null && body.focus_subject_id !== "") id("focus_subject_id", "focus subject");
  }
  if (Object.keys(fields).length) return res.status(400).json({ message: Object.values(fields)[0], fields });
  return next();
}
