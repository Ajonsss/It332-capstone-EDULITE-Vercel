import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import mongoose from "mongoose";
import geminiRouter from "../geminiRoute.js";
import toolsRouter from "../teacherTools.js";
import StudentAiInsight from "../models/StudentAiInsight.js";
import Intervention from "../models/Intervention.js";

test("support deletion requires authentication and isolates the owner and current school year", async (t) => {
  const owner = String(new mongoose.Types.ObjectId());
  const otherOwner = String(new mongoose.Types.ObjectId());
  const year = String(new mongoose.Types.ObjectId());
  const otherYear = String(new mongoose.Types.ObjectId());
  const app = express();
  app.use((req, _res, next) => {
    if (req.get("x-test-owner")) { req.user = { id: req.get("x-test-owner") }; req.academicYear = req.get("x-test-year") ?? null; }
    next();
  });
  app.use(geminiRouter, toolsRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const [Model, path] of [[StudentAiInsight, "/gemini/insights"], [Intervention, "/interventions"]]) {
    await t.test(Model.modelName, async (t) => {
      const id = String(new mongoose.Types.ObjectId());
      let exists = true, failed = false;
      const calls = [];
      t.mock.method(Model, "deleteOne", async (filter) => {
        calls.push(filter);
        if (failed) throw new Error("Test storage failure");
        const matches = exists && filter._id === id && filter.ownerId === owner && filter.schoolYearId === year;
        if (matches) exists = false;
        return { deletedCount: matches ? 1 : 0 };
      });
      const send = (recordId, teacher = owner, schoolYear = year) => fetch(`${base}${path}/${recordId}`, {
        method: "DELETE", headers: teacher ? { "x-test-owner": teacher, ...(schoolYear ? { "x-test-year": schoolYear } : {}) } : {},
      });
      assert.equal((await send(id, null)).status, 401);
      assert.equal((await send("bad-id")).status, 400);
      assert.equal(calls.length, 0);
      assert.equal((await send(id, otherOwner)).status, 404);
      assert.equal((await send(id, owner, otherYear)).status, 404);
      assert.equal((await send(id, owner, null)).status, 404);
      assert.equal(exists, true);
      failed = true;
      const log = t.mock.method(console, "error", () => {});
      assert.equal((await send(id)).status, 500);
      assert.equal(exists, true);
      log.mock.restore(); failed = false;
      assert.equal((await send(id)).status, 200);
      assert.equal(exists, false);
      assert.equal((await send(id)).status, 404);
    });
  }
});
