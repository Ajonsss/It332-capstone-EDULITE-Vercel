import express from "express";
import mongoose from "mongoose";

import Subject from "./models/Subject.js";
import Student from "./models/Student.js";
import Assessment from "./models/Assessment.js";

import {
  requireAuth,
} from "./middleware/auth.js";

const router = express.Router();

function normalizeName(value) {
  return typeof value === "string"
    ? value
        .trim()
        .replace(/\s+/g, " ")
    : "";
}

function createNameKey(value) {
  return normalizeName(
    value,
  ).toLowerCase();
}

function isValidId(value) {
  return mongoose.Types.ObjectId.isValid(
    value,
  );
}

function normalizeIds(value) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  return [
    ...new Set(
      value.map(String),
    ),
  ];
}

async function getCounts(
  subjectId,
  ownerId,
) {
  const [
    studentCount,
    assessmentCount,
  ] = await Promise.all([
    Student.countDocuments({
      ownerId,
      subjectIds: subjectId,
    }),

    Assessment.countDocuments({
      ownerId,
      subjectId,
    }),
  ]);

  return {
    studentCount,
    assessmentCount,
  };
}

router.get(
  "/subjects",
  requireAuth,
  async (req, res) => {
    try {
      const ownerId = req.user.id;

      const subjects =
        await Subject.find({
          ownerId,
        })
          .sort({ nameKey: 1 })
          .lean();

      const results =
        await Promise.all(
          subjects.map(
            async (subject) => {
              const {
                studentCount,
                assessmentCount,
              } = await getCounts(
                subject._id,
                ownerId,
              );

              return {
                id:
                  subject._id.toString(),
                name: subject.name,
                student_count:
                  studentCount,
                assessment_count:
                  assessmentCount,
              };
            },
          ),
        );

      return res.json(results);
    } catch (error) {
      console.error(
        "GET /subjects failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to load subjects.",
      });
    }
  },
);

router.get(
  "/subjects/:id",
  requireAuth,
  async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({
        message:
          "Subject not found.",
      });
    }

    try {
      const ownerId = req.user.id;

      const subject =
        await Subject.findOne({
          _id: req.params.id,
          ownerId,
        }).lean();

      if (!subject) {
        return res.status(404).json({
          message:
            "Subject not found.",
        });
      }

      const students =
        await Student.find({
          ownerId,
          subjectIds: subject._id,
        })
          .populate({
            path: "sectionId",
            select: "name",
            match: { ownerId },
          })
          .sort({
            grade: 1,
            name: 1,
          })
          .lean();

      const assessmentCount =
        await Assessment.countDocuments(
          {
            ownerId,
            subjectId:
              subject._id,
          },
        );

      return res.json({
        id: subject._id.toString(),
        name: subject.name,
        student_count:
          students.length,
        assessment_count:
          assessmentCount,

        students: students.map(
          (student) => ({
            id:
              student._id.toString(),
            name: student.name,
            grade: student.grade,
            section:
              student.sectionId
                ?.name ?? "",
          }),
        ),
      });
    } catch (error) {
      console.error(
        "GET /subjects/:id failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to load the subject.",
      });
    }
  },
);

router.post(
  "/subjects",
  requireAuth,
  async (req, res) => {
    const name =
      normalizeName(
        req.body.name,
      );

    const studentIds =
      normalizeIds(
        req.body.student_ids,
      );

    if (!name) {
      return res.status(400).json({
        message:
          "Subject name is required.",
      });
    }

    if (studentIds === null) {
      return res.status(400).json({
        message:
          "student_ids must be an array.",
      });
    }

    if (
      studentIds.some(
        (id) => !isValidId(id),
      )
    ) {
      return res.status(400).json({
        message:
          "One or more selected students are invalid.",
      });
    }

    try {
      const ownerId = req.user.id;
      const nameKey =
        createNameKey(name);

      const existing =
        await Subject.findOne({
          ownerId,
          nameKey,
        }).lean();

      if (existing) {
        return res.status(409).json({
          message:
            "A subject with this name already exists.",
        });
      }

      const ownedStudents =
        await Student.find({
          ownerId,
          _id: { $in: studentIds },
        }).select("_id");

      if (
        ownedStudents.length !==
        studentIds.length
      ) {
        return res.status(400).json({
          message:
            "One or more selected students do not exist.",
        });
      }

      let subject;

      await mongoose.connection.transaction(
        async (session) => {
          [subject] =
            await Subject.create(
              [
                {
                  ownerId,
                  name,
                  nameKey,
                },
              ],
              { session },
            );

          if (studentIds.length) {
            await Student.updateMany(
              {
                ownerId,
                _id: {
                  $in: studentIds,
                },
              },
              {
                $addToSet: {
                  subjectIds:
                    subject._id,
                },
              },
              { session },
            );
          }
        },
      );

      return res.status(201).json({
        message:
          "Subject added successfully.",
        id: subject._id.toString(),
        name: subject.name,
        student_count:
          studentIds.length,
        assessment_count: 0,
      });
    } catch (error) {
      console.error(
        "POST /subjects MongoDB error:",
        {
          message: error.message,
          code: error.code,
          keyPattern:
            error.keyPattern,
          keyValue:
            error.keyValue,
          index: error.index,
        },
      );

      if (error?.code === 11000) {
        if (
          error.keyPattern
            ?.legacyId
        ) {
          return res.status(409).json({
            message:
              "The legacyId_1 index is blocking this subject. Remove that index from the subjects collection.",
          });
        }

        return res.status(409).json({
          message:
            "A subject with this name already exists.",
        });
      }

      return res.status(500).json({
        message:
          "Unable to add the subject.",
      });
    }
  },
);

router.put(
  "/subjects/:id",
  requireAuth,
  async (req, res) => {
    const name =
      normalizeName(
        req.body.name,
      );

    if (!isValidId(req.params.id)) {
      return res.status(404).json({
        message:
          "Subject not found.",
      });
    }

    if (!name) {
      return res.status(400).json({
        message:
          "Subject name is required.",
      });
    }

    try {
      const subject =
        await Subject.findOneAndUpdate(
          {
            _id: req.params.id,
            ownerId: req.user.id,
          },
          {
            $set: {
              name,
              nameKey:
                createNameKey(name),
            },
          },
          {
            new: true,
            runValidators: true,
          },
        );

      if (!subject) {
        return res.status(404).json({
          message:
            "Subject not found.",
        });
      }

      return res.json({
        message:
          "Subject updated successfully.",
        id: subject._id.toString(),
        name: subject.name,
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          message:
            "A subject with this name already exists.",
        });
      }

      return res.status(500).json({
        message:
          "Unable to update the subject.",
      });
    }
  },
);

router.delete(
  "/subjects/:id",
  requireAuth,
  async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({
        message:
          "Subject not found.",
      });
    }

    try {
      const ownerId = req.user.id;

      const subject =
        await Subject.findOne({
          _id: req.params.id,
          ownerId,
        }).lean();

      if (!subject) {
        return res.status(404).json({
          message:
            "Subject not found.",
        });
      }

      const referenced = await Student.exists({ ownerId, subjectIds: subject._id }).setOptions({ acrossSchoolYears: true, includeArchived: true });
      const historicalAssessments = await Assessment.exists({ ownerId, subjectId: subject._id }).setOptions({ acrossSchoolYears: true });
      if (referenced || historicalAssessments) return res.status(409).json({ message: "This subject is used by enrollments or assessments in a school year or archive. Keep it to preserve those records." });

      const {
        studentCount,
        assessmentCount,
      } = await getCounts(
        subject._id,
        ownerId,
      );

      if (
        studentCount ||
        assessmentCount
      ) {
        return res.status(409).json({
          message:
            `Remove enrolled students and assessments from "${subject.name}" before deleting it.`,
        });
      }

      await Subject.deleteOne({
        _id: subject._id,
        ownerId,
      });

      return res.json({
        message:
          "Subject deleted successfully.",
      });
    } catch (error) {
      console.error(
        "DELETE /subjects/:id failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to delete the subject.",
      });
    }
  },
);

export default router;