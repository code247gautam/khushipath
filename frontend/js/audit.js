/**
 * audit.js — Audit log page (admin only).
 */
(function () {
  const tbody    = document.getElementById("auditTbody");
  const alertBox = document.getElementById("alertBox");

  let _page  = 1;
  const LIMIT = 50;
  let _total = 0;

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    const me = await API.get("/api/auth/me").catch(() => null);
    if (!me) { location.href = "/"; return; }
    if (me.role !== "admin") { location.href = "/dashboard.html"; return; }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    document.getElementById("searchBtn").addEventListener("click", () => { _page = 1; loadAudit(); });
    document.getElementById("clearBtn").addEventListener("click", () => {
      ["actionFilter","userFilter","dateFrom","dateTo"].forEach((id) => {
        document.getElementById(id).value = "";
      });
      _page = 1;
      loadAudit();
    });
    document.getElementById("prevBtn").addEventListener("click", () => { if (_page > 1) { _page--; loadAudit(); } });
    document.getElementById("nextBtn").addEventListener("click", () => {
      if (_page * LIMIT < _total) { _page++; loadAudit(); }
    });

    // Wire export button
    document.getElementById("exportBtn").addEventListener("click", (e) => {
      e.preventDefault();
      const q = buildParams();
      location.href = `/api/audit/export?${q}`;
    });

    loadAudit();
  })();

  function buildParams() {
    const q = new URLSearchParams();
    const action   = document.getElementById("actionFilter").value.trim();
    const dateFrom = document.getElementById("dateFrom").value;
    const dateTo   = document.getElementById("dateTo").value;
    const user     = document.getElementById("userFilter").value.trim();
    if (action)   q.set("action",    action);
    if (dateFrom) q.set("date_from", dateFrom);
    if (dateTo)   q.set("date_to",   dateTo);
    if (user)     q.set("user_email_like", user);
    q.set("page",  _page);
    q.set("limit", LIMIT);
    return q.toString();
  }

  async function loadAudit() {
    try {
      const rows = await API.get(`/api/audit?${buildParams()}`);

      // Read X-Total-Count from previous fetch (approximation; we re-fetch count via route)
      _total = rows.length < LIMIT ? (_page - 1) * LIMIT + rows.length : _page * LIMIT + 1;

      document.getElementById("pageLabel").textContent = `Page ${_page}`;
      document.getElementById("prevBtn").disabled = _page === 1;
      document.getElementById("nextBtn").disabled = rows.length < LIMIT;
      document.getElementById("totalLabel").textContent = `Showing ${rows.length} rows`;

      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">No log entries found.</td></tr>`;
        return;
      }

      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td class="text-nowrap">${new Date(r.created_at).toLocaleString()}</td>
          <td><code>${esc(r.action)}</code></td>
          <td>${r.entity_type ? `<span class="badge bg-secondary">${esc(r.entity_type)}</span> ${r.entity_id ?? ""}` : "—"}</td>
          <td>${esc(r.user_name || r.user_email || "system")}</td>
          <td>${esc(r.user_role || "—")}</td>
          <td>${esc(r.branch_name || "—")}</td>
          <td>${esc(r.ip_address || "—")}</td>
          <td>
            ${r.meta
              ? `<button class="btn btn-xs btn-sm btn-link p-0" onclick='showMeta(${JSON.stringify(JSON.stringify(r.meta))})'>detail</button>`
              : ""}
          </td>
        </tr>
      `).join("");
    } catch (err) {
      showAlert(err.message);
    }
  }

  window.showMeta = (metaStr) => {
    try {
      const obj = JSON.parse(metaStr);
      alert(JSON.stringify(obj, null, 2));
    } catch (_) {
      alert(metaStr);
    }
  };

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
