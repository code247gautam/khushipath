/**
 * pdfReport.js — Generate a PDF lab report using PDFKit.
 *
 * Returns a Buffer containing the PDF bytes.
 * Called on-demand; nothing is stored to disk.
 *
 * Layout sections (top → bottom):
 *   1. Lab logo + branch letterhead
 *   2. Report header (report no, date, version, QR code)
 *   3. Patient details
 *   4. Results table (test | value | unit | ref range | flag)
 *   5. Pathologist name + signature image
 *   6. Footer (superseded warning if applicable)
 */
const PDFDocument = require("pdfkit");
const QRCode      = require("qrcode");

/**
 * @param {Object} data
 * @param {Object} data.report     — report row
 * @param {Object} data.order      — order row (includes patient_* fields)
 * @param {Object} data.branch     — branch row
 * @param {Array}  data.items      — order_items with results & reference ranges
 * @param {Object} data.pathologist — user row for the approving pathologist
 * @param {string} [data.signaturePath] — absolute path to signature image file
 * @param {string} [data.logoPath]      — absolute path to logo image file
 * @returns {Promise<Buffer>}
 */
async function generateReportPDF(data) {
  const { report, order, branch, items, pathologist, signaturePath, logoPath } = data;

  // ── QR code (data URL for the report UID) ────────────────────────────────
  const qrDataUrl = await QRCode.toDataURL(
    `RPT:${report.report_uid}`,
    { width: 80, margin: 1 }
  );
  const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];

    doc.on("data",  (c) => chunks.push(c));
    doc.on("end",   ()  => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W  = doc.page.width;   // 595
    const M  = 40;                // margin
    const CW = W - M * 2;        // content width

    // ── Colour palette ────────────────────────────────────────────────────
    const BLUE   = "#1e40af";
    const GREY   = "#6b7280";
    const RED    = "#dc2626";
    const ORANGE = "#d97706";
    const GREEN  = "#16a34a";
    const BLACK  = "#111827";

    // ── Helper: horizontal rule ───────────────────────────────────────────
    function hRule(y, color = "#e5e7eb", thickness = 0.5) {
      doc.save().strokeColor(color).lineWidth(thickness)
        .moveTo(M, y).lineTo(W - M, y).stroke().restore();
    }

    // ── 1. Letterhead ─────────────────────────────────────────────────────
    let y = M;

    // Logo (if available)
    if (logoPath) {
      try {
        doc.image(logoPath, M, y, { height: 50 });
      } catch (_) { /* skip if file missing */ }
    }

    // Lab / branch name
    doc.font("Helvetica-Bold").fontSize(16).fillColor(BLUE)
      .text(branch.name || "Khushi Pathological Lab", M + 60, y, { width: CW - 100 });

    doc.font("Helvetica").fontSize(9).fillColor(GREY)
      .text(branch.address  || "", M + 60, y + 20, { width: CW - 100 })
      .text([branch.phone, branch.email].filter(Boolean).join("  •  "), M + 60, y + 32, { width: CW - 100 });

    // QR code — top right corner
    doc.image(qrBuffer, W - M - 60, y, { width: 60 });

    y += 60;
    hRule(y);
    y += 8;

    // ── 2. Report header ─────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(13).fillColor(BLACK)
      .text("LABORATORY REPORT", M, y, { align: "center", width: CW });
    y += 18;

    // Three-column info row
    const col = CW / 3;
    doc.font("Helvetica").fontSize(9).fillColor(GREY);

    function kv(label, value, x, ty) {
      doc.font("Helvetica").fillColor(GREY).text(label, x, ty);
      doc.font("Helvetica-Bold").fillColor(BLACK).text(value || "—", x, ty + 11);
    }

    kv("Report No.",  report.report_no,                      M,           y);
    kv("Report Date", fmtDate(report.approved_at || report.created_at), M + col,     y);
    kv("Version",     `v${report.version}${report.superseded ? "  (SUPERSEDED)" : ""}`, M + col * 2, y);

    y += 30;
    hRule(y, "#d1d5db");
    y += 8;

    // ── 3. Patient details ────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(10).fillColor(BLUE).text("PATIENT INFORMATION", M, y);
    y += 14;

    const ageStr = order.date_of_birth
      ? `${calcAge(order.date_of_birth)} yrs`
      : order.age_years ? `${order.age_years} yrs` : "—";

    const patientFields = [
      ["Patient ID",       order.patient_uid],
      ["Name",             order.patient_name],
      ["Age / Gender",     `${ageStr} / ${genderLabel(order.patient_gender)}`],
      ["Phone",            order.patient_phone || "—"],
      ["Ref. Doctor",      order.referring_doctor || order.clinical_notes || "—"],
      ["Order No.",        order.order_no],
    ];

    patientFields.forEach(([label, value], i) => {
      const cx = i % 2 === 0 ? M : M + CW / 2;
      const cy = y + Math.floor(i / 2) * 22;
      doc.font("Helvetica").fontSize(8).fillColor(GREY).text(label, cx, cy);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(BLACK).text(String(value), cx, cy + 10);
    });

    y += Math.ceil(patientFields.length / 2) * 22 + 8;
    hRule(y, "#d1d5db");
    y += 8;

    // ── 4. Results table ─────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(10).fillColor(BLUE).text("TEST RESULTS", M, y);
    y += 14;

    // Column widths
    const cols = { test: 160, value: 70, unit: 60, range: 110, flag: 50 };

    // Table header
    doc.rect(M, y, CW, 16).fill("#f1f5f9");
    doc.font("Helvetica-Bold").fontSize(8).fillColor(BLACK);
    let cx = M + 4;
    ["Test Name", "Result", "Unit", "Ref. Range", "Flag"].forEach((h, i) => {
      const w = Object.values(cols)[i];
      doc.text(h, cx, y + 4, { width: w - 4 });
      cx += w;
    });
    y += 16;

    // Table rows
    items.forEach((item, idx) => {
      const rowH = 18;
      if (idx % 2 === 0) doc.rect(M, y, CW, rowH).fill("#ffffff");
      else               doc.rect(M, y, CW, rowH).fill("#f8fafc");

      const flagColor = flagToColor(item.flag);
      doc.font("Helvetica").fontSize(8).fillColor(BLACK);
      cx = M + 4;

      const rangeText = item.range_text
        || (item.range_low != null || item.range_high != null
            ? `${item.range_low ?? ""}–${item.range_high ?? ""}`
            : "—");

      [item.name, item.value || "—", item.unit || "—", rangeText].forEach((text, ti) => {
        const w = Object.values(cols)[ti];
        doc.fillColor(BLACK).text(String(text), cx, y + 5, { width: w - 4, lineBreak: false });
        cx += w;
      });

      // Flag cell
      doc.font("Helvetica-Bold").fontSize(8).fillColor(flagColor)
        .text(item.flag || "—", cx, y + 5, { width: cols.flag - 4 });

      y += rowH;

      // Page break guard
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = M;
      }
    });

    hRule(y + 4);
    y += 16;

    // ── 5. Pathologist ────────────────────────────────────────────────────
    if (y > doc.page.height - 100) { doc.addPage(); y = M; }

    doc.font("Helvetica-Bold").fontSize(9).fillColor(BLACK)
      .text("Reviewed and approved by:", M, y);
    y += 14;

    if (signaturePath) {
      try {
        doc.image(signaturePath, M, y, { height: 40 });
      } catch (_) { /* skip */ }
      y += 44;
    }

    doc.font("Helvetica-Bold").fontSize(9).fillColor(BLACK)
      .text(pathologist?.full_name || "—", M, y);
    doc.font("Helvetica").fontSize(8).fillColor(GREY)
      .text("Pathologist", M, y + 11);

    if (report.pathologist_remarks) {
      y += 26;
      doc.font("Helvetica-Oblique").fontSize(8).fillColor(GREY)
        .text(`Remarks: ${report.pathologist_remarks}`, M, y, { width: CW });
    }

    // ── 6. Footer ─────────────────────────────────────────────────────────
    const footerY = doc.page.height - 35;
    hRule(footerY - 4);

    doc.font("Helvetica").fontSize(7).fillColor(GREY)
      .text(
        `Report UID: ${report.report_uid}  •  Generated: ${fmtDate(new Date())}  •  ${branch.name}`,
        M, footerY, { align: "center", width: CW }
      );

    if (report.superseded) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(RED)
        .text("⚠  THIS REPORT HAS BEEN SUPERSEDED BY A NEWER VERSION", M, footerY - 18, { align: "center", width: CW });
    }

    doc.end();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    "  " + dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function calcAge(dob) {
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

function genderLabel(g) {
  return g === "M" ? "Male" : g === "F" ? "Female" : "Other";
}

function flagToColor(flag) {
  return { N: "#16a34a", H: "#dc2626", L: "#2563eb", C: "#7c3aed" }[flag] || "#111827";
}

module.exports = { generateReportPDF };
