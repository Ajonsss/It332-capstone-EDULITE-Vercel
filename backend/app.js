import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

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
const api = express.Router();

const PORT =
  Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));

api.get("/", (req, res) => {
  res.json({
    message: "EduLITE API is running.",
    database: "MongoDB Atlas",
  });
});

// Validate the route-relative path after Express removes the /api mount.
api.use(validateRequestInputs);

// Connect at request time so Vercel can import the app without opening a
// database connection during its build. Concurrent requests share startup.
let databaseInitialization;
function initializeDatabase() {
  if (!databaseInitialization) {
    databaseInitialization = (async () => {
      await connectMongoDatabase();
      await Promise.all([SchoolYear, Intervention, AwardCertificate, AuditEvent].map((Model) => Model.createIndexes()));
    })().catch((error) => {
      databaseInitialization = undefined;
      throw error;
    });
  }
  return databaseInitialization;
}

api.use(async (req, res, next) => {
  try {
    await initializeDatabase();
    // Reconnect after a disconnected warm function instance, if necessary.
    await connectMongoDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

/*
  Section routes are registered before
  student routes because the old
  student.js file also contains duplicate
  /sections endpoints.

  Those duplicate routes will be removed
  when student.js is converted.
*/
api.use(accountRoutes);
api.use(teacherToolsRoutes);
api.use(loginRoutes);
api.use(sectionRoutes);
api.use(studentLifecycleRoutes);
api.use(studentRoutes);
api.use(studentImportRoutes);
api.use(subjectRoutes);
api.use(assessmentRoutes);
api.use(geminiRoute);
app.use("/api", api);

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
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(
        `EduLITE API running at http://localhost:${PORT}/api`,
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

// Vercel imports the default export; npm start still runs a local listener.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  startServer();
}

export default app;
