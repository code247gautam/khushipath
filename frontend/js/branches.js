/**
 * branches.js — Branch management page logic.
 * Requires /js/api.js to be loaded first.
 */
(function () {
  // ── Bootstrap modal instance ────────────────────────────────────────────
  const modalEl    = document.getElementById("branchModal");
  const bsModal    = new bootstrap.Modal(modalEl);
  const alertBox   = document.getElementById("alertBox");
  const modalAlert = document.getElementById("modalAlert");
  const tbody      = document.getElementById("branchTbody");

  // ── Auth guard ─────────────────────────────────────────────────────────
  API.get("/api/auth/me").catch(() => { location.href = "/"; });

  // Logout
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await API.post("/api/auth/logout", {});
    location.href = "/";
  });

  // ── Load branches ───────────────────────────────────────────────────────
  async function loadBranches() {
    try {
      const rows = await API.get("/api/branches");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No branches found.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((b) => `
        <tr>
          <td>${b.id}</td>
          <td>${esc(b.name)}</td>
          <td>${esc(b.phone || "—")}</td>
          <td>${esc(b.email || "—")}</td>
          <td>
            <span class="badge bg-${b.is_active ? "success" : "secondary"}">
              ${b.is_active ? "Active" : "Inactive"}
            </span>
          </td>
          <td>
            <button class="btn btn-xs btn-outline-primary btn-sm" onclick="editBranch(${b.id})">Edit</button>
            ${b.is_active
              ? `<button class="btn btn-xs btn-outline-danger btn-sm ms-1" onclick="deactivateBranch(${b.id})">Deactivate</button>`
              : ""}
          </td>
        </tr>
      `).join("");
    } catch (err) {
      showAlert(err.message, "danger");
    }
  }

  loadBranches();

  // ── Open "Add" modal ────────────────────────────────────────────────────
  document.getElementById("addBranchBtn").addEventListener("click", () => {
    document.getElementById("branchModalTitle").textContent = "New Branch";
    document.getElementById("branchId").value      = "";
    document.getElementById("branchName").value    = "";
    document.getElementById("branchAddress").value = "";
    document.getElementById("branchPhone").value   = "";
    document.getElementById("branchEmail").value   = "";
    modalAlert.className = "alert d-none";
  });

  // ── Save branch ─────────────────────────────────────────────────────────
  document.getElementById("saveBranchBtn").addEventListener("click", async () => {
    const id      = document.getElementById("branchId").value;
    const payload = {
      name:    document.getElementById("branchName").value.trim(),
      address: document.getElementById("branchAddress").value.trim(),
      phone:   document.getElementById("branchPhone").value.trim(),
      email:   document.getElementById("branchEmail").value.trim(),
    };

    if (!payload.name) {
      modalAlert.textContent = "Branch name is required.";
      modalAlert.className = "alert alert-danger";
      return;
    }

    try {
      if (id) {
        await API.put(`/api/branches/${id}`, payload);
      } else {
        await API.post("/api/branches", payload);
      }
      bsModal.hide();
      showAlert("Branch saved successfully.", "success");
      loadBranches();
    } catch (err) {
      modalAlert.textContent = err.message;
      modalAlert.className = "alert alert-danger";
    }
  });

  // ── Edit branch (exposed globally for inline onclick) ───────────────────
  window.editBranch = async (id) => {
    try {
      const b = await API.get(`/api/branches/${id}`);
      document.getElementById("branchModalTitle").textContent = "Edit Branch";
      document.getElementById("branchId").value      = b.id;
      document.getElementById("branchName").value    = b.name;
      document.getElementById("branchAddress").value = b.address || "";
      document.getElementById("branchPhone").value   = b.phone   || "";
      document.getElementById("branchEmail").value   = b.email   || "";
      modalAlert.className = "alert d-none";
      bsModal.show();
    } catch (err) {
      showAlert(err.message, "danger");
    }
  };

  // ── Deactivate branch ───────────────────────────────────────────────────
  window.deactivateBranch = async (id) => {
    if (!confirm("Deactivate this branch?")) return;
    try {
      await API.del(`/api/branches/${id}`);
      showAlert("Branch deactivated.", "warning");
      loadBranches();
    } catch (err) {
      showAlert(err.message, "danger");
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────
  function showAlert(msg, type = "danger") {
    alertBox.textContent = msg;
    alertBox.className = `alert alert-${type}`;
    setTimeout(() => { alertBox.className = "alert d-none"; }, 4000);
  }

  /** Escape HTML to prevent XSS in table output */
  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
