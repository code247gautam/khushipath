/**
 * billing.js — Invoice management, payments, collection report page logic.
 */
(function () {
  const globalAlert = document.getElementById("globalAlert");
  const invModal    = new bootstrap.Modal(document.getElementById("invoiceModal"));

  let _currentInvId = null;
  let _me = null;

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    _me = await API.get("/api/auth/me").catch(() => null);
    if (!_me) { location.href = "/"; return; }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    // Default collection date = today
    document.getElementById("collDate").value = new Date().toISOString().slice(0, 10);

    // Tab switching
    document.querySelectorAll("#billingTabs .nav-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#billingTabs .nav-link").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll("[id^=tab-]").forEach((el) => el.style.display = "none");
        document.getElementById(`tab-${btn.dataset.tab}`).style.display = "";
        if (btn.dataset.tab === "dues") loadDues();
      });
    });

    // Load defaults
    loadInvoices();

    // Wire buttons
    document.getElementById("invSearchBtn").addEventListener("click",   loadInvoices);
    document.getElementById("refreshDuesBtn").addEventListener("click", loadDues);
    document.getElementById("loadCollectionBtn").addEventListener("click", loadCollection);
    document.getElementById("saveDiscountBtn").addEventListener("click",  saveDiscount);
    document.getElementById("savePaymentBtn").addEventListener("click",   savePayment);

    // Allow Enter in invoice search
    document.getElementById("invSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadInvoices();
    });
  })();

  // ── Invoices ──────────────────────────────────────────────────────────
  async function loadInvoices() {
    const q = new URLSearchParams();
    const search   = document.getElementById("invSearch").value.trim();
    const status   = document.getElementById("invStatus").value;
    const dateFrom = document.getElementById("invDateFrom").value;
    const dateTo   = document.getElementById("invDateTo").value;
    if (search)   q.set("search",    search);
    if (status)   q.set("status",    status);
    if (dateFrom) q.set("date_from", dateFrom);
    if (dateTo)   q.set("date_to",   dateTo);

    try {
      const rows = await API.get(`/api/billing/invoices?${q}`);
      const tbody = document.getElementById("invTbody");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-muted text-center py-3">No invoices found.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((inv) => `
        <tr>
          <td><code>${esc(inv.invoice_no)}</code></td>
          <td>${esc(inv.patient_name)}<br><small class="text-muted">${esc(inv.patient_uid)}</small></td>
          <td><code>${esc(inv.order_no)}</code></td>
          <td>₹${fmt(inv.total_amount)}</td>
          <td>₹${fmt(inv.discount_amount)}</td>
          <td>₹${fmt(inv.paid_amount)}</td>
          <td class="${Number(inv.amount_due) > 0 ? "text-danger fw-semibold" : "text-success"}">
            ₹${fmt(inv.amount_due)}
          </td>
          <td><span class="status-${inv.status}">${esc(inv.status)}</span></td>
          <td>
            <button class="btn btn-xs btn-sm btn-outline-primary" onclick="openInvoice(${inv.id})">Manage</button>
          </td>
        </tr>
      `).join("");
    } catch (err) { showGlobalAlert(err.message); }
  }

  // ── Open invoice modal ────────────────────────────────────────────────
  window.openInvoice = async (id) => {
    _currentInvId = id;
    document.getElementById("invModalAlert").className = "alert d-none";
    document.getElementById("payAmount").value = "";
    document.getElementById("payRef").value    = "";

    try {
      await refreshInvoiceModal(id);
      invModal.show();
    } catch (err) { showGlobalAlert(err.message); }
  };

  async function refreshInvoiceModal(id) {
    const inv = await API.get(`/api/billing/invoices/${id}`);

    document.getElementById("invModalTitle").textContent = `Invoice ${inv.invoice_no}`;
    document.getElementById("invDetailInfo").innerHTML =
      `Patient: <strong>${esc(inv.patient_name)}</strong> (${esc(inv.patient_uid)}) &nbsp;|&nbsp; ` +
      `Order: <code>${esc(inv.order_no)}</code> &nbsp;|&nbsp; Status: <span class="status-${inv.status}">${esc(inv.status)}</span>`;

    document.getElementById("discountInput").value = inv.discount_amount;
    document.getElementById("invNotesInput").value = inv.notes || "";

    // Line items
    document.getElementById("invItemsTbody").innerHTML = inv.items.map((item) => `
      <tr>
        <td><code>${esc(item.code)}</code></td>
        <td>${esc(item.name)}</td>
        <td>₹${fmt(item.price_at_order)}</td>
      </tr>
    `).join("");

    // Balance
    const due = Number(inv.amount_due);
    document.getElementById("balanceSummary").innerHTML = `
      <span>Total: <strong>₹${fmt(inv.total_amount)}</strong></span>
      <span>Discount: <strong>₹${fmt(inv.discount_amount)}</strong></span>
      <span>Paid: <strong class="text-success">₹${fmt(inv.paid_amount)}</strong></span>
      <span>Due: <strong class="${due > 0 ? "text-danger" : "text-success"}">₹${fmt(due)}</strong></span>
    `;

    // Payments
    const ptbody = document.getElementById("paymentsTbody");
    if (!inv.payments.length) {
      ptbody.innerHTML = `<tr><td colspan="6" class="text-muted text-center small py-1">No payments yet.</td></tr>`;
    } else {
      ptbody.innerHTML = inv.payments.map((p) => `
        <tr>
          <td>${new Date(p.paid_at).toLocaleString()}</td>
          <td>₹${fmt(p.amount)}</td>
          <td>${esc(p.payment_method)}</td>
          <td>${esc(p.reference_no || "—")}</td>
          <td>${esc(p.received_by_name || "—")}</td>
          <td>
            ${_me?.role === "admin"
              ? `<button class="btn btn-xs btn-sm btn-link text-danger p-0"
                   onclick="voidPayment(${inv.id},${p.id})">void</button>`
              : ""}
          </td>
        </tr>
      `).join("");
    }

    // Hide payment form for paid/void invoices
    document.getElementById("paymentForm").style.display =
      (inv.status === "paid" || inv.status === "void") ? "none" : "";
    document.getElementById("saveDiscountBtn").disabled =
      (inv.status === "void" || inv.status === "paid");
  }

  // ── Save discount ─────────────────────────────────────────────────────
  async function saveDiscount() {
    const discount = Number(document.getElementById("discountInput").value);
    const notes    = document.getElementById("invNotesInput").value.trim();
    try {
      await API.put(`/api/billing/invoices/${_currentInvId}`, { discount_amount: discount, notes });
      await refreshInvoiceModal(_currentInvId);
      loadInvoices();
    } catch (err) {
      const el = document.getElementById("invModalAlert");
      el.textContent = err.message; el.className = "alert alert-danger";
    }
  }

  // ── Save payment ──────────────────────────────────────────────────────
  async function savePayment() {
    const amount = Number(document.getElementById("payAmount").value);
    const method = document.getElementById("payMethod").value;
    const ref    = document.getElementById("payRef").value.trim();

    if (!amount || amount <= 0) {
      const el = document.getElementById("invModalAlert");
      el.textContent = "Enter a valid payment amount."; el.className = "alert alert-warning";
      return;
    }

    try {
      await API.post(`/api/billing/invoices/${_currentInvId}/pay`, {
        amount, payment_method: method, reference_no: ref,
      });
      await refreshInvoiceModal(_currentInvId);
      loadInvoices();
      document.getElementById("payAmount").value = "";
      document.getElementById("payRef").value    = "";
    } catch (err) {
      const el = document.getElementById("invModalAlert");
      el.textContent = err.message; el.className = "alert alert-danger";
    }
  }

  // ── Void payment ──────────────────────────────────────────────────────
  window.voidPayment = async (invId, payId) => {
    if (!confirm("Void this payment? This will increase the outstanding balance.")) return;
    try {
      await API.del(`/api/billing/invoices/${invId}/payments/${payId}`);
      await refreshInvoiceModal(invId);
      loadInvoices();
    } catch (err) {
      const el = document.getElementById("invModalAlert");
      el.textContent = err.message; el.className = "alert alert-danger";
    }
  };

  // ── Dues ──────────────────────────────────────────────────────────────
  async function loadDues() {
    try {
      const rows = await API.get("/api/billing/dues");
      const tbody = document.getElementById("duesTbody");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-success text-center py-3 small">✓ No outstanding dues.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((inv) => `
        <tr>
          <td><code>${esc(inv.invoice_no)}</code></td>
          <td>${esc(inv.patient_name)}<br><small class="text-muted">${esc(inv.patient_uid)}</small></td>
          <td>₹${fmt(inv.total_amount)}</td>
          <td>₹${fmt(inv.paid_amount)}</td>
          <td class="text-danger fw-semibold">₹${fmt(inv.amount_due)}</td>
          <td><span class="status-${inv.status}">${esc(inv.status)}</span></td>
          <td><button class="btn btn-xs btn-sm btn-outline-success" onclick="openInvoice(${inv.id})">Pay</button></td>
        </tr>
      `).join("");
    } catch (err) { showGlobalAlert(err.message); }
  }

  // ── Daily collection ──────────────────────────────────────────────────
  async function loadCollection() {
    const date = document.getElementById("collDate").value;
    if (!date) { showGlobalAlert("Select a date.", "warning"); return; }

    try {
      const data = await API.get(`/api/billing/collection?date=${date}`);

      // Update CSV link
      const csvBtn = document.getElementById("collCsvBtn");
      csvBtn.href  = `/api/billing/collection/csv?date=${date}`;
      csvBtn.classList.remove("d-none");

      // KPI tiles
      const methods = Object.entries(data.byMethod);
      document.getElementById("collKpis").innerHTML = `
        <div class="col-auto">
          <div class="card px-3 py-2">
            <div class="fw-bold">₹${fmt(data.totalCollected)}</div>
            <div class="text-muted small">Total Collected</div>
          </div>
        </div>
        ${methods.map(([m, v]) => `
          <div class="col-auto">
            <div class="card px-3 py-2">
              <div class="fw-bold">₹${fmt(v)}</div>
              <div class="text-muted small">${esc(m)}</div>
            </div>
          </div>`).join("")}
        <div class="col-auto">
          <div class="card px-3 py-2">
            <div class="fw-bold">${data.payments.length}</div>
            <div class="text-muted small">Transactions</div>
          </div>
        </div>
      `;

      // Transactions table
      document.getElementById("collTbody").innerHTML = !data.payments.length
        ? `<tr><td colspan="7" class="text-muted text-center py-3">No collections for this date.</td></tr>`
        : data.payments.map((p) => `
            <tr>
              <td>${new Date(p.paid_at).toLocaleTimeString()}</td>
              <td><code>${esc(p.invoice_no)}</code></td>
              <td>${esc(p.patient_name)} (${esc(p.patient_uid)})</td>
              <td class="fw-semibold">₹${fmt(p.amount)}</td>
              <td>${esc(p.payment_method)}</td>
              <td>${esc(p.reference_no || "—")}</td>
              <td>${esc(p.received_by_name || "—")}</td>
            </tr>
          `).join("");

      document.getElementById("collSummary").classList.remove("d-none");
    } catch (err) { showGlobalAlert(err.message); }
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function fmt(val) {
    return Number(val || 0).toFixed(2);
  }

  function showGlobalAlert(msg, type = "danger") {
    globalAlert.textContent = msg;
    globalAlert.className   = `alert alert-${type}`;
    setTimeout(() => { globalAlert.className = "alert d-none"; }, 5000);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
})();
