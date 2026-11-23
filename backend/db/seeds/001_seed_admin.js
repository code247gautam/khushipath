/**
 * 001_seed_admin.js
 * Creates the default "Head Office" branch and a super-admin user.
 * Password is read from SEED_ADMIN_PASS env var (default: Admin@1234).
 * Change the password immediately after first login.
 */
const bcrypt = require("bcrypt");

exports.seed = async function (knex) {
  // Idempotent — skip if admin already exists
  const existing = await knex("users").where({ email: "admin@pathlab.local" }).first();
  if (existing) return;

  // Insert head-office branch
  const [branch] = await knex("branches")
    .insert({
      name: "Head Office",
      address: "1 Lab Street, City",
      phone: "0000000000",
      email: "headoffice@pathlab.local",
    })
    .returning("id");

  const branchId = branch.id ?? branch; // Knex returns object in pg

  // Hash password
  const rawPass = process.env.SEED_ADMIN_PASS || "Admin@1234";
  const hash = await bcrypt.hash(rawPass, 12);

  await knex("users").insert({
    branch_id: null,          // admin sees all branches
    full_name: "Super Admin",
    email: "admin@pathlab.local",
    password_hash: hash,
    role: "admin",
  });

  console.log(`\n✅  Seed complete — admin@pathlab.local / ${rawPass}`);
  console.log("    ⚠️  Change the password immediately after first login.\n");
};
