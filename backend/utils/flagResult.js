/**
 * flagResult.js — Determine the clinical flag for a numeric result.
 *
 * Logic:
 *   Given a result value and an array of matching reference ranges
 *   (already filtered for the patient's age and gender), return:
 *     "N"  — Normal
 *     "L"  — Low
 *     "H"  — High
 *     "C"  — Critical  (> 2× high or < 0.5× low; crude heuristic)
 *
 * If the value is non-numeric, or no range matches, returns "N".
 *
 * @param {string|number} rawValue  Result as entered
 * @param {Array}         ranges    Filtered reference_range rows
 * @returns {"N"|"H"|"L"|"C"}
 */
function flagResult(rawValue, ranges) {
  // Strip common prefix characters like "<", ">", "~"
  const numeric = parseFloat(String(rawValue).replace(/[^0-9.\-]/g, ""));
  if (isNaN(numeric)) return "N";
  if (!ranges || !ranges.length) return "N";

  // Use the first matching range (caller should pre-filter by age/gender)
  const range = ranges[0];
  const low  = range.range_low  != null ? Number(range.range_low)  : null;
  const high = range.range_high != null ? Number(range.range_high) : null;

  if (low !== null && numeric < low) {
    // Critical if less than half of lower bound
    return low > 0 && numeric < low * 0.5 ? "C" : "L";
  }
  if (high !== null && numeric > high) {
    // Critical if more than double the upper bound
    return numeric > high * 2 ? "C" : "H";
  }
  return "N";
}

module.exports = { flagResult };
