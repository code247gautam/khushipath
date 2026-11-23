/**
 * auth.js — Authentication and authorisation middleware
 *
 * requireAuth  — rejects unauthenticated requests (401)
 * requireRole  — rejects requests where the user's role is not in the
 *                allowed list (403)
 * requireBranch — attaches a branchFilter helper to req so route handlers
 *                 can easily scope DB queries to the user's branch.
 *                 Admins receive null (= no filter = all branches).
 */

/**
 * Ensure the request carries a valid, non-expired session.
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Authentication required." });
  }
  next();
}

/**
 * Factory: returns middleware that allows only the listed roles.
 * @param  {...string} roles  Allowed role names
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !roles.includes(req.session.role)) {
      return res.status(403).json({ error: "Access denied." });
    }
    next();
  };
}

/**
 * Attaches `req.branchFilter` — the branch_id the current user is locked
 * to, or null if the user is an admin (sees everything).
 *
 * Usage in route handlers:
 *   const filter = req.branchFilter;          // null | number
 *   if (filter) query.where('branch_id', filter);
 */
function requireBranch(req, res, next) {
  // Admin has branch_id = null in session → no restriction
  req.branchFilter = req.session.branchId || null;
  next();
}

module.exports = { requireAuth, requireRole, requireBranch };
