/**
 * billingRoutes.js — Invoice management, payments, and collection reports.
 *
 * GET    /api/billing/invoices              — list invoices (branch-scoped, filterable)
 * GET    /api/billing/invoices/:id          — single invoice with payments
 * PUT    /api/billing/invoices/:id          — update discount / notes / status
 * POST   /api/billing/invoices/:id/pay      — record a payment
 * DELETE /api/billing/invoices/:id/payments/:pid — void a payment (admin only)
 * GET    /api/billing/collection            — daily collection report for a date+branch
 * GET    /api/billing/collection/csv        — download collection as CSV
 * GET    /api/billing/dues                  — list all invoices with outstanding balances
 */
const express      = require("express");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireRole, requireBranch } = require("../middleware/auth");
const { logAudit }  = require("../middleware/audit");

const router = express.Router();

router.use(requireAuth, requireBranch);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Recompute paid_amount from invoice_payments and update invoice status. */
async function syncInvoiceBalance(trx, invoiceId) {
  const row = await trx("invoice_payments")
    .where({ invoice_id: invoiceId })
    .sum("amount as total")
    .first();

  const paid = Number(row.total || 0);

  const inv = await trx("invoices").where({ id: invoiceId }).first();
  const due = Number(inv.total_amount) - Number(inv.discount_amount) - paid;

  let status;
  if (inv.status === "void") {
    status = "void";
  } else if (due <= 0) {
    status = "paid";
  } else if (paid > 0) {
    status = "partially_paid";
  } else {
    status = "issued";
  }

  await trx("invoices")
    .where({ id: invoiceId })
    .update({ paid_amount: paid, status, updated_at: trx.fn.now() });

  return { paid_amount: paid, amount_due: Math.max(due, 0), status };
}

function csvCell(val) {
  if (val === null || val === undefined) return "";
  const s = typeof val === "object" ? JSON.stringify(val) : String(val);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ── GET /api/billing/invoices ─────────────────────────────────────────────────
router.get(
  "/invoices",
  asyncHandler(async (req, res) => {
    const {
      status, search, date_from, date_to,
      patient_id, page = 1, limit = 30,
    } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const bf     = req.branchFilter;

    const query = db("invoices as inv")
      .join("orders as o",   "o.id",  "inv.order_id")
      .join("patients as p", "p.id",  "o.patient_id")
      .leftJoin("users as u","u.id",  "inv.created_by")
      .select(
        "inv.id", "inv.invoice_no", "inv.status",
        "inv.total_amount", "inv.discount_amount", "inv.paid_amount",
        db.raw("inv.total_amount - inv.discount_amount - inv.paid_amount as amount_due"),
        "inv.created_at", "inv.notes",
        "o.order_no", "o.id as order_id",
        "p.patient_uid", "p.full_name as patient_name", "p.phone as patient_phone",
        "inv.branch_id"
      )
      .orderBy("inv.created_at", "desc")
      .limit(Number(limit))
      .offset(offset);

    if (bf)        query.where("inv.branch_id", bf);
    if (status)    query.where("inv.status",    status);
    if (patient_id) query.where("o.patient_id", patient_id);
    if (date_from) query.where("inv.created_at", ">=", date_from);
    if (date_to)   query.where("inv.created_at", "<=", date_to + " 23:59:59");
    if (search) {
      const like = `%${search}%`;
      query.where((b) =>
        b.whereILike("inv.invoice_no", like)
          .orWhereILike("p.full_name",   like)
          .orWhereILike("p.patient_uid", like)
          .orWhereILike("o.order_no",    like)
      );
    }

    res.json(await query);
  })
);

// ── GET /api/billing/invoices/:id ─────────────────────────────────────────────
router.get(
  "/invoices/:id",
  asyncHandler(async (req, res) => {
    const inv = await db("invoices as inv")
      .join("orders as o",   "o.id",  "inv.order_id")
      .join("patients as p", "p.id",  "o.patient_id")
      .select(
        "inv.*",
        db.raw("inv.total_amount - inv.discount_amount - inv.paid_amount as amount_due"),
        "o.order_no", "o.id as order_id",
        "p.patient_uid", "p.full_name as patient_name",
        "p.phone as patient_phone", "p.email as patient_email"
      )
      .where("inv.id", req.params.id)
      .first();

    if (!inv) return res.status(404).json({ error: "Invoice not found." });
    if (req.branchFilter && inv.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    // Order items (the line items)
    const items = await db("order_items as oi")
      .join("tests as t", "t.id", "oi.test_id")
      .select("t.code", "t.name", "t.unit", "oi.price_at_order")
      .where("oi.order_id", inv.order_id)
      .orderBy("t.code");

    // Payment history
    const payments = await db("invoice_payments as p")
      .leftJoin("users as u", "u.id", "p.received_by")
      .select("p.*", "u.full_name as received_by_name")
      .where("p.invoice_id", inv.id)
      .orderBy("p.paid_at");

    res.json({ ...inv, items, payments });
  })
);

// ── PUT /api/billing/invoices/:id — apply discount / notes ───────────────────
router.put(
  "/invoices/:id",
  requireRole("admin", "branch_manager", "accountant"),
  asyncHandler(async (req, res) => {
    const inv = await db("invoices").where({ id: req.params.id }).first();
    if (!inv) return res.status(404).json({ error: "Invoice not found." });
    if (req.branchFilter && inv.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }
    if (inv.status === "void") {
      return res.status(409).json({ error: "Cannot modify a voided invoice." });
    }

    const { discount_amount, notes } = req.body;

    const newDiscount = discount_amount !== undefined ? Number(discount_amount) : inv.discount_amount;
    if (newDiscount < 0 || newDiscount > Number(inv.total_amount)) {
      return res.status(400).json({ error: "Discount cannot exceed the total amount." });
    }

    const updated = await db.transaction(async (trx) => {
      await trx("invoices")
        .where({ id: inv.id })
        .update({
          discount_amount: newDiscount,
          notes:           notes ?? inv.notes,
          updated_at:      trx.fn.now(),
        });

      return syncInvoiceBalance(trx, inv.id);
    });

    await logAudit(req, { action: "billing.invoice_update", entity_type: "invoice", entity_id: inv.id,
      meta: { discount_amount: newDiscount } });
    res.json(updated);
  })
);

// ── POST /api/billing/invoices/:id/pay ────────────────────────────────────────
router.post(
  "/invoices/:id/pay",
  requireRole("admin", "branch_manager", "accountant", "receptionist"),
  asyncHandler(async (req, res) => {
    const inv = await db("invoices").where({ id: req.params.id }).first();
    if (!inv) return res.status(404).json({ error: "Invoice not found." });
    if (req.branchFilter && inv.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }
    if (inv.status === "void") {
      return res.status(409).json({ error: "Cannot accept payment for a voided invoice." });
    }
    if (inv.status === "paid") {
      return res.status(409).json({ error: "Invoice is already fully paid." });
    }

    const { amount, payment_method = "cash", reference_no, notes } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "amount must be a positive number." });
    }

    const amountDue = Number(inv.total_amount) - Number(inv.discount_amount) - Number(inv.paid_amount);
    if (Number(amount) > amountDue + 0.01) { // small float tolerance
      return res.status(400).json({ error: `Amount exceeds outstanding due of ₹${amountDue.toFixed(2)}.` });
    }

    const { balance, status: newStatus } = await db.transaction(async (trx) => {
      await trx("invoice_payments").insert({
        invoice_id:     inv.id,
        received_by:    req.session.userId,
        amount:         Number(amount),
        payment_method,
        reference_no:   reference_no || null,
        notes:          notes        || null,
        paid_at:        trx.fn.now(),
      });

      return syncInvoiceBalance(trx, inv.id);
    });

    await logAudit(req, { action: "billing.payment", entity_type: "invoice", entity_id: inv.id,
      meta: { amount, payment_method, newStatus } });

    res.status(201).json({
      message:    `Payment recorded. Status: ${newStatus}.`,
      amount_due: balance.amount_due,
      status:     newStatus,
    });
  })
);

// ── DELETE /api/billing/invoices/:id/payments/:pid — void a payment ───────────
router.delete(
  "/invoices/:id/payments/:pid",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const inv = await db("invoices").where({ id: req.params.id }).first();
    if (!inv) return res.status(404).json({ error: "Invoice not found." });

    const payment = await db("invoice_payments")
      .where({ id: req.params.pid, invoice_id: inv.id })
      .first();
    if (!payment) return res.status(404).json({ error: "Payment not found." });

    const updated = await db.transaction(async (trx) => {
      await trx("invoice_payments").where({ id: payment.id }).delete();
      return syncInvoiceBalance(trx, inv.id);
    });

    await logAudit(req, { action: "billing.payment_void", entity_type: "invoice", entity_id: inv.id,
      meta: { payment_id: payment.id, amount: payment.amount } });
    res.json({ message: "Payment voided.", ...updated });
  })
);

// ── GET /api/billing/dues — outstanding invoices ──────────────────────────────
router.get(
  "/dues",
  asyncHandler(async (req, res) => {
    const bf = req.branchFilter;

    const query = db("invoices as inv")
      .join("orders as o",   "o.id",  "inv.order_id")
      .join("patients as p", "p.id",  "o.patient_id")
      .select(
        "inv.id", "inv.invoice_no", "inv.status",
        "inv.total_amount", "inv.discount_amount", "inv.paid_amount",
        db.raw("inv.total_amount - inv.discount_amount - inv.paid_amount as amount_due"),
        "inv.created_at",
        "o.order_no", "p.patient_uid", "p.full_name as patient_name", "p.phone as patient_phone",
        "inv.branch_id"
      )
      .whereIn("inv.status", ["issued", "partially_paid"])
      .whereRaw("inv.total_amount - inv.discount_amount - inv.paid_amount > 0")
      .orderBy("amount_due", "desc");

    if (bf) query.where("inv.branch_id", bf);
    res.json(await query);
  })
);

// ── GET /api/billing/collection — daily collection report ────────────────────
router.get(
  "/collection",
  asyncHandler(async (req, res) => {
    const { date, branch_id } = req.query;
    if (!date) return res.status(400).json({ error: "date (YYYY-MM-DD) is required." });

    const bf    = req.branchFilter ?? (branch_id ? Number(branch_id) : null);
    const start = `${date}T00:00:00.000Z`;
    const end   = `${date}T23:59:59.999Z`;

    const payments = await db("invoice_payments as pay")
      .join("invoices as inv",    "inv.id",    "pay.invoice_id")
      .join("orders as o",        "o.id",      "inv.order_id")
      .join("patients as p",      "p.id",      "o.patient_id")
      .leftJoin("users as u",     "u.id",      "pay.received_by")
      .leftJoin("branches as b",  "b.id",      "inv.branch_id")
      .select(
        "pay.id as payment_id",
        "pay.amount", "pay.payment_method", "pay.reference_no",
        "pay.paid_at",
        "inv.invoice_no", "inv.total_amount", "inv.discount_amount",
        "o.order_no",
        "p.patient_uid", "p.full_name as patient_name", "p.phone as patient_phone",
        "u.full_name as received_by_name",
        "b.name as branch_name",
        "inv.branch_id"
      )
      .whereBetween("pay.paid_at", [start, end])
      .modify((q) => { if (bf) q.where("inv.branch_id", bf); })
      .orderBy("pay.paid_at");

    const totalCollected = payments.reduce((s, p) => s + Number(p.amount), 0);

    // Breakdown by payment method
    const byMethod = payments.reduce((acc, p) => {
      acc[p.payment_method] = (acc[p.payment_method] || 0) + Number(p.amount);
      return acc;
    }, {});

    res.json({ date, branch_id: bf, payments, totalCollected, byMethod });
  })
);

// ── GET /api/billing/collection/csv ──────────────────────────────────────────
router.get(
  "/collection/csv",
  asyncHandler(async (req, res) => {
    const { date, branch_id } = req.query;
    if (!date) return res.status(400).json({ error: "date is required." });

    const bf    = req.branchFilter ?? (branch_id ? Number(branch_id) : null);
    const start = `${date}T00:00:00.000Z`;
    const end   = `${date}T23:59:59.999Z`;

    const payments = await db("invoice_payments as pay")
      .join("invoices as inv",   "inv.id",   "pay.invoice_id")
      .join("orders as o",       "o.id",     "inv.order_id")
      .join("patients as p",     "p.id",     "o.patient_id")
      .leftJoin("users as u",    "u.id",     "pay.received_by")
      .select(
        "pay.paid_at", "inv.invoice_no", "o.order_no",
        "p.patient_uid", "p.full_name as patient_name",
        "pay.amount", "pay.payment_method", "pay.reference_no",
        "u.full_name as received_by"
      )
      .whereBetween("pay.paid_at", [start, end])
      .modify((q) => { if (bf) q.where("inv.branch_id", bf); })
      .orderBy("pay.paid_at");

    const headers = ["paid_at","invoice_no","order_no","patient_uid","patient_name",
                     "amount","payment_method","reference_no","received_by"];
    const csv = [
      headers.join(","),
      ...payments.map((r) => headers.map((h) => csvCell(r[h])).join(","))
    ].join("\r\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="collection_${date}.csv"`);
    res.send(csv);
  })
);

module.exports = router;
