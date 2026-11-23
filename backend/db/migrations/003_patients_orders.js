/**
 * 003_patients_orders.js — Phase 3 schema
 *
 * Tables added:
 *   patients        — registered lab patients
 *   orders          — a test order per visit (one patient may have many)
 *   order_items     — individual tests (or package expansions) inside an order
 *   results         — one result row per order_item, filled by technician
 */

exports.up = async function (knex) {
  // ── Patients ──────────────────────────────────────────────────────────────
  await knex.schema.createTable("patients", (t) => {
    t.increments("id").primary();
    t.integer("branch_id").notNullable()
      .references("id").inTable("branches").onDelete("RESTRICT");

    // Auto-generated patient ID, e.g. "PL-000001"
    t.string("patient_uid", 20).notNullable().unique();

    t.string("full_name", 150).notNullable();
    t.enu("gender", ["M", "F", "O"]).notNullable();     // M/F/Other
    t.date("date_of_birth");                              // used to calc age
    t.integer("age_years");                               // fallback if DOB unknown
    t.string("phone", 30).notNullable();
    t.string("email", 120);
    t.text("address");
    t.string("referring_doctor", 150);
    t.text("notes");
    t.timestamps(true, true);

    t.index(["branch_id"]);
    t.index(["phone"]);
    t.index(["patient_uid"]);
  });

  // ── Sequence for patient UID ──────────────────────────────────────────────
  // Using a plain integer sequence so we can format "PL-000001"
  await knex.raw(`CREATE SEQUENCE IF NOT EXISTS patient_uid_seq START 1`);

  // ── Orders ────────────────────────────────────────────────────────────────
  await knex.schema.createTable("orders", (t) => {
    t.increments("id").primary();
    t.integer("branch_id").notNullable()
      .references("id").inTable("branches").onDelete("RESTRICT");
    t.integer("patient_id").notNullable()
      .references("id").inTable("patients").onDelete("RESTRICT");
    t.integer("created_by").references("id").inTable("users").onDelete("SET NULL");

    // Human-readable order number, e.g. "ORD-20241115-0042"
    t.string("order_no", 30).notNullable().unique();

    t.enu("sample_status", [
      "collected",
      "received",
      "in_process",
      "reported",
      "delivered",
    ]).notNullable().defaultTo("collected");

    t.text("clinical_notes");
    t.string("referring_doctor", 150);  // override per-order if different from patient default
    t.timestamp("collected_at");
    t.timestamps(true, true);

    t.index(["branch_id"]);
    t.index(["patient_id"]);
  });

  // ── Order items (individual tests inside an order) ────────────────────────
  await knex.schema.createTable("order_items", (t) => {
    t.increments("id").primary();
    t.integer("order_id").notNullable()
      .references("id").inTable("orders").onDelete("CASCADE");
    t.integer("test_id").notNullable()
      .references("id").inTable("tests").onDelete("RESTRICT");
    // If the item came from a package, record which one for display
    t.integer("package_id").references("id").inTable("packages").onDelete("SET NULL");
    // Price snapshotted at order time (catalog price may change later)
    t.decimal("price_at_order", 10, 2).notNullable().defaultTo(0);
    t.unique(["order_id", "test_id"]);
  });

  // ── Results ───────────────────────────────────────────────────────────────
  await knex.schema.createTable("results", (t) => {
    t.increments("id").primary();
    t.integer("order_item_id").notNullable().unique()
      .references("id").inTable("order_items").onDelete("CASCADE");
    t.integer("entered_by").references("id").inTable("users").onDelete("SET NULL");

    t.text("value");                       // the actual result value (string to handle "<0.1" etc.)
    t.string("unit", 50);                  // copied from test at entry time
    t.enu("flag", ["N", "H", "L", "C"])    // Normal / High / Low / Critical
      .notNullable().defaultTo("N");
    t.text("technician_notes");
    t.timestamp("entered_at");

    // These fields are populated by Phase 4 (pathologist approval)
    t.integer("approved_by").references("id").inTable("users").onDelete("SET NULL");
    t.timestamp("approved_at");
    t.enu("approval_status", ["pending", "approved", "rejected"])
      .notNullable().defaultTo("pending");

    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("results");
  await knex.schema.dropTableIfExists("order_items");
  await knex.schema.dropTableIfExists("orders");
  await knex.schema.dropTableIfExists("patients");
  await knex.raw(`DROP SEQUENCE IF EXISTS patient_uid_seq`);
};
