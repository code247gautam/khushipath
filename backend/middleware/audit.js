/**
 * audit.js middleware — write an immutable audit log entry.
 *
 * Usage in route handlers:
 *   const { logAudit } = require('../middleware/audit');
 *   await logAudit(req, { action: 'report.download', entity_type: 'report', entity_id: 42 });
 *
 * Or use the Express middleware factory for automatic per-route logging:
 *   router.get('/:id/pdf', auditMiddleware('report.view'), asyncHandler(...));
 *
 * Never throws — audit failures are logged to stderr but never break the response.
 */
const db = require("../db");

/**
 * Write one audit log row.
 * @param {import('express').Request} req
 * @param {{ action: string, entity_type?: string, entity_id?: number|string, meta?: object }} opts
 */
async function logAudit(req, { action, entity_type, entity_id, meta } = {}) {
  try {
    const userId  = req.session?.userId  ?? null;
    const role    = req.session?.role    ?? null;
    const branchId = req.session?.branchId ?? null;

    // Collect email lazily to avoid a DB hit on every call
    // We store it on the session after first login to save round trips
    const userEmail = req.session?.email ?? null;

    // Best-effort IP: works behind a trusted reverse proxy if
    // app.set('trust proxy', 1) is configured
    const ip = req.ip || req.socket?.remoteAddress || null;
    const ua = req.headers?.["user-agent"]?.slice(0, 300) ?? null;

    await db("audit_logs").insert({
      user_id:     userId,
      user_email:  userEmail,
      user_role:   role,
      branch_id:   branchId,
      action,
      entity_type: entity_type ?? null,
      entity_id:   entity_id   ?? null,
      meta:        meta        ? JSON.stringify(meta) : null,
      ip_address:  ip,
      user_agent:  ua,
    });
  } catch (err) {
    // Audit failures must never break a user-facing request
    console.error("[AUDIT ERROR]", err.message);
  }
}

/**
 * Express middleware factory.
 * Runs AFTER the response so it doesn't delay the client.
 *
 * @param {string} action
 * @param {{ entityFromParam?: string, entityType?: string }} [opts]
 */
function auditMiddleware(action, { entityFromParam, entityType } = {}) {
  return (req, res, next) => {
    // Hook into response finish so we log only successful requests
    res.on("finish", () => {
      if (res.statusCode >= 400) return; // don't log failed requests

      const entity_id = entityFromParam ? req.params[entityFromParam] : undefined;
      logAudit(req, { action, entity_type: entityType, entity_id }).catch(() => {});
    });
    next();
  };
}

module.exports = { logAudit, auditMiddleware };
