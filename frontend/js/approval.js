/**
 * approval.js — Pathologist approval queue page.
 */
(function () {
  const alertBox    = document.getElementById("alertBox");
  const tbody       = document.getElementById("pendingTbody");
  const reviewModal = new bootstrap.Modal(document.getElementById("reviewModal"));

  let _currentOrderId = null;
  let _me = null;

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    _me = await API.get("/api/auth/me").catch(() => null);
    if (!_me) { location.href = "/"; return; }

    // Guard: only pathologist / admin / branch_manager see this page
    if (!["admin", "pathologist", "branch_manager"].includes(_me.role)) {
      location.href = "/dashboard.html";
      return;
    }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    document.getElementById("refreshBtn").addEventListener("click", loadPending);

    // Show signature card only for pathologist/admin
    if (_me.role === "pathologist" || _me.role === "admin") {
      loadSignaturePreview();
    } else {
      document.getElementById("sigCard").style.display = "none";
    }

    loadPending();
  })();

  // ── Load pending orders ───────────────────────────────────────────────
  async function loadPending() {
    try {
      const rows = await API.get("/api/approval/pending");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No orders pending approval.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((o) => `
        <tr>
          <td><code>${esc(o.order_no)}</code></td>
          <td>${esc(o.patient_name)}<br><small class="text-muted">${esc(o.patient_uid)}</small></td>
          <td>${esc(o.patient_phone)}</td>
          <td>${new Date(o.created_at).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary" onclick="reviewOrder(${o.id})">Review</button>
          </td>
        </tr>
      `).join("");
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Open review modal ─────────────────────────────────────────────────
  window.reviewOrder = async (orderId) => {
    _currentOrderId = orderId;
    document.getElementById("remarksTxt").value = "";
    document.getElementById("reviewAlert").className = "alert d-none";

    try {
      const [order, results] = await Promise.all([
        API.get(`/api/orders/${orderId}`),
        API.get(`/api/results/order/${orderId}`),
      ]);

      document.getElementById("reviewTitle").textContent =
        `Review — ${order.order_no}`;
      document.getElementById("reviewPatientInfo").innerHTML =
        `<strong>${esc(order.patient_name)}</strong> (${esc(order.patient_uid)})` +
        ` &nbsp;|&nbsp; ${order.patient_gender === "M" ? "Male" : order.patient_gender === "F" ? "Female" : "Other"}` +
        ` &nbsp;|&nbsp; ${order.patient_phone || ""}`;

      document.getElementById("reviewTbody").innerHTML = results.map((r) => {
        const flagClass = `flag-${r.flag || "N"}`;
        return `<tr>
          <td>${esc(r.name)}</td>
          <td>${esc(r.value || "—")}</td>
          <td>${esc(r.unit || "—")}</td>
          <td>—</td>
          <td><span class="${flagClass}">${r.flag || "—"}</span></td>
          <td>${esc(r.technician_notes || "")}</td>
        </tr>`;
      }).join("");

      reviewModal.show();
    } catch (err) {
      showAlert(err.message);
    }
  };

  // ── Approve ───────────────────────────────────────────────────────────
  document.getElementById("approveBtn").addEventListener("click", async () => {
    if (!_currentOrderId) return;
    const remarks = document.getElementById("remarksTxt").value.trim();
    try {
      const report = await API.post(`/api/approval/${_currentOrderId}/approve`, { remarks });
      reviewModal.hide();
      showAlert(`✓ Approved — Report ${report.report_no} generated.`, "success");
      loadPending();
    } catch (err) {
      document.getElementById("reviewAlert").textContent = err.message;
      document.getElementById("reviewAlert").className = "alert alert-danger";
    }
  });

  // ── Reject ────────────────────────────────────────────────────────────
  document.getElementById("rejectBtn").addEventListener("click", async () => {
    if (!_currentOrderId) return;
    const remarks = document.getElementById("remarksTxt").value.trim();
    if (!remarks) {
      document.getElementById("reviewAlert").textContent = "Please provide a reason for rejection.";
      document.getElementById("reviewAlert").className = "alert alert-warning";
      return;
    }
    try {
      await API.post(`/api/approval/${_currentOrderId}/reject`, { remarks });
      reviewModal.hide();
      showAlert("Order rejected — results returned to technician.", "warning");
      loadPending();
    } catch (err) {
      document.getElementById("reviewAlert").textContent = err.message;
      document.getElementById("reviewAlert").className = "alert alert-danger";
    }
  });

  // ── Signature upload ──────────────────────────────────────────────────
  document.getElementById("uploadSigBtn").addEventListener("click", async () => {
    const fileInput = document.getElementById("sigInput");
    if (!fileInput.files[0]) { showAlert("Select an image file first.", "warning"); return; }

    const { csrfToken } = await fetch("/api/csrf-token", { credentials: "include" }).then((r) => r.json());
    const form = new FormData();
    form.append("signature", fileInput.files[0]);

    const res = await fetch("/api/approval/signature", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      credentials: "include",
      body: form,
    });
    const data = await res.json();

    if (!res.ok) { showAlert(data.error || "Upload failed."); return; }
    showAlert("Signature saved.", "success");
    loadSignaturePreview();
  });

  async function loadSignaturePreview() {
    if (!_me) return;
    const res = await fetch(`/api/approval/signature/${_me.id}`, { credentials: "include" });
    if (res.ok) {
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const img  = document.getElementById("sigPreview");
      img.src    = url;
      img.style.display = "";
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
