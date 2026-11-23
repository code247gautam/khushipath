/**
 * resultRoutes.js — Result entry with automatic flag calculation.
 *
 * GET  /api/results/order/:orderId  — all results for an order
 * PUT  /api/results/:itemId         — enter/update a result for one order_item
 *                                     (creates the result row if it doesn't exist)
 *
 * Flag is computed server-side from the reference ranges matching the
 * patient's age and gender. The client may also suggest a flag but the
 * server always recalculates when a numeric value is provided.
 */
const express      = require("express");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireRole, requireBranch } = require("../middleware/auth");
const { flagResult } = require("../utils/flagResult");

const router = express.Router();

router.use(requireAuth, requireBranch);

// ── Helper: resolve patient age in years from order ───────────────────────────
function ageFromPatient(patient) {
  if (patient.date_of_birth) {
    const dob  = new Date(patient.date_of_birth);
    const diff = Date.now() - dob.getTime();
    return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
  }
  return patient.age_years ? Number(patient.age_years) : null;
}

// ── GET /api/results/order/:orderId ───────────────────────────────────────────
router.get(
  "/order/:orderId",
  asyncHandler(async (req, res) => {
    const order = await db("orders").where({ id: req.params.orderId }).first();
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (req.branchFilter && order.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    const rows = await db("order_items as oi")
      .join("tests as t", "t.id", "oi.test_id")
      .leftJoin("results as r", "r.order_item_id", "oi.id")
      .leftJoin("users as u", "u.id", "r.entered_by")
      .select(
        "oi.id as item_id", "t.id as test_id", "t.code", "t.name", "t.unit",
        "r.id as result_id", "r.value", "r.flag", "r.unit as result_unit",
        "r.technician_notes", "r.entered_at", "r.approval_status",
        "u.full_name as entered_by_name"
      )
      .where("oi.order_id", order.id)
      .orderBy("t.code");

    res.json(rows);
  })
);

// ── PUT /api/results/:itemId — enter or update a result ───────────────────────
router.put(
  "/:itemId",
  requireRole("admin", "branch_manager", "technician"),
  asyncHandler(async (req, res) => {
    const item_id = Number(req.params.itemId);
    const { value, technician_notes } = req.body;

    if (value === undefined || value === null || String(value).trim() === "") {
      return res.status(400).json({ error: "value is required." });
    }

    // Load order_item → order → patient
    const item = await db("order_items as oi")
      .join("orders as o", "o.id", "oi.order_id")
      .join("patients as p", "p.id", "o.patient_id")
      .select(
        "oi.id", "oi.test_id", "oi.order_id",
        "o.branch_id",
        "p.gender", "p.date_of_birth", "p.age_years"
      )
      .where("oi.id", item_id)
      .first();

    if (!item) return res.status(404).json({ error: "Order item not found." });
    if (req.branchFilter && item.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    // Cannot update result if already approved
    const existing = await db("results").where({ order_item_id: item_id }).first();
    if (existing && existing.approval_status === "approved") {
      return res.status(409).json({ error: "Result is already approved. Create a correction instead." });
    }

    // ── Auto-flag ─────────────────────────────────────────────────────────────
    const ageYears = ageFromPatient(item);
    const gender   = item.gender; // "M", "F", or "O"

    // Fetch matching reference ranges for this test
    const rangeQuery = db("reference_ranges").where({ test_id: item.test_id });
    if (ageYears !== null) {
      rangeQuery.where((b) =>
        b.where((inner) =>
          inner
            .where("age_min_years", "<=", ageYears)
            .orWhereNull("age_min_years")
        ).where((inner) =>
          inner
            .where("age_max_years", ">=", ageYears)
            .orWhereNull("age_max_years")
        )
      );
    }
    if (gender && gender !== "O") {
      rangeQuery.where((b) => b.where("gender", gender).orWhereNull("gender"));
    }

    const ranges = await rangeQuery.orderBy("age_min_years").orderBy("gender");
    const flag   = flagResult(value, ranges);

    // Fetch test unit for snapshot
    const test = await db("tests").where({ id: item.test_id }).select("unit").first();

    const payload = {
      value:            String(value).trim(),
      unit:             test ? test.unit : null,
      flag,
      technician_notes: technician_notes || null,
      entered_by:       req.session ? req.session.userId : null,
      entered_at:       db.fn.now(),
      approval_status:  "pending",
    };

    let result;
    if (existing) {
      [result] = await db("results")
        .where({ id: existing.id })
        .update({ ...payload, updated_at: db.fn.now() })
        .returning("*");
    } else {
      [result] = await db("results")
        .insert({ order_item_id: item_id, ...payload })
        .returning("*");
    }

    res.json(result);
  })
);

module.exports = router;
