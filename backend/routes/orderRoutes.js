/**
 * orderRoutes.js — Create orders, add tests/packages, update sample status.
 * Note: invoice creation is handled here via createInvoiceForOrder().
 *
 * GET    /api/orders              — list (branch-scoped, with filters)
 * GET    /api/orders/:id          — single order with items + result stubs
 * POST   /api/orders              — create order
 * PUT    /api/orders/:id/status   — update sample_status
 * POST   /api/orders/:id/items    — add test(s) or a package to order
 * DELETE /api/orders/:id/items/:itemId — remove an item (only while pending)
 */
const express      = require("express");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireRole, requireBranch } = require("../middleware/auth");
const { nextOrderNo } = require("./patientRoutes");

/**
 * Auto-create an invoice for a new order inside an existing transaction.
 * Called at the end of the POST /api/orders handler.
 * Extracted here so billingRoutes can also call it for re-sync if needed.
 */
async function createInvoiceForOrder(trx, order, userId) {
  // Calculate total from order_items
  const totRow = await trx("order_items")
    .where({ order_id: order.id })
    .sum("price_at_order as total")
    .first();

  const total = Number(totRow.total || 0);

  // Generate invoice number
  const today  = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `INV-${today}-`;
  const last   = await trx("invoices").whereILike("invoice_no", `${prefix}%`).orderBy("id", "desc").first();
  const counter = last ? parseInt(last.invoice_no.split("-").pop(), 10) + 1 : 1;
  const invoice_no = `${prefix}${String(counter).padStart(4, "0")}`;

  const [inv] = await trx("invoices")
    .insert({
      order_id:   order.id,
      branch_id:  order.branch_id,
      created_by: userId,
      invoice_no,
      total_amount: total,
      status:       "issued",
    })
    .returning("*");

  return inv;
}

const router = express.Router();

router.use(requireAuth, requireBranch);

const VALID_STATUSES = ["collected", "received", "in_process", "reported", "delivered"];

// ── GET /api/orders ───────────────────────────────────────────────────────────
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { patient_id, status, search, page = 1, limit = 30 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const query = db("orders as o")
      .join("patients as p", "p.id", "o.patient_id")
      .select(
        "o.id", "o.order_no", "o.sample_status",
        "o.created_at", "o.collected_at",
        "p.id as patient_id", "p.patient_uid",
        "p.full_name as patient_name", "p.phone as patient_phone",
        "o.branch_id"
      )
      .orderBy("o.created_at", "desc")
      .limit(Number(limit))
      .offset(offset);

    if (req.branchFilter) query.where("o.branch_id", req.branchFilter);
    if (patient_id)       query.where("o.patient_id", patient_id);
    if (status)           query.where("o.sample_status", status);
    if (search) {
      const like = `%${search}%`;
      query.where((b) =>
        b.whereILike("o.order_no", like)
          .orWhereILike("p.full_name", like)
          .orWhereILike("p.patient_uid", like)
      );
    }

    res.json(await query);
  })
);

// ── GET /api/orders/:id ───────────────────────────────────────────────────────
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await db("orders as o")
      .join("patients as p", "p.id", "o.patient_id")
      .select(
        "o.*",
        "p.patient_uid", "p.full_name as patient_name",
        "p.gender as patient_gender", "p.date_of_birth", "p.age_years",
        "p.phone as patient_phone", "p.email as patient_email"
      )
      .where("o.id", req.params.id)
      .first();

    if (!order) return res.status(404).json({ error: "Order not found." });
    if (req.branchFilter && order.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    // Items with test info and results (if any)
    const items = await db("order_items as oi")
      .join("tests as t", "t.id", "oi.test_id")
      .leftJoin("results as r", "r.order_item_id", "oi.id")
      .select(
        "oi.id as item_id", "oi.test_id", "oi.package_id", "oi.price_at_order",
        "t.code", "t.name", "t.unit", "t.sample_type",
        "r.id as result_id", "r.value", "r.flag", "r.approval_status",
        "r.technician_notes", "r.entered_at"
      )
      .where("oi.order_id", order.id)
      .orderBy("t.code");

    res.json({ ...order, items });
  })
);

// ── POST /api/orders ──────────────────────────────────────────────────────────
router.post(
  "/",
  requireRole("admin", "branch_manager", "receptionist"),
  asyncHandler(async (req, res) => {
    const {
      patient_id, clinical_notes, referring_doctor,
      test_ids = [], package_ids = [], collected_at,
    } = req.body;

    if (!patient_id) return res.status(400).json({ error: "patient_id is required." });
    if (!test_ids.length && !package_ids.length) {
      return res.status(400).json({ error: "At least one test or package is required." });
    }

    // Verify patient belongs to this branch
    const patient = await db("patients").where({ id: patient_id }).first();
    if (!patient) return res.status(404).json({ error: "Patient not found." });

    const branch_id = req.branchFilter ?? patient.branch_id;
    if (req.branchFilter && patient.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Patient is not in your branch." });
    }

    const order_no = await nextOrderNo();

    // Create order inside a transaction
    const order = await db.transaction(async (trx) => {
      const [newOrder] = await trx("orders")
        .insert({
          branch_id,
          patient_id,
          created_by:   req.session.userId,
          order_no,
          clinical_notes,
          referring_doctor: referring_doctor || patient.referring_doctor,
          collected_at:     collected_at || db.fn.now(),
        })
        .returning("*");

      // Collect test IDs to add (direct + via packages)
      const allTests = new Map(); // test_id → { price, package_id }

      // Direct tests
      if (test_ids.length) {
        const tests = await trx("tests").whereIn("id", test_ids).select("id", "price");
        for (const t of tests) allTests.set(t.id, { price: t.price, package_id: null });
      }

      // Package tests
      if (package_ids.length) {
        const pkgTests = await trx("package_tests as pt")
          .join("tests as t", "t.id", "pt.test_id")
          .whereIn("pt.package_id", package_ids)
          .select("t.id", "t.price", "pt.package_id");
        for (const pt of pkgTests) {
          if (!allTests.has(pt.id)) {
            allTests.set(pt.id, { price: pt.price, package_id: pt.package_id });
          }
        }
      }

      if (!allTests.size) throw new Error("None of the specified tests were found.");

      const items = [...allTests.entries()].map(([test_id, info]) => ({
        order_id:       newOrder.id,
        test_id,
        package_id:     info.package_id,
        price_at_order: info.price,
      }));

      await trx("order_items").insert(items);

      // Auto-create invoice
      await createInvoiceForOrder(trx, newOrder, req.session.userId);

      return newOrder;
    });

    // Return the full order with items
    const full = await db("orders as o")
      .join("patients as p", "p.id", "o.patient_id")
      .select("o.*", "p.patient_uid", "p.full_name as patient_name")
      .where("o.id", order.id)
      .first();

    const items = await db("order_items as oi")
      .join("tests as t", "t.id", "oi.test_id")
      .select("oi.id as item_id", "oi.test_id", "oi.price_at_order", "t.code", "t.name", "t.unit")
      .where("oi.order_id", order.id);

    res.status(201).json({ ...full, items });
  })
);

// ── PUT /api/orders/:id/status ────────────────────────────────────────────────
router.put(
  "/:id/status",
  requireRole("admin", "branch_manager", "receptionist", "technician"),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    const order = await db("orders").where({ id: req.params.id }).first();
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (req.branchFilter && order.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    const [row] = await db("orders")
      .where({ id: order.id })
      .update({ sample_status: status, updated_at: db.fn.now() })
      .returning("id, order_no, sample_status");

    res.json(row);
  })
);

// ── POST /api/orders/:id/items — add tests/packages after creation ────────────
router.post(
  "/:id/items",
  requireRole("admin", "branch_manager", "receptionist"),
  asyncHandler(async (req, res) => {
    const order = await db("orders").where({ id: req.params.id }).first();
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (req.branchFilter && order.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    const { test_ids = [], package_ids = [] } = req.body;
    if (!test_ids.length && !package_ids.length) {
      return res.status(400).json({ error: "Provide test_ids or package_ids." });
    }

    const existing = await db("order_items").where({ order_id: order.id }).pluck("test_id");
    const existingSet = new Set(existing);

    const toInsert = [];

    if (test_ids.length) {
      const tests = await db("tests").whereIn("id", test_ids).select("id", "price");
      for (const t of tests) {
        if (!existingSet.has(t.id)) {
          toInsert.push({ order_id: order.id, test_id: t.id, price_at_order: t.price });
        }
      }
    }

    if (package_ids.length) {
      const pkgTests = await db("package_tests as pt")
        .join("tests as t", "t.id", "pt.test_id")
        .whereIn("pt.package_id", package_ids)
        .select("t.id", "t.price", "pt.package_id");
      for (const pt of pkgTests) {
        if (!existingSet.has(pt.id)) {
          toInsert.push({ order_id: order.id, test_id: pt.id, package_id: pt.package_id, price_at_order: pt.price });
        }
      }
    }

    if (toInsert.length) await db("order_items").insert(toInsert);
    res.json({ added: toInsert.length });
  })
);

// ── DELETE /api/orders/:id/items/:itemId ──────────────────────────────────────
router.delete(
  "/:id/items/:itemId",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const order = await db("orders").where({ id: req.params.id }).first();
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (req.branchFilter && order.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    // Cannot remove items from orders that already have approved results
    const item = await db("order_items").where({ id: req.params.itemId, order_id: order.id }).first();
    if (!item) return res.status(404).json({ error: "Item not found." });

    const result = await db("results").where({ order_item_id: item.id }).first();
    if (result && result.approval_status === "approved") {
      return res.status(409).json({ error: "Cannot remove an item with an approved result." });
    }

    // Delete result stub if exists (cascade handles it, but be explicit)
    if (result) await db("results").where({ id: result.id }).delete();
    await db("order_items").where({ id: item.id }).delete();

    res.json({ message: "Item removed." });
  })
);

module.exports = router;
