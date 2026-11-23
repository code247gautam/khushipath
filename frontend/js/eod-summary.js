/**
 * eod-summary.js — End-of-Day Summary page logic.
 */
(function () {
  const alertBox = document.getElementById("alertBox");
  let _me        = null;
  let _branches  = [];

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    _me = await API.get("/api/auth/me").catch(() => null);
    if (!_me) { location.href = "/"; return; }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    // Default date = today
    document.getElementById("eodDate").value = new Date().toISOString().slice(0, 10);

    // Populate branch selector for admin
    if (_me.role === "admin") {
      _branches = await API.get("/api/branches").catch(() => []);
      const sel = document.getElementById("branchSelect");
      _branches.forEach((b) => {
        sel.innerHTML += `<option value="${b.id}">${esc(b.name)}</option>`;
      });
    } else {
      // Non-admin: hide branch selector, they only see their own branch
      document.getElementById("branchSelectWrap").style.display = "none";
    }

    document.getElementById("loadBtn").addEventListener("click", loadEOD);
    // Auto-load today on open
    loadEOD();
  })();

  // ── Load EOD summary ──────────────────────────────────────────────────
  async function loadEOD() {
    const date     = document.getElementById("eodDate").value;
    const branchId = document.getElementById("branchSelect")?.value || "";

    if (!date) { showAlert("Select a date.", "warning"); return; }

    try {
      const q = new URLSearchParams({ date });
      if (branchId) q.set("branch_id", branchId);

      const data = await API.get(`/api/dashboard/eod?${q}`);

      // Update export links
      document.getElementById("pdfBtn").href   = `/api/dashboard/eod/pdf?${q}`;
      document.getElementById("excelBtn").href = `/api/dashboard/eod/excel?${q}`;
      document.getElementById("exportBtns").style.display = "";

      renderKPIs(data.summary);
      renderStatusBreakdown(data.summary.status_counts);
      renderTopTests(data.top_tests);
      renderOrders(data.orders);
      renderReports(data.approved_reports);

      document.getElementById("summaryContent").style.display = "";
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── KPI tiles ─────────────────────────────────────────────────────────
  function renderKPIs(summary) {
    const kpis = [
      ["Patients",        summary.patient_count,  "#3b82f6"],
      ["Orders",          summary.order_count,    "#14b8a6"],
      ["Reports",         summary.report_count,   "#22c55e"],
      ["Revenue (₹)",     "₹" + Number(summary.revenue_total).toLocaleString("en-IN"), "#8b5cf6"],
    ];
    document.getElementById("eodKpis").innerHTML = kpis.map(([lbl, val, color]) => `
      <div class="col-6 col-md-3">
        <div class="kpi-box" style="border-left:4px solid ${color}">
          <div class="num">${val}</div>
          <div class="lbl">${lbl}</div>
        </div>
      </div>
    `).join("");
  }

  // ── Status breakdown ──────────────────────────────────────────────────
  function renderStatusBreakdown(counts) {
    const statuses = ["collected","received","in_process","reported","delivered"];
    document.getElementById("statusTbody").innerHTML = statuses.map((s) => `
      <tr>
        <td class="small">${s}</td>
        <td class="fw-semibold text-end">${counts[s] || 0}</td>
      </tr>
    `).join("");
  }

  // ── Top tests ─────────────────────────────────────────────────────────
  function renderTopTests(tests) {
    document.getElementById("topTestsTbody").innerHTML = !tests.length
      ? `<tr><td colspan="3" class="text-muted text-center small py-2">No data</td></tr>`
      : tests.map((t) => `
          <tr>
            <td class="small"><code>${esc(t.code)}</code></td>
            <td class="small">${esc(t.name)}</td>
            <td class="fw-semibold">${t.cnt}</td>
          </tr>
        `).join("");
  }

  // ── Orders ────────────────────────────────────────────────────────────
  function renderOrders(orders) {
    document.getElementById("eodOrdersTbody").innerHTML = !orders.length
      ? `<tr><td colspan="5" class="text-muted text-center py-2">No orders.</td></tr>`
      : orders.map((o) => `
          <tr>
            <td><code>${esc(o.order_no)}</code></td>
            <td>${esc(o.patient_name)}<br><small class="text-muted">${esc(o.patient_uid)}</small></td>
            <td><span class="badge bg-secondary">${esc(o.sample_status)}</span></td>
            <td>₹${Number(o.order_total || 0).toFixed(2)}</td>
            <td>${new Date(o.created_at).toLocaleTimeString()}</td>
          </tr>
        `).join("");
  }

  // ── Approved reports ──────────────────────────────────────────────────
  function renderReports(reports) {
    document.getElementById("eodReportsTbody").innerHTML = !reports.length
      ? `<tr><td colspan="4" class="text-muted text-center py-2">No reports approved.</td></tr>`
      : reports.map((r) => `
          <tr>
            <td><code>${esc(r.report_no)}</code></td>
            <td><code>${esc(r.order_no)}</code></td>
            <td>${esc(r.pathologist)}</td>
            <td>${new Date(r.approved_at).toLocaleTimeString()}</td>
          </tr>
        `).join("");
  }

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
