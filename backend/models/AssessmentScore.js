import mongoose from "mongoose";
import academicPlugin from "./academicPlugin.js";

const assessmentScoreSchema =
  new mongoose.Schema(
    {
      ownerId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        required: [
          true,
          "Score owner is required.",
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
          "Score student is required.",
        ],
        index: true,
      },

      assessmentId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "Assessment",
        required: [
          true,
          "Score assessment is required.",
        ],
        index: true,
      },

      score: {
        type: Number,
        required: [
          true,
          "Score is required.",
        ],
        min: [
          0,
          "Score cannot be negative.",
        ],
        validate: {
          validator:
            Number.isInteger,

          message:
            "Score must be a whole number.",
        },
      },
    },
    {
      timestamps: true,
      versionKey: false,
      collection:
        "assessmentScores",
    },
  );

assessmentScoreSchema.index(
  {
    ownerId: 1,
    studentId: 1,
    assessmentId: 1,
  },
  {
    unique: true,
    name:
      "unique_student_assessment_score_per_owner",
  },
);

assessmentScoreSchema.plugin(academicPlugin);

const AssessmentScore =
  mongoose.models
    .AssessmentScore ||
  mongoose.model(
    "AssessmentScore",
    assessmentScoreSchema,
  );

export default AssessmentScore;