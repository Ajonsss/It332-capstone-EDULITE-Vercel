import mongoose from "mongoose";
import academicPlugin from "./academicPlugin.js";
const schema = new mongoose.Schema({ ownerId: { type: mongoose.Schema.Types.ObjectId, required: true }, studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true }, title: { type: String, required: true, maxlength: 200 }, activities: { type: String, required: true, maxlength: 5000 }, difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "easy" }, dueDate: Date, status: { type: String, enum: ["assigned", "in_progress", "completed"], default: "assigned" }, baselineScore: { type: Number, min: 0, max: 100 }, followUpScore: { type: Number, min: 0, max: 100 }, notes: { type: String, maxlength: 2000 } }, { timestamps: true });
schema.plugin(academicPlugin);
export default mongoose.models.Intervention || mongoose.model("Intervention", schema);
