import dotenv from "dotenv";

dotenv.config();

import express from "express";
import cors from "cors";

import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "./database/mongo.js";

import SchoolYear from "./models/SchoolYear.js";
import Intervention from "./models/Intervention.js";
import AwardCertificate from "./models/AwardCertificate.js";
import AuditEvent from "./models/AuditEvent.js";
import accountRoutes from "./accountRoutes.js";
import teacherToolsRoutes from "./teacherTools.js";
import studentLifecycleRoutes from "./studentLifecycle.js";
import loginRoutes from "./login.js";
import sectionRoutes from "./section.js";
import studentRoutes from "./student.js";
import studentImportRoutes from "./studentImport.js";
import subjectRoutes from "./subject.js";
import assessmentRoutes from "./assessment.js";
import geminiRoute from "./geminiRoute.js";
import { validateRequestInputs } from "./middleware/inputValidation.js";

const app = express();

const PORT =
  Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(validateRequestInputs);

app.get("/", (req, res) => {
  res.json({
    message: "EduLITE API is running.",
    database: "MongoDB Atlas",
  });
});

/*
  Section routes are registered before
  student routes because the old
  student.js file also contains duplicate
  /sections endpoints.

  Those duplicate routes will be removed
  when student.js is converted.
*/
app.use(accountRoutes);
app.use(teacherToolsRoutes);
app.use(loginRoutes);
app.use(sectionRoutes);
app.use(studentLifecycleRoutes);
app.use(studentRoutes);
app.use(studentImportRoutes);
app.use(subjectRoutes);
app.use(assessmentRoutes);
app.use(geminiRoute);

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found.",
  });
});

app.use(
  (
    error,
    req,
    res,
    next,
  ) => {
    console.error(
      "Unhandled API error:",
      error,
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      message:
        "An unexpected server error occurred.",
    });
  },
);

async function startServer() {
  try {
    await connectMongoDatabase();
    await Promise.all([SchoolYear, Intervention, AwardCertificate, AuditEvent].map((Model) => Model.createIndexes()));

    app.listen(PORT, () => {
      console.log(
        `EduLITE API running at http://localhost:${PORT}`,
      );
    });
  } catch (error) {
    console.error(
      "EduLITE could not start:",
      error,
    );

    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(
    `\n${signal} received. Closing MongoDB connection...`,
  );

  try {
    await disconnectMongoDatabase();
  } catch (error) {
    console.error(
      "Unable to close MongoDB connection:",
      error,
    );
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

startServer();
