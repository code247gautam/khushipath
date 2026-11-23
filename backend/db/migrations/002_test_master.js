/**
 * 002_test_master.js — Phase 2 schema
 *
 * Tables added:
 *   test_categories  — grouping (Haematology, Biochemistry, …)
 *   tests            — the test catalog (one row per test)
 *   reference_ranges — normal ranges per test, age bracket and gender
 *   packages         — a named bundle with a single price
 *   package_tests    — many-to-many link between packages and tests
 */

exports.up = async function (knex) {
  // ── Test categories ──────────────────────────────────────────────────────
  await knex.schema.createTable("test_categories", (t) => {
    t.increments("id").primary();
    t.string("name", 100).notNullable().unique();
    t.text("description");
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);
  });

  // ── Tests ────────────────────────────────────────────────────────────────
  await knex.schema.createTable("tests", (t) => {
    t.increments("id").primary();
    t.string("code", 30).notNullable().unique();          // e.g. "CBC", "RBS"
    t.string("name", 150).notNullable();
    t.integer("category_id")
      .references("id").inTable("test_categories").onDelete("SET NULL");
    t.string("unit", 50);                                 // e.g. "g/dL", "mmol/L"
    t.decimal("price", 10, 2).notNullable().defaultTo(0);
    t.string("sample_type", 80);                         // Blood, Urine, Stool …
    t.integer("turnaround_hours").defaultTo(24);          // expected TAT
    t.text("method");                                     // analytical method
    t.text("notes");
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);
  });

  // ── Reference ranges ─────────────────────────────────────────────────────
  // Multiple ranges per test (split by age bracket and/or gender).
  await knex.schema.createTable("reference_ranges", (t) => {
    t.increments("id").primary();
    t.integer("test_id").notNullable()
      .references("id").inTable("tests").onDelete("CASCADE");
    // Age bracket (NULL = applies to all ages)
    t.integer("age_min_years");   // inclusive, NULL = no lower bound
    t.integer("age_max_years");   // inclusive, NULL = no upper bound
    // Gender: 'M', 'F', or NULL (applies to both)
    t.enu("gender", ["M", "F"]).nullable();
    t.decimal("range_low",  10, 4);   // NULL = no lower boundary (e.g. < 5)
    t.decimal("range_high", 10, 4);   // NULL = no upper boundary
    t.string("range_text", 200);      // free-text override e.g. "Negative"
    t.text("notes");
    t.timestamps(true, true);
  });

  // ── Packages ─────────────────────────────────────────────────────────────
  await knex.schema.createTable("packages", (t) => {
    t.increments("id").primary();
    t.string("code", 30).notNullable().unique();
    t.string("name", 150).notNullable();
    t.text("description");
    t.decimal("price", 10, 2).notNullable().defaultTo(0);
    t.boolean("is_active").defaultTo(true);
    t.timestamps(true, true);
  });

  // ── Package ↔ Test link ──────────────────────────────────────────────────
  await knex.schema.createTable("package_tests", (t) => {
    t.increments("id").primary();
    t.integer("package_id").notNullable()
      .references("id").inTable("packages").onDelete("CASCADE");
    t.integer("test_id").notNullable()
      .references("id").inTable("tests").onDelete("CASCADE");
    t.unique(["package_id", "test_id"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("package_tests");
  await knex.schema.dropTableIfExists("packages");
  await knex.schema.dropTableIfExists("reference_ranges");
  await knex.schema.dropTableIfExists("tests");
  await knex.schema.dropTableIfExists("test_categories");
};
