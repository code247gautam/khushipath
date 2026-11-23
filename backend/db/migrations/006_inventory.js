/**
 * 006_inventory.js — Phase 7 schema
 *
 * Tables added:
 *   inventory_items    — item master (reagents, kits, consumables)
 *   inventory_stock    — current stock level per branch per item
 *   inventory_batches  — batch/lot with expiry date per branch per item
 *   inventory_movements — every stock change: purchase, transfer, adjustment, usage
 *
 * Design decisions:
 *   • inventory_stock is a live denormalised counter; movements are the
 *     source of truth and are used to audit / reconstruct the balance.
 *   • Transfers generate two movement rows: OUT from source branch,
 *     IN to destination branch.
 *   • Low-stock alert level is stored on inventory_stock per branch so
 *     different branches can have different reorder thresholds.
 */

exports.up = async function (knex) {
  // ── Item master ───────────────────────────────────────────────────────────
  await knex.schema.createTable("inventory_items", (t) => {
    t.increments("id").primary();
    t.string("code",        40).notNullable().unique();
    t.string("name",       150).notNullable();
    t.enu("item_type", ["reagent", "kit", "consumable", "other"]).notNullable().defaultTo("other");
    t.string("unit",        30);        // e.g. "mL", "pieces", "box"
    t.string("supplier",   150);
    t.text("description");
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);
  });

  // ── Stock per branch ──────────────────────────────────────────────────────
  await knex.schema.createTable("inventory_stock", (t) => {
    t.increments("id").primary();
    t.integer("item_id").notNullable()
      .references("id").inTable("inventory_items").onDelete("CASCADE");
    t.integer("branch_id").notNullable()
      .references("id").inTable("branches").onDelete("CASCADE");
    t.decimal("quantity", 12, 3).notNullable().defaultTo(0);
    t.decimal("reorder_level", 12, 3).notNullable().defaultTo(0);  // alert threshold
    t.unique(["item_id", "branch_id"]);
    t.timestamps(true, true);
  });

  // ── Batches ───────────────────────────────────────────────────────────────
  await knex.schema.createTable("inventory_batches", (t) => {
    t.increments("id").primary();
    t.integer("item_id").notNullable()
      .references("id").inTable("inventory_items").onDelete("CASCADE");
    t.integer("branch_id").notNullable()
      .references("id").inTable("branches").onDelete("CASCADE");
    t.string("batch_no", 80).notNullable();
    t.date("expiry_date");
    t.decimal("quantity", 12, 3).notNullable().defaultTo(0);  // remaining in this batch
    t.timestamps(true, true);
    t.index(["expiry_date"]);
    t.index(["item_id", "branch_id"]);
  });

  // ── Movements (audit trail of every stock change) ─────────────────────────
  await knex.schema.createTable("inventory_movements", (t) => {
    t.increments("id").primary();
    t.integer("item_id").notNullable()
      .references("id").inTable("inventory_items").onDelete("RESTRICT");
    t.integer("branch_id").notNullable()
      .references("id").inTable("branches").onDelete("RESTRICT");
    t.integer("batch_id")
      .references("id").inTable("inventory_batches").onDelete("SET NULL");
    t.integer("created_by")
      .references("id").inTable("users").onDelete("SET NULL");

    t.enu("movement_type", [
      "purchase",     // new stock received
      "transfer_in",  // received from another branch
      "transfer_out", // sent to another branch
      "adjustment",   // manual correction (positive or negative)
      "usage",        // consumed during testing
    ]).notNullable();

    t.decimal("quantity", 12, 3).notNullable();  // positive = in, negative = out
    t.integer("related_branch_id")               // for transfers: the other branch
      .references("id").inTable("branches").onDelete("SET NULL");
    t.text("notes");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["item_id", "branch_id"]);
    t.index(["created_at"]);
    t.index(["movement_type"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("inventory_movements");
  await knex.schema.dropTableIfExists("inventory_batches");
  await knex.schema.dropTableIfExists("inventory_stock");
  await knex.schema.dropTableIfExists("inventory_items");
};
