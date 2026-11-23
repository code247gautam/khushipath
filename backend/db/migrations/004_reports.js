/**
 * 004_reports.js — Phase 4 schema
 *
 * Tables added:
 *   reports        — one report per order; each correction is a new version
 *   report_signatures — pathologist signature image paths per user
 *
 * Design decisions:
 *   • A report is always tied to a single order.
 *   • When a pathologist approves, a report row is inserted (version 1).
 *   • If the results are corrected afterwards, a new report row (version 2+)
 *     is inserted and the previous one is marked superseded = true.
 *   • Old (superseded) versions remain readable and downloadable.
 *   • The PDF is generated on demand from stored data — not stored on disk.
 */

exports.up = async function (knex) {
  // ── Pathologist signature images ─────────────────────────────────────────
  // Stored as a file path relative to /uploads/signatures/
  await knex.schema.createTable("report_signatures", (t) => {
    t.increments("id").primary();
    t.integer("user_id").notNullable().unique()
      .references("id").inTable("users").onDelete("CASCADE");
    t.string("file_path", 500).notNullable();   // e.g. "uploads/signatures/42.png"
    t.timestamps(true, true);
  });

  // ── Reports ───────────────────────────────────────────────────────────────
  await knex.schema.createTable("reports", (t) => {
    t.increments("id").primary();
    t.integer("order_id").notNullable()
      .references("id").inTable("orders").onDelete("RESTRICT");
    t.integer("branch_id").notNullable()
      .references("id").inTable("branches").onDelete("RESTRICT");

    // version increments on each correction cycle
    t.integer("version").notNullable().defaultTo(1);

    // superseded = true means a newer version exists; keep for history
    t.boolean("superseded").notNullable().defaultTo(false);

    // Approval details
    t.integer("approved_by").references("id").inTable("users").onDelete("SET NULL");
    t.timestamp("approved_at");
    t.enu("status", ["draft", "approved", "superseded"])
      .notNullable().defaultTo("draft");

    // Report UID used in the QR code — globally unique
    t.uuid("report_uid").notNullable().defaultTo(knex.raw("gen_random_uuid()")).unique();

    // Human-readable report number, e.g. "RPT-20241115-0001"
    t.string("report_no", 40).notNullable().unique();

    t.text("pathologist_remarks");
    t.timestamps(true, true);

    t.index(["order_id"]);
    t.index(["branch_id"]);
    t.index(["report_uid"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("reports");
  await knex.schema.dropTableIfExists("report_signatures");
};
