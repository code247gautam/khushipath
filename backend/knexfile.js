/**
 * knexfile.js — Knex configuration for all environments.
 * Database connection settings are read from environment variables only.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

/** @type {import('knex').Knex.Config} */
const base = {
  client: "pg",
  connection: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || "pathlab",
    user: process.env.DB_USER || "pathlab",
    password: process.env.DB_PASS || "changeme",
  },
  migrations: {
    directory: "./db/migrations",
    tableName: "knex_migrations",
  },
  seeds: {
    directory: "./db/seeds",
  },
  pool: { min: 2, max: 10 },
};

module.exports = {
  development: { ...base },
  production: {
    ...base,
    connection: { ...base.connection, ssl: { rejectUnauthorized: false } },
  },
};
