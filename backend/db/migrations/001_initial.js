/**
 * 001_initial.js — Phase 1 schema
 * Tables: branches, users
 *
 * Every user-facing table carries branch_id so rows are always scoped
 * to a single branch. Admin users have branch_id = NULL (all-branch access).
 */

exports.up = async function (knex) {
  // ── Branches ────────────────────────────────────────────────────────────
  await knex.schema.createTable("branches", (t) => {
    t.increments("id").primary();
    t.string("name", 120).notNullable();
    t.text("address");
    t.string("phone", 30);
    t.string("email", 120);
    t.string("logo_url", 500);        // path to uploaded logo file
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);         // created_at, updated_at
  });

  // ── Users ────────────────────────────────────────────────────────────────
  await knex.schema.createTable("users", (t) => {
    t.increments("id").primary();
    // branch_id NULL means the user is an admin who sees all branches
    t.integer("branch_id").references("id").inTable("branches").onDelete("SET NULL");
    t.string("full_name", 120).notNullable();
    t.string("email", 120).notNullable().unique();
    t.string("password_hash", 72).notNullable();   // bcrypt output is ≤72 chars
    t.enu("role", [
      "admin",
      "branch_manager",
      "receptionist",
      "technician",
      "pathologist",
      "accountant",
    ]).notNullable();
    t.string("phone", 30);
    t.boolean("is_active").defaultTo(true);
    t.timestamp("last_login_at");
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("users");
  await knex.schema.dropTableIfExists("branches");
};
