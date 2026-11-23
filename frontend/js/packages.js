/**
 * packages.js — Test packages page logic.
 */
(function () {
  const modalEl    = document.getElementById("pkgModal");
  const bsModal    = new bootstrap.Modal(modalEl);
  const alertBox   = document.getElementById("alertBox");
  const modalAlert = document.getElementById("modalAlert");
  const tbody      = document.getElementById("pkgTbody");

  let _allTests    = [];   // full test list for the "add test" dropdown

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    const me = await API.get("/api/auth/me").catch(() => null);
    if (!me) { location.href = "/"; return; }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    _allTests = await API.get("/api/tests?active_only=true");

    loadPackages();
  })();

  // ── Load packages ─────────────────────────────────────────────────────
  async function loadPackages() {
    try {
      const rows = await API.get("/api/packages");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">No packages found.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((p) => `
        <tr>
          <td><strong>${esc(p.code)}</strong></td>
          <td>${esc(p.name)}</td>
          <td>₹${Number(p.price).toFixed(2)}</td>
          <td>${p.test_count} test(s)</td>
          <td><span class="badge bg-${p.is_active ? "success" : "secondary"}">${p.is_active ? "Active" : "Inactive"}</span></td>
          <td>
            <button class="btn btn-sm btn-outline-primary" onclick="editPackage(${p.id})">Edit</button>
          </td>
        </tr>
      `).join("");
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Open "Add" modal ──────────────────────────────────────────────────
  document.getElementById("addPkgBtn").addEventListener("click", () => {
    document.getElementById("pkgId").value    = "";
    document.getElementById("pkgCode").value  = "";
    document.getElementById("pkgName").value  = "";
    document.getElementById("pkgPrice").value = "0";
    document.getElementById("pkgDesc").value  = "";
    document.getElementById("pkgTestsSection").classList.add("d-none");
    modalAlert.className = "alert d-none";
  });

  // ── Save package ──────────────────────────────────────────────────────
  document.getElementById("savePkgBtn").addEventListener("click", async () => {
    const id = document.getElementById("pkgId").value;
    const payload = {
      code:        document.getElementById("pkgCode").value.trim(),
      name:        document.getElementById("pkgName").value.trim(),
      description: document.getElementById("pkgDesc").value.trim(),
      price:       Number(document.getElementById("pkgPrice").value),
    };

    if (!payload.code || !payload.name) {
      modalAlert.textContent = "Code and Name are required.";
      modalAlert.className   = "alert alert-danger";
      return;
    }

    try {
      let saved;
      if (id) {
        saved = await API.put(`/api/packages/${id}`, payload);
      } else {
        saved = await API.post("/api/packages", payload);
        // After create, reload modal in edit mode so user can add tests
        document.getElementById("pkgId").value = saved.id;
        document.getElementById("pkgModalTitle").textContent = "Edit Package";
      }
      showAlert("Package saved.", "success");
      loadPackages();
      await openTestsSection(saved.id || id);
    } catch (err) {
      modalAlert.textContent = err.message;
      modalAlert.className   = "alert alert-danger";
    }
  });

  // ── Edit package ──────────────────────────────────────────────────────
  window.editPackage = async (id) => {
    try {
      const p = await API.get(`/api/packages/${id}`);
      document.getElementById("pkgModalTitle").textContent = "Edit Package";
      document.getElementById("pkgId").value    = p.id;
      document.getElementById("pkgCode").value  = p.code;
      document.getElementById("pkgName").value  = p.name;
      document.getElementById("pkgPrice").value = p.price;
      document.getElementById("pkgDesc").value  = p.description || "";
      modalAlert.className = "alert d-none";
      await openTestsSection(id, p.tests);
      bsModal.show();
    } catch (err) {
      showAlert(err.message);
    }
  };

  // ── Tests section inside package modal ────────────────────────────────
  async function openTestsSection(pkgId, tests) {
    document.getElementById("pkgTestsSection").classList.remove("d-none");

    if (!tests) {
      const p = await API.get(`/api/packages/${pkgId}`);
      tests = p.tests;
    }

    renderTestList(pkgId, tests);

    // Populate add-test dropdown (exclude already-added)
    const addedIds = new Set(tests.map((t) => t.id));
    const sel = document.getElementById("addTestSel");
    sel.innerHTML = `<option value="">— add a test —</option>`;
    _allTests
      .filter((t) => !addedIds.has(t.id))
      .forEach((t) => {
        sel.innerHTML += `<option value="${t.id}">${esc(t.code)} — ${esc(t.name)}</option>`;
      });
  }

  function renderTestList(pkgId, tests) {
    const list = document.getElementById("pkgTestList");
    if (!tests.length) {
      list.innerHTML = `<li class="list-group-item text-muted small">No tests yet.</li>`;
      return;
    }
    list.innerHTML = tests.map((t) => `
      <li class="list-group-item d-flex justify-content-between align-items-center small">
        <span><strong>${esc(t.code)}</strong> — ${esc(t.name)} (₹${Number(t.price).toFixed(2)})</span>
        <button class="btn btn-xs btn-sm btn-outline-danger"
          onclick="removeTestFromPkg(${pkgId},${t.id})">×</button>
      </li>
    `).join("");
  }

  document.getElementById("addTestToPkgBtn").addEventListener("click", async () => {
    const pkgId  = document.getElementById("pkgId").value;
    const testId = document.getElementById("addTestSel").value;
    if (!pkgId || !testId) return;
    try {
      await API.post(`/api/packages/${pkgId}/tests`, { test_id: Number(testId) });
      const p = await API.get(`/api/packages/${pkgId}`);
      await openTestsSection(pkgId, p.tests);
      loadPackages();
    } catch (err) {
      modalAlert.textContent = err.message;
      modalAlert.className   = "alert alert-danger";
    }
  });

  window.removeTestFromPkg = async (pkgId, testId) => {
    if (!confirm("Remove this test from the package?")) return;
    try {
      await API.del(`/api/packages/${pkgId}/tests/${testId}`);
      const p = await API.get(`/api/packages/${pkgId}`);
      await openTestsSection(pkgId, p.tests);
      loadPackages();
    } catch (err) {
      showAlert(err.message);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  function showAlert(msg, type = "danger") {
    alertBox.textContent = msg;
    alertBox.className   = `alert alert-${type}`;
    setTimeout(() => { alertBox.className = "alert d-none"; }, 4000);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
})();
