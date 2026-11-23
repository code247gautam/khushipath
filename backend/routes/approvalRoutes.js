/**
 * approvalRoutes.js — Pathologist approval workflow.
 *
 * GET  /api/approval/pending          — list orders with all results entered but not yet approved
 * POST /api/approval/:orderId/approve — approve all results → creates/increments report
 * POST /api/approval/:orderId/reject  — reject with remarks → results reset to pending
 * POST /api/approval/signature        — upload pathologist signature image
 * GET  /api/approval/signature/:userId — get signature image
 *
 * Rules:
 *   - Only the pathologist role (and admin) may approve/reject.
 *   - All results on an order must be entered before approval is possible.
 *   - Approval creates a report row (or increments version if corrections were made).
 *   - Rejection sets each result's approval_status back to "pending" so the
 *     technician can correct and resubmit.
 */
const express      = require("express");
const path         = require("path");
const fs           = require("fs");
const multer       = require("multer");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireRole, requireBranch } = require("../middleware/auth");
const { logAudit }  = require("../middleware/audit");

const router = express.Router();

router.use(requireAuth, requireBranch);

// ── Signature upload storage ──────────────────────────────────────────────────
// Use /app/uploads (writable) — __dirname is /app/routes, go up to /app then into uploads
const SIG_DIR = path.join(__dirname, "../uploads/signatures");
if (!fs.existsSync(SIG_DIR)) fs.mkdirSync(SIG_DIR, { recursive: true });

const sigStorage = multer.diskStorage({
  destination: SIG_DIR,
  filename: (req, file, cb) => {
    // name it by the user's id so overwriting replaces the old one
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${req.session.userId}${ext}`);
  },
});
const sigUpload = multer({
  storage: sigStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    /image\/(png|jpeg|jpg|gif)/.test(file.mimetype) ? cb(null, true) : cb(new Error("Images only.")),
});

// ── Helper: generate report number ───────────────────────────────────────────
async function nextReportNo() {
  const today  = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `RPT-${today}-`;
  const last   = await db("reports").whereILike("report_no", `${prefix}%`).orderBy("id", "desc").first();
  const counter = last ? parseInt(last.report_no.split("-").pop(), 10) + 1 : 1;
  return `${prefix}${String(counter).padStart(4, "0")}`;
}

// ── GET /api/approval/pending ─────────────────────────────────────────────────
router.get(
  "/pending",
  requireRole("admin", "pathologist", "branch_manager"),
  asyncHandler(async (req, res) => {
    // Orders where:
    //   - all order_items have a result row
    //   - at least one result is still pending approval
    const rows = await db("orders as o")
      .join("patients as p", "p.id", "o.patient_id")
      .whereExists(
        db("order_items as oi")
          .join("results as r", "r.order_item_id", "oi.id")
          .where("oi.order_id", db.ref("o.id"))
          .where("r.approval_status", "pending")
      )
      .whereNotExists(
        db("order_items as oi2")
          .leftJoin("results as r2", "r2.order_item_id", "oi2.id")
          .where("oi2.order_id", db.ref("o.id"))
          .whereNull("r2.id")   // items with no result yet
      )
      .select(
        "o.id", "o.order_no", "o.sample_status", "o.created_at",
        "p.patient_uid", "p.full_name as patient_name", "p.phone as patient_phone",
        "o.branch_id"
      )
      .modify((q) => { if (req.branchFilter) q.where("o.branch_id", req.branchFilter); })
      .orderBy("o.created_at");

    res.json(rows);
  })
);

// ── POST /api/approval/:orderId/approve ───────────────────────────────────────
router.post(
  "/:orderId/approve",
  requireRole("admin", "pathologist"),
  asyncHandler(async (req, res) => {
    const orderId = Number(req.params.orderId);
    const { remarks } = req.body;

    const order = await db("orders").where({ id: orderId }).first();
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (req.branchFilter && order.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    // Verify every item has a result
    const unfinished = await db("order_items as oi")
      .leftJoin("results as r", "r.order_item_id", "oi.id")
      .where("oi.order_id", orderId)
      .whereNull("r.id")
      .count("oi.id as cnt")
      .first();

    if (Number(unfinished.cnt) > 0) {
      return res.status(409).json({ error: "All results must be entered before approval." });
    }

    const report = await db.transaction(async (trx) => {
      // Mark all pending results as approved
      await trx("results as r")
        .join("order_items as oi", "oi.id", "r.order_item_id")
        .where("oi.order_id", orderId)
        .where("r.approval_status", "pending")
        .update({
          "r.approval_status": "approved",
          "r.approved_by":     req.session.userId,
          "r.approved_at":     trx.fn.now(),
        });

      // Check if a previous approved report exists for this order
      const existing = await trx("reports")
        .where({ order_id: orderId, superseded: false })
        .orderBy("version", "desc")
        .first();

      if (existing) {
        // Mark old report superseded
        await trx("reports")
          .where({ id: existing.id })
          .update({ superseded: true, status: "superseded", updated_at: trx.fn.now() });
      }

      const newVersion = existing ? existing.version + 1 : 1;
      const report_no  = await nextReportNo();

      const [newReport] = await trx("reports")
        .insert({
          order_id:             orderId,
          branch_id:            order.branch_id,
          version:              newVersion,
          approved_by:          req.session.userId,
          approved_at:          trx.fn.now(),
          status:               "approved",
          report_no,
          pathologist_remarks:  remarks || null,
        })
        .returning("*");

      // Move order status to "reported"
      await trx("orders")
        .where({ id: orderId })
        .update({ sample_status: "reported", updated_at: trx.fn.now() });

      return newReport;
    });

    await logAudit(req, { action: "report.approve", entity_type: "report", entity_id: report.id,
      meta: { order_id: orderId, version: report.version, report_no: report.report_no } });
    res.status(201).json(report);
  })
);

// ── POST /api/approval/:orderId/reject ────────────────────────────────────────
router.post(
  "/:orderId/reject",
  requireRole("admin", "pathologist"),
  asyncHandler(async (req, res) => {
    const orderId = Number(req.params.orderId);
    const { remarks } = req.body;

    const order = await db("orders").where({ id: orderId }).first();
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (req.branchFilter && order.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    // Reset all results to pending so the technician can correct them
    await db("results as r")
      .join("order_items as oi", "oi.id", "r.order_item_id")
      .where("oi.order_id", orderId)
      .update({
        "r.approval_status":    "rejected",
        "r.technician_notes":   db.raw(
          "CONCAT(COALESCE(r.technician_notes,''), ' [Rejected: ' || ? || ']')",
          [remarks || "No remarks"]
        ),
        "r.updated_at": db.fn.now(),
      });

    // Also flip back to in_process
    await db("orders").where({ id: orderId })
      .update({ sample_status: "in_process", updated_at: db.fn.now() });

    await logAudit(req, { action: "report.reject", entity_type: "order", entity_id: orderId,
      meta: { remarks } });
    res.json({ message: "Order rejected. Results reset for correction." });
  })
);

// ── POST /api/approval/signature — upload pathologist signature ───────────────
router.post(
  "/signature",
  requireRole("admin", "pathologist"),
  sigUpload.single("signature"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const filePath = `uploads/signatures/${req.file.filename}`;
    const userId   = req.session.userId;

    await db("report_signatures")
      .insert({ user_id: userId, file_path: filePath })
      .onConflict("user_id")
      .merge({ file_path: filePath, updated_at: db.fn.now() });

    res.json({ message: "Signature saved.", file_path: filePath });
  })
);

// ── GET /api/approval/signature/:userId ───────────────────────────────────────
router.get(
  "/signature/:userId",
  asyncHandler(async (req, res) => {
    const sig = await db("report_signatures")
      .where({ user_id: req.params.userId })
      .first();

    if (!sig) return res.status(404).json({ error: "No signature on file." });

    const absPath = path.join(__dirname, "../..", sig.file_path);
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: "Signature file missing." });

    res.sendFile(absPath);
  })
);

module.exports = router;
