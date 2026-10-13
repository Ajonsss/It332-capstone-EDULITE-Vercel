import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { limitAuthentication } from "./services/accountSecurity.js";
import User from "./models/User.js";
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
  return normalizeName(value)
    .toLowerCase();
}

function createToken(user) {
  const jwtSecret =
    process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error(
      "JWT_SECRET is missing.",
    );
  }

  return jwt.sign(
    {
      name: user.name,
      sessionVersion: user.sessionVersion ?? 0,
    },
    jwtSecret,
    {
      subject:
        user._id.toString(),

      expiresIn: "8h",

      issuer: "edulite-api",

      audience:
        "edulite-frontend",
    },
  );
}

function formatUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
  };
}

// =====================
// REGISTER
// =====================

router.post(
  "/register",
  limitAuthentication,
  async (req, res) => {
    const name = normalizeName(
      req.body.name,
    );

    const password =
      typeof req.body.password ===
      "string"
        ? req.body.password
        : "";

    if (!name) {
      return res.status(400).json({
        message: "Name is required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message:
          "Password must contain at least 6 characters.",
      });
    }

    try {
      const nameKey =
        createNameKey(name);

      const existingUser =
        await User.findOne({
          nameKey,
        }).lean();

      if (existingUser) {
        return res.status(409).json({
          message:
            "Name already exists",
        });
      }

      const hashedPassword =
        await bcrypt.hash(
          password,
          10,
        );

      const user =
        await User.create({
          name,
          nameKey,
          password: hashedPassword,
        });

      const token =
        createToken(user);

      return res.status(201).json({
        message:
          "Register successful",

        token,

        user: formatUser(user),
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          message:
            "Name already exists",
        });
      }

      console.error(
        "POST /register failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to register the user.",
      });
    }
  },
);

// =====================
// LOGIN
// =====================

router.post(
  "/login",
  limitAuthentication,
  async (req, res) => {
    const name = normalizeName(
      req.body.name,
    );

    const password =
      typeof req.body.password ===
      "string"
        ? req.body.password
        : "";

    if (!name || !password) {
      return res.status(400).json({
        message:
          "Invalid name or password",
      });
    }

    try {
      const user =
        await User.findOne({
          nameKey:
            createNameKey(name),
        });

      if (!user) {
        return res.status(400).json({
          message:
            "Invalid name or password",
        });
      }

      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) return res.status(429).json({ message: "Too many failed attempts. Try again in 15 minutes or use your recovery code." });

      const match =
        await bcrypt.compare(
          password,
          user.password,
        );

      if (!match) {
        const failures = (user.loginFailures ?? 0) + 1;
        await User.updateOne({ _id: user._id }, { $set: { loginFailures: failures, lockedUntil: failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null } });
        return res.status(400).json({
          message:
            "Invalid name or password",
        });
      }

      await User.updateOne({ _id: user._id }, { $set: { loginFailures: 0, lockedUntil: null } });
      const token =
        createToken(user);

      return res.json({
        message:
          "Login successful",

        token,

        user: formatUser(user),
      });
    } catch (error) {
      console.error(
        "POST /login failed:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to log in.",
      });
    }
  },
);

// =====================
// CURRENT ACCOUNT
// =====================

router.get(
  "/me",
  requireAuth,
  async (req, res) => {
    return res.json({
      user: {
        id:
          req.user.id.toString(),
        name: req.user.name,
      },
    });
  },
);

export default router;