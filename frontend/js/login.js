/**
 * login.js — Handles the login form submission.
 */
(function () {
  const form     = document.getElementById("loginForm");
  const alertBox = document.getElementById("alertBox");
  const loginBtn = document.getElementById("loginBtn");

  function showAlert(msg, type = "danger") {
    alertBox.textContent = msg;
    alertBox.className = `alert alert-${type}`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in…";
    alertBox.className = "alert d-none";

    const email    = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
      await API.post("/api/auth/login", { email, password });
      location.href = "/dashboard.html";
    } catch (err) {
      showAlert(err.message || "Login failed. Please try again.");
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign in";
    }
  });
})();
