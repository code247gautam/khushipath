/**
 * db/index.js — Knex singleton.
 * Import this file in routes and middleware to get the query builder.
 */
const knex = require("knex");
const config = require("../knexfile");

const env = process.env.NODE_ENV || "development";
const db = knex(config[env]);

module.exports = db;
