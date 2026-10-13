import mongoose from "mongoose";
const schema = new mongoose.Schema({ ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, name: { type: String, required: true, trim: true, maxlength: 40 }, rules: { type: mongoose.Schema.Types.Mixed, default: () => ({}) } }, { timestamps: true });
schema.index({ ownerId: 1, name: 1 }, { unique: true });
export default mongoose.models.SchoolYear || mongoose.model("SchoolYear", schema);
