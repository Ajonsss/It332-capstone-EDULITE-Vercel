import express from "express";
import mongoose from "mongoose";
import { isCalendarDate, parseWholeNumber, validateInput } from "../shared/inputValidation.mjs";

import Assessment, {
  ASSESSMENT_CATEGORIES,
  CATEGORY_LABELS,
  TERM_NUMBERS,
} from "./models/Assessment.js";

import AssessmentScore from "./models/AssessmentScore.js";
import Subject from "./models/Subject.js";
import Student from "./models/Student.js";

import {
  calculateStudentSubjectGrade,
} from "./utils/grading.js";

import {
  requireAuth,
} from "./middleware/auth.js";

const router = express.Router();

/*
  ============================================================
  FIXED ECR SLOT CONFIGURATION
  ============================================================
*/

const CATEGORY_SEQUENCE_LIMITS = Object.freeze({
  written_work: 5,
  performance_task: 3,
  summative_test: 2,
  term_exam: 1,
});

/*
  ============================================================
  BASIC HELPERS
  ============================================================
*/

function normalizeText(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function isValidDate(value) {
  return isCalendarDate(value);
}

function formatDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

/*
  ============================================================
  ECR SLOT HELPERS
  ============================================================
*/

function getSlotLabel(
  category,
  sequence,
) {
  if (
    !Number.isInteger(Number(sequence))
  ) {
    return null;
  }

  const numericSequence =
    parseWholeNumber(sequence);

  if (
    category === "written_work"
  ) {
    return `WW${numericSequence}`;
  }

  if (
    category === "performance_task"
  ) {
    return `PT${numericSequence}`;
  }

  if (
    category === "summative_test"
  ) {
    return `ST${numericSequence}`;
  }

  if (
    category === "term_exam"
  ) {
    return "Term Exam";
  }

  return null;
}

function validateSequence(
  category,
  sequence,
) {
  const maximum =
    CATEGORY_SEQUENCE_LIMITS[
      category
    ];

  if (!maximum) {
    return {
      valid: false,
      message:
        "The selected grading category is invalid.",
    };
  }

  const numericSequence =
    parseWholeNumber(sequence);

  if (
    !Number.isInteger(
      numericSequence,
    ) ||
    numericSequence < 1 ||
    numericSequence > maximum
  ) {
    if (
      category === "written_work"
    ) {
      return {
        valid: false,
        message:
          "Written / Oral Works must use WW1 through WW5.",
      };
    }

    if (
      category ===
      "performance_task"
    ) {
      return {
        valid: false,
        message:
          "Product / Performance Tasks must use PT1 through PT3.",
      };
    }

    if (
      category ===
      "summative_test"
    ) {
      return {
        valid: false,
        message:
          "Summative Test must use ST1 or ST2.",
      };
    }

    return {
      valid: false,
      message:
        "Term Examination uses the single Term Exam slot.",
    };
  }

  return {
    valid: true,
    sequence:
      numericSequence,
  };
}

/*
  ============================================================
  ASSESSMENT VALIDATION
  ============================================================
*/

async function validateAssessment(
  body,
  ownerId,
  {
    session = null,
    excludeAssessmentId = null,
  } = {},
) {
  const budgetError = validateInput(body.budget_of_work, { kind: "budgetOfWork", label: "Budget of Work", required: false });
  if (budgetError) return { error: budgetError };

  const name =
    normalizeText(body.name);

  const term =
    parseWholeNumber(body.term);

  const category =
    normalizeText(
      body.category,
    );

  const date =
    body.date;

  const totalItems =
    parseWholeNumber(
      body.total_items,
    );

  const subjectId =
    typeof body.subject_id === "string"
      ? body.subject_id.trim()
      : String(
          body.subject_id ?? "",
        );

  if (!name) {
    return {
      error:
        "Assessment name is required.",
    };
  }

  if (
    !TERM_NUMBERS.includes(term)
  ) {
    return {
      error:
        "Select Term 1, Term 2, or Term 3.",
    };
  }

  if (
    !ASSESSMENT_CATEGORIES.includes(
      category,
    )
  ) {
    return {
      error:
        "Select a valid ECR grading category.",
    };
  }

  /*
    Every category now requires a real ECR slot.
  */

  const sequenceValidation =
    validateSequence(
      category,
      body.sequence,
    );

  if (
    !sequenceValidation.valid
  ) {
    return {
      error:
        sequenceValidation.message,
    };
  }

  const sequence =
    sequenceValidation.sequence;

  if (!isValidDate(date)) {
    return {
      error:
        "A valid assessment date is required.",
    };
  }

  if (
    !Number.isInteger(
      totalItems,
    ) ||
    totalItems <= 0
  ) {
    return {
      error:
        "Highest Possible Score must be a positive whole number.",
    };
  }

  if (
    !isValidObjectId(subjectId)
  ) {
    return {
      error:
        "Select a valid subject for the assessment.",
    };
  }

  let subjectQuery =
    Subject.findOne({
      _id: subjectId,
      ownerId,
    });

  if (session) {
    subjectQuery =
      subjectQuery.session(
        session,
      );
  }

  const subject =
    await subjectQuery;

  if (!subject) {
    return {
      error:
        "The selected subject does not exist.",
    };
  }

  /*
    ==========================================================
    DUPLICATE ECR SLOT PREVENTION
    ==========================================================

    One subject + one term may only have:

      one WW1
      one WW2
      ...
      one PT1
      ...
      one ST1
      one ST2
      one Term Exam
  */

  const duplicateFilter = {
    ownerId,

    subjectId:
      subject._id,

    term,

    category,

    sequence,
  };

  if (
    excludeAssessmentId
  ) {
    duplicateFilter._id = {
      $ne:
        excludeAssessmentId,
    };
  }

  let duplicateQuery =
    Assessment.findOne(
      duplicateFilter,
    );

  if (session) {
    duplicateQuery =
      duplicateQuery.session(
        session,
      );
  }

  const duplicate =
    await duplicateQuery.lean();

  if (duplicate) {
    return {
      error:
        `${getSlotLabel(
          category,
          sequence,
        )} already exists for ${subject.name}, Term ${term}.`,
    };
  }

  return {
    value: {
      ...(body.budget_of_work !== undefined ? { budgetOfWork: (body.budget_of_work ?? "").trim() } : {}),
      name,

      term,

      category,

      sequence,

      date:
        new Date(
          `${date}T00:00:00.000Z`,
        ),

      totalItems,

      subjectId:
        subject._id,
    },
  };
}

/*
  ============================================================
  SCORE HELPERS
  ============================================================
*/

function normalizeScoreEntries(
  scores,
) {
  if (
    scores === undefined
  ) {
    return {
      value: [],
    };
  }

  if (
    !Array.isArray(scores)
  ) {
    return {
      error:
        "Scores must be an array.",
    };
  }

  const normalized = [];
  const seenStudentIds =
    new Set();

  for (const entry of scores) {
    const studentId =
      typeof entry.student_id ===
      "string"
        ? entry.student_id.trim()
        : String(
            entry.student_id ??
              "",
          );

    if (
      !isValidObjectId(studentId)
    ) {
      return {
        error:
          "Every score must have a valid student_id.",
      };
    }

    if (
      seenStudentIds.has(
        studentId,
      )
    ) {
      return {
        error:
          `Student ${studentId} appears more than once in the score list.`,
      };
    }

    seenStudentIds.add(
      studentId,
    );

    normalized.push({
      studentId,
      score:
        entry.score,
    });
  }

  return {
    value:
      normalized,
  };
}

async function validateScores(
  scores,
  totalItems,
  subjectId,
  ownerId,
  session = null,
) {
  const normalization =
    normalizeScoreEntries(scores);

  if (normalization.error) {
    return normalization;
  }

  const entries =
    normalization.value;

  if (entries.length === 0) {
    return {
      value: [],
    };
  }

  const studentIds =
    entries.map(
      (entry) =>
        entry.studentId,
    );

  let studentQuery =
    Student.find({
      _id: {
        $in: studentIds,
      },

      ownerId,

      subjectIds:
        subjectId,
    });

  if (session) {
    studentQuery =
      studentQuery.session(
        session,
      );
  }

  const students =
    await studentQuery;

  if (
    students.length !==
    studentIds.length
  ) {
    return {
      error:
        "Scores can only be recorded for students enrolled in the assessment subject.",
    };
  }

  const normalizedScores = [];

  for (const entry of entries) {
    /*
      Blank remains blank.

      No AssessmentScore document is created.
    */
    if (
      entry.score === "" ||
      entry.score === null ||
      entry.score === undefined
    ) {
      continue;
    }

    const score =
      parseWholeNumber(entry.score);

    if (
      !Number.isInteger(score) ||
      score < 0 ||
      score > totalItems
    ) {
      return {
        error:
          `Each score must be a whole number from 0 to ${totalItems}.`,
      };
    }

    normalizedScores.push({
      studentId:
        entry.studentId,

      score,
    });
  }

  return {
    value:
      normalizedScores,
  };
}

/*
  ============================================================
  RESPONSE FORMATTER
  ============================================================
*/

function formatAssessment(
  assessment,
  scoreCount = 0,
) {
  const subject =
    assessment.subjectId;

  const category =
    assessment.category ??
    null;

  const term =
    assessment.term ??
    null;

  const sequence =
    assessment.sequence ??
    null;

  return {
    id:
      assessment._id.toString(),

    name:
      assessment.name,

    term,

    term_label:
      term
        ? `Term ${term}`
        : "Legacy / Unclassified",

    category,

    category_label:
      CATEGORY_LABELS[
        category
      ] ??
      assessment.type ??
      "Legacy / Unclassified",

    sequence,

    slot_label:
      getSlotLabel(
        category,
        sequence,
      ) ??
      "Legacy / Unclassified",

    type:
      CATEGORY_LABELS[
        category
      ] ??
      assessment.type ??
      "Legacy / Unclassified",

    legacy_type:
      assessment.type ??
      null,

    date:
      formatDate(
        assessment.date,
      ),

    budget_of_work: assessment.budgetOfWork ?? "",

    total_items:
      assessment.totalItems,

    subject_id:
      subject?._id
        ? subject._id.toString()
        : assessment.subjectId
            ?.toString(),

    subject_name:
      subject?.name ?? "",

    score_count:
      scoreCount,

    is_structured:
      TERM_NUMBERS.includes(
        term,
      ) &&
      ASSESSMENT_CATEGORIES.includes(
        category,
      ) &&
      validateSequence(
        category,
        sequence,
      ).valid,
  };
}

/*
  ============================================================
  GET ASSESSMENT RECORDS
  ============================================================
*/

router.get(
  "/assessment-records",

  requireAuth,

  async (req, res) => {
    try {
      const ownerId =
        req.user.id;

      const scores =
        await AssessmentScore
          .find({
            ownerId,
          })
          .populate({
            path:
              "studentId",

            match: {
              ownerId,
            },

            select:
              "name grade sectionId",

            populate: {
              path:
                "sectionId",

              match: {
                ownerId,
              },

              select:
                "name",
            },
          })
          .populate({
            path:
              "assessmentId",

            match: {
              ownerId,
            },

            select:
              "name type term category sequence date totalItems subjectId",

            populate: {
              path:
                "subjectId",

              match: {
                ownerId,
              },

              select:
                "name",
            },
          })
          .lean();

      const records =
        scores
          .filter(
            (record) =>
              record.studentId &&
              record.assessmentId &&
              record.assessmentId
                .subjectId,
          )
          .map((record) => {
            const assessment =
              record.assessmentId;

            const category =
              assessment.category ??
              null;

            const sequence =
              assessment.sequence ??
              null;

            const term =
              assessment.term ??
              null;

            return {
              id:
                record._id.toString(),

              score:
                record.score,

              student_id:
                record.studentId._id
                  .toString(),

              student_name:
                record.studentId.name,

              grade:
                record.studentId.grade,

              section:
                record.studentId
                  .sectionId
                  ?.name ?? "",

              assessment_id:
                assessment._id
                  .toString(),

              assessment_name:
                assessment.name,

              term,

              term_label:
                term
                  ? `Term ${term}`
                  : "Legacy / Unclassified",

              category,

              category_label:
                CATEGORY_LABELS[
                  category
                ] ??
                assessment.type ??
                "Legacy / Unclassified",

              sequence,

              slot_label:
                getSlotLabel(
                  category,
                  sequence,
                ),

              type:
                CATEGORY_LABELS[
                  category
                ] ??
                assessment.type ??
                "Legacy / Unclassified",

              legacy_type:
                assessment.type ??
                null,

              date:
                formatDate(
                  assessment.date,
                ),

              total_items:
                assessment.totalItems,

              subject_id:
                assessment.subjectId
                  ._id
                  .toString(),

              subject_name:
                assessment.subjectId
                  .name,
            };
          });

      records.sort(
        (first, second) => {
          const subjectOrder =
            first.subject_name.localeCompare(
              second.subject_name,
            );

          if (subjectOrder !== 0) {
            return subjectOrder;
          }

          const studentOrder =
            first.student_name.localeCompare(
              second.student_name,
            );

          if (studentOrder !== 0) {
            return studentOrder;
          }

          const termOrder =
            Number(
              first.term ?? 99,
            ) -
            Number(
              second.term ?? 99,
            );

          if (termOrder !== 0) {
            return termOrder;
          }

          const categoryOrder =
            String(
              first.category ?? "",
            ).localeCompare(
              String(
                second.category ?? "",
              ),
            );

          if (categoryOrder !== 0) {
            return categoryOrder;
          }

          return (
            Number(
              first.sequence ?? 99,
            ) -
            Number(
              second.sequence ?? 99,
            )
          );
        },
      );

      return res.json(records);
    } catch (error) {
      console.error(
        "GET /assessment-records failed:",
        error,
      );

      return res
        .status(500)
        .json({
          message:
            "Unable to load assessment records.",
        });
    }
  },
);

/*
  ============================================================
  GET OFFICIAL GRADE SUMMARIES
  ============================================================
*/

router.get(
  "/grade-summaries",

  requireAuth,

  async (req, res) => {
    try {
      const ownerId =
        req.user.id;

      const subjectFilter =
        req.query.subject_id !==
          undefined &&
        req.query.subject_id !== ""
          ? String(
              req.query.subject_id,
            )
          : null;

      if (
        subjectFilter !== null &&
        !isValidObjectId(
          subjectFilter,
        )
      ) {
        return res
          .status(400)
          .json({
            message:
              "The subject ID is invalid.",
          });
      }

      const students =
        await Student
          .find({
            ownerId,
          })
          .populate({
            path:
              "sectionId",

            select:
              "name",

            match: {
              ownerId,
            },
          })
          .populate({
            path:
              "subjectIds",

            select:
              "name",

            match: {
              ownerId,
            },
          })
          .sort({
            grade: 1,
            name: 1,
          })
          .lean();

      const assessmentFilter = {
        ownerId,

        term: {
          $in:
            TERM_NUMBERS,
        },

        category: {
          $in:
            ASSESSMENT_CATEGORIES,
        },
      };

      if (
        subjectFilter !== null
      ) {
        assessmentFilter.subjectId =
          subjectFilter;
      }

      const assessments =
        await Assessment
          .find(
            assessmentFilter,
          )
          .select(
            "name term category sequence totalItems subjectId date",
          )
          .sort({
            subjectId: 1,
            term: 1,
            category: 1,
            sequence: 1,
            date: 1,
          })
          .lean();

      const assessmentIds =
        assessments.map(
          (assessment) =>
            assessment._id,
        );

      const scores =
        assessmentIds.length
          ? await AssessmentScore
              .find({
                ownerId,

                assessmentId: {
                  $in:
                    assessmentIds,
                },
              })
              .lean()
          : [];

      const scoreMap =
        new Map(
          scores.map((score) => [
            `${score.studentId.toString()}:${score.assessmentId.toString()}`,
            score.score,
          ]),
        );

      const assessmentsBySubject =
        new Map();

      for (
        const assessment
        of assessments
      ) {
        const subjectId =
          assessment.subjectId
            .toString();

        if (
          !assessmentsBySubject.has(
            subjectId,
          )
        ) {
          assessmentsBySubject.set(
            subjectId,
            [],
          );
        }

        assessmentsBySubject
          .get(subjectId)
          .push(assessment);
      }

      const summaries = [];

      for (
        const student
        of students
      ) {
        const subjects =
          (
            student.subjectIds ??
            []
          ).filter(Boolean);

        for (
          const subject
          of subjects
        ) {
          const subjectId =
            subject._id.toString();

          if (
            subjectFilter !== null &&
            subjectId !== subjectFilter
          ) {
            continue;
          }

          /*
            IMPORTANT:

            Only assessments actually created are included.

            But each created assessment now has the correct
            WW/PT/ST/TE sequence.
          */
          const subjectAssessments =
            assessmentsBySubject.get(
              subjectId,
            ) ?? [];

          const records =
            subjectAssessments.map(
              (assessment) => {
                const key =
                  `${student._id.toString()}:${assessment._id.toString()}`;

                return {
                  assessmentId:
                    assessment._id
                      .toString(),

                  name:
                    assessment.name,

                  term:
                    assessment.term,

                  category:
                    assessment.category,

                  sequence:
                    assessment.sequence,

                  date:
                    assessment.date,

                  totalItems:
                    assessment.totalItems,

                  score:
                    scoreMap.has(key)
                      ? scoreMap.get(key)
                      : null,
                };
              },
            );

          const calculation =
            calculateStudentSubjectGrade(
              records,
            );

          summaries.push({
            student_id:
              student._id
                .toString(),

            student_name:
              student.name,

            grade:
              student.grade,

            section:
              student.sectionId
                ?.name ?? "",

            subject_id:
              subjectId,

            subject_name:
              subject.name,

            term1:
              calculation.terms
                .term1,

            term2:
              calculation.terms
                .term2,

            term3:
              calculation.terms
                .term3,

            final:
              calculation.final,

            is_complete:
              calculation.isComplete,

            is_fully_complete:
              calculation
                .isFullyComplete ??
              false,
          });
        }
      }

      return res.json(
        summaries,
      );
    } catch (error) {
      console.error(
        "GET /grade-summaries failed:",
        error,
      );

      return res
        .status(500)
        .json({
          message:
            "Unable to calculate grade summaries.",
        });
    }
  },
);

/*
  ============================================================
  GET ALL ASSESSMENTS
  ============================================================
*/

router.get(
  "/assessments",

  requireAuth,

  async (req, res) => {
    try {
      const ownerId =
        req.user.id;

      const filter = {
        ownerId,
      };

      if (
        req.query.subject_id !==
          undefined &&
        req.query.subject_id !== ""
      ) {
        if (
          !isValidObjectId(
            req.query.subject_id,
          )
        ) {
          return res
            .status(400)
            .json({
              message:
                "The subject ID is invalid.",
            });
        }

        const subject =
          await Subject
            .findOne({
              _id:
                req.query.subject_id,

              ownerId,
            })
            .lean();

        if (!subject) {
          return res
            .status(404)
            .json({
              message:
                "Subject not found.",
            });
        }

        filter.subjectId =
          subject._id;
      }

      if (
        req.query.term !==
          undefined &&
        req.query.term !== ""
      ) {
        const term =
          Number(
            req.query.term,
          );

        if (
          !TERM_NUMBERS.includes(
            term,
          )
        ) {
          return res
            .status(400)
            .json({
              message:
                "Term must be 1, 2, or 3.",
            });
        }

        filter.term = term;
      }

      const assessments =
        await Assessment
          .find(filter)
          .populate({
            path:
              "subjectId",

            select:
              "name",

            match: {
              ownerId,
            },
          })
          .sort({
            term: 1,
            subjectId: 1,
            category: 1,
            sequence: 1,
            date: 1,
            createdAt: 1,
          })
          .lean();

      const results =
        await Promise.all(
          assessments
            .filter(
              (assessment) =>
                assessment.subjectId,
            )
            .map(
              async (
                assessment,
              ) => {
                const scoreCount =
                  await AssessmentScore
                    .countDocuments({
                      ownerId,

                      assessmentId:
                        assessment._id,
                    });

                return formatAssessment(
                  assessment,
                  scoreCount,
                );
              },
            ),
        );

      return res.json(results);
    } catch (error) {
      console.error(
        "GET /assessments failed:",
        error,
      );

      return res
        .status(500)
        .json({
          message:
            "Unable to load assessments.",
        });
    }
  },
);

/*
  ============================================================
  GET ONE ASSESSMENT
  ============================================================
*/

router.get(
  "/assessments/:id",

  requireAuth,

  async (req, res) => {
    const assessmentId =
      req.params.id;

    if (
      !isValidObjectId(
        assessmentId,
      )
    ) {
      return res
        .status(404)
        .json({
          message:
            "Assessment not found.",
        });
    }

    try {
      const ownerId =
        req.user.id;

      const assessment =
        await Assessment
          .findOne({
            _id:
              assessmentId,

            ownerId,
          })
          .populate({
            path:
              "subjectId",

            select:
              "name",

            match: {
              ownerId,
            },
          })
          .lean();

      if (
        !assessment ||
        !assessment.subjectId
      ) {
        return res
          .status(404)
          .json({
            message:
              "Assessment not found.",
          });
      }

      const students =
        await Student
          .find({
            ownerId,

            subjectIds:
              assessment.subjectId
                ._id,
          })
          .populate({
            path:
              "sectionId",

            select:
              "name",

            match: {
              ownerId,
            },
          })
          .sort({
            grade: 1,
            name: 1,
          })
          .lean();

      const scores =
        await AssessmentScore
          .find({
            ownerId,

            assessmentId:
              assessment._id,
          })
          .lean();

      const scoreMap =
        new Map(
          scores.map((score) => [
            score.studentId
              .toString(),
            score,
          ]),
        );

      const formattedStudents =
        students.map(
          (student) => {
            const scoreRecord =
              scoreMap.get(
                student._id
                  .toString(),
              );

            return {
              id:
                student._id
                  .toString(),

              name:
                student.name,

              grade:
                student.grade,

              section:
                student.sectionId
                  ?.name ?? "",

              score:
                scoreRecord
                  ?.score ??
                null,

              score_id:
                scoreRecord?._id
                  ? scoreRecord._id
                      .toString()
                  : null,
            };
          },
        );

      return res.json({
        ...formatAssessment(
          assessment,
          scores.length,
        ),

        students:
          formattedStudents,

        scores:
          formattedStudents.map(
            (student) => ({
              student_id:
                student.id,

              score:
                student.score,
            }),
          ),
      });
    } catch (error) {
      console.error(
        "GET /assessments/:id failed:",
        error,
      );

      return res
        .status(500)
        .json({
          message:
            "Unable to load the assessment.",
        });
    }
  },
);

/*
  ============================================================
  CREATE ASSESSMENT
  ============================================================
*/

router.post(
  "/assessments",

  requireAuth,

  async (req, res) => {
    try {
      const ownerId =
        req.user.id;

      const assessmentValidation =
        await validateAssessment(
          req.body,
          ownerId,
        );

      if (
        assessmentValidation.error
      ) {
        return res
          .status(400)
          .json({
            message:
              assessmentValidation.error,
          });
      }

      const scoresValidation =
        await validateScores(
          req.body.scores,

          assessmentValidation
            .value.totalItems,

          assessmentValidation
            .value.subjectId,

          ownerId,
        );

      if (
        scoresValidation.error
      ) {
        return res
          .status(400)
          .json({
            message:
              scoresValidation.error,
          });
      }

      let createdAssessment =
        null;

      await mongoose.connection
        .transaction(
          async (session) => {
            const transactionValidation =
              await validateAssessment(
                req.body,

                ownerId,

                {
                  session,
                },
              );

            if (
              transactionValidation.error
            ) {
              const validationError =
                new Error(
                  transactionValidation.error,
                );

              validationError.statusCode =
                400;

              throw validationError;
            }

            const [
              assessment,
            ] =
              await Assessment.create(
                [
                  {
                    ownerId,

                    ...transactionValidation
                      .value,
                  },
                ],

                {
                  session,
                },
              );

            createdAssessment =
              assessment;

            if (
              scoresValidation
                .value.length > 0
            ) {
              await AssessmentScore
                .insertMany(
                  scoresValidation
                    .value
                    .map(
                      (entry) => ({
                        ownerId,

                        studentId:
                          entry.studentId,

                        assessmentId:
                          assessment._id,

                        score:
                          entry.score,
                      }),
                    ),

                  {
                    session,
                  },
                );
            }
          },
        );

      return res
        .status(201)
        .json({
          message:
            "Assessment created successfully.",

          id:
            createdAssessment._id
              .toString(),
        });
    } catch (error) {
      if (
        error?.statusCode
      ) {
        return res
          .status(
            error.statusCode,
          )
          .json({
            message:
              error.message,
          });
      }

      if (
        error?.name ===
        "ValidationError"
      ) {
        const firstError =
          Object.values(
            error.errors ?? {},
          )[0];

        return res
          .status(400)
          .json({
            message:
              firstError?.message ||
              "The assessment information is invalid.",
          });
      }

      console.error(
        "POST /assessments failed:",
        error,
      );

      return res
        .status(500)
        .json({
          message:
            "Unable to create the assessment.",
        });
    }
  },
);

/*
  ============================================================
  UPDATE ASSESSMENT
  ============================================================
*/

router.put(
  "/assessments/:id",

  requireAuth,

  async (req, res) => {
    const assessmentId =
      req.params.id;

    if (
      !isValidObjectId(
        assessmentId,
      )
    ) {
      return res
        .status(404)
        .json({
          message:
            "Assessment not found.",
        });
    }

    try {
      const ownerId =
        req.user.id;

      const existingAssessment =
        await Assessment
          .findOne({
            _id:
              assessmentId,

            ownerId,
          })
          .lean();

      if (
        !existingAssessment
      ) {
        return res
          .status(404)
          .json({
            message:
              "Assessment not found.",
          });
      }

      const assessmentValidation =
        await validateAssessment(
          req.body,

          ownerId,

          {
            excludeAssessmentId:
              existingAssessment._id,
          },
        );

      if (
        assessmentValidation.error
      ) {
        return res
          .status(400)
          .json({
            message:
              assessmentValidation.error,
          });
      }

      const scoresValidation =
        await validateScores(
          req.body.scores,

          assessmentValidation
            .value.totalItems,

          assessmentValidation
            .value.subjectId,

          ownerId,
        );

      if (
        scoresValidation.error
      ) {
        return res
          .status(400)
          .json({
            message:
              scoresValidation.error,
          });
      }

      await mongoose.connection
        .transaction(
          async (session) => {
            const transactionValidation =
              await validateAssessment(
                req.body,

                ownerId,

                {
                  session,

                  excludeAssessmentId:
                    existingAssessment._id,
                },
              );

            if (
              transactionValidation.error
            ) {
              const validationError =
                new Error(
                  transactionValidation.error,
                );

              validationError.statusCode =
                400;

              throw validationError;
            }

            const assessment =
              await Assessment
                .findOneAndUpdate(
                  {
                    _id:
                      assessmentId,

                    ownerId,
                  },

                  {
                    $set:
                      transactionValidation
                        .value,

                    $unset: {
                      type: "",
                    },
                  },

                  {
                    new: true,
                    runValidators: true,
                    session,
                  },
                );

            if (!assessment) {
              const error =
                new Error(
                  "Assessment not found.",
                );

              error.statusCode =
                404;

              throw error;
            }

            await AssessmentScore
              .deleteMany(
                {
                  ownerId,

                  assessmentId:
                    assessment._id,
                },

                {
                  session,
                },
              );

            if (
              scoresValidation
                .value.length > 0
            ) {
              await AssessmentScore
                .insertMany(
                  scoresValidation
                    .value
                    .map(
                      (entry) => ({
                        ownerId,

                        studentId:
                          entry.studentId,

                        assessmentId:
                          assessment._id,

                        score:
                          entry.score,
                      }),
                    ),

                  {
                    session,
                  },
                );
            }
          },
        );

      return res.json({
        message:
          "Assessment updated successfully.",

        id:
          assessmentId,
      });
    } catch (error) {
      if (
        error?.statusCode
      ) {
        return res
          .status(
            error.statusCode,
          )
          .json({
            message:
              error.message,
          });
      }

      if (
        error?.name ===
        "ValidationError"
      ) {
        const firstError =
          Object.values(
            error.errors ?? {},
          )[0];

        return res
          .status(400)
          .json({
            message:
              firstError?.message ||
              "The assessment information is invalid.",
          });
      }

      console.error(
        "PUT /assessments/:id failed:",
        error,
      );

      return res
        .status(500)
        .json({
          message:
            "Unable to update the assessment.",
        });
    }
  },
);

/*
  ============================================================
  UPDATE / CLEAR ONE STUDENT SCORE
  ============================================================
*/

router.put(
  "/assessments/:assessmentId/scores/:studentId",

  requireAuth,

  async (req, res) => {
    const {
      assessmentId,
      studentId,
    } = req.params;

    if (
      !isValidObjectId(
        assessmentId,
      )
    ) {
      return res
        .status(404)
        .json({
          message:
            "Assessment not found.",
        });
    }

    if (
      !isValidObjectId(
        studentId,
      )
    ) {
      return res
        .status(404)
        .json({
          message:
            "Student not found.",
        });
    }

    try {
      const ownerId =
        req.user.id;

      const assessment =
        await Assessment
          .findOne({
            _id:
              assessmentId,

            ownerId,
          })
          .lean();

      if (!assessment) {
        return res
          .status(404)
          .json({
            message:
              "Assessment not found.",
          });
      }

      const student =
        await Student
          .findOne({
            _id:
              studentId,

            ownerId,

            subjectIds:
              assessment.subjectId,
          })
          .lean();

      if (!student) {
        return res
          .status(400)
          .json({
            message:
              "The student is not enrolled in this assessment subject.",
          });
      }

      if (
        req.body.score === "" ||
        req.body.score === null ||
        req.body.score === undefined
      ) {
        await AssessmentScore
          .deleteOne({
            ownerId,

            studentId:
              student._id,

            assessmentId:
              assessment._id,
          });

        return res.json({
          message:
            "Score cleared.",

          score: null,
        });
      }

      const score =
        parseWholeNumber(
          req.body.score,
        );

      if (
        !Number.isInteger(score) ||
        score < 0 ||
        score >
          assessment.totalItems
      ) {
        return res
          .status(400)
          .json({
            message:
              `Score must be a whole number from 0 to ${assessment.totalItems}.`,
          });
      }

      const savedScore =
        await AssessmentScore
          .findOneAndUpdate(
            {
              ownerId,

              studentId:
                student._id,

              assessmentId:
                assessment._id,
            },

            {
              $set: {
                score,
              },

              $setOnInsert: {
                ownerId,

                studentId:
                  student._id,

                assessmentId:
                  assessment._id,
              },
            },

            {
              upsert: true,
              new: true,
              runValidators: true,
            },
          );

      return res.json({
        message:
          "Score saved.",

        id:
          savedScore._id
            .toString(),

        score:
          savedScore.score,
      });
    } catch (error) {
      console.error(
        "PUT assessment score failed:",
        error,
      );

      return res
        .status(500)
        .json({
          message:
            "Unable to save the score.",
        });
    }
  },
);

/*
  ============================================================
  DELETE ASSESSMENT
  ============================================================
*/

router.delete(
  "/assessments/:id",

  requireAuth,

  async (req, res) => {
    const assessmentId =
      req.params.id;

    if (
      !isValidObjectId(
        assessmentId,
      )
    ) {
      return res
        .status(404)
        .json({
          message:
            "Assessment not found.",
        });
    }

    try {
      const ownerId =
        req.user.id;

      const assessment =
        await Assessment
          .findOne({
            _id:
              assessmentId,

            ownerId,
          })
          .lean();

      if (!assessment) {
        return res
          .status(404)
          .json({
            message:
              "Assessment not found.",
          });
      }

      await mongoose.connection
        .transaction(
          async (session) => {
            await AssessmentScore
              .deleteMany(
                {
                  ownerId,

                  assessmentId:
                    assessment._id,
                },

                {
                  session,
                },
              );

            const result =
              await Assessment
                .deleteOne(
                  {
                    _id:
                      assessment._id,

                    ownerId,
                  },

                  {
                    session,
                  },
                );

            if (
              result.deletedCount === 0
            ) {
              const error =
                new Error(
                  "Assessment not found.",
                );

              error.statusCode =
                404;

              throw error;
            }
          },
        );

      return res.json({
        message:
          "Assessment deleted successfully.",
      });
    } catch (error) {
      if (
        error?.statusCode
      ) {
        return res
          .status(
            error.statusCode,
          )
          .json({
            message:
              error.message,
          });
      }

      console.error(
        "DELETE /assessments/:id failed:",
        error,
      );

      return res
        .status(500)
        .json({
          message:
            "Unable to delete the assessment.",
        });
    }
  },
);

export default router;
