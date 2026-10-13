import crypto from "node:crypto";
export const hashRecoveryCode = (code) => crypto.createHash("sha256").update(code).digest("hex");
export function matchesRecoveryCode(code, hash) {
  if (typeof code !== "string" || !/^[a-f0-9]{64}$/i.test(code.trim()) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return crypto.timingSafeEqual(Buffer.from(hashRecoveryCode(code.trim().toLowerCase()), "hex"), Buffer.from(hash, "hex"));
}
const attempts = new Map();
export function limitAuthentication(req, res, next) {
  const now = Date.now(); const key = req.ip;
  for (const [ip, item] of attempts) if (item.until <= now) attempts.delete(ip);
  const item = attempts.get(key) ?? { count: 0, until: now + 15 * 60 * 1000 };
  item.count++; attempts.set(key, item);
  if (attempts.size > 10000) attempts.delete(attempts.keys().next().value);
  if (item.count > 30) { res.set("Retry-After", String(Math.ceil((item.until - now) / 1000))); return res.status(429).json({ message: "Too many sign-in attempts. Try again later." }); }
  return next();
}
