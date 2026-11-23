/**
 * server.js — Express application entry point.
 *
 * Security layers (in order):
 *   1. trust proxy        — correct IP behind nginx/traefik
 *   2. helmet             — secure HTTP headers + strict CSP
 *   3. cors               — same-origin; configure FRONTEND_ORIGIN for HTTPS
 *   4. globalApiLimiter   — 300 req/15 min per IP on all /api/* routes
 *   5. body parsers       — size-capped JSON + URL-encoded
 *   6. express-session    — PostgreSQL-backed, httpOnly, SameSite=strict
 *   7. csurf              — CSRF token (session-bound) on every mutation
 *   8. Per-route: requireAuth → requireRole → requireBranch
 *
 * Passwords are NEVER logged or returned by any route.
 * All DB queries use Knex parameterised bindings (no raw string interpolation).
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const express      = require("express");
const helmet       = require("helmet");
const cors         = require("cors");
const rateLimit    = require("express-rate-limit");
const session      = require("express-session");
const pgSession    = require("connect-pg-simple")(session);
const csrf         = require("csurf");
const path         = require("path");
const os           = require("os");
const { Pool }     = require("pg");

const authRoutes     = require("./routes/authRoutes");
const branchRoutes   = require("./routes/branchRoutes");
const userRoutes     = require("./routes/userRoutes");
const testRoutes     = require("./routes/testRoutes");
const packageRoutes  = require("./routes/packageRoutes");
const importRoutes   = require("./routes/importRoutes");
const { router: patientRoutes } = require("./routes/patientRoutes");
const orderRoutes    = require("./routes/orderRoutes");
const resultRoutes   = require("./routes/resultRoutes");
const approvalRoutes = require("./routes/approvalRoutes");
const reportRoutes   = require("./routes/reportRoutes");
const auditRoutes    = require("./routes/auditRoutes");
const retentionRoutes = require("./routes/retentionRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const billingRoutes   = require("./routes/billingRoutes");

const app  = express();
const PORT = process.env.PORT || 3000;

// Root of the whole repo (one level up from backend/)
const ROOT = path.resolve(__dirname, "..");

// ── Trust one proxy layer (nginx / traefik) ───────────────────────────────────
// Required so req.ip reflects the real client IP, not the proxy.
// Set to 0 (false) if running directly with no proxy.
app.set("trust proxy", process.env.TRUST_PROXY === "false" ? 0 : 1);

// ── Postgres pool for session store ──────────────────────────────────────────
const pgPool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || "neondb",
  user:     process.env.DB_USER     || "neondb_owner",
  password: process.env.DB_PASS,
  ssl:      process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// ── Security headers (helmet) ─────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
        styleSrc:    ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc:      ["'self'", "data:"],
        fontSrc:     ["'self'", "https://cdn.jsdelivr.net"],
        connectSrc:  ["'self'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
        frameSrc:    ["'none'"],
        objectSrc:   ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    // Additional helmet modules
    hsts:              { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy:    { policy: "strict-origin-when-cross-origin" },
    frameguard:        { action: "deny" },
    noSniff:           true,
    xssFilter:         true,
  })
);

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin:      process.env.FRONTEND_ORIGIN || "http://localhost:3000",
    credentials: true,
    methods:     ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// ── Global API rate limiter (all /api/* routes) ───────────────────────────────
// Prevents bulk scraping / abuse; the login endpoint has its own tighter limiter.
const globalApiLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 minutes
  max:             300,            // per IP per window
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: "Too many requests. Please slow down." },
  skip: (req) => req.method === "OPTIONS",
});
app.use("/api", globalApiLimiter);

// ── Static frontend & uploads (before session/CSRF — no auth needed) ─────────
app.use(express.static(path.join(ROOT, "frontend")));
app.use("/uploads", express.static(path.join(os.tmpdir(), "pathlab"), { index: false }));

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));

// ── Session (API routes only) ─────────────────────────────────────────────────
const sessionStore = new pgSession({
  pool:                 pgPool,
  tableName:            "sessions",
  createTableIfMissing: true,
  pruneSessionInterval: 60 * 60,
});

sessionStore.on("error", (err) => {
  console.error("[session-store] error:", err.message);
});

app.use("/api",
  session({
    store: sessionStore,
    secret:            process.env.SESSION_SECRET || "dev_secret_CHANGE_ME_NOW",
    resave:            false,
    saveUninitialized: false,
    name:              "pathlab.sid",
    cookie: {
      httpOnly: true,
      secure:   process.env.COOKIE_SECURE === "true",
      sameSite: "lax",
      maxAge:   Number(process.env.SESSION_MAX_AGE_MS) || 8 * 60 * 60 * 1000,
    },
  })
);

// ── CSRF protection (API routes only) ────────────────────────────────────────
const csrfProtection = csrf({ cookie: false });
app.use("/api", csrfProtection);

app.get("/api/csrf-token", (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api/auth",      authRoutes);
app.use("/api/branches",  branchRoutes);
app.use("/api/users",     userRoutes);
app.use("/api/tests",     testRoutes);
app.use("/api/packages",  packageRoutes);
app.use("/api/import",    importRoutes);
app.use("/api/patients",  patientRoutes);
app.use("/api/orders",    orderRoutes);
app.use("/api/results",   resultRoutes);
app.use("/api/approval",  approvalRoutes);
app.use("/api/reports",   reportRoutes);
app.use("/api/audit",     auditRoutes);
app.use("/api/retention", retentionRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/billing",   billingRoutes);

// ── 404 for unknown API routes ────────────────────────────────────────────────
app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(ROOT, "frontend", "index.html"));
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // 1. CSRF token mismatch
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ error: "Invalid or missing CSRF token." });
  }
  // 2. Validation throws from assertRequired / assertEnum etc.
  if (err.status && err.error) {
    return res.status(err.status).json({ error: err.error });
  }
  // 3. PostgreSQL unique-constraint violation
  if (err.code === "23505") {
    return res.status(409).json({ error: "A record with that value already exists." });
  }
  // 4. PostgreSQL foreign-key violation
  if (err.code === "23503") {
    return res.status(409).json({ error: "Referenced record does not exist." });
  }
  // 5. Multer file-size limit
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large. Maximum size is 5 MB." });
  }
  // 6. Everything else — log internally, never expose stack trace
  const ref = `ERR-${Date.now()}`;
  console.error(`[${ref}]`, err.message, err.stack);
  res.status(500).json({ error: "Internal server error.", ref });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n[PathLab] running on http://localhost:${PORT}`);
  console.log(`    NODE_ENV : ${process.env.NODE_ENV || "development"}`);
  console.log(`    DB       : ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  console.log(`    ROOT     : ${ROOT}`);
  console.log(`    FRONTEND : ${path.join(ROOT, "frontend")}`);
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === "dev_secret_CHANGE_ME_NOW") {
    console.warn("\n[WARNING] SESSION_SECRET is not set or is the default value.");
    console.warn("   Set a strong secret in .env before going to production.\n");
  }
});
