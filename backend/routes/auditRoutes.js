/**
 * auditRoutes.js — Read-only audit log access.
 *
 * GET /api/audit        — paginated list with filters (admin only)
 * GET /api/audit/export — stream filtered log as CSV (admin only)
 *
 * The audit log is intentionally read-only through the API.
 * No POST/PUT/DELETE endpoints exist here.
 */
const express      = require("express");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth, requireRole("admin"));

// ── GET /api/audit ────────────────────────────────────────────────────────────
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const {
      user_id, branch_id, action, entity_type, entity_id,
      date_from, date_to, ip_address,
      page = 1, limit = 50,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const query = db("audit_logs as a")
      .leftJoin("users as u",    "u.id",    "a.user_id")
      .leftJoin("branches as b", "b.id",    "a.branch_id")
      .select(
        "a.id", "a.action", "a.entity_type", "a.entity_id",
        "a.created_at", "a.ip_address", "a.user_agent",
        "a.user_email", "a.user_role",
        "u.full_name as user_name",
        "b.name as branch_name",
        "a.meta"
      )
      .orderBy("a.created_at", "desc")
      .limit(Number(limit))
      .offset(offset);

    if (user_id)    query.where("a.user_id",    user_id);
    if (branch_id)  query.where("a.branch_id",  branch_id);
    if (action)     query.whereILike("a.action", `%${action}%`);
    if (entity_type) query.where("a.entity_type", entity_type);
    if (entity_id)  query.where("a.entity_id",  entity_id);
    if (ip_address) query.whereILike("a.ip_address", `%${ip_address}%`);
    if (date_from)  query.where("a.created_at", ">=", date_from);
    if (date_to)    query.where("a.created_at", "<=", date_to + " 23:59:59");

    const rows = await query;

    // Total count for pagination header
    const countQ = db("audit_logs").count("id as total");
    if (user_id)    countQ.where("user_id",    user_id);
    if (branch_id)  countQ.where("branch_id",  branch_id);
    if (action)     countQ.whereILike("action", `%${action}%`);
    if (date_from)  countQ.where("created_at", ">=", date_from);
    if (date_to)    countQ.where("created_at", "<=", date_to + " 23:59:59");

    const { total } = await countQ.first();
    res.set("X-Total-Count", total);

    res.json(rows);
  })
);

// ── GET /api/audit/export — CSV download ──────────────────────────────────────
router.get(
  "/export",
  asyncHandler(async (req, res) => {
    const {
      user_id, branch_id, action, date_from, date_to,
    } = req.query;

    const query = db("audit_logs as a")
      .leftJoin("branches as b", "b.id", "a.branch_id")
      .select(
        "a.id", "a.created_at", "a.action", "a.entity_type", "a.entity_id",
        "a.user_email", "a.user_role", "b.name as branch_name",
        "a.ip_address", "a.meta"
      )
      .orderBy("a.created_at", "desc")
      .limit(50000); // hard cap

    if (user_id)   query.where("a.user_id",   user_id);
    if (branch_id) query.where("a.branch_id", branch_id);
    if (action)    query.whereILike("a.action", `%${action}%`);
    if (date_from) query.where("a.created_at", ">=", date_from);
    if (date_to)   query.where("a.created_at", "<=", date_to + " 23:59:59");

    const rows = await query;

    // Build CSV
    const headers = ["id","created_at","action","entity_type","entity_id",
                     "user_email","user_role","branch_name","ip_address","meta"];
    const lines = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))
    ];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="audit_${Date.now()}.csv"`);
    res.send(lines.join("\r\n"));
  })
);

// ── CSV cell escaping ──────────────────────────────────────────────────────────
function csvCell(val) {
  if (val === null || val === undefined) return "";
  const s = typeof val === "object" ? JSON.stringify(val) : String(val);
  // RFC-4180: wrap in quotes if contains comma, quote, or newline
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

module.exports = router;
