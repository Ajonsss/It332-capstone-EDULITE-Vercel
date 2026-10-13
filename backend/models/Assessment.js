import mongoose from "mongoose";
import academicPlugin from "./academicPlugin.js";

/*
  ============================================================
  EduLITE 3-Term Assessment Model
  ============================================================

  Written Works and Performance Tasks are FLEXIBLE.

  They do not have a required count and do not need numbered
  ECR slots.

  Example:

    Written Work:
      Vocabulary Exercise
      Reading Activity
      Essay
      Oral Recitation

  All four are simply written_work assessments.

  Performance Task:
      Science Project
      Group Presentation

  Both are simply performance_task assessments.

  Only Summative Tests and the Term Examination need a sequence:

      summative_test + sequence 1 = ST1
      summative_test + sequence 2 = ST2

      term_exam + sequence 1 = Term Exam
*/

export const TERM_NUMBERS = Object.freeze([
  1,
  2,
  3,
]);

export const ASSESSMENT_CATEGORIES = Object.freeze([
  "written_work",
  "performance_task",
  "summative_test",
  "term_exam",
]);

export const CATEGORY_LABELS = Object.freeze({
  written_work:
    "Written / Oral Works",

  performance_task:
    "Product / Performance Tasks",

  summative_test:
    "Summative Test",

  term_exam:
    "Term Examination",
});

const LEGACY_ASSESSMENT_TYPES = [
  "Major Exam",
  "Activity",
  "Quiz",
];

const assessmentSchema =
  new mongoose.Schema(
    {
      ownerId: {
        type:
          mongoose.Schema.Types.ObjectId,

        ref:
          "User",

        required: [
          true,
          "Assessment owner is required.",
        ],

        index:
          true,
      },

      name: {
        type:
          String,

        required: [
          true,
          "Assessment name is required.",
        ],

        trim:
          true,
      },

      term: {
        type:
          Number,

        required: [
          true,
          "Assessment term is required.",
        ],

        enum: {
          values:
            TERM_NUMBERS,

          message:
            "Assessment term must be Term 1, Term 2, or Term 3.",
        },

        index:
          true,
      },

      category: {
        type:
          String,

        required: [
          true,
          "Assessment grading category is required.",
        ],

        enum: {
          values:
            ASSESSMENT_CATEGORIES,

          message:
            "Assessment category must be written_work, performance_task, summative_test, or term_exam.",
        },

        index:
          true,
      },

      /*
        Sequence is intentionally optional.

        written_work:
          sequence = null

        performance_task:
          sequence = null

        summative_test:
          sequence = 1 or 2

        term_exam:
          sequence = 1
      */
      sequence: {
        type:
          Number,

        required:
          false,

        default:
          null,

        min: [
          1,
          "Assessment sequence must be at least 1.",
        ],

        validate: {
          validator(
            value,
          ) {
            return (
              value === null ||
              value === undefined ||
              Number.isInteger(
                value,
              )
            );
          },

          message:
            "Assessment sequence must be a whole number.",
        },

        index:
          true,
      },

      /*
        Previous EduLITE assessment type.

        Retained only so existing legacy records remain readable.
      */
      type: {
        type:
          String,

        enum: {
          values:
            LEGACY_ASSESSMENT_TYPES,

          message:
            "Legacy type must be Major Exam, Activity, or Quiz.",
        },

        required:
          false,
      },

      date: {
        type:
          Date,

        required: [
          true,
          "Assessment date is required.",
        ],

        index:
          true,
      },

      /*
        Highest Possible Score (HPS).

        We keep the existing database field name totalItems to
        avoid breaking old AssessmentScore/database references.
      */
      totalItems: {
        type:
          Number,

        required: [
          true,
          "Highest Possible Score is required.",
        ],

        min: [
          1,
          "Highest Possible Score must be at least 1.",
        ],

        validate: {
          validator:
            Number.isInteger,

          message:
            "Highest Possible Score must be a whole number.",
        },
      },

      budgetOfWork: {
        type: String,
        trim: true,
        default: "",
        maxlength: [5000, "Budget of Work must be at most 5000 characters."],
      },

      subjectId: {
        type:
          mongoose.Schema.Types.ObjectId,

        ref:
          "Subject",

        required: [
          true,
          "Assessment subject is required.",
        ],

        index:
          true,
      },
    },

    {
      timestamps:
        true,

      versionKey:
        false,

      collection:
        "assessments",
    },
  );

assessmentSchema.pre(
  "validate",

  function normalizeAssessment() {
    if (
      typeof this.name ===
      "string"
    ) {
      this.name =
        this.name
          .trim()
          .replace(
            /\s+/g,
            " ",
          );
    }
  },
);

assessmentSchema.index({
  ownerId:
    1,

  subjectId:
    1,

  date:
    -1,
});

assessmentSchema.index({
  ownerId:
    1,

  subjectId:
    1,

  term:
    1,

  category:
    1,

  date:
    1,
});

/*
  Useful for ST1/ST2/Term Exam lookups.

  This is NOT unique because WW/PT intentionally store sequence
  as null and may have many records.
*/
assessmentSchema.index({
  ownerId:
    1,

  subjectId:
    1,

  term:
    1,

  category:
    1,

  sequence:
    1,
});

assessmentSchema.plugin(academicPlugin);

const Assessment =
  mongoose.models.Assessment ||
  mongoose.model(
    "Assessment",
    assessmentSchema,
  );

export default Assessment;