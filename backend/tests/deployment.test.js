import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import mongoose from "mongoose";
import SchoolYear from "../models/SchoolYear.js";
import Intervention from "../models/Intervention.js";
import AwardCertificate from "../models/AwardCertificate.js";
import AuditEvent from "../models/AuditEvent.js";
import { connectMongoDatabase } from "../database/mongo.js";

test("Vercel app imports without a listener and serves the public API prefix", { timeout: 10000 }, async (t) => {
  const originalUri = process.env.MONGODB_URI;
  process.env.MONGODB_URI = "mongodb://test.invalid/deployment-test";
  t.after(() => {
    if (originalUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalUri;
  });

  let connected = false;
  let connectionAttempts = 0;
  let rejectConnection = false;
  for (const [key, get] of [["readyState", () => connected ? 1 : 0], ["db", () => connected ? {} : undefined]]) {
    const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, key);
    Object.defineProperty(mongoose.connection, key, { configurable: true, get });
    t.after(() => {
      if (descriptor) Object.defineProperty(mongoose.connection, key, descriptor);
      else delete mongoose.connection[key];
    });
  }
  t.mock.method(mongoose, "connect", async () => {
    connectionAttempts++;
    await new Promise((resolve) => setTimeout(resolve, 15));
    if (rejectConnection) throw new Error("Simulated connection failure");
    connected = true;
    return mongoose;
  });
  const disconnect = t.mock.method(mongoose, "disconnect", async () => {
    throw new Error("A request must not disconnect another request");
  });
  const indexes = [SchoolYear, Intervention, AwardCertificate, AuditEvent]
    .map((Model) => t.mock.method(Model, "createIndexes", async () => []));
  const listener = t.mock.method((await import("node:http")).Server.prototype, "listen", () => {
    throw new Error("Importing the app must not start a listener");
  });

  const { default: app } = await import("../app.js");
  assert.equal(listener.mock.callCount(), 0);
  assert.equal(connectionAttempts, 0);
  listener.mock.restore();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body) => fetch(base + path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  assert.equal((await request("/api")).status, 200);
  assert.equal((await request("/api/")).status, 200);
  assert.equal(connectionAttempts, 0);
  for (const [path, body] of [
    ["/api/login", { name: [], password: "pass" }],
    ["/api/students", { name: "Student123", grade: true }],
    ["/api/gemini/student-support/507f1f77bcf86cd799439011", { term: true }],
  ]) assert.equal((await request(path, body)).status, 400);
  assert.equal(connectionAttempts, 0, "Invalid requests are rejected before connecting");

  const statuses = await Promise.all(Array.from({ length: 6 }, () => request("/api/gemini/status")));
  for (const response of statuses) assert.equal(response.status, 401);
  assert.equal(connectionAttempts, 1, "Concurrent cold requests share the connection");
  for (const index of indexes) assert.equal(index.mock.callCount(), 1);
  for (const path of ["/api/students", "/api/students/507f1f77bcf86cd799439011/insights", "/api/gemini/insights/507f1f77bcf86cd799439011/pdf"])
    assert.equal((await request(path)).status, 401);
  for (const path of ["/students", "/api/api/gemini/status", "/api/does-not-exist"]) {
    const response = await request(path);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).message, "Route not found.");
  }

  connected = false;
  rejectConnection = true;
  const failures = await Promise.allSettled([connectMongoDatabase(), connectMongoDatabase()]);
  assert.ok(failures.every((result) => result.status === "rejected"));
  assert.equal(connectionAttempts, 2);
  rejectConnection = false;
  assert.equal((await request("/api/gemini/status")).status, 401);
  assert.equal(connectionAttempts, 3, "A failed connection can be retried");
  assert.equal(disconnect.mock.callCount(), 0);
});
