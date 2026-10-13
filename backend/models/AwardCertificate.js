import mongoose from "mongoose";
import academicPlugin from "./academicPlugin.js";
const schema = new mongoose.Schema({ ownerId: { type: mongoose.Schema.Types.ObjectId, required: true }, studentId: { type: mongoose.Schema.Types.ObjectId, default: null }, certificate: { type: mongoose.Schema.Types.Mixed, required: true } }, { timestamps: true });
schema.plugin(academicPlugin);
export default mongoose.models.AwardCertificate || mongoose.model("AwardCertificate", schema);
