/**
 * userRoutes.js — CRUD for lab staff users.
 *
 * GET    /api/users             — list users (admin = all, branch = own)
 * GET    /api/users/:id         — single user
 * POST   /api/users             — create (admin or branch_manager)
 * PUT    /api/users/:id         — update (admin or branch_manager)
 * DELETE /api/users/:id         — deactivate (admin only)
 * PUT    /api/users/:id/password — change own password
 */
const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth, requireRole, requireBranch } = require("../middleware/auth");

const router = express.Router();

const ALLOWED_ROLES = [
  "admin",
  "branch_manager",
  "receptionist",
  "technician",
  "pathologist",
  "accountant",
];

router.use(requireAuth, requireBranch);

// ── GET /api/users ───────────────────────────────────────────────────────────
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = db("users")
      .select(
        "id", "branch_id", "full_name", "email",
        "role", "phone", "is_active", "last_login_at", "created_at"
      )
      .orderBy("full_name");

    if (req.branchFilter) query.where("branch_id", req.branchFilter);

    const rows = await query;
    res.json(rows);
  })
);

// ── GET /api/users/:id ───────────────────────────────────────────────────────
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    const user = await db("users")
      .select("id", "branch_id", "full_name", "email", "role", "phone", "is_active")
      .where({ id })
      .first();

    if (!user) return res.status(404).json({ error: "User not found." });

    // Branch users cannot peek at users in other branches
    if (req.branchFilter && user.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    res.json(user);
  })
);

// ── POST /api/users ──────────────────────────────────────────────────────────
router.post(
  "/",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const { branch_id, full_name, email, password, role, phone } = req.body;

    // Validation
    if (!full_name || !email || !password || !role) {
      return res.status(400).json({ error: "full_name, email, password and role are required." });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: "Invalid role." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    // Branch managers can only create users in their own branch
    const targetBranch =
      req.session.role === "admin" ? branch_id : req.branchFilter;

    if (!targetBranch) {
      return res.status(400).json({ error: "branch_id is required." });
    }

    const hash = await bcrypt.hash(password, 12);

    const [row] = await db("users")
      .insert({
        branch_id: targetBranch,
        full_name,
        email: email.toLowerCase().trim(),
        password_hash: hash,
        role,
        phone,
      })
      .returning("id, branch_id, full_name, email, role, phone, is_active");

    res.status(201).json(row);
  })
);

// ── PUT /api/users/:id ───────────────────────────────────────────────────────
router.put(
  "/:id",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { full_name, email, role, phone, is_active, branch_id } = req.body;

    const existing = await db("users").where({ id }).first();
    if (!existing) return res.status(404).json({ error: "User not found." });

    // Branch managers can only update users in their own branch
    if (
      req.session.role === "branch_manager" &&
      existing.branch_id !== req.branchFilter
    ) {
      return res.status(403).json({ error: "Access denied." });
    }

    if (role && !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: "Invalid role." });
    }

    // Admin can move a user to a different branch; branch_manager cannot
    const updatedBranch =
      req.session.role === "admin" ? branch_id ?? existing.branch_id : existing.branch_id;

    const [row] = await db("users")
      .where({ id })
      .update({
        full_name:  full_name  ?? existing.full_name,
        email:      email      ? email.toLowerCase().trim() : existing.email,
        role:       role       ?? existing.role,
        phone:      phone      ?? existing.phone,
        is_active:  is_active  ?? existing.is_active,
        branch_id:  updatedBranch,
        updated_at: db.fn.now(),
      })
      .returning("id, branch_id, full_name, email, role, phone, is_active");

    res.json(row);
  })
);

// ── DELETE /api/users/:id — soft delete ──────────────────────────────────────
router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    // Prevent self-deactivation
    if (id === req.session.userId) {
      return res.status(400).json({ error: "Cannot deactivate your own account." });
    }

    const [row] = await db("users")
      .where({ id })
      .update({ is_active: false, updated_at: db.fn.now() })
      .returning("id");

    if (!row) return res.status(404).json({ error: "User not found." });
    res.json({ message: "User deactivated.", id });
  })
);

// ── PUT /api/users/:id/password ──────────────────────────────────────────────
// Any authenticated user may change their OWN password.
router.put(
  "/:id/password",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    // Users can only change their own password (admin can change anyone's)
    if (id !== req.session.userId && req.session.role !== "admin") {
      return res.status(403).json({ error: "Access denied." });
    }

    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "current_password and new_password are required." });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }

    const user = await db("users").where({ id }).first();
    if (!user) return res.status(404).json({ error: "User not found." });

    // Verify current password (even admin must supply the target user's current password)
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Current password is incorrect." });

    const hash = await bcrypt.hash(new_password, 12);
    await db("users").where({ id }).update({ password_hash: hash, updated_at: db.fn.now() });

    res.json({ message: "Password updated." });
  })
);

module.exports = router;
