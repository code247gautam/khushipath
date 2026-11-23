/**
 * 005_audit_retention.js — Phase 5 schema
 *
 * Tables added:
 *   audit_logs      — immutable record of every significant action
 *   retention_config — single-row config table for archiving settings
 *
 * Design decisions:
 *   • audit_logs has NO update/delete grants in production (enforced by app logic;
 *     a production DBA should revoke UPDATE/DELETE on this table from the app role).
 *   • The archived_at column on reports/orders marks rows that have been moved
 *     to cold storage but NOT deleted, satisfying the "warn before any deletion" rule.
 *   • We add archived_at to both orders and reports here via schema alterations.
 */

exports.up = async function (knex) {
  // ── Audit log ─────────────────────────────────────────────────────────────
  await knex.schema.createTable("audit_logs", (t) => {
    t.bigIncrements("id").primary();

    // Who
    t.integer("user_id").references("id").inTable("users").onDelete("SET NULL");
    t.string("user_email", 120);        // snapshot at log time (user may be deleted later)
    t.string("user_role",  30);
    t.integer("branch_id").references("id").inTable("branches").onDelete("SET NULL");

    // What
    t.string("action", 60).notNullable();   // e.g. "login", "result.enter", "report.download"
    t.string("entity_type", 60);            // e.g. "order", "result", "report", "user"
    t.bigInteger("entity_id");              // PK of the affected row
    t.jsonb("meta");                        // extra detail (old/new values, etc.)

    // When / Where
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.string("ip_address", 45);             // IPv4 or IPv6
    t.string("user_agent", 300);

    t.index(["user_id"]);
    t.index(["action"]);
    t.index(["entity_type", "entity_id"]);
    t.index(["created_at"]);
    t.index(["branch_id"]);
  });

  // ── Retention config (single row, upserted) ───────────────────────────────
  await knex.schema.createTable("retention_config", (t) => {
    t.increments("id").primary();
    t.integer("retention_months").notNullable().defaultTo(6);
    t.boolean("auto_archive_enabled").notNullable().defaultTo(true);
    t.timestamp("last_archive_run");
    t.timestamps(true, true);
  });

  // Seed the single config row
  await knex("retention_config").insert({ retention_months: 6, auto_archive_enabled: true });

  // ── Add archived_at to orders and reports ─────────────────────────────────
  await knex.schema.table("orders", (t) => {
    t.timestamp("archived_at").nullable();
    t.index(["archived_at"]);
  });

  await knex.schema.table("reports", (t) => {
    t.timestamp("archived_at").nullable();
    t.index(["archived_at"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.table("reports", (t) => { t.dropColumn("archived_at"); });
  await knex.schema.table("orders",  (t) => { t.dropColumn("archived_at"); });
  await knex.schema.dropTableIfExists("retention_config");
  await knex.schema.dropTableIfExists("audit_logs");
};
