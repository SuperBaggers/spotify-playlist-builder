"use strict";

/* ===========================================================================
   Spotify Playlist Builder — browser-only (no backend).

   Uses the Authorization Code + PKCE flow entirely in the browser. The Client
   ID is NOT a secret, so it's fine to ship it in config.js. Tokens live in this
   browser's localStorage; nothing is sent anywhere except Spotify.
   =========================================================================== */

const CLIENT_ID = window.SPOTIFY_CLIENT_ID || "";
// The redirect URI is derived from wherever this page is actually served, with
// any "index.html" stripped and a trailing slash enforced — so it always
// matches what you register, with no manual editing.
const REDIRECT_URI = (() => {
  let u = window.location.origin + window.location.pathname;
  u = u.replace(/index\.html$/, "");
  if (!u.endsWith("/")) u += "/";
  return u;
})();

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const SCOPES = "playlist-modify-private playlist-modify-public user-read-private user-read-email";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let matchResults = [];

/* ----------------------------------------------------------------------- */
/* PKCE helpers (Web Crypto)                                               */
/* ----------------------------------------------------------------------- */
function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString(len) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => ("0" + (b & 0xff).toString(16)).slice(-2)).join("").slice(0, len);
}
async function sha256(str) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
}

/* ----------------------------------------------------------------------- */
/* Token storage                                                           */
/* ----------------------------------------------------------------------- */
const TOKEN_KEY = "spb_token";
function saveToken(data) {
  if (!data.refresh_token) {
    const old = loadToken();
    if (old && old.refresh_token) data.refresh_token = old.refresh_token;
  }
  data.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
  localStorage.setItem(TOKEN_KEY, JSON.stringify(data));
}
function loadToken() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY)); }
  catch { return null; }
}
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

/* ----------------------------------------------------------------------- */
/* OAuth flow                                                              */
/* ----------------------------------------------------------------------- */
async function beginLogin() {
  const verifier = randomString(96);
  const challenge = b64url(await sha256(verifier));
  const state = randomString(16);
  sessionStorage.setItem("spb_verifier", verifier);
  sessionStorage.setItem("spb_state", state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state: state,
  });
  window.location.href = `${AUTH_URL}?${params}`;
}

async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  // Clean the query string out of the address bar regardless of outcome.
  const clean = () => history.replaceState({}, document.title, REDIRECT_URI);

  if (error) { clean(); toast("Spotify login was cancelled or failed.", true); return; }
  if (!code) return; // normal page load, nothing to do

  if (state !== sessionStorage.getItem("spb_state")) {
    clean(); toast("Login state mismatch — please try again.", true); return;
  }
  const verifier = sessionStorage.getItem("spb_verifier");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  showOverlay("Finishing sign-in…");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  hideOverlay();
  clean();
  if (!res.ok) { toast("Token exchange failed: " + (await res.text()), true); return; }
  saveToken(await res.json());
  sessionStorage.removeItem("spb_verifier");
  sessionStorage.removeItem("spb_state");
}

async function getValidToken() {
  let t = loadToken();
  if (!t) return null;
  if (Date.now() < t.expires_at - 60000) return t.access_token;

  // Refresh.
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
    client_id: CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) { clearToken(); return null; }
  saveToken(await res.json());
  return loadToken().access_token;
}

/* ----------------------------------------------------------------------- */
/* Spotify API                                                             */
/* ----------------------------------------------------------------------- */
async function spFetch(path, opts = {}) {
  const token = await getValidToken();
  if (!token) throw new Error("Not connected to Spotify.");
  const res = await fetch(path.startsWith("http") ? path : API + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, ...(opts.headers || {}) },
  });
  if (res.status === 401) { clearToken(); throw new Error("Session expired — reconnect."); }
  if (res.status === 429) {
    const wait = parseInt(res.headers.get("Retry-After") || "2", 10);
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
    return spFetch(path, opts);
  }
  if (!res.ok) throw new Error(`Spotify error ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function similarity(a, b) {
  // Lightweight Dice-coefficient on bigrams — good enough for ranking matches.
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = bigrams(a), B = bigrams(b);
  let overlap = 0, total = 0;
  A.forEach((c, g) => { total += c; if (B.has(g)) overlap += Math.min(c, B.get(g)); });
  B.forEach((c) => { total += c; });
  return (2 * overlap) / total;
}

async function searchTrack(entry) {
  const { artist, title, raw } = entry;
  const q = (artist && title) ? `track:${title} artist:${artist}` : (title || artist || raw);
  let data = await spFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=5`);
  let items = data.tracks ? data.tracks.items : [];
  if (!items.length && artist && title) {
    data = await spFetch(`/search?q=${encodeURIComponent(artist + " " + title)}&type=track&limit=5`);
    items = data.tracks ? data.tracks.items : [];
  }
  if (!items.length) return { input: raw, matched: false };

  const target = (`${artist} ${title}`).trim() || raw;
  const describe = (t) => {
    const artists = t.artists.map((a) => a.name).join(", ");
    const imgs = t.album.images || [];
    return {
      uri: t.uri, id: t.id, name: t.name, artists,
      album: t.album.name,
      image: imgs.length ? imgs[imgs.length - 1].url : null,
      url: t.external_urls.spotify,
      confidence: Math.round(similarity(target, `${artists} ${t.name}`) * 1000) / 1000,
    };
  };
  const described = items.map(describe).sort((a, b) => b.confidence - a.confidence);
  return { input: raw, matched: true, best: described[0], alternatives: described.slice(1, 4) };
}

/* ----------------------------------------------------------------------- */
/* Input parsing                                                           */
/* ----------------------------------------------------------------------- */
const SEPARATORS = [" - ", " – ", " — ", "\t", " | ", ", "];
function parsePlaylist(text) {
  const out = [];
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    let artist = "", title = "";
    let split = false;
    for (const sep of SEPARATORS) {
      const idx = line.indexOf(sep);
      if (idx !== -1) { artist = line.slice(0, idx).trim(); title = line.slice(idx + sep.length).trim(); split = true; break; }
    }
    if (!split) title = line;
    artist = artist.replace(/^\s*\d{1,3}[.)\-]\s*/, "");
    out.push({ artist, title, raw: line });
  }
  return out;
}

/* ----------------------------------------------------------------------- */
/* UI: status / auth                                                       */
/* ----------------------------------------------------------------------- */
function showOverlay(t) { $("#overlay-text").textContent = t || "Working…"; $("#overlay").classList.remove("hidden"); }
function hideOverlay() { $("#overlay").classList.add("hidden"); }
function toast(msg, err) {
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", !!err);
  t.classList.remove("hidden"); clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 4000);
}
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function refreshUI() {
  // Always show the redirect URI so the user can register it.
  $("#redirect-uri").textContent = REDIRECT_URI;
  const r2 = $("#redirect-uri-2"); if (r2) r2.textContent = REDIRECT_URI;

  if (!CLIENT_ID || CLIENT_ID === "PASTE_YOUR_CLIENT_ID_HERE") {
    $("#setup-card").classList.remove("hidden");
    return;
  }
  const token = await getValidToken();
  if (token) {
    let name = "Connected";
    try { const me = await spFetch("/me"); name = me.display_name || me.id; } catch {}
    $("#connect-card").classList.add("hidden");
    $("#input-card").classList.remove("hidden");
    $("#account").innerHTML =
      `<span class="name">${escapeHtml(name)}</span><button class="ghost" id="logout-btn">Disconnect</button>`;
    $("#logout-btn").addEventListener("click", () => { clearToken(); location.reload(); });
  } else {
    $("#connect-card").classList.remove("hidden");
    $("#input-card").classList.add("hidden");
    $("#review-card").classList.add("hidden");
  }
}

/* ----------------------------------------------------------------------- */
/* UI: results rendering                                                   */
/* ----------------------------------------------------------------------- */
function badge(c) {
  const pct = Math.round(c * 100);
  if (c >= 0.8) return `<span class="badge high">${pct}%</span>`;
  if (c >= 0.5) return `<span class="badge mid">${pct}%</span>`;
  return `<span class="badge low">${pct}%</span>`;
}
function renderResults() {
  const box = $("#results"); box.innerHTML = ""; let matched = 0;
  matchResults.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "track" + (r.matched ? "" : " unmatched");
    if (r.matched) {
      matched++; const b = r.best;
      row.innerHTML = `
        <input type="checkbox" data-i="${i}" checked />
        <img src="${b.image || ""}" alt="" />
        <div class="meta">
          <div class="t">${escapeHtml(b.name)}</div>
          <div class="a">${escapeHtml(b.artists)} · ${escapeHtml(b.album)}</div>
          <div class="src">from: ${escapeHtml(r.input)}</div>
        </div>
        ${badge(b.confidence)}
        ${r.alternatives && r.alternatives.length ? `<span class="alt-toggle" data-i="${i}">other matches</span>` : ""}`;
    } else {
      row.innerHTML = `
        <input type="checkbox" disabled />
        <img src="" alt="" />
        <div class="meta"><div class="t">No match found</div><div class="a">${escapeHtml(r.input)}</div></div>
        <span class="badge none">none</span>`;
    }
    box.appendChild(row);

    if (r.matched && r.alternatives && r.alternatives.length) {
      const alts = document.createElement("div");
      alts.className = "alts hidden"; alts.dataset.alts = i;
      r.alternatives.forEach((a, j) => {
        const el = document.createElement("div");
        el.className = "alt";
        el.innerHTML = `<img src="${a.image || ""}" alt="" /><span>${escapeHtml(a.name)} — ${escapeHtml(a.artists)}</span>`;
        el.addEventListener("click", () => {
          const chosen = r.alternatives.splice(j, 1)[0];
          r.alternatives.unshift(r.best); r.best = chosen; renderResults();
        });
        alts.appendChild(el);
      });
      box.appendChild(alts);
    }
  });
  $("#match-summary").textContent = `${matched} of ${matchResults.length} matched`;
}

function selectedTracks() {
  return $$("#results input[type=checkbox]:checked:not([disabled])")
    .map((c) => matchResults[parseInt(c.dataset.i, 10)].best);
}

/* ----------------------------------------------------------------------- */
/* Export                                                                  */
/* ----------------------------------------------------------------------- */
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}
function doExport(fmt) {
  const tracks = selectedTracks();
  if (!tracks.length) { toast("Select at least one track.", true); return; }
  if (fmt === "csv") {
    const rows = [["title", "artist", "album", "spotify_uri", "spotify_url"]];
    tracks.forEach((t) => rows.push([t.name, t.artists, t.album, t.uri, t.url]));
    const csv = rows.map((r) => r.map((c) => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    download("playlist.csv", csv, "text/csv");
  } else if (fmt === "uris") {
    download("playlist-uris.txt", tracks.map((t) => t.uri).join("\n"), "text/plain");
  } else {
    download("playlist.json", JSON.stringify(tracks, null, 2), "application/json");
  }
  toast("Exported ✓");
}

/* ----------------------------------------------------------------------- */
/* Create playlist                                                         */
/* ----------------------------------------------------------------------- */
async function createPlaylist() {
  const tracks = selectedTracks();
  if (!tracks.length) { toast("Select at least one track.", true); return; }
  const uris = tracks.map((t) => t.uri);
  showOverlay(`Adding ${uris.length} tracks…`);
  try {
    const playlist = await spFetch(`/me/playlists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: $("#playlist-name").value.trim() || "Imported Playlist",
        description: "Created with Spotify Playlist Builder",
        public: $("#public-check").checked,
      }),
    });
    for (let i = 0; i < uris.length; i += 100) {
      await spFetch(`/playlists/${playlist.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
      });
    }
    hideOverlay();
    $("#create-result").innerHTML =
      `<a class="success-link" href="${playlist.external_urls.spotify}" target="_blank">
        Added ${uris.length} tracks — open playlist in Spotify ↗</a>`;
    toast("Playlist created ✓");
  } catch (e) { hideOverlay(); toast(e.message, true); }
}

/* ----------------------------------------------------------------------- */
/* Wire up                                                                 */
/* ----------------------------------------------------------------------- */
function wire() {
  $("#connect-btn").addEventListener("click", beginLogin);

  $("#playlist-input").addEventListener("input", (e) => {
    const n = e.target.value.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
    $("#line-count").textContent = `${n} track${n === 1 ? "" : "s"}`;
  });

  $("#match-btn").addEventListener("click", async () => {
    const text = $("#playlist-input").value;
    if (!text.trim()) { toast("Paste some tracks first.", true); return; }
    const entries = parsePlaylist(text);
    if (!entries.length) { toast("No tracks found.", true); return; }
    matchResults = [];
    $("#review-card").classList.remove("hidden");
    $("#results").innerHTML = "";
    showOverlay(`Searching 0 / ${entries.length}…`);
    try {
      for (let i = 0; i < entries.length; i++) {
        $("#overlay-text").textContent = `Searching ${i + 1} / ${entries.length}…`;
        matchResults.push(await searchTrack(entries[i]));
      }
      hideOverlay();
      renderResults();
      $("#review-card").scrollIntoView({ behavior: "smooth" });
    } catch (e) { hideOverlay(); toast(e.message, true); }
  });

  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("alt-toggle")) {
      const alts = document.querySelector(`.alts[data-alts="${e.target.dataset.i}"]`);
      if (alts) alts.classList.toggle("hidden");
    }
  });

  $("#select-all").addEventListener("click", () => $$("#results input[type=checkbox]:not([disabled])").forEach((c) => (c.checked = true)));
  $("#select-none").addEventListener("click", () => $$("#results input[type=checkbox]:not([disabled])").forEach((c) => (c.checked = false)));
  $$("[data-export]").forEach((b) => b.addEventListener("click", () => doExport(b.dataset.export)));
  $("#create-btn").addEventListener("click", createPlaylist);
}

/* ----------------------------------------------------------------------- */
/* Boot                                                                    */
/* ----------------------------------------------------------------------- */
(async function () {
  wire();
  await handleRedirect();
  await refreshUI();
})().catch((e) => toast(e.message, true));
