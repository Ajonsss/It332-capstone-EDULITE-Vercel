// Shared by browser forms and the API so typed, pasted and imported data agree.
export const FIELD_LIMITS = Object.freeze({ name: 200, namePart: 100, section: 100, subject: 100, assessment: 200, username: 100, passwordBytes: 72 });

export function normalizeInputText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function parseWholeNumber(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : NaN;
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return NaN;
  const number = Number(value.trim());
  return Number.isSafeInteger(number) ? number : NaN;
}

export function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const PERSON_CHARACTERS = /^[\p{L}\p{M} .,'’ʼ()-]*$/u;
const LABEL_CHARACTERS = /^[\p{L}\p{M}\p{N} .,'’ʼ&()/+:_%#-]*$/u;
const USERNAME_CHARACTERS = /^[\p{L}\p{M}\p{N} ._@'’ʼ-]*$/u;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;
const DEFAULT_LIMITS = { personName: FIELD_LIMITS.name, section: FIELD_LIMITS.section, subject: FIELD_LIMITS.subject, assessment: FIELD_LIMITS.assessment, username: FIELD_LIMITS.username };

function syntaxError(value, { kind = "text", label = "This field", maxLength = DEFAULT_LIMITS[kind] } = {}) {
  if (typeof value !== "string") return `${label} must be text.`;
  if (kind === "budgetOfWork") {
    if (/[\p{Cf}\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(value)) return `${label} cannot contain control or invisible characters.`;
    if (value.length > 5000) return `${label} must be at most 5000 characters.`;
    return "";
  }
  if (CONTROL_CHARACTERS.test(value)) return `${label} cannot contain control or invisible characters.`;
  if (maxLength && value.length > maxLength) return `${label} must be at most ${maxLength} characters.`;
  if (kind === "personName" && !PERSON_CHARACTERS.test(value)) return `${label} accepts letters, spaces, and name punctuation only. Numbers are not allowed.`;
  if (["section", "subject", "assessment"].includes(kind) && !LABEL_CHARACTERS.test(value)) return `${label} accepts letters, numbers, spaces, and common punctuation only.`;
  if (kind === "username" && !USERNAME_CHARACTERS.test(value)) return `${label} accepts letters, numbers, spaces, periods, apostrophes, @, underscores, and hyphens only.`;
  if (kind === "password" && new TextEncoder().encode(value).length > FIELD_LIMITS.passwordBytes) return `${label} must be at most 72 UTF-8 bytes (some characters use more than one byte).`;
  return "";
}

// Reject invalid keystrokes/pastes without silently stripping or changing data.
export function validateInputDraft(value, rules = {}) {
  if (rules.kind === "integer") {
    if (typeof value !== "string" || (value !== "" && !/^\d+$/.test(value))) return `${rules.label || "This field"} accepts whole-number digits only. Letters, decimals, signs, and exponents are not allowed.`;
    if (value && !Number.isSafeInteger(Number(value))) return `${rules.label || "This field"} is too large.`;
    return "";
  }
  if (rules.kind === "date") return ""; // The date picker handles drafts; final validation checks the calendar.
  return syntaxError(value, rules);
}

export function validateInput(value, { kind = "text", label = "This field", required = true, min = 0, max = Number.MAX_SAFE_INTEGER, minLength = 0, ...options } = {}) {
  const blank = value === undefined || value === null || value === "" || (kind !== "integer" && typeof value === "string" && !value.trim());
  if (blank) return required ? `${label} is required.` : "";
  if (kind === "integer") {
    const number = parseWholeNumber(value);
    if (!Number.isSafeInteger(number)) return `${label} must be a whole number using digits only.`;
    if (number < min || number > max) return max === Number.MAX_SAFE_INTEGER ? `${label} must be at least ${min}.` : `${label} must be from ${min} to ${max}.`;
    return "";
  }
  if (kind === "date") return isCalendarDate(value) ? "" : `${label} must be a real calendar date in YYYY-MM-DD format.`;
  const error = syntaxError(value, { kind, label, ...options });
  if (error) return error;
  const text = normalizeInputText(value);
  if (kind === "personName" && !/\p{L}/u.test(text)) return `${label} must contain letters.`;
  if (["subject", "assessment"].includes(kind) && !/\p{L}/u.test(text)) return `${label} must contain letters; numbers alone are not a name.`;
  if (["section", "username"].includes(kind) && !/[\p{L}\p{N}]/u.test(text)) return `${label} must contain letters or numbers.`;
  const length = kind === "password" ? value.length : text.length;
  if (length < minLength) return `${label} must contain at least ${minLength} characters.`;
  return "";
}
