/**
 * reportRoutes.js — Report retrieval and PDF generation.
 *
 * GET  /api/reports                   — search reports (branch-scoped)
 * GET  /api/reports/:id               — single report with full data
 * GET  /api/reports/:id/pdf           — stream PDF to browser (inline preview)
 * GET  /api/reports/:id/download      — force-download PDF
 * GET  /api/reports/by-uid/:uid       — look up by QR-code UID
 * GET  /api/reports/order/:orderId    — all report versions for an order
 */
const express      = require("express");
const path         = require("path");
const fs           = require("fs");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireBranch } = require("../middleware/auth");
const { generateReportPDF } = require("../utils/pdfReport");
const { logAudit }  = require("../middleware/audit");

const router = express.Router();

router.use(requireAuth, requireBranch);

// ── Shared: load full report data for PDF generation ─────────────────────────
async function loadReportData(reportId) {
  const report = await db("reports").where({ id: reportId }).first();
  if (!report) return null;

  const order = await db("orders as o")
    .join("patients as p", "p.id", "o.patient_id")
    .select(
      "o.*",
      "p.patient_uid", "p.full_name as patient_name",
      "p.gender as patient_gender", "p.date_of_birth", "p.age_years",
      "p.phone as patient_phone", "p.email as patient_email"
    )
    .where("o.id", report.order_id)
    .first();

  const branch = await db("branches").where({ id: report.branch_id }).first();

  // Items with results and best-matching reference range
  const items = await db("order_items as oi")
    .join("tests as t", "t.id", "oi.test_id")
    .join("results as r", "r.order_item_id", "oi.id")
    .select(
      "t.id as test_id", "t.code", "t.name", "t.unit",
      "r.value", "r.flag", "r.unit as result_unit"
    )
    .where("oi.order_id", order.id)
    .orderBy("t.code");

  // Attach the first matching reference range to each item
  for (const item of items) {
    const ageYears = order.date_of_birth
      ? Math.floor((Date.now() - new Date(order.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      : order.age_years;

    const rangeQ = db("reference_ranges")
      .where({ test_id: item.test_id })
      .orderBy("age_min_years")
      .first();

    if (ageYears) {
      rangeQ.where((b) =>
        b.where((i) => i.where("age_min_years", "<=", ageYears).orWhereNull("age_min_years"))
         .where((i) => i.where("age_max_years", ">=", ageYears).orWhereNull("age_max_years"))
      );
    }
    if (order.patient_gender && order.patient_gender !== "O") {
      rangeQ.where((b) => b.where("gender", order.patient_gender).orWhereNull("gender"));
    }

    const range = await rangeQ;
    item.range_low   = range?.range_low  ?? null;
    item.range_high  = range?.range_high ?? null;
    item.range_text  = range?.range_text ?? null;
  }

  // Pathologist user
  const pathologist = report.approved_by
    ? await db("users").where({ id: report.approved_by }).select("id", "full_name").first()
    : null;

  // Signature path
  let signaturePath = null;
  if (report.approved_by) {
    const sig = await db("report_signatures").where({ user_id: report.approved_by }).first();
    if (sig) {
      const abs = path.join(__dirname, "../..", sig.file_path);
      if (fs.existsSync(abs)) signaturePath = abs;
    }
  }

  // Logo path — prefer branch-specific logo, fall back to default lab logo
  let logoPath = null;
  if (branch?.logo_url) {
    const abs = path.join(__dirname, "../..", branch.logo_url);
    if (fs.existsSync(abs)) logoPath = abs;
  }
  if (!logoPath) {
    const defaultLogo = path.join(__dirname, "../../frontend/assets/logo.png");
    if (fs.existsSync(defaultLogo)) logoPath = defaultLogo;
  }

  return { report, order, branch, items, pathologist, signaturePath, logoPath };
}

// ── GET /api/reports ──────────────────────────────────────────────────────────
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const {
      search, patient_id, branch_id, status,
      date_from, date_to, test_code, referring_doctor,
      page = 1, limit = 30,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    const query = db("reports as rpt")
      .join("orders as o",   "o.id",   "rpt.order_id")
      .join("patients as p", "p.id",   "o.patient_id")
      .leftJoin("users as u", "u.id",  "rpt.approved_by")
      .select(
        "rpt.id", "rpt.report_no", "rpt.report_uid", "rpt.version",
        "rpt.superseded", "rpt.status", "rpt.approved_at", "rpt.created_at",
        "p.patient_uid", "p.full_name as patient_name", "p.phone as patient_phone",
        "o.order_no", "o.referring_doctor",
        "u.full_name as pathologist_name",
        "rpt.branch_id"
      )
      .orderBy("rpt.created_at", "desc")
      .limit(Number(limit))
      .offset(offset);

    // Branch scoping
    const bFilter = req.branchFilter || (branch_id ? Number(branch_id) : null);
    if (bFilter) query.where("rpt.branch_id", bFilter);

    if (status)      query.where("rpt.status", status);
    if (patient_id)  query.where("o.patient_id", patient_id);
    if (date_from)   query.where("rpt.approved_at", ">=", date_from);
    if (date_to)     query.where("rpt.approved_at", "<=", date_to + " 23:59:59");
    if (referring_doctor) query.whereILike("o.referring_doctor", `%${referring_doctor}%`);

    if (search) {
      const like = `%${search}%`;
      query.where((b) =>
        b.whereILike("p.full_name",   like)
          .orWhereILike("p.patient_uid", like)
          .orWhereILike("p.phone",       like)
          .orWhereILike("rpt.report_no", like)
          .orWhereILike("o.order_no",    like)
      );
    }

    if (test_code) {
      query.whereExists(
        db("order_items as oi")
          .join("tests as t", "t.id", "oi.test_id")
          .where("oi.order_id", db.ref("o.id"))
          .whereILike("t.code", `%${test_code}%`)
      );
    }

    res.json(await query);
  })
);

// ── GET /api/reports/order/:orderId ───────────────────────────────────────────
router.get(
  "/order/:orderId",
  asyncHandler(async (req, res) => {
    const rows = await db("reports")
      .where({ order_id: req.params.orderId })
      .orderBy("version");
    res.json(rows);
  })
);

// ── GET /api/reports/by-uid/:uid ──────────────────────────────────────────────
router.get(
  "/by-uid/:uid",
  asyncHandler(async (req, res) => {
    const report = await db("reports").where({ report_uid: req.params.uid }).first();
    if (!report) return res.status(404).json({ error: "Report not found." });
    res.json(report);
  })
);

// ── GET /api/reports/:id ──────────────────────────────────────────────────────
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = await loadReportData(Number(req.params.id));
    if (!data) return res.status(404).json({ error: "Report not found." });

    if (req.branchFilter && data.report.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }
    res.json(data);
  })
);

// ── PDF streaming helper ──────────────────────────────────────────────────────
async function streamPDF(req, res, disposition) {
  const data = await loadReportData(Number(req.params.id));
  if (!data) return res.status(404).json({ error: "Report not found." });

  if (req.branchFilter && data.report.branch_id !== req.branchFilter) {
    return res.status(403).json({ error: "Access denied." });
  }

  const pdfBuf = await generateReportPDF(data);
  const filename = `${data.report.report_no}.pdf`;

  // Audit: view or download
  await logAudit(req, {
    action:      disposition === "attachment" ? "report.download" : "report.view",
    entity_type: "report",
    entity_id:   data.report.id,
    meta:        { report_no: data.report.report_no },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuf.length);
  res.send(pdfBuf);
}

// ── GET /api/reports/:id/pdf ──────────────────────────────────────────────────
router.get("/:id/pdf",      asyncHandler((req, res) => streamPDF(req, res, "inline")));

// ── GET /api/reports/:id/download ────────────────────────────────────────────
router.get("/:id/download", asyncHandler((req, res) => streamPDF(req, res, "attachment")));

module.exports = router;
