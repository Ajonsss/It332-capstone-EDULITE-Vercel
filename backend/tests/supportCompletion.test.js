import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import mongoose from "mongoose";
import geminiRouter from "../geminiRoute.js";
import StudentAiInsight from "../models/StudentAiInsight.js";
import Student from "../models/Student.js";

test("finishing AI interventions persists status, protects scope and keeps the saved recommendation", async (t) => {
  const ownerId = String(new mongoose.Types.ObjectId()), schoolYearId = String(new mongoose.Types.ObjectId());
  const otherId = String(new mongoose.Types.ObjectId()), studentId = String(new mongoose.Types.ObjectId());
  const item = { _id: String(new mongoose.Types.ObjectId()), ownerId, schoolYearId, studentId, supportType: "intervention", title: "Fractions",
    result: { plan: { title: "Fractions", targetedInterventions: [{ title: "Practice" }] } }, pdfData: Buffer.from("saved-pdf") };
  const enrichment = { ...item, _id: String(new mongoose.Types.ObjectId()), supportType: "enrichment" };
  const rows = [item, enrichment];
  const query = (value) => ({ select() { return this; }, sort() { return this; }, lean: async () => structuredClone(value) });
  const matches = (row, filter) => ["_id", "ownerId", "schoolYearId", "supportType"].every((key) => row[key] === filter[key]);
  let failed = false, changes = 0;
  t.mock.method(StudentAiInsight, "findOneAndUpdate", (filter, update, options) => {
    assert.equal(options.runValidators, true); assert.equal(options.new, true);
    assert.deepEqual(filter.status, { $ne: "completed" });
    const found = rows.find((row) => matches(row, filter) && row.status !== "completed");
    if (failed) return { select() { return this; }, lean: async () => { throw new Error("Test storage failure"); } };
    if (found) { Object.assign(found, update.$set); changes++; }
    return query(found ?? null);
  });
  t.mock.method(StudentAiInsight, "findOne", (filter) => query(rows.find((row) => matches(row, filter)) ?? null));
  t.mock.method(Student, "exists", async () => ({ _id: studentId }));
  t.mock.method(StudentAiInsight, "find", (filter) => query(rows.filter((row) => row.studentId === filter.studentId && row.ownerId === filter.ownerId)));
  const app = express();
  app.use((req, _res, next) => {
    if (req.get("x-test-owner")) { req.user = { id: req.get("x-test-owner") }; req.academicYear = req.get("x-test-year") ?? null; }
    next();
  });
  app.use(geminiRouter);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (id = item._id, owner = ownerId, year = schoolYearId) => fetch(`${base}/gemini/insights/${id}/finish`, {
    method: "PATCH", headers: owner ? { "x-test-owner": owner, ...(year ? { "x-test-year": year } : {}) } : {},
  });
  const headers = { "x-test-owner": ownerId, "x-test-year": schoolYearId };
  const before = await (await fetch(`${base}/students/${studentId}/insights`, { headers })).json();
  assert.equal(before[0].status, "active", "older recommendations default to open");
  assert.equal(before[0].completedAt, null);
  assert.equal((await send(item._id, null)).status, 401);
  assert.equal((await send("invalid")).status, 400);
  assert.equal((await send(item._id, otherId)).status, 404);
  assert.equal((await send(item._id, ownerId, otherId)).status, 404);
  assert.equal((await send(item._id, ownerId, null)).status, 404);
  assert.equal((await send(enrichment._id)).status, 404, "enrichment is not completed as an intervention");
  assert.equal(changes, 0);
  failed = true;
  const log = t.mock.method(console, "error", () => {});
  assert.equal((await send()).status, 500); assert.equal(item.status, undefined);
  log.mock.restore(); failed = false;
  const response = await send(); assert.equal(response.status, 200);
  const closed = await response.json();
  assert.equal(closed.status, "completed"); assert.ok(closed.completedAt);
  assert.deepEqual(closed.result, item.result); assert.ok(closed.pdfUrl.endsWith("/pdf"));
  assert.equal(closed.pdfData, undefined); assert.equal(item.pdfData.toString(), "saved-pdf");
  const repeated = await (await send()).json();
  assert.equal(repeated.completedAt, closed.completedAt); assert.equal(changes, 1);
  const after = await (await fetch(`${base}/students/${studentId}/insights`, { headers })).json();
  assert.equal(after[0].status, "completed"); assert.equal(after[0].completedAt, closed.completedAt);
  assert.equal(after[1].status, "active"); assert.equal(after[1].completedAt, null);
});
