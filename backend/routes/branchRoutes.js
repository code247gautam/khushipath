/**
 * branchRoutes.js — CRUD for lab branches.
 *
 * GET    /api/branches          — list all (admin) or own branch
 * GET    /api/branches/:id      — single branch
 * POST   /api/branches          — create (admin only)
 * PUT    /api/branches/:id      — update (admin only)
 * DELETE /api/branches/:id      — soft-delete / deactivate (admin only)
 */
const express = require("express");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth, requireRole, requireBranch } = require("../middleware/auth");

const router = express.Router();

// All branch routes require an authenticated session
router.use(requireAuth, requireBranch);

// ── GET /api/branches ────────────────────────────────────────────────────────
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = db("branches").select("*").orderBy("name");

    // Non-admin users see only their own branch
    if (req.branchFilter) query.where("id", req.branchFilter);

    const rows = await query;
    res.json(rows);
  })
);

// ── GET /api/branches/:id ────────────────────────────────────────────────────
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    // Non-admin: block access to other branches
    if (req.branchFilter && req.branchFilter !== id) {
      return res.status(403).json({ error: "Access denied." });
    }

    const branch = await db("branches").where({ id }).first();
    if (!branch) return res.status(404).json({ error: "Branch not found." });
    res.json(branch);
  })
);

// ── POST /api/branches ───────────────────────────────────────────────────────
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { name, address, phone, email } = req.body;
    if (!name) return res.status(400).json({ error: "Branch name is required." });

    const [row] = await db("branches")
      .insert({ name, address, phone, email })
      .returning("*");

    res.status(201).json(row);
  })
);

// ── PUT /api/branches/:id ────────────────────────────────────────────────────
router.put(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { name, address, phone, email, is_active } = req.body;

    const [row] = await db("branches")
      .where({ id })
      .update({ name, address, phone, email, is_active, updated_at: db.fn.now() })
      .returning("*");

    if (!row) return res.status(404).json({ error: "Branch not found." });
    res.json(row);
  })
);

// ── DELETE /api/branches/:id — soft delete (deactivate) ─────────────────────
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    const [row] = await db("branches")
      .where({ id })
      .update({ is_active: false, updated_at: db.fn.now() })
      .returning("id");

    if (!row) return res.status(404).json({ error: "Branch not found." });
    res.json({ message: "Branch deactivated.", id });
  })
);

module.exports = router;
