/**
 * users.js — User management page logic.
 * Requires /js/api.js to be loaded first.
 */
(function () {
  const modalEl    = document.getElementById("userModal");
  const bsModal    = new bootstrap.Modal(modalEl);
  const alertBox   = document.getElementById("alertBox");
  const modalAlert = document.getElementById("modalAlert");
  const tbody      = document.getElementById("userTbody");

  let _me       = null;
  let _branches = [];

  // ── Boot: auth check → load data ──────────────────────────────────────
  (async () => {
    _me = await API.get("/api/auth/me").catch(() => null);
    if (!_me) { location.href = "/"; return; }

    // Only admin and branch_manager may see this page
    if (!["admin", "branch_manager"].includes(_me.role)) {
      location.href = "/dashboard.html";
      return;
    }

    _branches = await API.get("/api/branches").catch(() => []);

    // Populate branch dropdown
    const branchSel = document.getElementById("userBranch");
    _branches.forEach((b) => {
      const opt = document.createElement("option");
      opt.value       = b.id;
      opt.textContent = b.name;
      branchSel.appendChild(opt);
    });

    // Branch managers cannot change the branch of a user
    if (_me.role === "branch_manager") {
      document.getElementById("branchGroup").style.display = "none";
    }

    loadUsers();
  })();

  // Logout
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await API.post("/api/auth/logout", {});
    location.href = "/";
  });

  // ── Load users ─────────────────────────────────────────────────────────
  async function loadUsers() {
    try {
      const rows = await API.get("/api/users");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No users found.</td></tr>`;
        return;
      }

      const branchMap = Object.fromEntries(_branches.map((b) => [b.id, b.name]));

      tbody.innerHTML = rows.map((u) => `
        <tr>
          <td>${u.id}</td>
          <td>${esc(u.full_name)}</td>
          <td>${esc(u.email)}</td>
          <td><span class="badge bg-secondary">${esc(u.role)}</span></td>
          <td>${esc(branchMap[u.branch_id] || "All branches")}</td>
          <td>
            <span class="badge bg-${u.is_active ? "success" : "secondary"}">
              ${u.is_active ? "Active" : "Inactive"}
            </span>
          </td>
          <td>
            <button class="btn btn-sm btn-outline-primary" onclick="editUser(${u.id})">Edit</button>
            ${u.is_active && _me.role === "admin"
              ? `<button class="btn btn-sm btn-outline-danger ms-1" onclick="deactivateUser(${u.id})">Deactivate</button>`
              : ""}
          </td>
        </tr>
      `).join("");
    } catch (err) {
      showAlert(err.message, "danger");
    }
  }

  // ── Open "Add" modal ────────────────────────────────────────────────────
  document.getElementById("addUserBtn").addEventListener("click", () => {
    document.getElementById("userModalTitle").textContent = "New User";
    document.getElementById("userId").value       = "";
    document.getElementById("userName").value     = "";
    document.getElementById("userEmail").value    = "";
    document.getElementById("userPassword").value = "";
    document.getElementById("userRole").value     = "receptionist";
    document.getElementById("userPhone").value    = "";
    document.getElementById("userBranch").value   = "";
    document.getElementById("passwordGroup").style.display = "";
    modalAlert.className = "alert d-none";
  });

  // ── Save user ───────────────────────────────────────────────────────────
  document.getElementById("saveUserBtn").addEventListener("click", async () => {
    const id       = document.getElementById("userId").value;
    const payload  = {
      full_name: document.getElementById("userName").value.trim(),
      email:     document.getElementById("userEmail").value.trim(),
      role:      document.getElementById("userRole").value,
      phone:     document.getElementById("userPhone").value.trim(),
      branch_id: Number(document.getElementById("userBranch").value) || undefined,
    };

    if (!id) {
      payload.password = document.getElementById("userPassword").value;
    }

    if (!payload.full_name || !payload.email || !payload.role) {
      modalAlert.textContent = "Name, email, and role are required.";
      modalAlert.className = "alert alert-danger";
      return;
    }

    try {
      if (id) {
        await API.put(`/api/users/${id}`, payload);
      } else {
        await API.post("/api/users", payload);
      }
      bsModal.hide();
      showAlert("User saved.", "success");
      loadUsers();
    } catch (err) {
      modalAlert.textContent = err.message;
      modalAlert.className = "alert alert-danger";
    }
  });

  // ── Edit user ───────────────────────────────────────────────────────────
  window.editUser = async (id) => {
    try {
      const u = await API.get(`/api/users/${id}`);
      document.getElementById("userModalTitle").textContent = "Edit User";
      document.getElementById("userId").value     = u.id;
      document.getElementById("userName").value   = u.full_name;
      document.getElementById("userEmail").value  = u.email;
      document.getElementById("userRole").value   = u.role;
      document.getElementById("userPhone").value  = u.phone || "";
      document.getElementById("userBranch").value = u.branch_id || "";
      // Hide password field on edit (use change-password endpoint separately)
      document.getElementById("passwordGroup").style.display = "none";
      modalAlert.className = "alert d-none";
      bsModal.show();
    } catch (err) {
      showAlert(err.message, "danger");
    }
  };

  // ── Deactivate ──────────────────────────────────────────────────────────
  window.deactivateUser = async (id) => {
    if (!confirm("Deactivate this user?")) return;
    try {
      await API.del(`/api/users/${id}`);
      showAlert("User deactivated.", "warning");
      loadUsers();
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

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
