/**
 * authRoutes.js — Login, logout, and session-check endpoints.
 *
 * POST /api/auth/login   — validate credentials, start session
 * POST /api/auth/logout  — destroy session
 * GET  /api/auth/me      — return current user info (no password)
 */
const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/rateLimiter");
const { logAudit } = require("../middleware/audit");

const router = express.Router();

// ── POST /api/auth/login ──────────────────────────────────────���──────────────
router.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // Basic input presence check
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    // Fetch user (never return password_hash to client)
    const user = await db("users")
      .where({ email: email.toLowerCase().trim(), is_active: true })
      .first();

    // Constant-time compare even when user not found (prevent timing attacks)
    const dummyHash = "$2b$12$invalidhashfortimingprotection000000000000000000000000";
    const match = user
      ? await bcrypt.compare(password, user.password_hash)
      : await bcrypt.compare(password, dummyHash).then(() => false);

    if (!match) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Regenerate session ID on login (session fixation protection)
    req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ error: "Session error." });

      req.session.userId   = user.id;
      req.session.role     = user.role;
      req.session.branchId = user.branch_id;   // null for admin
      req.session.fullName = user.full_name;
      req.session.email    = user.email;        // cached for audit logs

      // Track last login time
      await db("users").where({ id: user.id }).update({ last_login_at: db.fn.now() });

      // Audit: login success
      await logAudit(req, { action: "auth.login", entity_type: "user", entity_id: user.id });

      res.json({
        id:        user.id,
        fullName:  user.full_name,
        email:     user.email,
        role:      user.role,
        branchId:  user.branch_id,
      });
    });
  })
);

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post("/logout", requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Could not log out." });
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out." });
  });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await db("users")
      .select("id", "full_name", "email", "role", "branch_id", "last_login_at")
      .where({ id: req.session.userId })
      .first();

    if (!user) return res.status(404).json({ error: "User not found." });
    res.json(user);
  })
);

module.exports = router;
