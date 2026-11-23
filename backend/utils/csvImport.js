/**
 * csvImport.js — Parse a CSV or Excel buffer into an array of plain objects.
 *
 * Supported formats:
 *   .csv  — RFC-4180 with header row
 *   .xlsx / .xls — first sheet, first row as headers
 *
 * Returns: Array<{ [columnHeader]: string }>
 *
 * Dependencies: xlsx (SheetJS) — zero-cost, MIT licence.
 * Install: npm install xlsx
 */
const XLSX = require("xlsx");

/**
 * @param {Buffer} buffer  Raw file bytes
 * @param {string} filename  Original file name (used to infer format)
 * @returns {Array<Object>}  Rows as plain objects keyed by header
 */
function parseUpload(buffer, filename) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];
  // header:1 → first row becomes keys; defval:"" → missing cells = empty string
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rows.length < 2) return []; // no data rows

  const headers = rows[0].map((h) => String(h).trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = String(row[i] ?? "").trim(); });
    return obj;
  });
}

module.exports = { parseUpload };
