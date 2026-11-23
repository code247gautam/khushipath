/**
 * retentionRoutes.js — Retention config and archiving.
 *
 * GET  /api/retention/config           — view current settings (admin)
 * PUT  /api/retention/config           — update settings (admin)
 * GET  /api/retention/due              — preview rows that would be archived
 * POST /api/retention/archive          — run archiving now (marks archived_at)
 * GET  /api/retention/archived         — list archived orders/reports
 * POST /api/retention/export-before-delete — CSV export before hard delete (admin)
 * DELETE /api/retention/hard-delete    — permanently delete archived rows older
 *                                        than a second threshold (admin, with confirmation)
 */
const express      = require("express");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const { logAudit }  = require("../middleware/audit");

const router = express.Router();

router.use(requireAuth, requireRole("admin"));

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getConfig() {
  return db("retention_config").first();
}

function cutoffDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

// ── GET /api/retention/config ─────────────────────────────────────────────────
router.get("/config", asyncHandler(async (req, res) => {
  res.json(await getConfig());
}));

// ── PUT /api/retention/config ─────────────────────────────────────────────────
router.put(
  "/config",
  asyncHandler(async (req, res) => {
    const { retention_months, auto_archive_enabled } = req.body;

    if (retention_months !== undefined && (isNaN(retention_months) || retention_months < 1)) {
      return res.status(400).json({ error: "retention_months must be a positive integer." });
    }

    const cfg = await getConfig();
    const [updated] = await db("retention_config")
      .where({ id: cfg.id })
      .update({
        retention_months:     retention_months     ?? cfg.retention_months,
        auto_archive_enabled: auto_archive_enabled ?? cfg.auto_archive_enabled,
        updated_at: db.fn.now(),
      })
      .returning("*");

    await logAudit(req, { action: "retention.config_update", meta: { retention_months, auto_archive_enabled } });
    res.json(updated);
  })
);

// ── GET /api/retention/due ────────────────────────────────────────────────────
// Preview of orders that have passed the retention window and are not yet archived.
router.get(
  "/due",
  asyncHandler(async (req, res) => {
    const cfg    = await getConfig();
    const cutoff = cutoffDate(cfg.retention_months);

    const orders = await db("orders as o")
      .join("patients as p", "p.id", "o.patient_id")
      .whereNull("o.archived_at")
      .where("o.created_at", "<", cutoff)
      .select(
        "o.id", "o.order_no", "o.sample_status", "o.created_at",
        "p.patient_uid", "p.full_name as patient_name",
        "o.branch_id"
      )
      .orderBy("o.created_at")
      .limit(500);

    res.json({
      retention_months: cfg.retention_months,
      cutoff_date:      cutoff,
      count:            orders.length,
      orders,
    });
  })
);

// ── POST /api/retention/archive ───────────────────────────────────────────────
// Soft-archive: set archived_at on eligible orders and their reports.
router.post(
  "/archive",
  asyncHandler(async (req, res) => {
    const cfg    = await getConfig();
    const cutoff = cutoffDate(cfg.retention_months);

    const { orderCount, reportCount } = await db.transaction(async (trx) => {
      // Archive orders older than cutoff that haven't been archived yet
      const archivedOrders = await trx("orders")
        .whereNull("archived_at")
        .where("created_at", "<", cutoff)
        .update({ archived_at: trx.fn.now() });

      // Archive their reports too
      const archivedReports = await trx("reports")
        .whereNull("archived_at")
        .whereIn("order_id",
          trx("orders").where("created_at", "<", cutoff).select("id")
        )
        .update({ archived_at: trx.fn.now() });

      return { orderCount: archivedOrders, reportCount: archivedReports };
    });

    // Record the last run time
    const cfg2 = await getConfig();
    await db("retention_config").where({ id: cfg2.id })
      .update({ last_archive_run: db.fn.now() });

    await logAudit(req, { action: "retention.archive", meta: { orderCount, reportCount, cutoff } });

    res.json({ message: "Archive complete.", orderCount, reportCount, cutoff });
  })
);

// ── GET /api/retention/archived ───────────────────────────────────────────────
router.get(
  "/archived",
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const rows = await db("orders as o")
      .join("patients as p", "p.id", "o.patient_id")
      .whereNotNull("o.archived_at")
      .select(
        "o.id", "o.order_no", "o.sample_status", "o.created_at", "o.archived_at",
        "p.patient_uid", "p.full_name as patient_name", "o.branch_id"
      )
      .orderBy("o.archived_at", "desc")
      .limit(Number(limit))
      .offset(offset);

    res.json(rows);
  })
);

// ── POST /api/retention/export-before-delete ──────────────────────────────────
// Export archived orders to CSV before the admin hard-deletes them.
router.post(
  "/export-before-delete",
  asyncHandler(async (req, res) => {
    const { older_than_months = 24 } = req.body;
    const cutoff = cutoffDate(Number(older_than_months));

    const rows = await db("orders as o")
      .join("patients as p", "p.id", "o.patient_id")
      .whereNotNull("o.archived_at")
      .where("o.archived_at", "<", cutoff)
      .select(
        "o.id", "o.order_no", "o.sample_status",
        "o.created_at", "o.archived_at",
        "p.patient_uid", "p.full_name", "p.phone", "o.branch_id"
      )
      .orderBy("o.archived_at");

    const headers = ["order_id","order_no","patient_uid","patient_name",
                     "phone","sample_status","created_at","archived_at","branch_id"];
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))
    ].join("\r\n");

    await logAudit(req, { action: "retention.export", meta: { older_than_months, count: rows.length } });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="export_before_delete_${Date.now()}.csv"`);
    res.send(csv);
  })
);

// ── DELETE /api/retention/hard-delete ─────────────────────────────────────────
// Permanently delete archived records older than `older_than_months`.
// Requires body: { confirm: "DELETE", older_than_months: N }
router.delete(
  "/hard-delete",
  asyncHandler(async (req, res) => {
    const { confirm, older_than_months = 24 } = req.body;

    if (confirm !== "DELETE") {
      return res.status(400).json({
        error: 'Send { "confirm": "DELETE", "older_than_months": N } to confirm hard deletion.'
      });
    }

    const cutoff = cutoffDate(Number(older_than_months));

    // Find eligible order IDs
    const eligible = await db("orders")
      .whereNotNull("archived_at")
      .where("archived_at", "<", cutoff)
      .pluck("id");

    if (!eligible.length) {
      return res.json({ message: "No records eligible for deletion.", deleted: 0 });
    }

    const deleted = await db.transaction(async (trx) => {
      // Reports cascade via FK, but delete explicitly to be safe
      await trx("reports").whereIn("order_id", eligible).delete();
      const n = await trx("orders").whereIn("id", eligible).delete();
      return n;
    });

    await logAudit(req, {
      action: "retention.hard_delete",
      meta:   { older_than_months, deleted, cutoff },
    });

    res.json({ message: `Permanently deleted ${deleted} orders and their reports.`, deleted });
  })
);

function csvCell(val) {
  if (val === null || val === undefined) return "";
  const s = typeof val === "object" ? JSON.stringify(val) : String(val);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

module.exports = router;
