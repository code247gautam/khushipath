/**
 * testRoutes.js — CRUD for the test catalog.
 *
 * GET    /api/tests                      — list all tests (with optional ?category_id=&search=)
 * GET    /api/tests/:id                  — single test with its reference ranges
 * POST   /api/tests                      — create test  (admin, branch_manager)
 * PUT    /api/tests/:id                  — update test  (admin, branch_manager)
 * DELETE /api/tests/:id                  — deactivate   (admin only)
 *
 * GET    /api/tests/categories           — list categories
 * POST   /api/tests/categories           — create category (admin)
 *
 * POST   /api/tests/:id/ranges           — add reference range
 * PUT    /api/tests/:id/ranges/:rid      — update range
 * DELETE /api/tests/:id/ranges/:rid      — delete range
 */
const express     = require("express");
const db          = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

// ── Categories ───────────────────────────────────────────────────────────────

router.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const rows = await db("test_categories")
      .select("*")
      .orderBy("name");
    res.json(rows);
  })
);

router.post(
  "/categories",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Category name is required." });

    const [row] = await db("test_categories")
      .insert({ name, description })
      .returning("*");
    res.status(201).json(row);
  })
);

// ── Tests list & create ──────────────────────────────────────────────────────

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { category_id, search, active_only } = req.query;

    const query = db("tests as t")
      .leftJoin("test_categories as c", "t.category_id", "c.id")
      .select(
        "t.id", "t.code", "t.name", "t.unit", "t.price",
        "t.sample_type", "t.turnaround_hours", "t.method",
        "t.notes", "t.is_active",
        "c.name as category_name"
      )
      .orderBy("t.code");

    if (category_id) query.where("t.category_id", category_id);
    if (active_only === "true") query.where("t.is_active", true);
    if (search) {
      const like = `%${search}%`;
      query.where((b) =>
        b.whereILike("t.name", like).orWhereILike("t.code", like)
      );
    }

    res.json(await query);
  })
);

router.post(
  "/",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const { code, name, category_id, unit, price, sample_type,
            turnaround_hours, method, notes } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: "code and name are required." });
    }

    const [row] = await db("tests")
      .insert({ code: code.toUpperCase(), name, category_id, unit, price,
                sample_type, turnaround_hours, method, notes })
      .returning("*");

    res.status(201).json(row);
  })
);

// ── Single test with ranges ──────────────────────────────────────────────────

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const test = await db("tests as t")
      .leftJoin("test_categories as c", "t.category_id", "c.id")
      .select("t.*", "c.name as category_name")
      .where("t.id", req.params.id)
      .first();

    if (!test) return res.status(404).json({ error: "Test not found." });

    const ranges = await db("reference_ranges")
      .where({ test_id: test.id })
      .orderBy("age_min_years")
      .orderBy("gender");

    res.json({ ...test, reference_ranges: ranges });
  })
);

router.put(
  "/:id",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { code, name, category_id, unit, price, sample_type,
            turnaround_hours, method, notes, is_active } = req.body;

    const [row] = await db("tests")
      .where({ id })
      .update({
        code: code ? code.toUpperCase() : undefined,
        name, category_id, unit, price, sample_type,
        turnaround_hours, method, notes, is_active,
        updated_at: db.fn.now(),
      })
      .returning("*");

    if (!row) return res.status(404).json({ error: "Test not found." });
    res.json(row);
  })
);

router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const [row] = await db("tests")
      .where({ id: req.params.id })
      .update({ is_active: false, updated_at: db.fn.now() })
      .returning("id");

    if (!row) return res.status(404).json({ error: "Test not found." });
    res.json({ message: "Test deactivated.", id: row.id });
  })
);

// ── Reference ranges ─────────────────────────────────────────────────────────

router.post(
  "/:id/ranges",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const test_id = Number(req.params.id);

    // Verify test exists
    const test = await db("tests").where({ id: test_id }).first();
    if (!test) return res.status(404).json({ error: "Test not found." });

    const { age_min_years, age_max_years, gender, range_low, range_high, range_text, notes } = req.body;

    const [row] = await db("reference_ranges")
      .insert({ test_id, age_min_years, age_max_years, gender: gender || null,
                range_low, range_high, range_text, notes })
      .returning("*");

    res.status(201).json(row);
  })
);

router.put(
  "/:id/ranges/:rid",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const test_id = Number(req.params.id);
    const rid     = Number(req.params.rid);
    const { age_min_years, age_max_years, gender, range_low, range_high, range_text, notes } = req.body;

    const [row] = await db("reference_ranges")
      .where({ id: rid, test_id })
      .update({ age_min_years, age_max_years, gender: gender || null,
                range_low, range_high, range_text, notes,
                updated_at: db.fn.now() })
      .returning("*");

    if (!row) return res.status(404).json({ error: "Range not found." });
    res.json(row);
  })
);

router.delete(
  "/:id/ranges/:rid",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const deleted = await db("reference_ranges")
      .where({ id: req.params.rid, test_id: req.params.id })
      .delete();

    if (!deleted) return res.status(404).json({ error: "Range not found." });
    res.json({ message: "Range deleted." });
  })
);

module.exports = router;
