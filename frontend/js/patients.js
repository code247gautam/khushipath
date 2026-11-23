/**
 * patients.js — Patient list, registration, edit, quick order history.
 */
(function () {
  const modalEl    = document.getElementById("patientModal");
  const bsModal    = new bootstrap.Modal(modalEl);
  const alertBox   = document.getElementById("alertBox");
  const modalAlert = document.getElementById("modalAlert");
  const tbody      = document.getElementById("patientTbody");
  const searchInput = document.getElementById("searchInput");

  let _searchTimer = null;
  let _me = null;

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    _me = await API.get("/api/auth/me").catch(() => null);
    if (!_me) { location.href = "/"; return; }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    loadPatients();
  })();

  // ── Search ────────────────────────────────────────────────────────────
  searchInput.addEventListener("input", () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(loadPatients, 300);
  });

  // ── Load patient list ─────────────────────────────────────────────────
  async function loadPatients() {
    const params = new URLSearchParams();
    if (searchInput.value) params.set("search", searchInput.value);

    try {
      const rows = await API.get(`/api/patients?${params}`);
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">No patients found.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((p) => `
        <tr>
          <td><code>${esc(p.patient_uid)}</code></td>
          <td>${esc(p.full_name)}</td>
          <td>${p.gender === "M" ? "Male" : p.gender === "F" ? "Female" : "Other"}</td>
          <td>${esc(p.phone)}</td>
          <td>${esc(p.referring_doctor || "—")}</td>
          <td>${new Date(p.created_at).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary" onclick="editPatient(${p.id})">Edit</button>
            <a href="/orders.html?patient_id=${p.id}" class="btn btn-sm btn-outline-success ms-1">Orders</a>
          </td>
        </tr>
      `).join("");
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Open "Register" modal ─────────────────────────────────────────────
  document.getElementById("addPatientBtn").addEventListener("click", () => {
    document.getElementById("patientModalTitle").textContent = "Register Patient";
    document.getElementById("patientId").value  = "";
    document.getElementById("pName").value      = "";
    document.getElementById("pGender").value    = "M";
    document.getElementById("pDOB").value       = "";
    document.getElementById("pAge").value       = "";
    document.getElementById("pPhone").value     = "";
    document.getElementById("pEmail").value     = "";
    document.getElementById("pAddress").value   = "";
    document.getElementById("pDoctor").value    = "";
    document.getElementById("pNotes").value     = "";
    document.getElementById("orderHistorySection").classList.add("d-none");
    document.getElementById("newOrderBtn").style.display = "none";
    modalAlert.className = "alert d-none";
  });

  // ── Save patient ──────────────────────────────────────────────────────
  document.getElementById("savePatientBtn").addEventListener("click", async () => {
    const id = document.getElementById("patientId").value;
    const payload = {
      full_name:        document.getElementById("pName").value.trim(),
      gender:           document.getElementById("pGender").value,
      date_of_birth:    document.getElementById("pDOB").value   || null,
      age_years:        document.getElementById("pAge").value   || null,
      phone:            document.getElementById("pPhone").value.trim(),
      email:            document.getElementById("pEmail").value.trim(),
      address:          document.getElementById("pAddress").value.trim(),
      referring_doctor: document.getElementById("pDoctor").value.trim(),
      notes:            document.getElementById("pNotes").value.trim(),
    };

    if (!payload.full_name || !payload.phone) {
      modalAlert.textContent = "Full name and phone are required.";
      modalAlert.className   = "alert alert-danger";
      return;
    }

    try {
      let saved;
      if (id) {
        saved = await API.put(`/api/patients/${id}`, payload);
      } else {
        saved = await API.post("/api/patients", payload);
      }
      showAlert(id ? "Patient updated." : `Patient registered — ID: ${saved.patient_uid}`, "success");
      bsModal.hide();
      loadPatients();
    } catch (err) {
      modalAlert.textContent = err.message;
      modalAlert.className   = "alert alert-danger";
    }
  });

  // ── Edit patient ──────────────────────────────────────────────────────
  window.editPatient = async (id) => {
    try {
      const p = await API.get(`/api/patients/${id}`);
      document.getElementById("patientModalTitle").textContent = `Edit — ${p.patient_uid}`;
      document.getElementById("patientId").value  = p.id;
      document.getElementById("pName").value      = p.full_name;
      document.getElementById("pGender").value    = p.gender;
      document.getElementById("pDOB").value       = p.date_of_birth ? p.date_of_birth.slice(0, 10) : "";
      document.getElementById("pAge").value       = p.age_years || "";
      document.getElementById("pPhone").value     = p.phone;
      document.getElementById("pEmail").value     = p.email || "";
      document.getElementById("pAddress").value   = p.address || "";
      document.getElementById("pDoctor").value    = p.referring_doctor || "";
      document.getElementById("pNotes").value     = p.notes || "";
      modalAlert.className = "alert d-none";

      // Show order history
      const oh = document.getElementById("orderHistorySection");
      oh.classList.remove("d-none");
      const histTbody = document.getElementById("orderHistoryTbody");
      if (p.orders && p.orders.length) {
        histTbody.innerHTML = p.orders.map((o) => `
          <tr>
            <td><code>${esc(o.order_no)}</code></td>
            <td><span class="badge bg-secondary">${esc(o.sample_status)}</span></td>
            <td>${new Date(o.created_at).toLocaleDateString()}</td>
            <td><a href="/orders.html?order_id=${o.id}" class="btn btn-xs btn-sm btn-outline-primary">View</a></td>
          </tr>
        `).join("");
      } else {
        histTbody.innerHTML = `<tr><td colspan="4" class="text-muted text-center small">No orders yet.</td></tr>`;
      }

      // "New Order" shortcut
      const newOrderBtn = document.getElementById("newOrderBtn");
      newOrderBtn.style.display = "";
      newOrderBtn.onclick = () => {
        bsModal.hide();
        location.href = `/orders.html?patient_id=${id}`;
      };

      bsModal.show();
    } catch (err) {
      showAlert(err.message);
    }
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
