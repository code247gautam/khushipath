/**
 * 002_seed_test_catalog.js
 * Seeds a minimal set of test categories, common tests, and reference ranges
 * so the UI has data immediately after migration. Safe to re-run (idempotent).
 */

exports.seed = async function (knex) {
  // ── Categories ─────────────────────────────────────────────────────────
  const cats = [
    "Haematology",
    "Biochemistry",
    "Microbiology",
    "Immunology",
    "Urine Analysis",
  ];

  for (const name of cats) {
    await knex("test_categories")
      .insert({ name })
      .onConflict("name")
      .ignore();
  }

  const catMap = Object.fromEntries(
    (await knex("test_categories").select("id", "name")).map((r) => [r.name, r.id])
  );

  // ── Tests ───────────────────────────────────────────────────────────────
  const tests = [
    {
      code: "CBC",
      name: "Complete Blood Count",
      category_id: catMap["Haematology"],
      unit: "varies",
      price: 150.0,
      sample_type: "EDTA Blood",
      turnaround_hours: 4,
    },
    {
      code: "HGB",
      name: "Haemoglobin",
      category_id: catMap["Haematology"],
      unit: "g/dL",
      price: 80.0,
      sample_type: "EDTA Blood",
      turnaround_hours: 2,
    },
    {
      code: "RBS",
      name: "Random Blood Sugar",
      category_id: catMap["Biochemistry"],
      unit: "mg/dL",
      price: 60.0,
      sample_type: "Serum",
      turnaround_hours: 2,
    },
    {
      code: "FBS",
      name: "Fasting Blood Sugar",
      category_id: catMap["Biochemistry"],
      unit: "mg/dL",
      price: 60.0,
      sample_type: "Serum",
      turnaround_hours: 2,
    },
    {
      code: "CREAT",
      name: "Serum Creatinine",
      category_id: catMap["Biochemistry"],
      unit: "mg/dL",
      price: 90.0,
      sample_type: "Serum",
      turnaround_hours: 4,
    },
    {
      code: "UA",
      name: "Urine Analysis (Complete)",
      category_id: catMap["Urine Analysis"],
      unit: "varies",
      price: 100.0,
      sample_type: "Midstream Urine",
      turnaround_hours: 2,
    },
  ];

  for (const t of tests) {
    await knex("tests").insert(t).onConflict("code").ignore();
  }

  const testMap = Object.fromEntries(
    (await knex("tests").select("id", "code")).map((r) => [r.code, r.id])
  );

  // ── Reference ranges ────────────────────────────────────────────────────
  const ranges = [
    // HGB — adult males
    { test_id: testMap["HGB"], gender: "M", age_min_years: 18, range_low: 13.0, range_high: 17.5 },
    // HGB — adult females
    { test_id: testMap["HGB"], gender: "F", age_min_years: 18, range_low: 12.0, range_high: 16.0 },
    // HGB — children
    { test_id: testMap["HGB"], gender: null, age_min_years: 1, age_max_years: 17, range_low: 11.0, range_high: 16.0 },
    // RBS
    { test_id: testMap["RBS"], range_low: 70, range_high: 200 },
    // FBS
    { test_id: testMap["FBS"], range_low: 70, range_high: 100 },
    // Creatinine — male
    { test_id: testMap["CREAT"], gender: "M", range_low: 0.74, range_high: 1.35 },
    // Creatinine — female
    { test_id: testMap["CREAT"], gender: "F", range_low: 0.59, range_high: 1.04 },
  ];

  // Idempotent: skip if any ranges already exist for these tests
  const existingTestIds = Object.values(testMap);
  const existingRanges = await knex("reference_ranges")
    .whereIn("test_id", existingTestIds)
    .count("id as cnt")
    .first();

  if (Number(existingRanges.cnt) === 0) {
    await knex("reference_ranges").insert(ranges);
  }

  // ── Sample package ───────────────────────────────────────────────────────
  await knex("packages")
    .insert({ code: "LFT-PKG", name: "Liver Function Package", price: 850.0 })
    .onConflict("code")
    .ignore();

  const pkg = await knex("packages").where({ code: "LFT-PKG" }).first();
  if (pkg) {
    // Add RBS + Creatinine to the package (just as an example)
    for (const code of ["RBS", "CREAT"]) {
      if (testMap[code]) {
        await knex("package_tests")
          .insert({ package_id: pkg.id, test_id: testMap[code] })
          .onConflict(["package_id", "test_id"])
          .ignore();
      }
    }
  }

  console.log("✅  Test catalog seeded.");
};
