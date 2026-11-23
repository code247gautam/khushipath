/**
 * importRoutes.js — Excel / CSV import for the test catalog.
 *
 * POST /api/import/tests      — upsert tests from spreadsheet
 * POST /api/import/ranges     — upsert reference ranges from spreadsheet
 * GET  /api/import/template   — download a CSV template
 *
 * Accepted columns for tests (case-insensitive, spaces converted to _):
 *   code, name, category, unit, price, sample_type, turnaround_hours, method, notes
 *
 * Accepted columns for ranges:
 *   test_code, age_min_years, age_max_years, gender, range_low, range_high, range_text, notes
 *
 * File is uploaded as multipart/form-data field "file".
 * Max size: 5 MB.
 */
const express      = require("express");
const multer       = require("multer");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const { parseUpload } = require("../utils/csvImport");

const router  = express.Router();
// Store upload in memory (max 5 MB) — no temp files on disk
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireAuth, requireRole("admin", "branch_manager"));

// ── POST /api/import/tests ────────────────────────────────────────────────────
router.post(
  "/tests",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const rows = parseUpload(req.file.buffer, req.file.originalname);
    if (!rows.length) return res.status(400).json({ error: "File has no data rows." });

    // Build category name → id map (create missing ones on the fly)
    const catRows = await db("test_categories").select("id", "name");
    const catMap  = Object.fromEntries(catRows.map((r) => [r.name.toLowerCase(), r.id]));

    let inserted = 0, updated = 0, skipped = 0;
    const errors = [];

    for (const [i, row] of rows.entries()) {
      const lineNo = i + 2; // +2: header is line 1

      const code = (row.code || "").toUpperCase().trim();
      const name = (row.name || "").trim();

      if (!code || !name) {
        errors.push({ line: lineNo, error: "Missing code or name — skipped." });
        skipped++;
        continue;
      }

      // Resolve / auto-create category
      let category_id = null;
      const catName = (row.category || "").trim().toLowerCase();
      if (catName) {
        if (!catMap[catName]) {
          const [nc] = await db("test_categories")
            .insert({ name: row.category.trim() })
            .onConflict("name").merge()
            .returning("id");
          catMap[catName] = nc.id;
        }
        category_id = catMap[catName];
      }

      const payload = {
        code,
        name,
        category_id,
        unit:              row.unit              || null,
        price:             Number(row.price)     || 0,
        sample_type:       row.sample_type       || null,
        turnaround_hours:  Number(row.turnaround_hours) || 24,
        method:            row.method            || null,
        notes:             row.notes             || null,
      };

      try {
        const existing = await db("tests").where({ code }).first();
        if (existing) {
          await db("tests").where({ code }).update({ ...payload, updated_at: db.fn.now() });
          updated++;
        } else {
          await db("tests").insert(payload);
          inserted++;
        }
      } catch (err) {
        errors.push({ line: lineNo, code, error: err.message });
        skipped++;
      }
    }

    res.json({ inserted, updated, skipped, errors });
  })
);

// ── POST /api/import/ranges ───────────────────────────────────────────────────
router.post(
  "/ranges",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const rows = parseUpload(req.file.buffer, req.file.originalname);
    if (!rows.length) return res.status(400).json({ error: "File has no data rows." });

    // Build test code → id lookup
    const testRows = await db("tests").select("id", "code");
    const testMap  = Object.fromEntries(testRows.map((r) => [r.code.toUpperCase(), r.id]));

    let inserted = 0, skipped = 0;
    const errors = [];

    for (const [i, row] of rows.entries()) {
      const lineNo  = i + 2;
      const code    = (row.test_code || "").toUpperCase().trim();
      const test_id = testMap[code];

      if (!test_id) {
        errors.push({ line: lineNo, error: `Test code "${code}" not found — skipped.` });
        skipped++;
        continue;
      }

      const gender = (row.gender || "").toUpperCase().trim();

      try {
        await db("reference_ranges").insert({
          test_id,
          age_min_years: row.age_min_years ? Number(row.age_min_years) : null,
          age_max_years: row.age_max_years ? Number(row.age_max_years) : null,
          gender:        ["M", "F"].includes(gender) ? gender : null,
          range_low:     row.range_low  ? Number(row.range_low)  : null,
          range_high:    row.range_high ? Number(row.range_high) : null,
          range_text:    row.range_text || null,
          notes:         row.notes      || null,
        });
        inserted++;
      } catch (err) {
        errors.push({ line: lineNo, error: err.message });
        skipped++;
      }
    }

    res.json({ inserted, skipped, errors });
  })
);

// ── GET /api/import/template ──────────────────────────────────────────────────
// Returns a plain CSV template the user can fill in and upload.
router.get("/template", (req, res) => {
  const csv = [
    "code,name,category,unit,price,sample_type,turnaround_hours,method,notes",
    "HGB,Haemoglobin,Haematology,g/dL,80,EDTA Blood,2,,",
    "RBS,Random Blood Sugar,Biochemistry,mg/dL,60,Serum,2,,",
  ].join("\r\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="test_import_template.csv"');
  res.send(csv);
});

module.exports = router;
