/**
 * dashboardRoutes.js — Aggregated KPI data for the dashboard and EOD summary.
 *
 * GET /api/dashboard/today          — today's KPIs (branch-scoped or all)
 * GET /api/dashboard/eod            — end-of-day summary for a date + branch
 * GET /api/dashboard/eod/pdf        — PDF version of EOD summary
 * GET /api/dashboard/eod/excel      — Excel (CSV) version of EOD summary
 * GET /api/dashboard/delayed        — orders past their TAT
 * GET /api/dashboard/top-tests      — top N tests by count for a date range
 */
const express      = require("express");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireBranch } = require("../middleware/auth");
const PDFDocument  = require("pdfkit");

const router = express.Router();

router.use(requireAuth, requireBranch);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the start-of-day ISO string for a given date string (YYYY-MM-DD) */
function dayStart(dateStr) {
  return `${dateStr}T00:00:00.000Z`;
}
function dayEnd(dateStr) {
  return `${dateStr}T23:59:59.999Z`;
}

/** Scope a knex query to a branch if branchFilter is set */
function scopeBranch(query, branchFilter, tableAlias = null) {
  const col = tableAlias ? `${tableAlias}.branch_id` : "branch_id";
  if (branchFilter) query.where(col, branchFilter);
  return query;
}

// ── GET /api/dashboard/today ──────────────────────────────────────────────────
router.get(
  "/today",
  asyncHandler(async (req, res) => {
    const today     = new Date().toISOString().slice(0, 10);
    const start     = dayStart(today);
    const end       = dayEnd(today);
    const bf        = req.branchFilter;

    // Run all KPI queries in parallel for speed
    const [
      patientsToday,
      ordersToday,
      resultsPending,
      resultsApproved,
      reportsDelivered,
      delayedOrders,
    ] = await Promise.all([

      // 1. Patients registered today
      scopeBranch(db("patients").whereBetween("created_at", [start, end]).count("id as cnt"), bf)
        .first(),

      // 2. Orders created today
      scopeBranch(db("orders").whereBetween("created_at", [start, end]).count("id as cnt"), bf)
        .first(),

      // 3. Results pending approval (all time, not just today — your backlog)
      db("results as r")
        .join("order_items as oi", "oi.id", "r.order_item_id")
        .join("orders as o",       "o.id",  "oi.order_id")
        .where("r.approval_status", "pending")
        .modify((q) => { if (bf) q.where("o.branch_id", bf); })
        .count("r.id as cnt").first(),

      // 4. Reports approved today
      scopeBranch(db("reports").whereBetween("approved_at", [start, end]).where("status", "approved").count("id as cnt"), bf)
        .first(),

      // 5. Orders delivered today
      scopeBranch(db("orders").whereBetween("updated_at", [start, end]).where("sample_status", "delivered").count("id as cnt"), bf)
        .first(),

      // 6. Delayed orders: in_process and past TAT
      db("orders as o")
        .join("order_items as oi", "oi.order_id", "o.id")
        .join("tests as t",        "t.id",         "oi.test_id")
        .whereIn("o.sample_status", ["collected", "received", "in_process"])
        .whereRaw("o.collected_at + (t.turnaround_hours || ' hours')::interval < NOW()")
        .modify((q) => { if (bf) q.where("o.branch_id", bf); })
        .countDistinct("o.id as cnt").first(),
    ]);

    // Revenue today (sum of price_at_order for orders created today)
    const revenueRow = await db("order_items as oi")
      .join("orders as o", "o.id", "oi.order_id")
      .whereBetween("o.created_at", [start, end])
      .modify((q) => { if (bf) q.where("o.branch_id", bf); })
      .sum("oi.price_at_order as total")
      .first();

    res.json({
      date:               today,
      patients_today:     Number(patientsToday.cnt),
      orders_today:       Number(ordersToday.cnt),
      results_pending:    Number(resultsPending.cnt),
      reports_approved:   Number(resultsApproved.cnt),
      orders_delivered:   Number(reportsDelivered.cnt),
      delayed_orders:     Number(delayedOrders.cnt),
      revenue_today:      Number(revenueRow.total || 0),
    });
  })
);

// ── GET /api/dashboard/top-tests ──────────────────────────────────────────────
router.get(
  "/top-tests",
  asyncHandler(async (req, res) => {
    const { date_from, date_to, limit = 10 } = req.query;
    const bf = req.branchFilter;

    const query = db("order_items as oi")
      .join("tests as t", "t.id", "oi.test_id")
      .join("orders as o", "o.id", "oi.order_id")
      .select("t.id", "t.code", "t.name")
      .count("oi.id as order_count")
      .groupBy("t.id", "t.code", "t.name")
      .orderBy("order_count", "desc")
      .limit(Number(limit));

    if (bf)        query.where("o.branch_id", bf);
    if (date_from) query.where("o.created_at", ">=", dayStart(date_from));
    if (date_to)   query.where("o.created_at", "<=", dayEnd(date_to));

    res.json(await query);
  })
);

// ── GET /api/dashboard/delayed ────────────────────────────────────────────────
router.get(
  "/delayed",
  asyncHandler(async (req, res) => {
    const bf = req.branchFilter;

    const rows = await db("orders as o")
      .join("patients as p", "p.id", "o.patient_id")
      .join("order_items as oi", "oi.order_id", "o.id")
      .join("tests as t", "t.id", "oi.test_id")
      .whereIn("o.sample_status", ["collected", "received", "in_process"])
      .whereRaw("o.collected_at + (t.turnaround_hours || ' hours')::interval < NOW()")
      .modify((q) => { if (bf) q.where("o.branch_id", bf); })
      .select(
        "o.id", "o.order_no", "o.sample_status", "o.collected_at",
        "p.patient_uid", "p.full_name as patient_name",
        db.raw("MIN(t.turnaround_hours) as min_tat"),
        db.raw("EXTRACT(EPOCH FROM (NOW() - o.collected_at))/3600 as hours_elapsed")
      )
      .groupBy("o.id", "o.order_no", "o.sample_status", "o.collected_at",
               "p.patient_uid", "p.full_name")
      .orderBy("hours_elapsed", "desc")
      .limit(100);

    res.json(rows);
  })
);

// ── GET /api/dashboard/eod ────────────────────────────────────────────────────
router.get(
  "/eod",
  asyncHandler(async (req, res) => {
    const { date, branch_id } = req.query;
    if (!date) return res.status(400).json({ error: "date (YYYY-MM-DD) is required." });

    // Respect branch scoping; allow admin to pass a specific branch_id
    const bf = req.branchFilter ?? (branch_id ? Number(branch_id) : null);
    const start = dayStart(date);
    const end   = dayEnd(date);

    // ── Gather all data ────────────────────────────────────────────────
    const [
      newPatients,
      orders,
      approvedReports,
      topTests,
    ] = await Promise.all([

      // New patients
      db("patients")
        .whereBetween("created_at", [start, end])
        .modify((q) => { if (bf) q.where("branch_id", bf); })
        .select("patient_uid", "full_name", "gender", "phone", "referring_doctor"),

      // All orders with item count + total value
      db("orders as o")
        .join("patients as p", "p.id", "o.patient_id")
        .leftJoin(
          db("order_items").select("order_id").sum("price_at_order as total").groupBy("order_id").as("rev"),
          "rev.order_id", "o.id"
        )
        .whereBetween("o.created_at", [start, end])
        .modify((q) => { if (bf) q.where("o.branch_id", bf); })
        .select(
          "o.order_no", "o.sample_status", "o.created_at",
          "p.patient_uid", "p.full_name as patient_name",
          "rev.total as order_total"
        )
        .orderBy("o.created_at"),

      // Approved reports
      db("reports as r")
        .join("orders as o",  "o.id",  "r.order_id")
        .join("users as u",   "u.id",  "r.approved_by")
        .whereBetween("r.approved_at", [start, end])
        .where("r.status", "approved")
        .modify((q) => { if (bf) q.where("r.branch_id", bf); })
        .select(
          "r.report_no", "r.version", "r.approved_at",
          "o.order_no", "u.full_name as pathologist"
        )
        .orderBy("r.approved_at"),

      // Top 10 tests
      db("order_items as oi")
        .join("tests as t", "t.id", "oi.test_id")
        .join("orders as o", "o.id", "oi.order_id")
        .whereBetween("o.created_at", [start, end])
        .modify((q) => { if (bf) q.where("o.branch_id", bf); })
        .select("t.code", "t.name")
        .count("oi.id as cnt")
        .groupBy("t.code", "t.name")
        .orderBy("cnt", "desc")
        .limit(10),
    ]);

    // Revenue total
    const revenueTotal = orders.reduce((s, o) => s + Number(o.order_total || 0), 0);

    // Branch name
    let branchName = "All Branches";
    if (bf) {
      const br = await db("branches").where({ id: bf }).select("name").first();
      branchName = br?.name ?? `Branch ${bf}`;
    }

    res.json({
      date,
      branch_id:      bf,
      branch_name:    branchName,
      new_patients:   newPatients,
      orders,
      approved_reports: approvedReports,
      top_tests:      topTests,
      summary: {
        patient_count:  newPatients.length,
        order_count:    orders.length,
        report_count:   approvedReports.length,
        revenue_total:  revenueTotal,
        status_counts:  orders.reduce((acc, o) => {
          acc[o.sample_status] = (acc[o.sample_status] || 0) + 1;
          return acc;
        }, {}),
      },
    });
  })
);

// ── GET /api/dashboard/eod/excel ─────────────────────────────────────────────
router.get(
  "/eod/excel",
  asyncHandler(async (req, res) => {
    const { date, branch_id } = req.query;
    if (!date) return res.status(400).json({ error: "date is required." });

    const bf = req.branchFilter ?? (branch_id ? Number(branch_id) : null);

    // Re-use the eod endpoint logic via internal fetch (simple: just requery)
    const start = dayStart(date);
    const end   = dayEnd(date);

    const orders = await db("orders as o")
      .join("patients as p", "p.id", "o.patient_id")
      .leftJoin(
        db("order_items").select("order_id").sum("price_at_order as total").groupBy("order_id").as("rev"),
        "rev.order_id", "o.id"
      )
      .whereBetween("o.created_at", [start, end])
      .modify((q) => { if (bf) q.where("o.branch_id", bf); })
      .select(
        "o.order_no", "o.sample_status", "o.created_at",
        "p.patient_uid", "p.full_name as patient_name", "p.phone",
        "rev.total as order_total"
      )
      .orderBy("o.created_at");

    const headers = ["order_no","patient_uid","patient_name","phone","sample_status","created_at","order_total"];
    const csv = [
      headers.join(","),
      ...orders.map((o) => headers.map((h) => csvCell(o[h])).join(","))
    ].join("\r\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="eod_${date}.csv"`);
    res.send(csv);
  })
);

// ── GET /api/dashboard/eod/pdf ────────────────────────────────────────────────
router.get(
  "/eod/pdf",
  asyncHandler(async (req, res) => {
    const { date, branch_id } = req.query;
    if (!date) return res.status(400).json({ error: "date is required." });

    const bf = req.branchFilter ?? (branch_id ? Number(branch_id) : null);
    const start = dayStart(date);
    const end   = dayEnd(date);

    const [orders, approvedReports, newPatients] = await Promise.all([
      db("orders as o")
        .join("patients as p", "p.id", "o.patient_id")
        .leftJoin(
          db("order_items").select("order_id").sum("price_at_order as total").groupBy("order_id").as("rev"),
          "rev.order_id", "o.id"
        )
        .whereBetween("o.created_at", [start, end])
        .modify((q) => { if (bf) q.where("o.branch_id", bf); })
        .select("o.order_no", "o.sample_status", "p.patient_uid", "p.full_name as patient_name", "rev.total as order_total")
        .orderBy("o.created_at"),

      db("reports as r")
        .whereBetween("r.approved_at", [start, end])
        .where("r.status", "approved")
        .modify((q) => { if (bf) q.where("r.branch_id", bf); })
        .count("id as cnt").first(),

      db("patients")
        .whereBetween("created_at", [start, end])
        .modify((q) => { if (bf) q.where("branch_id", bf); })
        .count("id as cnt").first(),
    ]);

    let branchName = "All Branches";
    if (bf) {
      const br = await db("branches").where({ id: bf }).select("name").first();
      branchName = br?.name ?? `Branch ${bf}`;
    }

    const revenueTotal = orders.reduce((s, o) => s + Number(o.order_total || 0), 0);

    // ── Build PDF ──────────────────────────────────────────────────────
    const doc    = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data",  (c) => chunks.push(c));

    const pdfBuf = await new Promise((resolve, reject) => {
      doc.on("end",   ()  => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const W = doc.page.width;
      const M = 40;
      const CW = W - M * 2;

      doc.font("Helvetica-Bold").fontSize(16).fillColor("#1e40af")
        .text("End-of-Day Summary", M, M, { align: "center", width: CW });
      doc.font("Helvetica").fontSize(10).fillColor("#6b7280")
        .text(`${branchName}  •  ${date}`, M, M + 22, { align: "center", width: CW });

      doc.moveTo(M, M + 38).lineTo(W - M, M + 38).strokeColor("#e5e7eb").lineWidth(0.5).stroke();

      let y = M + 50;

      // KPI tiles
      const kpis = [
        ["New Patients",     newPatients.cnt],
        ["Orders",           orders.length],
        ["Reports Approved", approvedReports.cnt],
        ["Revenue",          `₹${revenueTotal.toFixed(2)}`],
      ];

      const tileW = CW / kpis.length;
      kpis.forEach(([label, val], i) => {
        const x = M + i * tileW;
        doc.rect(x + 4, y, tileW - 8, 50).fill("#f1f5f9");
        doc.font("Helvetica-Bold").fontSize(20).fillColor("#1e293b")
          .text(String(val), x + 4, y + 8, { width: tileW - 8, align: "center" });
        doc.font("Helvetica").fontSize(8).fillColor("#6b7280")
          .text(label, x + 4, y + 34, { width: tileW - 8, align: "center" });
      });

      y += 66;

      // Orders table
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#1e40af").text("Orders", M, y);
      y += 14;

      doc.rect(M, y, CW, 16).fill("#f1f5f9");
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#111827");
      ["Order No.", "Patient", "Status", "Value"].forEach((h, i) => {
        const colW = [100, 200, 110, 90][i];
        const cx   = M + [0, 100, 300, 410][i];
        doc.text(h, cx + 2, y + 4, { width: colW });
      });
      y += 16;

      orders.forEach((o, idx) => {
        const rowH = 15;
        if (idx % 2 === 0) doc.rect(M, y, CW, rowH).fill("#ffffff");
        else               doc.rect(M, y, CW, rowH).fill("#f8fafc");
        doc.font("Helvetica").fontSize(8).fillColor("#111827");
        [o.order_no, o.patient_name, o.sample_status, `₹${Number(o.order_total||0).toFixed(2)}`]
          .forEach((txt, i) => {
            const cx = M + [0, 100, 300, 410][i];
            doc.text(String(txt), cx + 2, y + 3, { width: [100,200,110,90][i] - 4, lineBreak: false });
          });
        y += rowH;
        if (y > doc.page.height - 60) { doc.addPage(); y = M; }
      });

      doc.font("Helvetica").fontSize(8).fillColor("#6b7280")
        .text(`Generated: ${new Date().toLocaleString()}`, M, doc.page.height - 40, { align: "center", width: CW });

      doc.end();
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="eod_${date}.pdf"`);
    res.setHeader("Content-Length", pdfBuf.length);
    res.send(pdfBuf);
  })
);

function csvCell(val) {
  if (val === null || val === undefined) return "";
  const s = typeof val === "object" ? JSON.stringify(val) : String(val);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

module.exports = router;
