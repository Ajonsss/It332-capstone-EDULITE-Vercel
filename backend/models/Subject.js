import mongoose from "mongoose";
import academicPlugin from "./academicPlugin.js";

const subjectSchema =
  new mongoose.Schema(
    {
      legacyId: {
        type: Number,
        default: null,
      },

      ownerId: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },

      name: {
        type: String,
        required: [
          true,
          "Subject name is required.",
        ],
        trim: true,
      },

      nameKey: {
        type: String,
        required: true,
      },
    },
    {
      timestamps: true,
      collection: "subjects",
    },
  );

subjectSchema.pre(
  "validate",
  function normalizeSubject() {
    if (typeof this.name === "string") {
      this.name = this.name
        .trim()
        .replace(/\s+/g, " ");

      this.nameKey =
        this.name.toLowerCase();
    }
  },
);

subjectSchema.index(
  {
    ownerId: 1,
    nameKey: 1,
  },
  {
    unique: true,
    name:
      "unique_subject_name_per_owner",
  },
);

subjectSchema.plugin(academicPlugin, { scopeSchoolYear: false });

const Subject =
  mongoose.models.Subject ||
  mongoose.model(
    "Subject",
    subjectSchema,
  );

export default Subject;