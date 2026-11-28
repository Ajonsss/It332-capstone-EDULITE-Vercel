import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { assessmentIncludesStudent } from "../../shared/assessmentScope.mjs";
import { connectMongoDatabase, disconnectMongoDatabase } from "../database/mongo.js";
import Assessment from "../models/Assessment.js";
import AssessmentScore from "../models/AssessmentScore.js";
import AuditEvent from "../models/AuditEvent.js";
import SchoolYear from "../models/SchoolYear.js";
import Student from "../models/Student.js";
import User from "../models/User.js";
import { academicContext } from "../services/academicContext.js";

const BATCH_SIZE = 250;
const DEFAULT_SEED = "edulite-sample-scores-v1";
const ACTOR_NAME = "Sample score generator";
const SCORE_KEY = { ownerId: 1, studentId: 1, assessmentId: 1 };
const HELP = `Usage: node backend/scripts/seedSampleScores.js [--dry-run | --apply]
       [--owner-id ID] [--school-year-id ID|legacy] [--seed VALUE]

The default is a read-only preview. Use --apply to insert scores and audit entries.
Defaults may be set in the environment or backend/.env with SEED_OWNER_ID,
SEED_SCHOOL_YEAR_ID and SEED_RANDOM_SEED. CLI options take precedence.
`;

class SeedError extends Error {}

const pairKey = (studentId, assessmentId) => `${studentId}:${assessmentId}`;
const yearKey = (value) => String(value ?? "legacy");

function parseId(value, label) {
  if (value === undefined) return undefined;
  if (!mongoose.isObjectIdOrHexString(value)) throw new SeedError(`${label} must be a MongoDB ObjectId.`);
  return new mongoose.Types.ObjectId(value);
}

function parseSettings(args) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: {
      apply: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "owner-id": { type: "string" },
      "school-year-id": { type: "string" },
      seed: { type: "string" },
      help: { type: "boolean", short: "h" },
    } }));
  } catch {
    throw new SeedError("Invalid arguments. See --help for usage.");
  }
  if (values.help) return { help: true };
  if (values.apply && values["dry-run"]) throw new SeedError("Choose either --apply or --dry-run.");
  const ownerId = parseId(values["owner-id"] ?? process.env.SEED_OWNER_ID, "Owner ID");
  const year = values["school-year-id"] ?? process.env.SEED_SCHOOL_YEAR_ID;
  const schoolYearId = year === "legacy" ? null : parseId(year, "School year ID");
  const seed = values.seed ?? process.env.SEED_RANDOM_SEED ?? DEFAULT_SEED;
  if (!seed.trim()) throw new SeedError("The random seed must have a value.");
  return { apply: values.apply, ownerId, schoolYearId, seed };
}

export async function findTargets({ ownerId, schoolYearId }) {
  if (ownerId && schoolYearId !== undefined) {
    const [owner, year] = await Promise.all([
      User.findById(ownerId).select("name").lean(),
      schoolYearId && SchoolYear.findOne({ _id: schoolYearId, ownerId }).select("name").lean(),
    ]);
    if (!owner || (schoolYearId && !year)) return [];
    const assessments = await Assessment.countDocuments({ ownerId, schoolYearId });
    return [{ ownerId, owner: owner.name, schoolYearId, schoolYear: year?.name ?? "Legacy / unassigned", assessments }];
  }

  const filter = {};
  if (ownerId) filter.ownerId = ownerId;
  if (schoolYearId !== undefined) filter.schoolYearId = schoolYearId;
  const groups = await Assessment.aggregate([
    { $match: filter },
    { $group: {
      _id: { ownerId: "$ownerId", schoolYearId: { $ifNull: ["$schoolYearId", null] } },
      assessments: { $sum: 1 },
    } },
    { $sort: { "_id.ownerId": 1, "_id.schoolYearId": 1 } },
  ]);
  const ownerIds = groups.map(({ _id }) => _id.ownerId).filter(Boolean);
  const yearIds = groups.map(({ _id }) => _id.schoolYearId).filter(Boolean);
  const [owners, years] = await Promise.all([
    User.find({ _id: { $in: ownerIds } }).select("name").lean(),
    SchoolYear.find({ _id: { $in: yearIds } }).select("ownerId name").lean(),
  ]);
  const ownersById = new Map(owners.map((owner) => [String(owner._id), owner]));
  const yearsById = new Map(years.map((year) => [String(year._id), year]));
  return groups.flatMap(({ _id: scope, assessments }) => {
    const owner = ownersById.get(String(scope.ownerId));
    const year = yearsById.get(String(scope.schoolYearId));
    if (!owner || (scope.schoolYearId && String(year?.ownerId) !== String(owner._id))) return [];
    return [{ ...scope, owner: owner.name, schoolYear: year?.name ?? "Legacy / unassigned", assessments }];
  });
}

function randomUnit(seed, ...parts) {
  return createHash("sha256").update(JSON.stringify([seed, ...parts])).digest().readUInt32BE() / 2 ** 32;
}

export function generateScore(seed, studentId, assessment) {
  const { _id: assessmentId, subjectId, totalItems } = assessment;
  if (!Number.isSafeInteger(totalItems) || totalItems < 1) {
    throw new SeedError(`Assessment ${assessmentId} has an invalid highest possible score.`);
  }
  const student = String(studentId);
  const ability = randomUnit(seed, "student", student);
  let baseline = 0.68 + ((ability - 0.25) / 0.5) * 0.16;
  if (ability < 0.25) baseline = 0.48 + (ability / 0.25) * 0.17;
  if (ability >= 0.75) baseline = 0.86 + ((ability - 0.75) / 0.25) * 0.12;
  const subject = (randomUnit(seed, "subject", student, String(subjectId)) - 0.5) * 0.11;
  const difficulty = (randomUnit(seed, "assessment", String(assessmentId)) - 0.5) * 0.08;
  const variation = (randomUnit(seed, "result", student, String(assessmentId)) - 0.5) * 0.12;
  return Math.round(Math.max(0, Math.min(1, baseline + subject + difficulty + variation)) * totalItems);
}

export function planSampleScores(assessments, students, scores, schoolYearId) {
  const studentsBySubject = new Map();
  for (const student of students) {
    if (student.archived === true) continue;
    for (const subjectId of new Set((student.subjectIds ?? []).map(String))) {
      if (!studentsBySubject.has(subjectId)) studentsBySubject.set(subjectId, []);
      studentsBySubject.get(subjectId).push(student);
    }
  }
  const existingByPair = new Map(scores.map((row) => [pairKey(row.studentId, row.assessmentId), row]));
  const missing = [];
  const eligible = new Map();
  let assessmentsWithoutEligibleStudents = 0;
  let outOfYearScores = 0;
  for (const assessment of assessments) {
    const roster = (studentsBySubject.get(String(assessment.subjectId)) ?? [])
      .filter((student) => assessmentIncludesStudent(assessment, student));
    if (roster.length === 0) assessmentsWithoutEligibleStudents++;
    for (const { _id: studentId } of roster) {
      const assessmentId = assessment._id;
      const key = pairKey(studentId, assessmentId);
      eligible.set(key, assessment);
      const existing = existingByPair.get(key);
      if (!existing) missing.push({ studentId, assessmentId });
      else if (yearKey(existing.schoolYearId) !== yearKey(schoolYearId)) outOfYearScores++;
    }
  }
  return { schoolYearId, assessments: assessments.length, eligible, existingByPair, scores, missing, outOfYearScores, assessmentsWithoutEligibleStudents };
}

async function readPlan(scope) {
  const [assessments, students] = await Promise.all([
    Assessment.find(scope).select("subjectId classSections totalItems").sort("_id").lean(),
    Student.find(scope).select("subjectIds grade sectionId archived").sort("_id").lean(),
  ]);
  // Include existing pairs recorded under a different year because the unique index spans years.
  const scores = await AssessmentScore.find({ ownerId: scope.ownerId, $or: [
    { schoolYearId: scope.schoolYearId },
    { assessmentId: { $in: assessments.map(({ _id }) => _id) } },
  ] }).setOptions({ acrossSchoolYears: true }).lean();
  return planSampleScores(assessments, students, scores, scope.schoolYearId);
}

function summarize(plan) {
  return {
    assessments: plan.assessments,
    assessmentsWithoutEligibleStudents: plan.assessmentsWithoutEligibleStudents,
    eligiblePairs: plan.eligible.size,
    existingEligibleScores: plan.eligible.size - plan.missing.length,
    existingScoreRecordsInSchoolYear: plan.scores.filter((row) => yearKey(row.schoolYearId) === yearKey(plan.schoolYearId)).length,
    eligibleScoresStoredUnderAnotherYear: plan.outOfYearScores,
    scoresToInsert: plan.missing.length,
  };
}

async function buildWrites(scope, pairs, seed, session) {
  const assessmentIds = pairs.map((pair) => pair.assessmentId);
  const studentIds = pairs.map((pair) => pair.studentId);
  // Recheck eligibility and score limits inside the write transaction.
  const assessments = await Assessment.find({ ...scope, _id: { $in: assessmentIds } }).select("subjectId classSections totalItems").session(session).lean();
  const students = await Student.find({ ...scope, _id: { $in: studentIds } }).select("subjectIds grade sectionId").session(session).lean();
  const assessmentsById = new Map(assessments.map((row) => [String(row._id), row]));
  const studentsById = new Map(students.map((row) => [String(row._id), row]));
  const now = new Date();
  return Promise.all(pairs.map(async ({ studentId, assessmentId }) => {
    const assessment = assessmentsById.get(String(assessmentId));
    const student = studentsById.get(String(studentId));
    if (!assessment || !student || !student.subjectIds?.some((id) => String(id) === String(assessment.subjectId))
      || !assessmentIncludesStudent(assessment, student)) {
      throw new SeedError("A planned pair is no longer eligible. Run a fresh preview before applying again.");
    }
    const document = new AssessmentScore({
      ...scope,
      studentId,
      assessmentId,
      score: generateScore(seed, studentId, assessment),
      createdAt: now,
      updatedAt: now,
    });
    await document.validate();
    return { updateOne: {
      filter: { ownerId: scope.ownerId, studentId, assessmentId },
      update: { $setOnInsert: document.toObject() },
      upsert: true,
      setDefaultsOnInsert: false,
    } };
  }));
}

async function applyBatch(scope, pairs, seed) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await mongoose.connection.transaction(async (session) => {
        const writes = await buildWrites(scope, pairs, seed, session);
        const result = await AssessmentScore.bulkWrite(writes, { ordered: true, timestamps: false, session });
        const inserted = Object.keys(result.upsertedIds).map((index) => writes[index].updateOne.update.$setOnInsert);
        if (result.modifiedCount || inserted.length !== result.upsertedCount) {
          throw new SeedError("The score batch did not produce insert-only results.");
        }
        if (inserted.length === 0) return { inserted };
        // bulkWrite skips the score document hooks. Mirror the insertMany audit payload.
        const changes = inserted.map(({ _id, score, studentId, assessmentId }) => ({ id: String(_id), score, studentId, assessmentId }));
        const [audit] = await AuditEvent.create([{ ...scope, action: "insertMany", resource: AssessmentScore.modelName, changes }], { session });
        return { inserted, auditId: audit._id, changes };
      }, { readPreference: "primary", readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } catch (error) {
      // A concurrent insert can win the unique-key race. Retry the aborted batch.
      if (error.code !== 11000 || attempt === 3) throw error;
    }
  }
}

async function requireScoreIndex() {
  const indexes = await AssessmentScore.collection.indexes();
  const hasIndex = indexes.some(({ key, unique, partialFilterExpression }) => (
    unique && !partialFilterExpression && Object.keys(key).length === Object.keys(SCORE_KEY).length
      && Object.keys(SCORE_KEY).every((field) => key[field] === 1 || key[field] === -1)
  ));
  if (!hasIndex) throw new SeedError("The unique index on ownerId, studentId and assessmentId is missing.");
}

async function verify(scope, before, batches) {
  const after = await readPlan(scope);
  const byId = new Map(after.scores.map((row) => [String(row._id), row]));
  if (before.scores.some((row) => !isDeepStrictEqual(row, byId.get(String(row._id))))) {
    throw new SeedError("Verification found a change in an existing score or its timestamps.");
  }
  const missingAfter = before.missing.some(({ studentId, assessmentId }) => !after.existingByPair.has(pairKey(studentId, assessmentId)));
  if (missingAfter || after.missing.length) throw new SeedError("Verification found planned or currently eligible scores still missing.");
  const checks = batches.flatMap(({ inserted }) => inserted);
  for (const expected of checks) {
    const stored = byId.get(String(expected._id));
    const assessment = after.eligible.get(pairKey(expected.studentId, expected.assessmentId));
    if (!isDeepStrictEqual(expected, stored) || !assessment || stored.score > assessment.totalItems) {
      throw new SeedError("Verification found a generated score that changed or no longer meets eligibility or score limits.");
    }
  }
  const auditBatches = batches.filter(({ auditId }) => auditId);
  const audits = await AuditEvent.find({ ...scope, _id: { $in: auditBatches.map(({ auditId }) => auditId) } })
    .select("actorName action resource changes").lean();
  const auditsById = new Map(audits.map((row) => [String(row._id), row]));
  for (const { auditId, changes } of auditBatches) {
    const audit = auditsById.get(String(auditId));
    if (audit?.actorName !== ACTOR_NAME || audit.action !== "insertMany" || audit.resource !== AssessmentScore.modelName
      || !isDeepStrictEqual(audit.changes, changes)) {
      throw new SeedError("Verification could not match every inserted score to its batch audit entry.");
    }
  }
  return {
    scoresInserted: checks.length,
    existingScoresVerifiedUnchanged: before.scores.length,
    assessmentsWithoutEligibleStudents: after.assessmentsWithoutEligibleStudents,
    auditEntriesVerified: audits.length,
    scoresStillMissing: after.missing.length,
  };
}

export async function runSampleScores(target, { apply, seed }, report = () => {}) {
  const { ownerId, schoolYearId } = target;
  const scope = { ownerId, schoolYearId };
  return academicContext.run({ ...scope, actorName: ACTOR_NAME }, async () => {
    const before = await readPlan(scope);
    report(apply ? "Apply plan" : "Preview", { target, ...summarize(before) });
    const batches = [];
    if (!apply) return before;
    if (before.missing.length) await requireScoreIndex();
    for (let offset = 0; offset < before.missing.length; offset += BATCH_SIZE) {
      const batch = await applyBatch(scope, before.missing.slice(offset, offset + BATCH_SIZE), seed);
      batches.push(batch);
      report("Committed batch", { scoresInserted: batch.inserted.length });
    }
    const result = await verify(scope, before, batches);
    report("Verified", result);
    return result;
  });
}

function safeError(error) {
  if (error instanceof SeedError) return error.message;
  if (error.syscall === "querySrv" || error.syscall === "queryTxt") return "MongoDB Atlas DNS lookup failed.";
  if (error.name === "ValidationError") return "A generated document failed schema validation.";
  if (error.name === "MongooseServerSelectionError" || error.name === "MongoServerSelectionError") return "Could not reach the configured MongoDB database.";
  if (Number.isInteger(error.code)) return `MongoDB operation failed with code ${error.code}.`;
  return "The sample-score operation failed.";
}

async function main() {
  dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
  const settings = parseSettings(process.argv.slice(2));
  if (settings.help) {
    console.log(HELP);
    return;
  }
  if (!process.env.MONGODB_URI) throw new SeedError("MONGODB_URI is missing from the environment.");
  await connectMongoDatabase();
  const targets = await findTargets(settings);
  if (targets.length === 0) throw new SeedError("No matching owner and school-year scope was found.");
  if (targets.length !== 1) {
    console.log("Available targets", JSON.stringify(targets, null, 2));
    throw new SeedError("Multiple targets match. Select one with --owner-id and --school-year-id.");
  }
  await runSampleScores(targets[0], settings, (label, data) => console.log(label, JSON.stringify(data, null, 2)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  } finally {
    try {
      await disconnectMongoDatabase();
    } catch {
      console.error("Could not close the MongoDB connection.");
      process.exitCode = 1;
    }
  }
}
