# Spotify Playlist Builder — web version

A single-page website (no server, no Python) that turns a pasted song list into a
Spotify playlist, with options to export it or push it straight into your account.
It runs entirely in your browser and hosts for free on **GitHub Pages**.

Login uses Spotify's PKCE flow, so there's no secret to hide and no backend to
maintain. On a real `https://` address the old `127.0.0.1` paste step is gone —
connecting is now one click.

> **Personal use only.** Under Spotify's 2025 rules a hobbyist app stays in
> "development mode": it works for you (you need Spotify Premium, which you have)
> plus up to a handful of people you manually add. It can't be made public. For
> just you, that's no limitation at all.

---

## What you'll do

1. **GitHub:** create a repo and upload these files.
2. **GitHub:** turn on Pages to get your live URL.
3. **Spotify dashboard:** register that URL as the Redirect URI and copy your Client ID.
4. **GitHub:** paste the Client ID into `config.js`.
5. **Visit the site** and connect.

No terminal, no git commands — all done in the browser.

---

## STEP 1 — Create the repo and upload the files

1. Go to <https://github.com/new> (logged in as **SuperBaggers**).
2. **Repository name:** `spotify-playlist-builder`
   *(Use exactly this — it makes your site URL match the redirect URI below. If you
   pick a different name, that's fine too; the app shows you the URI to register.)*
3. Set it to **Public**, then click **Create repository**.
   *(Public is required for free GitHub Pages. There are no secrets in these files —
   a Spotify Client ID is not sensitive — so public is safe here.)*
4. On the new empty repo page, click **uploading an existing file**
   (the link in "Quick setup").
5. Drag **all of these files** into the upload box:
   - `index.html`
   - `app.js`
   - `config.js`
   - `style.css`
   - `.nojekyll` *(optional; if your file picker hides it, don't worry about it)*
6. Click **Commit changes**.

## STEP 2 — Turn on GitHub Pages

1. In the repo, click **Settings** (top tab).
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. **Branch:** select `main`, folder `/ (root)`, then **Save**.
5. Wait ~1 minute, then refresh. The page will show your live address:

   ```
   https://superbaggers.github.io/spotify-playlist-builder/
   ```

   That's your site. (It may 404 for the first minute while it builds — give it a moment.)

## STEP 3 — Set up the Spotify app

1. Go to <https://developer.spotify.com/dashboard> → your app (or **Create app**).
2. Open **Settings → Edit**. Under **Redirect URIs**, add exactly:

   ```
   https://superbaggers.github.io/spotify-playlist-builder/
   ```

   *(Include the trailing slash. If you named the repo differently, open your live
   site — the setup screen prints the exact URI to paste here.)*
3. Make sure **Web API** is ticked under "APIs used". **Save.**
4. Still in Settings, copy the **Client ID** (you don't need the Client Secret).

## STEP 4 — Add your Client ID

1. Back in your GitHub repo, click `config.js`, then the **pencil** (Edit) icon.
2. Replace `PASTE_YOUR_CLIENT_ID_HERE` with your Client ID, keeping the quotes:

   ```js
   window.SPOTIFY_CLIENT_ID = "your_client_id_here";
   ```
3. Click **Commit changes**. Wait ~30 seconds for Pages to update.

## STEP 5 — Use it

Open `https://superbaggers.github.io/spotify-playlist-builder/`, click
**Connect to Spotify**, approve, and you're in.

- **Paste** your list (one track per line, `Artist - Title` works best).
- **Search Spotify** → review the matches, untick anything you don't want, click
  *"other matches"* to swap versions.
- **Export** (JSON / CSV / URIs) or **Add to my Spotify** to create the playlist.

---

## Updating the site later

Edit any file straight from the GitHub website (pencil icon → commit). Pages
redeploys automatically within a minute. No re-uploading needed.

## Troubleshooting

- **Site shows "Add your Client ID"** — `config.js` still has the placeholder, or
  Pages hasn't finished redeploying. Wait a minute and refresh.
- **Spotify says "INVALID_CLIENT: Invalid redirect URI"** — the URI registered on
  the Spotify app doesn't *exactly* match. Open your live site; it displays the
  exact string to paste into the dashboard (watch the trailing slash).
- **403 when searching or creating** — add your own account to the app's allowlist:
  dashboard → your app → **Settings → User Management** → add your Spotify email.
- **"Session expired"** — just click Connect again; it re-authorises silently.
- **Page 404s right after enabling Pages** — normal for the first ~60 seconds.

## Notes

- **Tokens** live only in your browser's local storage on the device you use. Click
  **Disconnect** to clear them.
- **Scopes** requested: `playlist-modify-private` and `playlist-modify-public` only.
  The app can't read your library or control playback.
- Searching is one request per track in sequence, so a long list takes a little
  while; if Spotify rate-limits it, the app waits and retries automatically.

## Files

```
index.html    the page
app.js        all logic: PKCE login, search, review, export, create
config.js     <- the only file you edit (your Client ID)
style.css     styling
.nojekyll     tells GitHub Pages to serve files as-is
```
