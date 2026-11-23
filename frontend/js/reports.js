/**
 * reports.js — Report search, history, PDF preview and download.
 */
(function () {
  const alertBox = document.getElementById("alertBox");
  const tbody    = document.getElementById("reportTbody");

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    const me = await API.get("/api/auth/me").catch(() => null);
    if (!me) { location.href = "/"; return; }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    document.getElementById("searchBtn").addEventListener("click", doSearch);
    document.getElementById("clearBtn").addEventListener("click", () => {
      ["searchInput","testCode"].forEach((id) => document.getElementById(id).value = "");
      ["dateFrom","dateTo"].forEach((id) => document.getElementById(id).value = "");
      document.getElementById("statusFilter").value = "";
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">Use the search bar above.</td></tr>`;
    });

    // Allow Enter key in search box
    document.getElementById("searchInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
    });

    // If a report_id is in the URL, preview it immediately
    const params = new URLSearchParams(location.search);
    if (params.get("report_id")) {
      previewReport(Number(params.get("report_id")));
    } else {
      // Auto-load recent approved reports on open
      doSearch();
    }
  })();

  // ── Search ────────────────────────────────────────────────────────────
  async function doSearch() {
    const q = new URLSearchParams();
    const search   = document.getElementById("searchInput").value.trim();
    const dateFrom = document.getElementById("dateFrom").value;
    const dateTo   = document.getElementById("dateTo").value;
    const testCode = document.getElementById("testCode").value.trim();
    const status   = document.getElementById("statusFilter").value;

    if (search)   q.set("search",    search);
    if (dateFrom) q.set("date_from", dateFrom);
    if (dateTo)   q.set("date_to",   dateTo);
    if (testCode) q.set("test_code", testCode);
    if (status)   q.set("status",    status);

    try {
      const rows = await API.get(`/api/reports?${q}`);
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">No reports found.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((r) => {
        const isSuperseded = r.superseded;
        const cls = isSuperseded ? "superseded" : "";
        return `
          <tr class="${cls}">
            <td><code>${esc(r.report_no)}</code></td>
            <td>${esc(r.patient_name)}<br><small class="text-muted">${esc(r.patient_uid)}</small></td>
            <td><code>${esc(r.order_no)}</code></td>
            <td>${esc(r.pathologist_name || "—")}</td>
            <td>${r.approved_at ? new Date(r.approved_at).toLocaleDateString() : "—"}</td>
            <td>${r.version}</td>
            <td>
              <span class="badge bg-${r.status === "approved" ? "success" : r.status === "superseded" ? "secondary" : "warning text-dark"}">
                ${esc(r.status)}
              </span>
            </td>
            <td>
              <button class="btn btn-xs btn-sm btn-outline-primary" onclick="previewReport(${r.id})">View</button>
              <a href="/api/reports/${r.id}/download" class="btn btn-xs btn-sm btn-outline-secondary ms-1">PDF</a>
            </td>
          </tr>`;
      }).join("");
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Preview report in new tab ─────────────────────────────────────────
  window.previewReport = (id) => {
    window.open(`/api/reports/${id}/pdf`, "_blank");
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  function showAlert(msg, type = "danger") {
    alertBox.textContent = msg;
    alertBox.className   = `alert alert-${type}`;
    setTimeout(() => { alertBox.className = "alert d-none"; }, 5000);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
})();
