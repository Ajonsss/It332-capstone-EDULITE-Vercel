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
    let schoolYearId = user.activeSchoolYearId ?? null;
    let rules = { ...DEFAULT_RULES, ...user.legacyRules };
    if (schoolYearId) {
      const year = await SchoolYear.findOne({ _id: schoolYearId, ownerId: user._id }).lean();
      if (!year) return res.status(409).json({ message: "Your active school year is unavailable. Select another year in Settings." });
      rules = { ...DEFAULT_RULES, ...year.rules };
    }
    req.academicYear = schoolYearId;
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

export default requireAuth;