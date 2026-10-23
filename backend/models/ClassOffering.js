import mongoose from "mongoose";
import academicPlugin from "./academicPlugin.js";

const classOfferingSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  grade: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  // A null section stores a registered grade level before its first section.
  sectionId: { type: mongoose.Schema.Types.ObjectId, ref: "Section", default: null },
  subjectIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Subject" }],
}, { timestamps: true, collection: "classOfferings" });
classOfferingSchema.plugin(academicPlugin);
classOfferingSchema.index({ ownerId: 1, schoolYearId: 1, grade: 1, sectionId: 1 }, { unique: true, name: "unique_class_per_year_grade_section" });

export default mongoose.models.ClassOffering || mongoose.model("ClassOffering", classOfferingSchema);
