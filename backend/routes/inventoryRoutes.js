/**
 * inventoryRoutes.js — Full inventory management.
 *
 * Item master
 *   GET    /api/inventory/items              — list items
 *   GET    /api/inventory/items/:id          — single item with stock per branch
 *   POST   /api/inventory/items              — create item
 *   PUT    /api/inventory/items/:id          — update item
 *
 * Stock per branch
 *   GET    /api/inventory/stock              — stock levels (branch-scoped)
 *   PUT    /api/inventory/stock/:itemId      — set reorder level for a branch
 *
 * Purchases
 *   POST   /api/inventory/purchase           — receive new stock (+batch)
 *
 * Transfers
 *   POST   /api/inventory/transfer           — move stock between branches
 *
 * Adjustments
 *   POST   /api/inventory/adjust             — manual correction
 *
 * Batches
 *   GET    /api/inventory/batches            — list batches (branch-scoped)
 *   GET    /api/inventory/batches/expiring   — batches expiring within N days
 *
 * Movements (history)
 *   GET    /api/inventory/movements          — movement log (branch-scoped)
 *
 * Alerts
 *   GET    /api/inventory/alerts/low-stock   — items below reorder level
 *   GET    /api/inventory/alerts/expiring    — batches expiring within 30 days
 */
const express      = require("express");
const db           = require("../db");
const asyncHandler  = require("../utils/asyncHandler");
const { requireAuth, requireRole, requireBranch } = require("../middleware/auth");
const { logAudit }  = require("../middleware/audit");

const router = express.Router();

router.use(requireAuth, requireBranch);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Atomically update inventory_stock quantity.
 * Creates the row if it doesn't exist (upsert).
 */
async function adjustStock(trx, itemId, branchId, delta) {
  // Use a raw upsert so we don't have race conditions
  await trx.raw(`
    INSERT INTO inventory_stock (item_id, branch_id, quantity, reorder_level, created_at, updated_at)
    VALUES (?, ?, ?, 0, NOW(), NOW())
    ON CONFLICT (item_id, branch_id)
    DO UPDATE SET quantity = inventory_stock.quantity + ?, updated_at = NOW()
  `, [itemId, branchId, delta, delta]);
}

// ── Item master ───────────────────────────────────────────────────────────────

router.get("/items", asyncHandler(async (req, res) => {
  const { search, item_type } = req.query;
  const q = db("inventory_items").select("*").where("is_active", true).orderBy("name");
  if (item_type) q.where("item_type", item_type);
  if (search) {
    const like = `%${search}%`;
    q.where((b) => b.whereILike("name", like).orWhereILike("code", like));
  }
  res.json(await q);
}));

router.get("/items/:id", asyncHandler(async (req, res) => {
  const item = await db("inventory_items").where({ id: req.params.id }).first();
  if (!item) return res.status(404).json({ error: "Item not found." });

  // Stock per branch
  const stock = await db("inventory_stock as s")
    .join("branches as b", "b.id", "s.branch_id")
    .select("s.*", "b.name as branch_name")
    .where("s.item_id", item.id);

  res.json({ ...item, stock });
}));

router.post(
  "/items",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const { code, name, item_type, unit, supplier, description } = req.body;
    if (!code || !name) return res.status(400).json({ error: "code and name are required." });

    const [row] = await db("inventory_items")
      .insert({ code: code.toUpperCase(), name, item_type, unit, supplier, description })
      .returning("*");
    res.status(201).json(row);
  })
);

router.put(
  "/items/:id",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const { code, name, item_type, unit, supplier, description, is_active } = req.body;
    const [row] = await db("inventory_items")
      .where({ id: req.params.id })
      .update({ code: code ? code.toUpperCase() : undefined, name, item_type, unit, supplier, description, is_active, updated_at: db.fn.now() })
      .returning("*");
    if (!row) return res.status(404).json({ error: "Item not found." });
    res.json(row);
  })
);

// ── Stock per branch ──────────────────────────────────────────────────────────

router.get("/stock", asyncHandler(async (req, res) => {
  const bf = req.branchFilter;
  const q = db("inventory_stock as s")
    .join("inventory_items as i", "i.id", "s.item_id")
    .leftJoin("branches as b", "b.id", "s.branch_id")
    .select(
      "s.id", "s.item_id", "s.branch_id", "s.quantity", "s.reorder_level",
      "i.code", "i.name", "i.unit", "i.item_type", "i.supplier",
      "b.name as branch_name",
      // is_low flag
      db.raw("CASE WHEN s.quantity <= s.reorder_level THEN true ELSE false END as is_low")
    )
    .orderBy("i.name");

  if (bf) q.where("s.branch_id", bf);
  res.json(await q);
}));

router.put(
  "/stock/:itemId",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const itemId   = Number(req.params.itemId);
    const branchId = req.branchFilter ?? Number(req.body.branch_id);
    const { reorder_level } = req.body;

    if (!branchId) return res.status(400).json({ error: "branch_id required." });

    await db.raw(`
      INSERT INTO inventory_stock (item_id, branch_id, quantity, reorder_level, created_at, updated_at)
      VALUES (?, ?, 0, ?, NOW(), NOW())
      ON CONFLICT (item_id, branch_id)
      DO UPDATE SET reorder_level = ?, updated_at = NOW()
    `, [itemId, branchId, reorder_level, reorder_level]);

    const row = await db("inventory_stock").where({ item_id: itemId, branch_id: branchId }).first();
    res.json(row);
  })
);

// ── Purchase (receive new stock) ──────────────────────────────────────────────

router.post(
  "/purchase",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const {
      item_id, branch_id: bodyBranch,
      quantity, batch_no, expiry_date, notes,
    } = req.body;

    if (!item_id || !quantity || quantity <= 0) {
      return res.status(400).json({ error: "item_id and positive quantity are required." });
    }

    const branchId = req.branchFilter ?? Number(bodyBranch);
    if (!branchId) return res.status(400).json({ error: "branch_id required." });

    const movement = await db.transaction(async (trx) => {
      // Update / create stock row
      await adjustStock(trx, item_id, branchId, Number(quantity));

      // Create or update batch if batch_no provided
      let batchId = null;
      if (batch_no) {
        const existing = await trx("inventory_batches")
          .where({ item_id, branch_id: branchId, batch_no })
          .first();

        if (existing) {
          await trx("inventory_batches")
            .where({ id: existing.id })
            .update({ quantity: db.raw("quantity + ?", [Number(quantity)]), updated_at: trx.fn.now() });
          batchId = existing.id;
        } else {
          const [b] = await trx("inventory_batches")
            .insert({ item_id, branch_id: branchId, batch_no, expiry_date: expiry_date || null, quantity })
            .returning("id");
          batchId = b.id;
        }
      }

      const [mov] = await trx("inventory_movements")
        .insert({
          item_id,
          branch_id:     branchId,
          batch_id:      batchId,
          created_by:    req.session.userId,
          movement_type: "purchase",
          quantity:      Number(quantity),
          notes,
        })
        .returning("*");

      return mov;
    });

    await logAudit(req, { action: "inventory.purchase", entity_type: "inventory_item", entity_id: item_id,
      meta: { quantity, branchId, batch_no } });
    res.status(201).json(movement);
  })
);

// ── Transfer between branches ─────────────────────────────────────────────────

router.post(
  "/transfer",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const { item_id, from_branch_id, to_branch_id, quantity, batch_id, notes } = req.body;

    if (!item_id || !from_branch_id || !to_branch_id || !quantity || quantity <= 0) {
      return res.status(400).json({ error: "item_id, from_branch_id, to_branch_id and positive quantity required." });
    }
    if (from_branch_id === to_branch_id) {
      return res.status(400).json({ error: "Source and destination branch must differ." });
    }

    // Branch-scoped users can only transfer FROM their own branch
    if (req.branchFilter && req.branchFilter !== Number(from_branch_id)) {
      return res.status(403).json({ error: "You can only transfer from your own branch." });
    }

    // Check available stock
    const stock = await db("inventory_stock")
      .where({ item_id, branch_id: from_branch_id })
      .first();

    if (!stock || Number(stock.quantity) < Number(quantity)) {
      return res.status(409).json({ error: "Insufficient stock in source branch." });
    }

    const movements = await db.transaction(async (trx) => {
      await adjustStock(trx, item_id, from_branch_id, -Number(quantity));
      await adjustStock(trx, item_id, to_branch_id,    Number(quantity));

      // Update batch quantity if specified
      if (batch_id) {
        await trx("inventory_batches")
          .where({ id: batch_id })
          .update({ quantity: db.raw("quantity - ?", [Number(quantity)]), updated_at: trx.fn.now() });
      }

      const [out] = await trx("inventory_movements").insert({
        item_id, branch_id: from_branch_id, batch_id: batch_id || null,
        created_by: req.session.userId, movement_type: "transfer_out",
        quantity: -Number(quantity), related_branch_id: to_branch_id, notes,
      }).returning("*");

      const [inn] = await trx("inventory_movements").insert({
        item_id, branch_id: to_branch_id, batch_id: batch_id || null,
        created_by: req.session.userId, movement_type: "transfer_in",
        quantity: Number(quantity), related_branch_id: from_branch_id, notes,
      }).returning("*");

      return [out, inn];
    });

    await logAudit(req, { action: "inventory.transfer", entity_type: "inventory_item", entity_id: item_id,
      meta: { from_branch_id, to_branch_id, quantity } });
    res.status(201).json({ out: movements[0], in: movements[1] });
  })
);

// ── Manual adjustment ─────────────────────────────────────────────────────────

router.post(
  "/adjust",
  requireRole("admin", "branch_manager"),
  asyncHandler(async (req, res) => {
    const { item_id, branch_id: bodyBranch, quantity, notes } = req.body;

    if (!item_id || quantity === undefined || quantity === null) {
      return res.status(400).json({ error: "item_id and quantity (positive or negative) are required." });
    }

    const branchId = req.branchFilter ?? Number(bodyBranch);
    if (!branchId) return res.status(400).json({ error: "branch_id required." });

    // Prevent stock going below zero
    const stock = await db("inventory_stock").where({ item_id, branch_id: branchId }).first();
    if (stock && Number(stock.quantity) + Number(quantity) < 0) {
      return res.status(409).json({ error: "Adjustment would result in negative stock." });
    }

    const movement = await db.transaction(async (trx) => {
      await adjustStock(trx, item_id, branchId, Number(quantity));
      const [mov] = await trx("inventory_movements").insert({
        item_id, branch_id: branchId,
        created_by: req.session.userId,
        movement_type: "adjustment",
        quantity: Number(quantity),
        notes: notes || "Manual adjustment",
      }).returning("*");
      return mov;
    });

    await logAudit(req, { action: "inventory.adjust", entity_type: "inventory_item", entity_id: item_id,
      meta: { quantity, branchId, notes } });
    res.status(201).json(movement);
  })
);

// ── Batches ───────────────────────────────────────────────────────────────────

router.get("/batches", asyncHandler(async (req, res) => {
  const bf = req.branchFilter;
  const { item_id } = req.query;
  const q = db("inventory_batches as b")
    .join("inventory_items as i", "i.id", "b.item_id")
    .select("b.*", "i.name as item_name", "i.code as item_code", "i.unit")
    .where("b.quantity", ">", 0)
    .orderBy("b.expiry_date");

  if (bf)      q.where("b.branch_id", bf);
  if (item_id) q.where("b.item_id",   item_id);
  res.json(await q);
}));

router.get("/batches/expiring", asyncHandler(async (req, res) => {
  const days  = Number(req.query.days || 30);
  const bf    = req.branchFilter;
  const limit = new Date();
  limit.setDate(limit.getDate() + days);

  const q = db("inventory_batches as b")
    .join("inventory_items as i", "i.id", "b.item_id")
    .join("branches as br", "br.id", "b.branch_id")
    .select("b.*", "i.name as item_name", "i.code as item_code", "i.unit", "br.name as branch_name")
    .where("b.quantity", ">", 0)
    .whereNotNull("b.expiry_date")
    .where("b.expiry_date", "<=", limit.toISOString().slice(0, 10))
    .orderBy("b.expiry_date");

  if (bf) q.where("b.branch_id", bf);
  res.json(await q);
}));

// ── Movements history ─────────────────────────────────────────────────────────

router.get("/movements", asyncHandler(async (req, res) => {
  const bf = req.branchFilter;
  const { item_id, movement_type, date_from, date_to, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const q = db("inventory_movements as m")
    .join("inventory_items as i", "i.id", "m.item_id")
    .leftJoin("users as u", "u.id", "m.created_by")
    .leftJoin("branches as b", "b.id", "m.branch_id")
    .select(
      "m.*",
      "i.code as item_code", "i.name as item_name", "i.unit",
      "u.full_name as created_by_name",
      "b.name as branch_name"
    )
    .orderBy("m.created_at", "desc")
    .limit(Number(limit))
    .offset(offset);

  if (bf)            q.where("m.branch_id", bf);
  if (item_id)       q.where("m.item_id", item_id);
  if (movement_type) q.where("m.movement_type", movement_type);
  if (date_from)     q.where("m.created_at", ">=", date_from);
  if (date_to)       q.where("m.created_at", "<=", date_to + " 23:59:59");

  res.json(await q);
}));

// ── Alerts ────────────────────────────────────────────────────────────────────

router.get("/alerts/low-stock", asyncHandler(async (req, res) => {
  const bf = req.branchFilter;
  const q = db("inventory_stock as s")
    .join("inventory_items as i", "i.id", "s.item_id")
    .join("branches as b", "b.id", "s.branch_id")
    .select(
      "s.quantity", "s.reorder_level",
      "i.id as item_id", "i.code", "i.name", "i.unit", "i.supplier",
      "b.id as branch_id", "b.name as branch_name",
      db.raw("s.reorder_level - s.quantity as shortage")
    )
    .where("s.quantity", "<=", db.ref("s.reorder_level"))
    .where("s.reorder_level", ">", 0)
    .orderBy("shortage", "desc");

  if (bf) q.where("s.branch_id", bf);
  res.json(await q);
}));

router.get("/alerts/expiring", asyncHandler(async (req, res) => {
  const days  = Number(req.query.days || 30);
  const bf    = req.branchFilter;
  const limit = new Date();
  limit.setDate(limit.getDate() + days);

  const q = db("inventory_batches as b")
    .join("inventory_items as i", "i.id", "b.item_id")
    .join("branches as br", "br.id", "b.branch_id")
    .select("b.*", "i.name as item_name", "i.code as item_code", "i.unit", "br.name as branch_name",
      db.raw("b.expiry_date::text as expiry_str"),
      db.raw("(b.expiry_date - CURRENT_DATE) as days_left"))
    .where("b.quantity", ">", 0)
    .whereNotNull("b.expiry_date")
    .where("b.expiry_date", "<=", limit.toISOString().slice(0, 10))
    .orderBy("b.expiry_date");

  if (bf) q.where("b.branch_id", bf);
  res.json(await q);
}));

module.exports = router;
