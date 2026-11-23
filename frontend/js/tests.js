/**
 * tests.js — Test catalog page logic.
 */
(function () {
  const modalEl    = document.getElementById("testModal");
  const bsModal    = new bootstrap.Modal(modalEl);
  const alertBox   = document.getElementById("alertBox");
  const modalAlert = document.getElementById("modalAlert");
  const tbody      = document.getElementById("testTbody");
  const catFilter  = document.getElementById("catFilter");
  const tCategory  = document.getElementById("tCategory");
  const searchInput = document.getElementById("searchInput");

  let _currentTestId = null;
  let _searchTimer   = null;

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    const me = await API.get("/api/auth/me").catch(() => null);
    if (!me) { location.href = "/"; return; }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await API.post("/api/auth/logout", {});
      location.href = "/";
    });

    // Load categories into filter + modal dropdown
    const cats = await API.get("/api/tests/categories");
    cats.forEach((c) => {
      catFilter.innerHTML  += `<option value="${c.id}">${esc(c.name)}</option>`;
      tCategory.innerHTML  += `<option value="${c.id}">${esc(c.name)}</option>`;
    });

    loadTests();
  })();

  // ── Debounced search ──────────────────────────────────────────────────
  searchInput.addEventListener("input", () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(loadTests, 300);
  });
  catFilter.addEventListener("change", loadTests);

  // ── Load tests ────────────────────────────────────────────────────────
  async function loadTests() {
    const params = new URLSearchParams();
    if (catFilter.value)       params.set("category_id", catFilter.value);
    if (searchInput.value)     params.set("search",      searchInput.value);

    try {
      const rows = await API.get(`/api/tests?${params}`);
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">No tests found.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((t) => `
        <tr>
          <td><strong>${esc(t.code)}</strong></td>
          <td>${esc(t.name)}</td>
          <td>${esc(t.category_name || "—")}</td>
          <td>${esc(t.unit || "—")}</td>
          <td>₹${Number(t.price).toFixed(2)}</td>
          <td>${esc(t.sample_type || "—")}</td>
          <td>${t.turnaround_hours ?? "—"}</td>
          <td><span class="badge bg-${t.is_active ? "success" : "secondary"}">${t.is_active ? "Active" : "Inactive"}</span></td>
          <td>
            <button class="btn btn-xs btn-sm btn-outline-primary" onclick="editTest(${t.id})">Edit</button>
          </td>
        </tr>
      `).join("");
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ── Open "Add" modal ──────────────────────────────────────────────────
  document.getElementById("addTestBtn").addEventListener("click", () => {
    _currentTestId = null;
    document.getElementById("testModalTitle").textContent = "New Test";
    document.getElementById("testId").value   = "";
    document.getElementById("tCode").value    = "";
    document.getElementById("tName").value    = "";
    document.getElementById("tCategory").value = "";
    document.getElementById("tUnit").value    = "";
    document.getElementById("tPrice").value   = "0";
    document.getElementById("tTAT").value     = "24";
    document.getElementById("tSample").value  = "";
    document.getElementById("tMethod").value  = "";
    document.getElementById("tNotes").value   = "";
    document.getElementById("rangesSection").classList.add("d-none");
    modalAlert.className = "alert d-none";
  });

  // ── Save test ─────────────────────────────────────────────────────────
  document.getElementById("saveTestBtn").addEventListener("click", async () => {
    const id = document.getElementById("testId").value;
    const payload = {
      code:             document.getElementById("tCode").value.trim(),
      name:             document.getElementById("tName").value.trim(),
      category_id:      document.getElementById("tCategory").value || null,
      unit:             document.getElementById("tUnit").value.trim(),
      price:            Number(document.getElementById("tPrice").value),
      turnaround_hours: Number(document.getElementById("tTAT").value),
      sample_type:      document.getElementById("tSample").value.trim(),
      method:           document.getElementById("tMethod").value.trim(),
      notes:            document.getElementById("tNotes").value.trim(),
    };

    if (!payload.code || !payload.name) {
      modalAlert.textContent = "Code and Name are required.";
      modalAlert.className   = "alert alert-danger";
      return;
    }

    try {
      let saved;
      if (id) {
        saved = await API.put(`/api/tests/${id}`, payload);
      } else {
        saved = await API.post("/api/tests", payload);
      }
      showAlert("Test saved.", "success");
      loadTests();

      // After save, stay open if editing so ranges can be managed
      if (!id) bsModal.hide();
      else {
        _currentTestId = saved.id;
        await loadRanges(saved.id);
      }
    } catch (err) {
      modalAlert.textContent = err.message;
      modalAlert.className   = "alert alert-danger";
    }
  });

  // ── Edit test (global for inline onclick) ─────────────────────────────
  window.editTest = async (id) => {
    _currentTestId = id;
    try {
      const t = await API.get(`/api/tests/${id}`);
      document.getElementById("testModalTitle").textContent = "Edit Test";
      document.getElementById("testId").value    = t.id;
      document.getElementById("tCode").value     = t.code;
      document.getElementById("tName").value     = t.name;
      document.getElementById("tCategory").value = t.category_id || "";
      document.getElementById("tUnit").value     = t.unit || "";
      document.getElementById("tPrice").value    = t.price;
      document.getElementById("tTAT").value      = t.turnaround_hours;
      document.getElementById("tSample").value   = t.sample_type || "";
      document.getElementById("tMethod").value   = t.method || "";
      document.getElementById("tNotes").value    = t.notes || "";
      modalAlert.className = "alert d-none";

      document.getElementById("rangesSection").classList.remove("d-none");
      await loadRanges(id, t.reference_ranges);

      bsModal.show();
    } catch (err) {
      showAlert(err.message);
    }
  };

  // ── Reference ranges ──────────────────────────────────────────────────
  async function loadRanges(testId, ranges) {
    if (!ranges) {
      const t = await API.get(`/api/tests/${testId}`);
      ranges = t.reference_ranges;
    }
    const rtbody = document.getElementById("rangeTbody");
    if (!ranges.length) {
      rtbody.innerHTML = `<tr><td colspan="7" class="text-muted text-center small">No ranges yet.</td></tr>`;
      return;
    }
    rtbody.innerHTML = ranges.map((r) => `
      <tr>
        <td>${r.age_min_years ?? "—"}</td>
        <td>${r.age_max_years ?? "—"}</td>
        <td>${r.gender || "Both"}</td>
        <td>${r.range_low ?? "—"}</td>
        <td>${r.range_high ?? "—"}</td>
        <td>${esc(r.range_text || "")}</td>
        <td>
          <button class="btn btn-xs btn-sm btn-outline-danger"
            onclick="deleteRange(${testId},${r.id})">×</button>
        </td>
      </tr>
    `).join("");
  }

  document.getElementById("addRangeBtn").addEventListener("click", () => {
    document.getElementById("rangeForm").classList.toggle("d-none");
  });

  document.getElementById("cancelRangeBtn").addEventListener("click", () => {
    document.getElementById("rangeForm").classList.add("d-none");
  });

  document.getElementById("saveRangeBtn").addEventListener("click", async () => {
    if (!_currentTestId) return;
    const payload = {
      age_min_years: document.getElementById("rAgeMin").value  || null,
      age_max_years: document.getElementById("rAgeMax").value  || null,
      gender:        document.getElementById("rGender").value  || null,
      range_low:     document.getElementById("rLow").value     || null,
      range_high:    document.getElementById("rHigh").value    || null,
      range_text:    document.getElementById("rText").value    || null,
    };
    try {
      await API.post(`/api/tests/${_currentTestId}/ranges`, payload);
      document.getElementById("rangeForm").classList.add("d-none");
      await loadRanges(_currentTestId);
    } catch (err) {
      alert(err.message);
    }
  });

  window.deleteRange = async (testId, rangeId) => {
    if (!confirm("Delete this range?")) return;
    try {
      await API.del(`/api/tests/${testId}/ranges/${rangeId}`);
      await loadRanges(testId);
    } catch (err) {
      alert(err.message);
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
