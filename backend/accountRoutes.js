import express from "express";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import User from "./models/User.js";
import AuditEvent from "./models/AuditEvent.js";
import { requireAuth } from "./middleware/auth.js";
import { hashRecoveryCode, matchesRecoveryCode, limitAuthentication } from "./services/accountSecurity.js";
import { validateInput } from "../shared/inputValidation.mjs";
const router = express.Router();
router.post("/account/recovery-code", requireAuth, async (req, res) => {
  try {
    if (typeof req.body?.password !== "string") return res.status(400).json({ message: "Enter your current password." });
    const user = await User.findById(req.user.id);
    if (!await bcrypt.compare(req.body.password, user.password)) return res.status(400).json({ message: "The current password is incorrect." });
    const recoveryCode = crypto.randomBytes(32).toString("hex");
    await User.updateOne({ _id: user._id }, { $set: { recoveryHash: hashRecoveryCode(recoveryCode) } });
    await AuditEvent.create({ ownerId: user._id, action: "recovery-code-generated", resource: "Account" });
    res.set("Cache-Control", "no-store").json({ recoveryCode, message: "Save this code privately. It is displayed once; generating another invalidates the old code." });
  } catch { res.status(500).json({ message: "Unable to generate a recovery code." }); }
});
router.post("/account/reset-password", limitAuthentication, async (req, res) => {
  const error = validateInput(req.body?.password, { kind: "password", label: "New password", minLength: 8 });
  if (error) return res.status(400).json({ message: error });
  if (typeof req.body.name !== "string") return res.status(400).json({ message: "Enter your username and recovery code." });
  try {
    const user = await User.findOne({ nameKey: req.body.name.trim().replace(/\s+/g, " ").toLowerCase() }).select("+recoveryHash");
    if (!user || !matchesRecoveryCode(req.body.recovery_code, user.recoveryHash)) return res.status(400).json({ message: "The username or recovery code is invalid." });
    const password = await bcrypt.hash(req.body.password, 12);
    const changed = await User.updateOne({ _id: user._id, recoveryHash: user.recoveryHash }, { $set: { password, loginFailures: 0, lockedUntil: null }, $unset: { recoveryHash: 1 }, $inc: { sessionVersion: 1 } });
    if (!changed.modifiedCount) return res.status(400).json({ message: "The recovery code has already been used." });
    await AuditEvent.create({ ownerId: user._id, action: "password-recovered", resource: "Account" });
    return res.json({ message: "Password reset. Sign in again and generate a new recovery code in Settings." });
  } catch { return res.status(500).json({ message: "Unable to reset the password." }); }
});
router.post("/account/change-password", requireAuth, async (req, res) => {
  const error = validateInput(req.body?.new_password, { kind: "password", label: "New password", minLength: 8 });
  if (error || typeof req.body.password !== "string") return res.status(400).json({ message: error || "Enter your current password." });
  try {
    const user = await User.findById(req.user.id);
    if (!await bcrypt.compare(req.body.password, user.password)) return res.status(400).json({ message: "The current password is incorrect." });
    await User.updateOne({ _id: user._id }, { $set: { password: await bcrypt.hash(req.body.new_password, 12) }, $inc: { sessionVersion: 1 } });
    await AuditEvent.create({ ownerId: user._id, action: "password-changed", resource: "Account" });
    return res.json({ message: "Password changed. All sessions have been signed out." });
  } catch { return res.status(500).json({ message: "Unable to change your password." }); }
});
router.post("/account/sign-out-all", requireAuth, async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $inc: { sessionVersion: 1 } });
  res.json({ message: "All sessions have been signed out." });
});
export default router;
