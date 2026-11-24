import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import { academicContext, DEFAULT_RULES } from "../services/academicContext.js";
import SchoolYear from "../models/SchoolYear.js";
import User from "../models/User.js";

export async function requireAuth(
  req,
  res,
  next,
) {
  if (req.user) return next();
  try {
    const authorization =
      req.get("authorization") ?? "";

    const [scheme, token] =
      authorization.split(" ");

    if (
      scheme !== "Bearer" ||
      !token
    ) {
      return res.status(401).json({
        message:
          "Authentication is required.",
      });
    }

    const jwtSecret =
      process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error(
        "JWT_SECRET is missing.",
      );
    }

    const payload = jwt.verify(
      token,
      jwtSecret,
      { issuer: "edulite-api", audience: "edulite-frontend", algorithms: ["HS256"] },
    );

    if (
      typeof payload !== "object" ||
      !mongoose.isObjectIdOrHexString(
        payload.sub,
      )
    ) {
      return res.status(401).json({
        message:
          "The authentication token is invalid.",
      });
    }

    const user =
      await User.findById(
        payload.sub,
      )
        .select("_id name sessionVersion activeSchoolYearId legacyRules")
        .lean();

    if (!user) {
      return res.status(401).json({
        message:
          "The account no longer exists.",
      });
    }

    if ((payload.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) return res.status(401).json({ message: "Your session has been revoked. Please log in again." });
    const schoolYearId = user.activeSchoolYearId ?? null;
    const legacyRules = { ...DEFAULT_RULES, ...user.legacyRules };
    let rules = legacyRules;
    if (schoolYearId) {
      const year = await SchoolYear.findOne({ _id: schoolYearId, ownerId: user._id }).lean();
      if (!year) return res.status(409).json({ message: "Your active school year is unavailable. Select another year in Settings." });
      rules = { ...DEFAULT_RULES, ...year.rules };
    }
    req.academicYear = schoolYearId;
    req.legacyRules = legacyRules;
    req.rules = rules;

    req.user = {
      id: user._id,
      name: user.name,
    };

    return academicContext.run({ ownerId: user._id, actorName: user.name, schoolYearId, rules }, () => next());
  } catch (error) {
    if (
      error?.name ===
        "JsonWebTokenError" ||
      error?.name ===
        "TokenExpiredError"
    ) {
      return res.status(401).json({
        message:
          "Your session is invalid or expired. Please log in again.",
      });
    }

    console.error(
      "Authentication failed:",
      error,
    );

    return res.status(500).json({
      message:
        "Unable to authenticate the request.",
    });
  }
}

// Opt-in scope for reporting and the actions launched from a report. Changing
// this request's scope does not change the account's active school year.
export async function selectAcademicYear(req, res, next) {
  const requested = req.query?.school_year_id;
  if (requested === undefined) return next();
  if (requested !== "legacy" && !mongoose.isObjectIdOrHexString(requested)) {
    return res.status(400).json({ message: "Select a valid school year." });
  }

  let schoolYearId = requested === "legacy" ? null : requested.toLowerCase();
  const activeYearId = req.academicYear ?? null;
  if (String(schoolYearId) === String(activeYearId)) return next();

  try {
    let rules = req.legacyRules;
    if (schoolYearId !== null) {
      const year = await SchoolYear.findOne({ _id: schoolYearId, ownerId: req.user.id }).lean();
      if (!year) return res.status(404).json({ message: "School year not found." });
      schoolYearId = year._id;
      rules = { ...DEFAULT_RULES, ...year.rules };
    }
    req.activeAcademicYear = activeYearId;
    req.academicYear = schoolYearId;
    req.rules = rules ?? DEFAULT_RULES;
    return academicContext.run({
      ownerId: req.user.id, actorName: req.user.name, schoolYearId, rules: req.rules,
    }, next);
  } catch (error) {
    return next(error);
  }
}

export default requireAuth;
