/**
 * patientRoutes.js — Patient registration and search.
 *
 * GET    /api/patients           — search/list (branch-scoped)
 * GET    /api/patients/:id       — single patient + order history
 * POST   /api/patients           — register new patient
 * PUT    /api/patients/:id       — update demographics
 */
const express      = require("express");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireRole, requireBranch } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth, requireBranch);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate next patient UID: PL-000001, PL-000002, … */
async function nextPatientUid() {
  const result = await db.raw(`SELECT nextval('patient_uid_seq') AS seq`);
  const seq    = Number(result.rows[0].seq);
  return `PL-${String(seq).padStart(6, "0")}`;
}

/** Generate order number: ORD-YYYYMMDD-NNNN (branch-relative daily counter) */
async function nextOrderNo() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `ORD-${today}-`;
  const last = await db("orders")
    .whereILike("order_no", `${prefix}%`)
    .orderBy("id", "desc")
    .first();
  const counter = last
    ? parseInt(last.order_no.split("-").pop(), 10) + 1
    : 1;
  return `${prefix}${String(counter).padStart(4, "0")}`;
}

// ── GET /api/patients — search & list ─────────────────────────────────────────
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, page = 1, limit = 30 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const query = db("patients")
      .select("id", "patient_uid", "full_name", "gender", "date_of_birth",
              "age_years", "phone", "email", "referring_doctor", "branch_id", "created_at")
      .orderBy("created_at", "desc")
      .limit(Number(limit))
      .offset(offset);

    if (req.branchFilter) query.where("branch_id", req.branchFilter);

    if (search) {
      const like = `%${search}%`;
      query.where((b) =>
        b.whereILike("full_name", like)
          .orWhereILike("phone", like)
          .orWhereILike("patient_uid", like)
      );
    }

    const rows = await query;
    res.json(rows);
  })
);

// ── GET /api/patients/:id ─────────────────────────────────────────────────────
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const patient = await db("patients").where({ id: req.params.id }).first();
    if (!patient) return res.status(404).json({ error: "Patient not found." });

    // Branch check
    if (req.branchFilter && patient.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    // Last 20 orders
    const orders = await db("orders")
      .where({ patient_id: patient.id })
      .select("id", "order_no", "sample_status", "created_at")
      .orderBy("created_at", "desc")
      .limit(20);

    res.json({ ...patient, orders });
  })
);

// ── POST /api/patients — register ─────────────────────────────────────────────
router.post(
  "/",
  requireRole("admin", "branch_manager", "receptionist"),
  asyncHandler(async (req, res) => {
    const {
      full_name, gender, date_of_birth, age_years,
      phone, email, address, referring_doctor, notes,
    } = req.body;

    if (!full_name || !gender || !phone) {
      return res.status(400).json({ error: "full_name, gender and phone are required." });
    }
    if (!["M", "F", "O"].includes(gender)) {
      return res.status(400).json({ error: "gender must be M, F or O." });
    }

    // Branch: use user's own branch, or body-supplied branch_id for admin,
    // or fall back to the first available branch (super-admin with no fixed branch)
    let branch_id = req.branchFilter !== undefined ? req.branchFilter : (Number(req.body.branch_id) || null);
    if (!branch_id) {
      const firstBranch = await db("branches").orderBy("id").first();
      branch_id = firstBranch ? firstBranch.id : null;
    }
    if (!branch_id) return res.status(400).json({ error: "branch_id is required." });

    const patient_uid = await nextPatientUid();

    const [row] = await db("patients")
      .insert({
        branch_id, patient_uid, full_name, gender,
        date_of_birth: date_of_birth || null,
        age_years:     age_years     || null,
        phone, email, address, referring_doctor, notes,
      })
      .returning("*");

    res.status(201).json(row);
  })
);

// ── PUT /api/patients/:id ─────────────────────────────────────────────────────
router.put(
  "/:id",
  requireRole("admin", "branch_manager", "receptionist"),
  asyncHandler(async (req, res) => {
    const id      = Number(req.params.id);
    const patient = await db("patients").where({ id }).first();
    if (!patient) return res.status(404).json({ error: "Patient not found." });

    if (req.branchFilter && patient.branch_id !== req.branchFilter) {
      return res.status(403).json({ error: "Access denied." });
    }

    const {
      full_name, gender, date_of_birth, age_years,
      phone, email, address, referring_doctor, notes,
    } = req.body;

    const [row] = await db("patients")
      .where({ id })
      .update({
        full_name:        full_name        ?? patient.full_name,
        gender:           gender           ?? patient.gender,
        date_of_birth:    date_of_birth    ?? patient.date_of_birth,
        age_years:        age_years        ?? patient.age_years,
        phone:            phone            ?? patient.phone,
        email:            email            ?? patient.email,
        address:          address          ?? patient.address,
        referring_doctor: referring_doctor ?? patient.referring_doctor,
        notes:            notes            ?? patient.notes,
        updated_at:       db.fn.now(),
      })
      .returning("*");

    res.json(row);
  })
);

module.exports = { router, nextOrderNo };
