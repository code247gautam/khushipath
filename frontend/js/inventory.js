/**
 * inventory.js — Inventory management page logic.
 */
(function () {
  const globalAlert = document.getElementById("globalAlert");

  let _me       = null;
  let _items    = [];
  let _branches = [];

  // Modal instances
  const itemModal     = new bootstrap.Modal(document.getElementById("itemModal"));
  const purchaseModal = new bootstrap.Modal(document.getElementById("purchaseModal"));
  const transferModal = new bootstrap.Modal(document.getElementById("transferModal"));
  const adjustModal   = new bootstrap.Modal(document.getElementById("adjustModal"));

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    _me = await API.get("/api/auth/me").catch(() => null);
    if (!_me) { location.href = "/"; return; }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    // Load support data
    [_items, _branches] = await Promise.all([
      API.get("/api/inventory/items"),
      API.get("/api/branches"),
    ]);

    populateItemSelects();
    populateBranchSelects();

    // Tab switching
    document.querySelectorAll("#invTabs .nav-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#invTabs .nav-link").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll("[id^=tab-]").forEach((el) => el.style.display = "none");
        document.getElementById(`tab-${btn.dataset.tab}`).style.display = "";
        loadTab(btn.dataset.tab);
      });
    });

    // Load default tab
    loadTab("stock");
    loadAlertBadges();

    // Bind save buttons
    document.getElementById("saveItemBtn").addEventListener("click",     saveItem);
    document.getElementById("savePurchaseBtn").addEventListener("click", savePurchase);
    document.getElementById("saveTransferBtn").addEventListener("click", saveTransfer);
    document.getElementById("saveAdjustBtn").addEventListener("click",   saveAdjust);
    document.getElementById("movSearchBtn").addEventListener("click",    () => loadMovements());

    // Stock search
    let st;
    document.getElementById("stockSearch").addEventListener("input", () => {
      clearTimeout(st); st = setTimeout(() => loadStock(), 250);
    });

    // Add item button — reset form
    document.getElementById("addItemBtn").addEventListener("click", () => {
      document.getElementById("itemId").value  = "";
      document.getElementById("iCode").value   = "";
      document.getElementById("iName").value   = "";
      document.getElementById("iType").value   = "reagent";
      document.getElementById("iUnit").value   = "";
      document.getElementById("iSupplier").value = "";
      document.getElementById("iDesc").value   = "";
      document.getElementById("itemModalTitle").textContent = "New Item";
      document.getElementById("itemModalAlert").className = "alert d-none";
    });
  })();

  function loadTab(tab) {
    if (tab === "stock")     loadStock();
    if (tab === "items")     loadItems();
    if (tab === "batches")   loadBatches();
    if (tab === "movements") loadMovements();
    if (tab === "alerts")    loadAlerts();
  }

  // ── Populate selects ──────────────────────────────────────────────────
  function populateItemSelects() {
    ["purchaseItem","transferItem","adjustItem"].forEach((id) => {
      const sel = document.getElementById(id);
      sel.innerHTML = `<option value="">— select item —</option>`;
      _items.forEach((i) => {
        sel.innerHTML += `<option value="${i.id}">${esc(i.code)} — ${esc(i.name)}</option>`;
      });
    });
  }

  function populateBranchSelects() {
    ["transferFrom","transferTo"].forEach((id) => {
      const sel = document.getElementById(id);
      sel.innerHTML = `<option value="">— select branch —</option>`;
      _branches.forEach((b) => {
        sel.innerHTML += `<option value="${b.id}">${esc(b.name)}</option>`;
      });
    });
  }

  // ── Alert badges (header row) ─────────────────────────────────────────
  async function loadAlertBadges() {
    try {
      const [low, exp] = await Promise.all([
        API.get("/api/inventory/alerts/low-stock"),
        API.get("/api/inventory/alerts/expiring"),
      ]);
      const container = document.getElementById("alertBadges");
      container.innerHTML = "";
      if (low.length) container.innerHTML += `
        <div class="col-auto">
          <div class="p-2 rounded alert-low small"><strong>${low.length}</strong> low-stock item(s)</div>
        </div>`;
      if (exp.length) container.innerHTML += `
        <div class="col-auto">
          <div class="p-2 rounded alert-expiry small"><strong>${exp.length}</strong> batch(es) expiring within 30 days</div>
        </div>`;
    } catch (_) {}
  }

  // ── Stock ─────────────────────────────────────────────────────────────
  async function loadStock() {
    const search = document.getElementById("stockSearch").value.toLowerCase();
    try {
      let rows = await API.get("/api/inventory/stock");
      if (search) rows = rows.filter((r) =>
        r.name.toLowerCase().includes(search) || r.code.toLowerCase().includes(search)
      );
      const tbody = document.getElementById("stockTbody");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-muted text-center py-3">No stock records.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((r) => {
        const isLow = r.is_low;
        return `<tr class="${isLow ? "table-danger" : ""}">
          <td><code>${esc(r.code)}</code></td>
          <td>${esc(r.name)}</td>
          <td>${esc(r.item_type)}</td>
          <td>${esc(r.unit || "—")}</td>
          <td class="fw-semibold">${Number(r.quantity).toFixed(2)}</td>
          <td>${Number(r.reorder_level).toFixed(2)}</td>
          <td>${isLow ? '<span class="badge bg-danger">Low</span>' : '<span class="badge bg-success">OK</span>'}</td>
          <td>
            <button class="btn btn-xs btn-sm btn-outline-secondary" onclick="editReorderLevel(${r.item_id},${r.branch_id},${r.reorder_level})">Set Reorder</button>
          </td>
        </tr>`;
      }).join("");
    } catch (err) { showGlobalAlert(err.message); }
  }

  window.editReorderLevel = async (itemId, branchId, current) => {
    const val = prompt(`Set reorder level for this item (current: ${current}):`, current);
    if (val === null || isNaN(val)) return;
    try {
      await API.put(`/api/inventory/stock/${itemId}`, { branch_id: branchId, reorder_level: Number(val) });
      loadStock();
    } catch (err) { showGlobalAlert(err.message); }
  };

  // ── Items ─────────────────────────────────────────────────────────────
  async function loadItems() {
    try {
      const rows = await API.get("/api/inventory/items");
      _items = rows; // refresh cache
      populateItemSelects();
      const tbody = document.getElementById("itemTbody");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-muted text-center py-3">No items.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((i) => `
        <tr>
          <td><code>${esc(i.code)}</code></td>
          <td>${esc(i.name)}</td>
          <td>${esc(i.item_type)}</td>
          <td>${esc(i.unit || "—")}</td>
          <td>${esc(i.supplier || "—")}</td>
          <td><button class="btn btn-xs btn-sm btn-outline-primary" onclick="editItem(${i.id})">Edit</button></td>
        </tr>
      `).join("");
    } catch (err) { showGlobalAlert(err.message); }
  }

  window.editItem = async (id) => {
    const item = await API.get(`/api/inventory/items/${id}`);
    document.getElementById("itemModalTitle").textContent = "Edit Item";
    document.getElementById("itemId").value     = item.id;
    document.getElementById("iCode").value      = item.code;
    document.getElementById("iName").value      = item.name;
    document.getElementById("iType").value      = item.item_type;
    document.getElementById("iUnit").value      = item.unit || "";
    document.getElementById("iSupplier").value  = item.supplier || "";
    document.getElementById("iDesc").value      = item.description || "";
    document.getElementById("itemModalAlert").className = "alert d-none";
    itemModal.show();
  };

  async function saveItem() {
    const id = document.getElementById("itemId").value;
    const payload = {
      code:        document.getElementById("iCode").value.trim(),
      name:        document.getElementById("iName").value.trim(),
      item_type:   document.getElementById("iType").value,
      unit:        document.getElementById("iUnit").value.trim(),
      supplier:    document.getElementById("iSupplier").value.trim(),
      description: document.getElementById("iDesc").value.trim(),
    };
    try {
      if (id) await API.put(`/api/inventory/items/${id}`, payload);
      else    await API.post("/api/inventory/items", payload);
      itemModal.hide();
      loadItems();
    } catch (err) {
      const el = document.getElementById("itemModalAlert");
      el.textContent = err.message; el.className = "alert alert-danger";
    }
  }

  // ── Batches ───────────────────────────────────────────────────────────
  async function loadBatches() {
    try {
      const rows = await API.get("/api/inventory/batches");
      const tbody = document.getElementById("batchTbody");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-muted text-center py-3">No batches.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((b) => {
        const daysLeft = b.expiry_date
          ? Math.ceil((new Date(b.expiry_date) - Date.now()) / 86400000)
          : null;
        const cls = daysLeft !== null && daysLeft <= 30 ? "table-warning" : "";
        return `<tr class="${cls}">
          <td>${esc(b.item_code)} — ${esc(b.item_name)}</td>
          <td><code>${esc(b.batch_no)}</code></td>
          <td>${Number(b.quantity).toFixed(2)} ${esc(b.unit || "")}</td>
          <td>${b.expiry_date ? `${b.expiry_date.slice(0,10)} ${daysLeft !== null ? `(${daysLeft}d)` : ""}` : "—"}</td>
          <td>${b.branch_id}</td>
        </tr>`;
      }).join("");
    } catch (err) { showGlobalAlert(err.message); }
  }

  // ── Movements ─────────────────────────────────────────────────────────
  async function loadMovements() {
    const type     = document.getElementById("movTypeFilter").value;
    const dateFrom = document.getElementById("movDateFrom").value;
    const dateTo   = document.getElementById("movDateTo").value;
    const q        = new URLSearchParams({ limit: 100 });
    if (type)     q.set("movement_type", type);
    if (dateFrom) q.set("date_from",     dateFrom);
    if (dateTo)   q.set("date_to",       dateTo);
    try {
      const rows = await API.get(`/api/inventory/movements?${q}`);
      const tbody = document.getElementById("movTbody");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-muted text-center py-3">No movements.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((m) => {
        const qtyClass = m.quantity > 0 ? "text-success" : "text-danger";
        return `<tr>
          <td>${new Date(m.created_at).toLocaleString()}</td>
          <td>${esc(m.item_code)} — ${esc(m.item_name)}</td>
          <td><span class="badge bg-secondary">${esc(m.movement_type)}</span></td>
          <td class="${qtyClass} fw-semibold">${m.quantity > 0 ? "+" : ""}${Number(m.quantity).toFixed(2)} ${esc(m.unit||"")}</td>
          <td>${esc(m.branch_name)}</td>
          <td>${esc(m.created_by_name || "—")}</td>
          <td>${esc(m.notes || "")}</td>
        </tr>`;
      }).join("");
    } catch (err) { showGlobalAlert(err.message); }
  }

  // ── Alerts ────────────────────────────────────────────────────────────
  async function loadAlerts() {
    try {
      const [low, exp] = await Promise.all([
        API.get("/api/inventory/alerts/low-stock"),
        API.get("/api/inventory/alerts/expiring"),
      ]);

      document.getElementById("lowStockTbody").innerHTML = !low.length
        ? `<tr><td colspan="5" class="text-success text-center py-2 small">✓ All items above reorder level</td></tr>`
        : low.map((r) => `<tr>
            <td>${esc(r.code)} — ${esc(r.name)}</td>
            <td>${esc(r.branch_name)}</td>
            <td class="text-danger fw-semibold">${Number(r.quantity).toFixed(2)}</td>
            <td>${Number(r.reorder_level).toFixed(2)}</td>
            <td class="text-danger">${Number(r.shortage).toFixed(2)} short</td>
          </tr>`).join("");

      document.getElementById("expiringTbody").innerHTML = !exp.length
        ? `<tr><td colspan="5" class="text-success text-center py-2 small">✓ No batches expiring soon</td></tr>`
        : exp.map((b) => `<tr class="${Number(b.days_left) <= 7 ? "table-danger" : "table-warning"}">
            <td>${esc(b.item_code)} — ${esc(b.item_name)}</td>
            <td><code>${esc(b.batch_no)}</code></td>
            <td>${b.expiry_date?.slice(0,10) || "—"}</td>
            <td>${Number(b.quantity).toFixed(2)} ${esc(b.unit||"")}</td>
            <td class="fw-semibold">${b.days_left} days</td>
          </tr>`).join("");
    } catch (err) { showGlobalAlert(err.message); }
  }

  // ── Purchase save ─────────────────────────────────────────────────────
  async function savePurchase() {
    const payload = {
      item_id:     Number(document.getElementById("purchaseItem").value),
      quantity:    Number(document.getElementById("purchaseQty").value),
      batch_no:    document.getElementById("purchaseBatch").value.trim() || undefined,
      expiry_date: document.getElementById("purchaseExpiry").value || undefined,
      notes:       document.getElementById("purchaseNotes").value.trim(),
    };
    if (!payload.item_id || !payload.quantity) {
      setModalAlert("purchaseAlert", "Item and quantity required."); return;
    }
    try {
      await API.post("/api/inventory/purchase", payload);
      purchaseModal.hide();
      showGlobalAlert("Purchase recorded.", "success");
      loadStock(); loadAlertBadges();
    } catch (err) { setModalAlert("purchaseAlert", err.message); }
  }

  // ── Transfer save ─────────────────────────────────────────────────────
  async function saveTransfer() {
    const payload = {
      item_id:        Number(document.getElementById("transferItem").value),
      from_branch_id: Number(document.getElementById("transferFrom").value),
      to_branch_id:   Number(document.getElementById("transferTo").value),
      quantity:       Number(document.getElementById("transferQty").value),
      notes:          document.getElementById("transferNotes").value.trim(),
    };
    if (!payload.item_id || !payload.from_branch_id || !payload.to_branch_id || !payload.quantity) {
      setModalAlert("transferAlert", "All fields required."); return;
    }
    try {
      await API.post("/api/inventory/transfer", payload);
      transferModal.hide();
      showGlobalAlert("Transfer complete.", "success");
      loadStock();
    } catch (err) { setModalAlert("transferAlert", err.message); }
  }

  // ── Adjustment save ───────────────────────────────────────────────────
  async function saveAdjust() {
    const payload = {
      item_id:  Number(document.getElementById("adjustItem").value),
      quantity: Number(document.getElementById("adjustQty").value),
      notes:    document.getElementById("adjustNotes").value.trim(),
    };
    if (!payload.item_id || isNaN(payload.quantity) || payload.quantity === 0) {
      setModalAlert("adjustAlert", "Item and non-zero quantity required."); return;
    }
    try {
      await API.post("/api/inventory/adjust", payload);
      adjustModal.hide();
      showGlobalAlert("Adjustment applied.", "success");
      loadStock(); loadAlertBadges();
    } catch (err) { setModalAlert("adjustAlert", err.message); }
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function showGlobalAlert(msg, type = "danger") {
    globalAlert.textContent = msg;
    globalAlert.className   = `alert alert-${type}`;
    setTimeout(() => { globalAlert.className = "alert d-none"; }, 5000);
  }

  function setModalAlert(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg; el.className = "alert alert-danger";
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
})();
