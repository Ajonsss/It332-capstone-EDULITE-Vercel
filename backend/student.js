import express from "express";
import mongoose from "mongoose";

import Student from "./models/Student.js";
import Section from "./models/Section.js";
import Subject from "./models/Subject.js";
import Assessment from "./models/Assessment.js";
import AssessmentScore from "./models/AssessmentScore.js";
import Intervention from "./models/Intervention.js";
import AwardCertificate from "./models/AwardCertificate.js";
import StudentAiInsight from "./models/StudentAiInsight.js";
import { parseWholeNumber } from "../shared/inputValidation.mjs";

import {
  requireAuth,
} from "./middleware/auth.js";

const router = express.Router();

function normalizeText(value) {
  return typeof value === "string"
    ? value
        .trim()
        .replace(/\s+/g, " ")
    : "";
}

function isValidId(value) {
  return mongoose.Types.ObjectId.isValid(
    value,
  );
}

function normalizeIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.map(String),
    ),
  ];
}

function formatStudent(student) {
  const subjects =
    (
      student.subjectIds ?? []
    ).filter(Boolean);

  return {
    id: student._id.toString(),
    name: student.name,
    grade: student.grade,

    section:
      student.sectionId?.name ??
      "",

    section_id:
      student.sectionId?._id
        ?.toString() ?? null,

    subjects: subjects.map(
      (subject) => ({
        id:
          subject._id.toString(),
        name: subject.name,
      }),
    ),

    subject_ids:
      subjects.map((subject) =>
        subject._id.toString(),
      ),

    subject_names:
      subjects.map(
        (subject) =>
          subject.name,
      ),
  };
}

async function findStudent(
  studentId,
  ownerId,
) {
  return Student.findOne({
    _id: studentId,
    ownerId,
  })
    .populate({
      path: "sectionId",
      select: "name",
      match: { ownerId },
    })
    .populate({
      path: "subjectIds",
      select: "name nameKey",
      match: { ownerId },
      options: {
        sort: { nameKey: 1 },
      },
    })
    .lean();
}

async function validateStudent(
  body,
  ownerId,
) {
  const name =
    normalizeText(body.name);

  const grade = parseWholeNumber(
    body.grade,
  );

  const sectionName =
    normalizeText(
      body.section,
    );

  const subjectIds =
    normalizeIds(
      body.subject_ids,
    );

  if (!name) {
    return {
      error:
        "Student name is required.",
    };
  }

  if (
    !Number.isInteger(grade) ||
    grade <= 0
  ) {
    return {
      error:
        "Grade must be a positive whole number.",
    };
  }

  if (!sectionName) {
    return {
      error:
        "Section is required.",
    };
  }

  if (!subjectIds.length) {
    return {
      error:
        "Select at least one subject for the student.",
    };
  }

  if (
    subjectIds.some(
      (id) => !isValidId(id),
    )
  ) {
    return {
      error:
        "One or more selected subjects are invalid.",
    };
  }

  const section =
    await Section.findOne({
      ownerId,

      nameKey:
        sectionName.toLowerCase(),
    });

  if (!section) {
    return {
      error:
        "The selected section does not exist.",
    };
  }

  const subjects =
    await Subject.find({
      ownerId,

      _id: {
        $in: subjectIds,
      },
    });

  if (
    subjects.length !==
    subjectIds.length
  ) {
    return {
      error:
        "One or more selected subjects do not exist.",
    };
  }

  return {
    value: {
      name,
      grade,

      sectionId:
        section._id,

      subjectIds:
        subjects.map(
          (subject) =>
            subject._id,
        ),
    },
  };
}

router.get(
  "/students",
  requireAuth,
  async (req, res) => {
    try {
      const ownerId = req.user.id;
      const filter = { ownerId };

      if (
        req.query.subject_id
      ) {
        if (
          !isValidId(
            req.query.subject_id,
          )
        ) {
          return res.status(400).json({
            message:
              "The subject ID is invalid.",
          });
        }

        const subject =
          await Subject.findOne({
            _id:
              req.query.subject_id,
            ownerId,
          });

        if (!subject) {
          return res.status(404).json({
            message:
              "Subject not found.",
          });
        }

        filter.subjectIds =
          subject._id;
      }

      const students =
        await Student.find(filter)
          .populate({
            path: "sectionId",
            select: "name",
            match: { ownerId },
          })
          .populate({
            path: "subjectIds",
            select: "name nameKey",
            match: { ownerId },
            options: {
              sort: { nameKey: 1 },
            },
          })
          .sort({
            grade: 1,
            name: 1,
          })
          .lean();

      return res.json(
        students.map(
          formatStudent,
        ),
      );
    } catch (error) {
      console.error(
        "GET /students failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to load students.",
      });
    }
  },
);

router.get(
  "/students/:id",
  requireAuth,
  async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({
        message:
          "Student not found.",
      });
    }

    try {
      const student =
        await findStudent(
          req.params.id,
          req.user.id,
        );

      if (!student) {
        return res.status(404).json({
          message:
            "Student not found.",
        });
      }

      return res.json(
        formatStudent(student),
      );
    } catch (error) {
      console.error(
        "GET /students/:id failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to load the student.",
      });
    }
  },
);

router.post(
  "/students",
  requireAuth,
  async (req, res) => {
    try {
      const ownerId = req.user.id;

      const validation =
        await validateStudent(
          req.body,
          ownerId,
        );

      if (validation.error) {
        return res.status(400).json({
          message:
            validation.error,
        });
      }

      const student =
        await Student.create({
          ownerId,
          ...validation.value,
        });

      const populated =
        await findStudent(
          student._id,
          ownerId,
        );

      return res.status(201).json({
        message:
          "Student added successfully.",

        ...formatStudent(
          populated,
        ),
      });
    } catch (error) {
      console.error(
        "POST /students failed:",
        {
          message: error.message,
          code: error.code,
          keyPattern:
            error.keyPattern,
          keyValue:
            error.keyValue,
        },
      );

      if (error?.code === 11000) {
        if (
          error.keyPattern
            ?.legacyId
        ) {
          return res.status(409).json({
            message:
              "The legacyId_1 index is blocking this student. Remove that index from the students collection.",
          });
        }

        return res.status(409).json({
          message:
            "A student with this information already exists.",
        });
      }

      return res.status(500).json({
        message:
          "Unable to add the student.",
      });
    }
  },
);

router.put(
  "/students/:id",
  requireAuth,
  async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({
        message:
          "Student not found.",
      });
    }

    try {
      const ownerId = req.user.id;

      const validation =
        await validateStudent(
          req.body,
          ownerId,
        );

      if (validation.error) {
        return res.status(400).json({
          message:
            validation.error,
        });
      }

      const student =
        await Student.findOneAndUpdate(
          {
            _id: req.params.id,
            ownerId,
          },
          {
            $set:
              validation.value,
          },
          {
            new: true,
            runValidators: true,
          },
        );

      if (!student) {
        return res.status(404).json({
          message:
            "Student not found.",
        });
      }

      const unavailable =
        await Assessment.find({
          ownerId,

          subjectId: {
            $nin:
              validation.value
                .subjectIds,
          },
        }).select("_id");

      await AssessmentScore.deleteMany({
        ownerId,
        studentId:
          student._id,

        assessmentId: {
          $in: unavailable.map(
            (assessment) =>
              assessment._id,
          ),
        },
      });

      const populated =
        await findStudent(
          student._id,
          ownerId,
        );

      return res.json({
        message:
          "Student updated successfully.",

        ...formatStudent(
          populated,
        ),
      });
    } catch (error) {
      console.error(
        "PUT /students/:id failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to update the student.",
      });
    }
  },
);

router.put(
  "/students/:id/assessment-scores",
  requireAuth,
  async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({
        message:
          "Student not found.",
      });
    }

    if (
      !Array.isArray(
        req.body.scores,
      )
    ) {
      return res.status(400).json({
        message:
          "Scores must be an array.",
      });
    }

    try {
      const ownerId = req.user.id;

      const student =
        await Student.findOne({
          _id: req.params.id,
          ownerId,
        });

      if (!student) {
        return res.status(404).json({
          message:
            "Student not found.",
        });
      }

      const validatedScores = [];
      for (
        const entry
        of req.body.scores
      ) {
        const assessmentId =
          String(
            entry.assessment_id ??
              "",
          );

        if (
          !isValidId(
            assessmentId,
          )
        ) {
          return res.status(400).json({
            message:
              "Every score must include a valid assessment_id.",
          });
        }

        const assessment =
          await Assessment.findOne({
            _id: assessmentId,
            ownerId,

            subjectId: {
              $in:
                student.subjectIds,
            },
          });

        if (!assessment) {
          return res.status(400).json({
            message:
              "An assessment is not available for this student.",
          });
        }

        if (
          entry.score === null ||
          entry.score === "" ||
          entry.score ===
            undefined
        ) {
          validatedScores.push({ assessmentId: assessment._id, score: null });
          continue;
        }

        const score = parseWholeNumber(
          entry.score,
        );

        if (
          !Number.isInteger(score) ||
          score < 0 ||
          score >
            assessment.totalItems
        ) {
          return res.status(400).json({
            message:
              `Score must be from 0 to ${assessment.totalItems}.`,
          });
        }

        validatedScores.push({ assessmentId: assessment._id, score });
      }

      // Check every assessment and range before changing any score.
      for (const { assessmentId, score } of validatedScores) {
        if (score === null) {
          await AssessmentScore.deleteOne({ ownerId, studentId: student._id, assessmentId });
          continue;
        }
        await AssessmentScore.findOneAndUpdate(
          {
            ownerId,
            studentId:
              student._id,
            assessmentId,
          },
          {
            $set: { score },
            $setOnInsert: {
              ownerId,
              studentId:
                student._id,
              assessmentId,
            },
          },
          {
            upsert: true,
            runValidators: true,
          },
        );
      }

      return res.json({
        message:
          "Scores updated successfully.",
      });
    } catch (error) {
      console.error(
        "Score update failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to update the student scores.",
      });
    }
  },
);

router.delete(
  "/students/:id",
  requireAuth,
  async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({
        message:
          "Student not found.",
      });
    }

    try {
      const ownerId = req.user.id;

      const student =
        await Student.findOne({
          _id: req.params.id,
          ownerId,
        });

      if (!student) {
        return res.status(404).json({
          message:
            "Student not found.",
        });
      }

      const nextEnrollment = await Student.exists({ ownerId, previousEnrollmentId: student._id }).setOptions({ acrossSchoolYears: true, includeArchived: true });
      if (nextEnrollment) return res.status(409).json({ message: "This student has a next-year enrollment. Archive the original year record instead of deleting its enrollment history." });
      // Issued certificates retain their historical recipient snapshot after a student is deleted.
      await AwardCertificate.updateMany({ ownerId, studentId: student._id }, { $set: { studentId: null } });
      await Promise.all([
        Intervention.deleteMany({ ownerId, studentId: student._id }),
        AssessmentScore.deleteMany({
          ownerId,
          studentId:
            student._id,
        }),

        StudentAiInsight.deleteMany({
          ownerId,
          studentId:
            student._id,
        }),
      ]);

      await Student.deleteOne({
        _id: student._id,
        ownerId,
      });

      return res.json({
        message:
          "Student deleted successfully.",
      });
    } catch (error) {
      console.error(
        "DELETE /students/:id failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to delete the student.",
      });
    }
  },
);

export default router;
