import express from "express";
import mongoose from "mongoose";

import Section from "./models/Section.js";
import Student from "./models/Student.js";

import {
  requireAuth,
} from "./middleware/auth.js";

const router = express.Router();

function normalizeSectionName(
  value,
) {
  return typeof value === "string"
    ? value
        .trim()
        .replace(/\s+/g, " ")
    : "";
}

function createNameKey(value) {
  return normalizeSectionName(
    value,
  ).toLowerCase();
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(
    value,
  );
}

function formatSection(
  section,
  studentCount = 0,
) {
  return {
    id: section._id.toString(),
    name: section.name,

    student_count:
      studentCount,
  };
}

// ===========================
// GET ALL SECTIONS
// ===========================

router.get(
  "/sections",
  requireAuth,
  async (req, res) => {
    try {
      const ownerId =
        req.user.id;

      const sections =
        await Section.find({
          ownerId,
        })
          .sort({
            nameKey: 1,
          })
          .lean();

      const results =
        await Promise.all(
          sections.map(
            async (section) => {
              const studentCount =
                await Student.countDocuments(
                  {
                    ownerId,

                    sectionId:
                      section._id,
                  },
                );

              return formatSection(
                section,
                studentCount,
              );
            },
          ),
        );

      return res.json(results);
    } catch (error) {
      console.error(
        "GET /sections failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to load sections.",
      });
    }
  },
);

// ===========================
// ADD A SECTION
// ===========================

router.post(
  "/sections",
  requireAuth,
  async (req, res) => {
    const name =
      normalizeSectionName(
        req.body.name,
      );

    if (!name) {
      return res.status(400).json({
        message:
          "Section name is required.",
      });
    }

    const nameKey =
      createNameKey(name);

    try {
      const existingSection =
        await Section.findOne({
          ownerId: req.user.id,
          nameKey,
        }).lean();

      if (existingSection) {
        return res.status(409).json({
          message:
            "A section with this name already exists.",
        });
      }

      const section =
        await Section.create({
          ownerId: req.user.id,
          name,
          nameKey,
        });

      return res.status(201).json({
        message:
          "Section added successfully.",

        ...formatSection(
          section,
          0,
        ),
      });
    } catch (error) {
      console.error(
        "POST /sections MongoDB error:",
        {
          message:
            error.message,

          code: error.code,

          keyPattern:
            error.keyPattern,

          keyValue:
            error.keyValue,

          index: error.index,
        },
      );

      if (error?.code === 11000) {
        const duplicateField =
          error.keyPattern
            ? Object.keys(
                error.keyPattern,
              ).join(", ")
            : "";

        if (
          duplicateField.includes(
            "legacyId",
          )
        ) {
          return res.status(409).json({
            message:
              "A legacy database index is blocking this section. Remove the legacyId_1 index from the sections collection.",
          });
        }

        return res.status(409).json({
          message:
            "A section with this name already exists.",
        });
      }

      if (
        error?.name ===
        "ValidationError"
      ) {
        return res.status(400).json({
          message:
            Object.values(
              error.errors ?? {},
            )[0]?.message ||
            "The section information is invalid.",
        });
      }

      return res.status(500).json({
        message:
          "Unable to add the section.",
      });
    }
  },
);

// ===========================
// REMOVE A SECTION
// ===========================

router.delete(
  "/sections/:id",
  requireAuth,
  async (req, res) => {
    const sectionId =
      req.params.id;

    if (
      !isValidObjectId(sectionId)
    ) {
      return res.status(404).json({
        message:
          "Section not found.",
      });
    }

    try {
      const ownerId =
        req.user.id;

      const section =
        await Section.findOne({
          _id: sectionId,
          ownerId,
        }).lean();

      if (!section) {
        return res.status(404).json({
          message:
            "Section not found.",
        });
      }

      const studentCount =
        await Student.countDocuments({
          ownerId,

          sectionId:
            section._id,
        }).setOptions({ acrossSchoolYears: true, includeArchived: true });

      if (studentCount > 0) {
        return res.status(409).json({
          message:
            `Cannot remove ${section.name} because it still has ${studentCount} student${studentCount === 1 ? "" : "s"}. Move or delete those students first.`,
        });
      }

      const result =
        await Section.deleteOne({
          _id: section._id,
          ownerId,
        });

      if (
        result.deletedCount === 0
      ) {
        return res.status(404).json({
          message:
            "Section not found.",
        });
      }

      return res.json({
        message:
          "Section removed successfully.",
      });
    } catch (error) {
      console.error(
        "DELETE /sections/:id failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to remove the section.",
      });
    }
  },
);

export default router;