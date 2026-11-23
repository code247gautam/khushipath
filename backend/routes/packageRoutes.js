/**
 * packageRoutes.js — CRUD for test packages (bundles of tests).
 *
 * GET    /api/packages            — list all packages with their test count
 * GET    /api/packages/:id        — single package with full test list
 * POST   /api/packages            — create package (admin, branch_manager)
 * PUT    /api/packages/:id        — update package (admin, branch_manager)
 * DELETE /api/packages/:id        — deactivate    (admin only)
 * POST   /api/packages/:id/tests  — add a test to the package
 * DELETE /api/packages/:id/tests/:tid — remove a test from the package
 */
const express      = require("express");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

// ── List packages ─────────────────────────────────────────────────────────────
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await db("packages as p")
      .leftJoin("package_tests as pt", "pt.package_id", "p.id")
      .select(
        "p.id", "p.code", "p.name", "p.description",
        "p.price", "p.is_active",
        db.raw("COUNT(pt.test_id) as test_count")
      )
      .groupBy("p.id")
      .orderBy("p.code");

    res.json(rows);
  })
);

// ── Single package with tests ─────────────────────────────────────────────────
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const pkg = await db("packages").where({ id: req.params.id }).first();
    if (!pkg) return res.status(404).json({ error: "Package not found." });

    const tests = await db("package_tests as pt")
      .join("tests as t", "t.id", "pt.test_id")
      .select("t.id", "t.code", "t.name", "t.unit", "t.price", "t.sample_type")
      .where("pt.package_id", pkg.id)
      .orderBy("t.code");

    res.json({ ...pkg, tests });
  })
);

// ── Create package ────────────────────────────────────────────────────────────
router.post(
  "/",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const { code, name, description, price } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: "code and name are required." });
    }

    const [row] = await db("packages")
      .insert({ code: code.toUpperCase(), name, description, price })
      .returning("*");

    res.status(201).json(row);
  })
);

// ── Update package ────────────────────────────────────────────────────────────
router.put(
  "/:id",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const { code, name, description, price, is_active } = req.body;

    const [row] = await db("packages")
      .where({ id: req.params.id })
      .update({
        code: code ? code.toUpperCase() : undefined,
        name, description, price, is_active,
        updated_at: db.fn.now(),
      })
      .returning("*");

    if (!row) return res.status(404).json({ error: "Package not found." });
    res.json(row);
  })
);

// ── Deactivate package ────────────────────────────────────────────────────────
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const [row] = await db("packages")
      .where({ id: req.params.id })
      .update({ is_active: false, updated_at: db.fn.now() })
      .returning("id");

    if (!row) return res.status(404).json({ error: "Package not found." });
    res.json({ message: "Package deactivated.", id: row.id });
  })
);

// ── Add test to package ───────────────────────────────────────────────────────
router.post(
  "/:id/tests",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const package_id = Number(req.params.id);
    const { test_id } = req.body;

    if (!test_id) return res.status(400).json({ error: "test_id is required." });

    const pkg  = await db("packages").where({ id: package_id }).first();
    if (!pkg) return res.status(404).json({ error: "Package not found." });

    const test = await db("tests").where({ id: test_id }).first();
    if (!test) return res.status(404).json({ error: "Test not found." });

    const [row] = await db("package_tests")
      .insert({ package_id, test_id })
      .returning("*");

    res.status(201).json(row);
  })
);

// ── Remove test from package ──────────────────────────────────────────────────
router.delete(
  "/:id/tests/:tid",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const deleted = await db("package_tests")
      .where({ package_id: req.params.id, test_id: req.params.tid })
      .delete();

    if (!deleted) return res.status(404).json({ error: "Link not found." });
    res.json({ message: "Test removed from package." });
  })
);

module.exports = router;
