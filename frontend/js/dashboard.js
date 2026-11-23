/**
 * dashboard.js — Live KPI tiles + top tests + delayed orders.
 * Auto-refreshes every 60 seconds.
 */
(function () {
  let _me = null;

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    _me = await API.get("/api/auth/me").catch(() => null);
    if (!_me) { location.href = "/"; return; }

    // Show user info
    document.getElementById("userGreeting").textContent =
      `${_me.full_name}  •  ${_me.role.replace(/_/g, " ")}`;
    document.getElementById("roleLabel").textContent = `Role: ${_me.role}`;
    document.getElementById("dateLabel").textContent =
      new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    // Show role-gated nav links
    document.querySelectorAll("[data-role-only]").forEach((el) => {
      const allowed = el.dataset.roleOnly.split(",").map((r) => r.trim());
      if (allowed.includes(_me.role)) el.style.display = "";
    });

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    document.getElementById("refreshBtn").addEventListener("click", loadAll);

    loadAll();
    setInterval(loadAll, 60_000); // auto-refresh every minute
  })();

  // ── Load all dashboard data ───────────────────────────────────────────
  async function loadAll() {
    await Promise.all([loadKPIs(), loadTopTests(), loadDelayed()]);
  }

  // ── KPI tiles ─────────────────────────────────────────────────────────
  async function loadKPIs() {
    try {
      const d = await API.get("/api/dashboard/today");
      document.getElementById("kpi-patients").textContent = d.patients_today;
      document.getElementById("kpi-orders").textContent   = d.orders_today;
      document.getElementById("kpi-pending").textContent  = d.results_pending;
      document.getElementById("kpi-approved").textContent = d.reports_approved;
      document.getElementById("kpi-delayed").textContent  = d.delayed_orders;
      document.getElementById("kpi-revenue").textContent  =
        "₹" + Number(d.revenue_today).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    } catch (_) { /* silent — already showing — */ }
  }

  // ── Top tests (last 7 days) ───────────────────────────────────────────
  async function loadTopTests() {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 6);
    const from = dateFrom.toISOString().slice(0, 10);
    const to   = new Date().toISOString().slice(0, 10);

    try {
      const rows = await API.get(`/api/dashboard/top-tests?date_from=${from}&date_to=${to}&limit=8`);
      const chart = document.getElementById("topTestsChart");

      if (!rows.length) {
        chart.innerHTML = `<div class="text-muted small">No data yet.</div>`;
        return;
      }

      const max = Math.max(...rows.map((r) => Number(r.order_count)));
      chart.innerHTML = rows.map((r) => {
        const pct = max ? Math.round((Number(r.order_count) / max) * 100) : 0;
        return `
          <div class="d-flex align-items-center mb-1" style="gap:8px">
            <div style="width:60px;font-size:.75rem;text-align:right;color:#64748b">${esc(r.code)}</div>
            <div style="flex:1;background:#e2e8f0;border-radius:3px;height:14px">
              <div style="width:${pct}%;background:#3b82f6;border-radius:3px;height:100%"></div>
            </div>
            <div style="width:30px;font-size:.75rem;color:#1e293b;font-weight:600">${r.order_count}</div>
          </div>`;
      }).join("");
    } catch (_) {}
  }

  // ── Delayed orders ─────────────────────────────────────────────────────
  async function loadDelayed() {
    try {
      const rows = await API.get("/api/dashboard/delayed");
      const tbody = document.getElementById("delayedTbody");

      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-success py-3 small">✓ No delayed orders</td></tr>`;
        return;
      }

      tbody.innerHTML = rows.slice(0, 10).map((o) => {
        const hours = Number(o.hours_elapsed).toFixed(1);
        const badgeClass = Number(hours) > 48 ? "danger" : "warning";
        return `<tr>
          <td><code>${esc(o.order_no)}</code></td>
          <td>${esc(o.patient_name)}</td>
          <td>${esc(o.sample_status)}</td>
          <td><span class="badge bg-${badgeClass}">${hours}h</span></td>
        </tr>`;
      }).join("");
    } catch (_) {}
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
})();
