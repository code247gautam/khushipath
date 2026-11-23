/**
 * orders.js — Order list, create, status update, view items.
 * Supports URL params: ?patient_id=N (pre-fills patient), ?order_id=N (auto-opens detail)
 */
(function () {
  const alertBox    = document.getElementById("alertBox");
  const modalAlert  = document.getElementById("modalAlert");
  const orderTbody  = document.getElementById("orderTbody");
  const bsOrderModal = new bootstrap.Modal(document.getElementById("orderModal"));
  const bsDetailModal = new bootstrap.Modal(document.getElementById("orderDetailModal"));

  const params = new URLSearchParams(location.search);

  // Selected items for the new-order form
  let _selectedTests    = new Map(); // test_id → {code, name, price}
  let _selectedPackages = new Map(); // pkg_id  → {code, name, price}
  let _allTests         = [];
  let _allPackages      = [];

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    const me = await API.get("/api/auth/me").catch(() => null);
    if (!me) { location.href = "/"; return; }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    // Populate selects
    [_allTests, _allPackages] = await Promise.all([
      API.get("/api/tests?active_only=true"),
      API.get("/api/packages"),
    ]);

    _allTests.forEach((t) => {
      document.getElementById("testSelect").innerHTML +=
        `<option value="${t.id}">${esc(t.code)} — ${esc(t.name)} (₹${Number(t.price).toFixed(2)})</option>`;
    });
    _allPackages.forEach((p) => {
      document.getElementById("pkgSelect").innerHTML +=
        `<option value="${p.id}">${esc(p.code)} — ${esc(p.name)} (₹${Number(p.price).toFixed(2)})</option>`;
    });

    // If patient_id in URL, pre-select that patient
    if (params.get("patient_id")) {
      await preselectPatient(Number(params.get("patient_id")));
    }

    // If order_id in URL, auto-open detail
    if (params.get("order_id")) {
      await openDetail(Number(params.get("order_id")));
    }

    loadOrders();
    setupFilters();
  })();

  // ── Filters ───────────────────────────────────────────────────────────
  function setupFilters() {
    let t;
    document.getElementById("searchInput").addEventListener("input", () => {
      clearTimeout(t); t = setTimeout(loadOrders, 300);
    });
    document.getElementById("statusFilter").addEventListener("change", loadOrders);
  }

  // ── Load orders ───────────────────────────────────────────────────────
  async function loadOrders() {
    const q = new URLSearchParams();
    const search = document.getElementById("searchInput").value;
    const status = document.getElementById("statusFilter").value;
    if (search) q.set("search", search);
    if (status) q.set("status", status);
    if (params.get("patient_id")) q.set("patient_id", params.get("patient_id"));

    try {
      const rows = await API.get(`/api/orders?${q}`);
      if (!rows.length) {
        orderTbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">No orders found.</td></tr>`;
        return;
      }
      orderTbody.innerHTML = rows.map((o) => `
        <tr>
          <td><code>${esc(o.order_no)}</code></td>
          <td>${esc(o.patient_name)}<br><small class="text-muted">${esc(o.patient_uid)}</small></td>
          <td>${esc(o.patient_phone)}</td>
          <td>—</td>
          <td><span class="badge badge-${o.sample_status} bg-secondary">${esc(o.sample_status)}</span></td>
          <td>${new Date(o.created_at).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary" onclick="openDetail(${o.id})">View</button>
            <a href="/results.html?order_id=${o.id}" class="btn btn-sm btn-outline-success ms-1">Results</a>
          </td>
        </tr>
      `).join("");
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Patient search inside new-order modal ─────────────────────────────
  document.getElementById("patientSearchBtn").addEventListener("click", searchPatient);
  document.getElementById("patientSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchPatient();
  });

  async function searchPatient() {
    const q = document.getElementById("patientSearch").value.trim();
    if (!q) return;
    const rows = await API.get(`/api/patients?search=${encodeURIComponent(q)}&limit=10`);
    const container = document.getElementById("patientResults");
    if (!rows.length) { container.innerHTML = `<div class="list-group-item text-muted small">No patients found.</div>`; return; }
    container.innerHTML = rows.map((p) => `
      <button type="button" class="list-group-item list-group-item-action small"
        onclick="selectPatient(${p.id},'${esc(p.patient_uid)}','${esc(p.full_name)}','${esc(p.phone)}')">
        <strong>${esc(p.patient_uid)}</strong> — ${esc(p.full_name)} (${esc(p.phone)})
      </button>
    `).join("");
  }

  window.selectPatient = (id, uid, name, phone) => {
    document.getElementById("selectedPatientId").value = id;
    document.getElementById("selectedPatient").textContent = `✓ ${uid} — ${name} (${phone})`;
    document.getElementById("selectedPatient").classList.remove("d-none");
    document.getElementById("patientResults").innerHTML = "";
  };

  async function preselectPatient(id) {
    const p = await API.get(`/api/patients/${id}`).catch(() => null);
    if (p) window.selectPatient(p.id, p.patient_uid, p.full_name, p.phone);
  }

  // ── Add test / package to order form ──────────────────────────────────
  document.getElementById("addTestToOrderBtn").addEventListener("click", () => {
    const sel = document.getElementById("testSelect");
    const id  = Number(sel.value);
    if (!id) return;
    const t = _allTests.find((t) => t.id === id);
    if (t && !_selectedTests.has(id)) {
      _selectedTests.set(id, t);
      renderSelectedTests();
    }
    sel.value = "";
  });

  document.getElementById("addPkgToOrderBtn").addEventListener("click", () => {
    const sel = document.getElementById("pkgSelect");
    const id  = Number(sel.value);
    if (!id) return;
    const p = _allPackages.find((p) => p.id === id);
    if (p && !_selectedPackages.has(id)) {
      _selectedPackages.set(id, p);
      renderSelectedTests();
    }
    sel.value = "";
  });

  function renderSelectedTests() {
    const list = document.getElementById("selectedTestsList");
    const items = [];
    _selectedTests.forEach((t, id) =>
      items.push(`<li class="list-group-item d-flex justify-content-between small">
        <span class="text-primary fw-semibold">[T]</span> ${esc(t.code)} — ${esc(t.name)} (₹${Number(t.price).toFixed(2)})
        <button class="btn btn-xs btn-sm btn-link text-danger p-0" onclick="removeOrderItem('test',${id})">×</button>
      </li>`)
    );
    _selectedPackages.forEach((p, id) =>
      items.push(`<li class="list-group-item d-flex justify-content-between small">
        <span class="text-success fw-semibold">[P]</span> ${esc(p.code)} — ${esc(p.name)} (₹${Number(p.price).toFixed(2)})
        <button class="btn btn-xs btn-sm btn-link text-danger p-0" onclick="removeOrderItem('pkg',${id})">×</button>
      </li>`)
    );
    list.innerHTML = items.join("");
  }

  window.removeOrderItem = (type, id) => {
    if (type === "test") _selectedTests.delete(id);
    else _selectedPackages.delete(id);
    renderSelectedTests();
  };

  // ── Save new order ────────────────────────────────────────────────────
  document.getElementById("saveOrderBtn").addEventListener("click", async () => {
    const patientId = Number(document.getElementById("selectedPatientId").value);
    if (!patientId) {
      modalAlert.textContent = "Please select a patient.";
      modalAlert.className   = "alert alert-danger";
      return;
    }
    if (!_selectedTests.size && !_selectedPackages.size) {
      modalAlert.textContent = "Add at least one test or package.";
      modalAlert.className   = "alert alert-danger";
      return;
    }

    const payload = {
      patient_id:       patientId,
      test_ids:         [..._selectedTests.keys()],
      package_ids:      [..._selectedPackages.keys()],
      referring_doctor: document.getElementById("oDoctor").value.trim(),
      clinical_notes:   document.getElementById("oClinical").value.trim(),
    };

    try {
      const order = await API.post("/api/orders", payload);
      bsOrderModal.hide();
      showAlert(`Order ${order.order_no} created.`, "success");
      _selectedTests.clear();
      _selectedPackages.clear();
      loadOrders();
    } catch (err) {
      modalAlert.textContent = err.message;
      modalAlert.className   = "alert alert-danger";
    }
  });

  // ── Reset modal on open ───────────────────────────────────────────────
  document.getElementById("addOrderBtn").addEventListener("click", () => {
    document.getElementById("selectedPatientId").value = "";
    document.getElementById("selectedPatient").classList.add("d-none");
    document.getElementById("patientResults").innerHTML = "";
    document.getElementById("patientSearch").value = "";
    document.getElementById("selectedTestsList").innerHTML = "";
    _selectedTests.clear();
    _selectedPackages.clear();
    modalAlert.className = "alert d-none";
    if (params.get("patient_id")) preselectPatient(Number(params.get("patient_id")));
  });

  // ── Order detail ──────────────────────────────────────────────────────
  window.openDetail = async (id) => {
    try {
      const o = await API.get(`/api/orders/${id}`);
      document.getElementById("detailTitle").textContent = `Order ${o.order_no}`;
      document.getElementById("detailInfo").innerHTML =
        `Patient: <strong>${esc(o.patient_name)}</strong> (${esc(o.patient_uid)}) &nbsp;|&nbsp; ` +
        `Collected: ${o.collected_at ? new Date(o.collected_at).toLocaleString() : "—"}`;

      document.getElementById("statusSelect").value = o.sample_status;

      document.getElementById("detailItemsTbody").innerHTML = o.items.map((item) => {
        const flagClass = `flag-${item.flag || "N"}`;
        return `<tr>
          <td>${esc(item.code)}</td>
          <td>${esc(item.name)}</td>
          <td>₹${Number(item.price_at_order).toFixed(2)}</td>
          <td>${item.value ? esc(item.value) : '<span class="text-muted">—</span>'}</td>
          <td><span class="${flagClass}">${item.flag || "—"}</span></td>
        </tr>`;
      }).join("");

      document.getElementById("updateStatusBtn").onclick = () => updateStatus(o.id);
      document.getElementById("goToResultsBtn").href     = `/results.html?order_id=${o.id}`;

      bsDetailModal.show();
    } catch (err) {
      showAlert(err.message);
    }
  };

  async function updateStatus(orderId) {
    const status = document.getElementById("statusSelect").value;
    try {
      await API.put(`/api/orders/${orderId}/status`, { status });
      showAlert("Status updated.", "success");
      bsDetailModal.hide();
      loadOrders();
    } catch (err) {
      showAlert(err.message);
    }
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
