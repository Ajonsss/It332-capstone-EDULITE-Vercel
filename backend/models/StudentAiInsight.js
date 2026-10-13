import mongoose from "mongoose";
import academicPlugin from "./academicPlugin.js";

const studentAiInsightSchema =
  new mongoose.Schema(
    {
      ownerId: {
        type:
          mongoose.Schema.Types
            .ObjectId,

        ref: "User",

        required: [
          true,
          "Insight owner is required.",
        ],

        index: true,
      },

      studentId: {
        type:
          mongoose.Schema.Types
            .ObjectId,

        ref: "Student",

        required: [
          true,
          "Insight student is required.",
        ],

        index: true,
      },

      supportType: {
        type: String,

        required: [
          true,
          "Support type is required.",
        ],

        enum: {
          values: [
            "intervention",
            "enrichment",
          ],

          message:
            "Support type must be intervention or enrichment.",
        },
      },

      classification: {
        type: String,

        required: [
          true,
          "Classification is required.",
        ],

        enum: {
          values: [
            "At Risk",
            "Within Expected Range",
            "High Performing",
          ],

          message:
            "The insight classification is invalid.",
        },
      },

      focusSubjectId: {
        type:
          mongoose.Schema.Types
            .ObjectId,

        ref: "Subject",

        default: null,
      },

      focusLabel: {
        type: String,

        required: [
          true,
          "Focus label is required.",
        ],

        trim: true,
      },

      model: {
        type: String,

        required: [
          true,
          "Gemini model is required.",
        ],

        trim: true,
      },

      title: {
        type: String,

        required: [
          true,
          "Insight title is required.",
        ],

        trim: true,
      },

      result: {
        type:
          mongoose.Schema.Types
            .Mixed,

        required: [
          true,
          "Insight result is required.",
        ],
      },

      pdfData: {
        type: Buffer,

        required: [
          true,
          "Insight PDF is required.",
        ],
      },
    },
    {
      timestamps: true,

      versionKey: false,

      collection:
        "studentAiInsights",
    },
  );

studentAiInsightSchema.index(
  {
    ownerId: 1,
    studentId: 1,
    createdAt: -1,
  },
  {
    name:
      "student_insights_by_owner_and_date",
  },
);

studentAiInsightSchema.index(
  {
    ownerId: 1,
    createdAt: -1,
  },
  {
    name:
      "insights_by_owner_and_date",
  },
);

studentAiInsightSchema.plugin(academicPlugin);

const StudentAiInsight =
  mongoose.models
    .StudentAiInsight ||
  mongoose.model(
    "StudentAiInsight",
    studentAiInsightSchema,
  );

export default StudentAiInsight;