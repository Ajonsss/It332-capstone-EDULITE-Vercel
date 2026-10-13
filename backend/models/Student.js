import mongoose from "mongoose";
import academicPlugin from "./academicPlugin.js";

const studentSchema =
  new mongoose.Schema(
    {
      previousEnrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
      archived: { type: Boolean, default: false, index: true },
      archivedAt: { type: Date, default: null },
      archiveSnapshot: { type: mongoose.Schema.Types.Mixed, select: false },

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
          "Student name is required.",
        ],
        trim: true,
      },

      grade: {
        type: Number,
        required: true,
        min: 1,
        validate: {
          validator: Number.isInteger,
          message:
            "Grade must be a whole number.",
        },
      },

      sectionId: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "Section",
        required: true,
        index: true,
      },

      subjectIds: {
        type: [
          {
            type:
              mongoose.Schema.Types
                .ObjectId,
            ref: "Subject",
          },
        ],
        required: true,
        validate: {
          validator(value) {
            return (
              Array.isArray(value) &&
              value.length > 0
            );
          },
          message:
            "Select at least one subject for the student.",
        },
      },
    },
    {
      timestamps: true,
      collection: "students",
    },
  );

studentSchema.plugin(academicPlugin);

// Active class workflows exclude archives; archive routes explicitly opt in.
studentSchema.pre(/^find/, function excludeArchives() {
  if (!this.getOptions().includeArchived) this.where({ archived: { $ne: true } });
});
studentSchema.pre("countDocuments", function countActiveStudents() {
  if (!this.getOptions().includeArchived) this.where({ archived: { $ne: true } });
});
studentSchema.index({ ownerId: 1, archived: 1, archivedAt: -1 });

studentSchema.pre(
  "validate",
  function normalizeStudent() {
    if (typeof this.name === "string") {
      this.name = this.name
        .trim()
        .replace(/\s+/g, " ");
    }

    if (Array.isArray(this.subjectIds)) {
      this.subjectIds = [
        ...new Map(
          this.subjectIds.map(
            (subjectId) => [
              String(subjectId),
              subjectId,
            ],
          ),
        ).values(),
      ];
    }
  },
);

studentSchema.index({
  ownerId: 1,
  subjectIds: 1,
});

studentSchema.index({
  ownerId: 1,
  grade: 1,
  sectionId: 1,
  name: 1,
});

const Student =
  mongoose.models.Student ||
  mongoose.model(
    "Student",
    studentSchema,
  );

export default Student;