/**
 * retention.js — Retention & archiving page logic.
 */
(function () {
  const alertBox = document.getElementById("alertBox");

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    const me = await API.get("/api/auth/me").catch(() => null);
    if (!me) { location.href = "/"; return; }
    if (me.role !== "admin") { location.href = "/dashboard.html"; return; }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    document.getElementById("saveConfigBtn").addEventListener("click", saveConfig);
    document.getElementById("previewBtn").addEventListener("click", previewDue);
    document.getElementById("archiveNowBtn").addEventListener("click", archiveNow);
    document.getElementById("exportDeleteBtn").addEventListener("click", exportBeforeDelete);
    document.getElementById("hardDeleteBtn").addEventListener("click", hardDelete);

    loadConfig();
    loadArchived();
  })();

  // ── Load & save config ────────────────────────────────────────────────
  async function loadConfig() {
    try {
      const cfg = await API.get("/api/retention/config");
      document.getElementById("retentionMonths").value = cfg.retention_months;
      document.getElementById("autoArchive").checked   = cfg.auto_archive_enabled;
      document.getElementById("lastRunLabel").textContent =
        cfg.last_archive_run
          ? `Last run: ${new Date(cfg.last_archive_run).toLocaleString()}`
          : "Never run.";
    } catch (err) {
      showAlert(err.message);
    }
  }

  async function saveConfig() {
    const months = Number(document.getElementById("retentionMonths").value);
    const auto   = document.getElementById("autoArchive").checked;
    try {
      await API.put("/api/retention/config", { retention_months: months, auto_archive_enabled: auto });
      showAlert("Settings saved.", "success");
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Preview due orders ────────────────────────────────────────────────
  async function previewDue() {
    try {
      const data = await API.get("/api/retention/due");
      document.getElementById("dueInfo").textContent =
        `${data.count} orders created before ${new Date(data.cutoff_date).toLocaleDateString()} are due for archiving.`;

      const tbody = document.getElementById("dueTbody");
      if (!data.orders.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-2">None due.</td></tr>`;
      } else {
        tbody.innerHTML = data.orders.map((o) => `
          <tr>
            <td><code>${esc(o.order_no)}</code></td>
            <td>${esc(o.patient_name)} (${esc(o.patient_uid)})</td>
            <td>${new Date(o.created_at).toLocaleDateString()}</td>
            <td>${o.branch_id}</td>
          </tr>
        `).join("");
      }
      document.getElementById("dueTable").classList.remove("d-none");
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Archive now ───────────────────────────────────────────────────────
  async function archiveNow() {
    if (!confirm("Run archiving now? This will mark eligible orders as archived.")) return;
    try {
      const result = await API.post("/api/retention/archive", {});
      showAlert(`Archived ${result.orderCount} orders and ${result.reportCount} reports.`, "success");
      loadConfig();
      loadArchived();
      document.getElementById("dueTable").classList.add("d-none");
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Load archived records ─────────────────────────────────────────────
  async function loadArchived() {
    try {
      const rows = await API.get("/api/retention/archived");
      const tbody = document.getElementById("archivedTbody");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No archived records.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((o) => `
        <tr>
          <td><code>${esc(o.order_no)}</code></td>
          <td>${esc(o.patient_name)} (${esc(o.patient_uid)})</td>
          <td>${new Date(o.created_at).toLocaleDateString()}</td>
          <td>${new Date(o.archived_at).toLocaleDateString()}</td>
          <td>${o.branch_id}</td>
        </tr>
      `).join("");
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Export before delete ──────────────────────────────────────────────
  async function exportBeforeDelete() {
    const months = document.getElementById("deleteMonths").value;
    // This is a POST that returns a CSV download — use fetch directly
    const { csrfToken } = await fetch("/api/csrf-token", { credentials: "include" }).then((r) => r.json());
    const res = await fetch(`/api/retention/export-before-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      credentials: "include",
      body: JSON.stringify({ older_than_months: Number(months) }),
    });
    if (!res.ok) { showAlert("Export failed."); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `export_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Hard delete ───────────────────────────────────────────────────────
  async function hardDelete() {
    const months = document.getElementById("deleteMonths").value;
    if (!confirm(`⚠️ Permanently delete archived records older than ${months} months?\n\nThis CANNOT be undone. Export first!`)) return;
    try {
      const result = await API.del(`/api/retention/hard-delete`);
      // Note: API.del doesn't support body — use post workaround:
      const { csrfToken } = await fetch("/api/csrf-token", { credentials: "include" }).then((r) => r.json());
      const res = await fetch("/api/retention/hard-delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        credentials: "include",
        body: JSON.stringify({ confirm: "DELETE", older_than_months: Number(months) }),
      });
      const data = await res.json();
      if (!res.ok) { showAlert(data.error || "Delete failed."); return; }
      showAlert(`Permanently deleted ${data.deleted} orders.`, "warning");
      loadArchived();
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function showAlert(msg, type = "danger") {
    alertBox.textContent = msg;
    alertBox.className   = `alert alert-${type}`;
    setTimeout(() => { alertBox.className = "alert d-none"; }, 6000);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
})();
