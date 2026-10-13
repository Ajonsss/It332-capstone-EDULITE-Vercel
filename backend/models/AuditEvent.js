import mongoose from "mongoose";
import { getAcademicContext } from "../services/academicContext.js";
const schema = new mongoose.Schema({ ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, schoolYearId: { type: mongoose.Schema.Types.ObjectId, default: null }, actorName: String, action: String, resource: String, recordId: String, before: mongoose.Schema.Types.Mixed, changes: mongoose.Schema.Types.Mixed }, { timestamps: true });
schema.pre("validate", function recordActor() { if (!this.actorName) this.actorName = getAcademicContext()?.actorName ?? "System"; });
export default mongoose.models.AuditEvent || mongoose.model("AuditEvent", schema);
