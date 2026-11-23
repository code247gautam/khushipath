#!/usr/bin/env node
/**
 * archive_old_reports.js — Scheduled archiving script.
 *
 * Run via cron or a node-cron job. Marks orders and reports older than
 * the configured retention period as archived (sets archived_at).
 * Does NOT delete anything — that requires explicit admin action via the UI.
 *
 * Cron example (runs at 3:00 AM daily):
 *   0 3 * * * node /path/to/pathlab/backend/scripts/archive_old_reports.js \
 *               >> /var/log/pathlab-archive.log 2>&1
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const knex = require("knex");
const cfg  = require("../knexfile");

const db = knex(cfg[process.env.NODE_ENV || "development"]);

(async () => {
  console.log(`[${new Date().toISOString()}] Archive job starting…`);

  try {
    // Read retention config
    const config = await db("retention_config").first();
    if (!config) {
      console.error("retention_config table is empty. Run migrations first.");
      process.exit(1);
    }

    if (!config.auto_archive_enabled) {
      console.log("Auto-archive is disabled. Exiting.");
      await db.destroy();
      return;
    }

    const months  = config.retention_months;
    const cutoff  = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffISO = cutoff.toISOString();

    console.log(`  Retention: ${months} months  |  Cutoff: ${cutoffISO}`);

    // Count eligible rows first
    const dueCount = await db("orders")
      .whereNull("archived_at")
      .where("created_at", "<", cutoffISO)
      .count("id as cnt")
      .first();

    console.log(`  Orders due for archiving: ${dueCount.cnt}`);

    if (Number(dueCount.cnt) === 0) {
      console.log("  Nothing to archive.");
    } else {
      const { orderCount, reportCount } = await db.transaction(async (trx) => {
        const o = await trx("orders")
          .whereNull("archived_at")
          .where("created_at", "<", cutoffISO)
          .update({ archived_at: trx.fn.now() });

        const r = await trx("reports")
          .whereNull("archived_at")
          .whereIn("order_id",
            trx("orders").where("created_at", "<", cutoffISO).select("id")
          )
          .update({ archived_at: trx.fn.now() });

        return { orderCount: o, reportCount: r };
      });

      console.log(`  ✅ Archived ${orderCount} orders and ${reportCount} reports.`);
    }

    // Update last_archive_run
    const config2 = await db("retention_config").first();
    await db("retention_config").where({ id: config2.id })
      .update({ last_archive_run: db.fn.now() });

    // Write a row to audit_logs (system action — no user_id)
    await db("audit_logs").insert({
      action:     "retention.archive",
      entity_type: "system",
      meta:       JSON.stringify({
        source: "cron",
        months,
        cutoff: cutoffISO,
      }),
    });

    console.log(`[${new Date().toISOString()}] Archive job done.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Archive job FAILED:`, err.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
})();
