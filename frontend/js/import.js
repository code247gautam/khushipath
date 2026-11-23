/**
 * import.js — Excel/CSV import page logic.
 * Handles both drop-zone and file-picker interaction, then POSTs
 * the file as multipart/form-data (bypassing the JSON api.js wrapper).
 */
(function () {

  // ── Auth guard ────────────────────────────────────────────────────────
  API.get("/api/auth/me").catch(() => { location.href = "/"; });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await API.post("/api/auth/logout", {});
    location.href = "/";
  });

  // ── Generic file-upload widget setup ──────────────────────────────────
  /**
   * @param {string} dropZoneId
   * @param {string} fileInputId
   * @param {string} fileNameId     — element showing the selected file name
   * @param {string} uploadBtnId
   * @param {string} resultDivId
   * @param {string} apiEndpoint   — POST target
   */
  function setupImport({ dropZoneId, fileInputId, fileNameId, uploadBtnId, resultDivId, apiEndpoint }) {
    const dropZone   = document.getElementById(dropZoneId);
    const fileInput  = document.getElementById(fileInputId);
    const fileNameEl = document.getElementById(fileNameId);
    const uploadBtn  = document.getElementById(uploadBtnId);
    const resultDiv  = document.getElementById(resultDivId);

    let selectedFile = null;

    function setFile(file) {
      selectedFile     = file;
      fileNameEl.textContent = `Selected: ${file.name}`;
      uploadBtn.disabled = false;
    }

    // Click on drop-zone opens file picker
    dropZone.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) setFile(fileInput.files[0]);
    });

    // Drag-and-drop events
    dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); dropZone.classList.add("over"); });
    dropZone.addEventListener("dragleave", ()  => dropZone.classList.remove("over"));
    dropZone.addEventListener("drop",      (e) => {
      e.preventDefault();
      dropZone.classList.remove("over");
      const file = e.dataTransfer.files[0];
      if (file) setFile(file);
    });

    // Upload
    uploadBtn.addEventListener("click", async () => {
      if (!selectedFile) return;

      uploadBtn.disabled = true;
      uploadBtn.textContent = "Uploading…";
      resultDiv.innerHTML = "";

      try {
        // We need a CSRF token even for multipart form uploads
        const { csrfToken } = await fetch("/api/csrf-token", { credentials: "include" }).then((r) => r.json());

        const form = new FormData();
        form.append("file", selectedFile);

        const res = await fetch(apiEndpoint, {
          method: "POST",
          headers: { "X-CSRF-Token": csrfToken },
          credentials: "include",
          body: form,
        });

        const data = await res.json();

        if (!res.ok) {
          resultDiv.innerHTML = `<div class="alert alert-danger">${esc(data.error || "Upload failed.")}</div>`;
          return;
        }

        // Show summary
        const errorHtml = data.errors && data.errors.length
          ? `<ul class="mb-0 mt-2 small text-danger">
               ${data.errors.map((e) => `<li>Line ${e.line}: ${esc(e.error)}</li>`).join("")}
             </ul>`
          : "";

        resultDiv.innerHTML = `
          <div class="alert alert-success">
            ✅ Import complete —
            ${data.inserted ?? 0} inserted,
            ${data.updated ?? 0} updated,
            ${data.skipped ?? 0} skipped.
            ${errorHtml}
          </div>`;

      } catch (err) {
        resultDiv.innerHTML = `<div class="alert alert-danger">${esc(err.message)}</div>`;
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = "Upload";
      }
    });
  }

  // ── Initialise both widgets ───────────────────────────────────────────
  setupImport({
    dropZoneId:  "testDropZone",
    fileInputId: "testFileInput",
    fileNameId:  "testFileName",
    uploadBtnId: "importTestsBtn",
    resultDivId: "testImportResult",
    apiEndpoint: "/api/import/tests",
  });

  setupImport({
    dropZoneId:  "rangeDropZone",
    fileInputId: "rangeFileInput",
    fileNameId:  "rangeFileName",
    uploadBtnId: "importRangesBtn",
    resultDivId: "rangeImportResult",
    apiEndpoint: "/api/import/ranges",
  });

  // ── Helpers ───────────────────────────────────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
})();
