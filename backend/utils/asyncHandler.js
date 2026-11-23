/**
 * asyncHandler.js
 * Wraps an async route handler so thrown errors are forwarded to Express
 * error middleware instead of causing an unhandled promise rejection.
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
