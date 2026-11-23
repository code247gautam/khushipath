/**
 * validate.js — Reusable input-validation helpers for route handlers.
 *
 * Usage:
 *   const { assertRequired, assertPositiveNumber, assertEnum } = require('../middleware/validate');
 *   assertRequired({ name, email }, ['name', 'email']);
 *   assertEnum(role, ROLES, 'role');
 *
 * All helpers throw an object { status, error } caught by asyncHandler → global
 * error middleware, which returns the correct HTTP status to the client.
 *
 * We deliberately avoid heavy validation libraries to keep zero-cost dependencies.
 */

const ROLES = ["admin", "branch_manager", "receptionist", "technician", "pathologist", "accountant"];

/**
 * Throw 400 if any key in `keys` is missing / empty in `body`.
 */
function assertRequired(body, keys) {
  for (const key of keys) {
    const v = body[key];
    if (v === undefined || v === null || String(v).trim() === "") {
      throw { status: 400, error: `${key} is required.` };
    }
  }
}

/**
 * Throw 400 if value is not a number > 0.
 */
function assertPositiveNumber(value, field) {
  if (isNaN(Number(value)) || Number(value) <= 0) {
    throw { status: 400, error: `${field} must be a positive number.` };
  }
}

/**
 * Throw 400 if value is not in allowed list.
 */
function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw { status: 400, error: `${field} must be one of: ${allowed.join(", ")}.` };
  }
}

/**
 * Sanitise a string — strip leading/trailing whitespace, limit length.
 * Returns null if input is falsy.
 */
function sanitizeStr(value, maxLen = 500) {
  if (!value) return null;
  return String(value).trim().slice(0, maxLen);
}

/**
 * Returns true if the email format is valid (basic RFC-5322 subset).
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

/**
 * Escape HTML special chars — used before inserting any user-supplied text
 * into HTML strings on the server side (e.g., PDF generation).
 */
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = { assertRequired, assertPositiveNumber, assertEnum, sanitizeStr, isValidEmail, escapeHtml, ROLES };
