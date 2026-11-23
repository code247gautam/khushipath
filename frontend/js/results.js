/**
 * results.js — Result entry screen with auto-flag display.
 * URL param: ?order_id=N  pre-loads that order immediately.
 */
(function () {
  const alertBox    = document.getElementById("alertBox");
  const resultsCard = document.getElementById("resultsCard");
  const tbody       = document.getElementById("resultsTbody");
  const params      = new URLSearchParams(location.search);

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    const me = await API.get("/api/auth/me").catch(() => null);
    if (!me) { location.href = "/"; return; }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    document.getElementById("searchOrderBtn").addEventListener("click", doSearch);
    document.getElementById("orderSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
    });

    // Pre-load from URL param
    if (params.get("order_id")) {
      await loadOrder(Number(params.get("order_id")));
    }
  })();

  // ── Search for an order ───────────────────────────────────────────────
  async function doSearch() {
    const q = document.getElementById("orderSearch").value.trim();
    if (!q) return;

    try {
      const rows = await API.get(`/api/orders?search=${encodeURIComponent(q)}&limit=10`);
      if (!rows.length) { showAlert("No orders found.", "warning"); return; }
      if (rows.length === 1) { await loadOrder(rows[0].id); return; }

      // Multiple matches — show a quick picker
      const html = rows.map((o) =>
        `<button class="btn btn-sm btn-outline-secondary m-1"
           onclick="loadOrderById(${o.id})">
          ${esc(o.order_no)} — ${esc(o.patient_name)}
        </button>`
      ).join("");
      document.getElementById("orderLabel").innerHTML = html;
    } catch (err) {
      showAlert(err.message);
    }
  }

  window.loadOrderById = (id) => loadOrder(id);

  // ── Load a specific order ─────────────────────────────────────────────
  async function loadOrder(orderId) {
    try {
      // Fetch order header
      const order = await API.get(`/api/orders/${orderId}`);
      // Fetch results for each item
      const results = await API.get(`/api/results/order/${orderId}`);

      document.getElementById("orderInfo").textContent =
        `Order: ${order.order_no}  |  Status: ${order.sample_status}`;
      document.getElementById("patientInfo").textContent =
        `${order.patient_name} (${order.patient_uid})  •  ${order.patient_gender === "M" ? "Male" : order.patient_gender === "F" ? "Female" : "Other"}`;
      document.getElementById("orderLabel").textContent = order.order_no;

      renderResults(results, orderId);
      resultsCard.classList.remove("d-none");
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Render result rows ────────────────────────────────────────────────
  function renderResults(items, orderId) {
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">No test items on this order.</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((item) => {
      const isApproved = item.approval_status === "approved";
      const flagClass  = `flag-${item.flag || "N"}`;
      const statusBadge = {
        pending:  `<span class="badge bg-warning text-dark">Pending</span>`,
        approved: `<span class="badge bg-success">Approved</span>`,
        rejected: `<span class="badge bg-danger">Rejected</span>`,
      }[item.approval_status] || `<span class="badge bg-secondary">—</span>`;

      return `
        <tr class="result-row" id="row-${item.item_id}">
          <td>${esc(item.code)}</td>
          <td>${esc(item.name)}</td>
          <td>${esc(item.unit || "—")}</td>
          <td>
            ${isApproved
              ? `<span>${esc(item.value ?? "—")}</span>`
              : `<input type="text" class="form-control form-control-sm value-input"
                   id="val-${item.item_id}"
                   value="${esc(item.value ?? "")}"
                   placeholder="Enter value" />`
            }
          </td>
          <td>
            <span class="${flagClass}" id="flag-${item.item_id}">
              ${item.flag || (item.value ? "N" : "—")}
            </span>
          </td>
          <td>
            ${isApproved
              ? `<span>${esc(item.technician_notes || "—")}</span>`
              : `<input type="text" class="form-control form-control-sm"
                   id="notes-${item.item_id}"
                   value="${esc(item.technician_notes ?? "")}"
                   placeholder="Notes" />`
            }
          </td>
          <td>${statusBadge}</td>
          <td>
            ${isApproved
              ? `<span class="text-muted small">Locked</span>`
              : `<button class="btn btn-sm btn-primary"
                   onclick="saveResult(${item.item_id}, ${orderId})">Save</button>`
            }
          </td>
        </tr>`;
    }).join("");
  }

  // ── Save a single result ──────────────────────────────────────────────
  window.saveResult = async (itemId, orderId) => {
    const value = document.getElementById(`val-${itemId}`)?.value?.trim();
    const notes = document.getElementById(`notes-${itemId}`)?.value?.trim();

    if (!value && value !== "0") {
      showAlert("Value cannot be empty.", "warning");
      return;
    }

    try {
      const result = await API.put(`/api/results/${itemId}`, {
        value,
        technician_notes: notes,
      });

      // Update the flag in-place without full reload
      const flagEl = document.getElementById(`flag-${itemId}`);
      if (flagEl) {
        flagEl.textContent  = result.flag;
        flagEl.className    = `flag-${result.flag}`;
      }

      showAlert(`Saved — Flag: ${result.flag}`, "success");
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
