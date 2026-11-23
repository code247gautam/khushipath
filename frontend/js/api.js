/**
 * api.js — Thin fetch wrapper used by all frontend pages.
 *
 * Automatically:
 *  - fetches a CSRF token on first mutating request and caches it
 *  - sends credentials (session cookie) with every request
 *  - redirects to / on 401 (session expired)
 *  - returns parsed JSON or throws an Error with the server's error message
 */

const API = (() => {
  let _csrfToken = null;

  async function _fetchCsrf() {
    if (_csrfToken) return _csrfToken;
    const res = await fetch("/api/csrf-token", { credentials: "include" });
    const data = await res.json();
    _csrfToken = data.csrfToken;
    return _csrfToken;
  }

  async function _request(method, url, body) {
    const headers = { "Content-Type": "application/json" };

    // Attach CSRF token for state-changing methods
    if (["POST", "PUT", "DELETE", "PATCH"].includes(method.toUpperCase())) {
      headers["X-CSRF-Token"] = await _fetchCsrf();
    }

    const opts = {
      method,
      headers,
      credentials: "include",
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);

    // Session expired
    if (res.status === 401 && !url.includes("/api/auth/login")) {
      location.href = "/";
      return;
    }

    // No-content responses (e.g. 204)
    if (res.status === 204) return null;

    const data = await res.json();

    if (!res.ok) {
      // After a CSRF failure the token is stale — clear it so it re-fetches
      if (res.status === 403 && data.error?.includes("CSRF")) _csrfToken = null;
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    return data;
  }

  return {
    get:    (url)        => _request("GET",    url),
    post:   (url, body)  => _request("POST",   url, body),
    put:    (url, body)  => _request("PUT",    url, body),
    del:    (url)        => _request("DELETE", url),
  };
})();
