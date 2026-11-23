/**
 * 007_billing.js — Phase 8 schema
 *
 * Tables added:
 *   invoices         — one invoice per order (auto-created on order, finalized on approval)
 *   invoice_payments — partial / full payment records linked to an invoice
 *
 * Design decisions:
 *   • An invoice is auto-created when an order is created (status = draft).
 *   • The invoice total = sum of order_items.price_at_order after discount.
 *   • Payments accumulate; amount_due = total_amount - discount_amount - SUM(payments).
 *   • Status transitions:  draft → issued → partially_paid → paid → void
 *   • Voiding is a soft operation; the row stays for audit.
 *   • We also add a generated column amount_due on the query side (not stored) —
 *     computed as (total_amount - discount_amount - paid_amount).
 */

exports.up = async function (knex) {
  // ── Invoices ──────────────────────────────────────────────────────────────
  await knex.schema.createTable("invoices", (t) => {
    t.increments("id").primary();
    t.integer("order_id").notNullable().unique()
      .references("id").inTable("orders").onDelete("RESTRICT");
    t.integer("branch_id").notNullable()
      .references("id").inTable("branches").onDelete("RESTRICT");
    t.integer("created_by")
      .references("id").inTable("users").onDelete("SET NULL");

    // Human-readable number, e.g. "INV-20241115-0001"
    t.string("invoice_no", 40).notNullable().unique();

    t.decimal("total_amount",    10, 2).notNullable().defaultTo(0);
    t.decimal("discount_amount", 10, 2).notNullable().defaultTo(0);
    t.decimal("paid_amount",     10, 2).notNullable().defaultTo(0); // cached sum of payments

    t.enu("status", ["draft", "issued", "partially_paid", "paid", "void"])
      .notNullable().defaultTo("draft");

    t.text("notes");
    t.timestamps(true, true);

    t.index(["branch_id"]);
    t.index(["order_id"]);
    t.index(["status"]);
    t.index(["created_at"]);
  });

  // ── Payments ──────────────────────────────────────────────────────────────
  await knex.schema.createTable("invoice_payments", (t) => {
    t.increments("id").primary();
    t.integer("invoice_id").notNullable()
      .references("id").inTable("invoices").onDelete("RESTRICT");
    t.integer("received_by")
      .references("id").inTable("users").onDelete("SET NULL");

    t.decimal("amount", 10, 2).notNullable();
    t.enu("payment_method", ["cash", "card", "upi", "bank_transfer", "other"])
      .notNullable().defaultTo("cash");
    t.string("reference_no", 100);  // cheque/UPI/transaction reference
    t.text("notes");
    t.timestamp("paid_at").notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("invoice_payments");
  await knex.schema.dropTableIfExists("invoices");
};
