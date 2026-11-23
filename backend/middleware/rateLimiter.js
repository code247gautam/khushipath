/**
 * rateLimiter.js
 * Applies a strict rate limit to the login endpoint to defend against
 * brute-force attacks.  After 10 failures in 15 minutes the IP is blocked
 * for the remainder of that window.
 */
const rateLimit = require("express-rate-limit");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                    // attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again after 15 minutes." },
  skipSuccessfulRequests: true,
});

module.exports = { loginLimiter };
