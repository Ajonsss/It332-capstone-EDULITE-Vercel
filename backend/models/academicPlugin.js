import mongoose from "mongoose";
import { getAcademicContext } from "../services/academicContext.js";
import AuditEvent from "./AuditEvent.js";

export default function academicPlugin(schema, { scopeSchoolYear = true } = {}) {
  if (scopeSchoolYear) schema.add({ schoolYearId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolYear", default: () => getAcademicContext()?.schoolYearId ?? null, index: true } });
  schema.pre(/^(find|count|update|delete)/, function scopeYear() {
    const context = getAcademicContext();
    if (!context) return;
    this.where({ ownerId: context.ownerId });
    if (scopeSchoolYear && !this.getOptions().acrossSchoolYears) this.where({ schoolYearId: context.schoolYearId ?? null });
  });
  schema.pre(/^(findOneAndUpdate|updateOne|updateMany|findOneAndDelete|deleteOne|deleteMany)$/, async function captureChange() {
    if (!getAcademicContext()) return;
    this.auditBefore = await this.model.collection.find(this.getFilter(), { session: this.getOptions().session, projection: { pdfData: 0 } }).limit(100).toArray();
  });
  schema.post(/^(findOneAndUpdate|updateOne|updateMany|findOneAndDelete|deleteOne|deleteMany)$/, async function recordChange(result) {
    const context = getAcademicContext();
    if (!context || ((this.op === "findOneAndUpdate" || this.op === "findOneAndDelete") && !result) || (!this.auditBefore?.length && !result?.upsertedId)) return;
    await AuditEvent.create([{ ownerId: context.ownerId, schoolYearId: context.schoolYearId, action: this.op, resource: this.model.modelName, recordId: String(this.getFilter()._id ?? result?.upsertedId ?? "batch"), before: this.auditBefore, changes: this.getUpdate() ?? { deleted: true } }], { session: this.getOptions().session });
  });
  schema.post("save", async function recordSave(doc) {
    const context = getAcademicContext();
    if (context) await AuditEvent.create([{ ownerId: context.ownerId, schoolYearId: doc.schoolYearId, action: "save", resource: doc.constructor.modelName, recordId: String(doc._id), changes: Object.fromEntries(Object.entries(doc.toObject()).filter(([key]) => key !== "pdfData")) }], { session: doc.$session() });
  });
  schema.post("insertMany", async function recordInsert(docs) {
    const context = getAcademicContext();
    if (context && docs.length) await AuditEvent.create([{ ownerId: context.ownerId, schoolYearId: context.schoolYearId, action: "insertMany", resource: this.modelName, changes: docs.map((doc) => ({ id: String(doc._id), score: doc.score, studentId: doc.studentId, assessmentId: doc.assessmentId })) }], { session: docs[0].$session?.() });
  });
}
