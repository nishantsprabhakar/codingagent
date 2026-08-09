# Wrexlyn web demo (docs/)

A static, browser-only chat demo of Wrexlyn, meant to be served by GitHub
Pages. It has **no backend** — no server, no database — which means:

## One-time setup: enable GitHub Pages

This repo doesn't have Pages enabled yet — I don't have a token to flip
that setting via the API, so it needs one manual step from you:

1. Go to **github.com/nishantsprabhakar/codingagent → Settings → Pages**.
2. Under "Build and deployment" → "Source", choose **"Deploy from a
   branch"**.
3. Branch: **main**, folder: **/docs**. Save.
4. GitHub builds and publishes it within a minute or two, at
   **https://nishantsprabhakar.github.io/codingagent/**.


- It cannot read/write files or run shell commands. That's the real agent,
  which only exists as the local desktop app in the rest of this repo.
- Google Sign-In runs entirely client-side (Google Identity Services). It
  verifies who's using the page for that browser session only — nothing
  about the signed-in user is stored anywhere, on any server, ever.
- The API key a visitor enters is kept in that browser's `localStorage`
  and sent directly from their browser to the provider they picked. It
  never passes through any server of ours.

## One-time setup: Google Sign-In

Sign-in won't work until you create your own OAuth Client ID (this has to
happen under your own Google account — nobody else can do this step for
you):

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Create a project if you don't have one already (top-left project picker
   → "New Project").
3. Click **"+ Create Credentials" → "OAuth client ID"**.
   - If prompted to configure the OAuth consent screen first, choose
     **External**, fill in an app name and your email, and save — you
     don't need to submit it for verification for personal/demo use.
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: add the URL this page will be
     served from, e.g. `https://<your-github-username>.github.io` (no
     trailing slash, no path).
4. Copy the generated **Client ID** (ends in `.apps.googleusercontent.com`).
5. Open `docs/app.js` and replace `YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com`
   near the top with your real client ID. Commit and push.

Until you do this, the page shows a "Continue without signing in" fallback
so the chat demo itself is still usable — but real Google Sign-In needs
the steps above.

## Why the provider list is hand-verified, not just copied from the desktop app

Calling an LLM API directly from a browser only works if that API sends
CORS headers allowing it — many provider APIs are built for server-to-
server use and deliberately block direct browser requests. The desktop
app's `src/providers/*.ts` prove nothing about this either way, since
Node has no CORS restriction at all. Each provider in `providers.js` was confirmed with a live `OPTIONS`/`POST`
request carrying a real `Origin` header before being added (Pollinations,
Groq, OpenRouter, Gemini, Cerebras, and Mistral currently pass, as of
2026-08) — if you add another provider, verify its CORS behavior the same
way first; a provider that worked when this was written can also change
that behavior later.

Pollinations is the default, no-key provider — plain chat requests (no
tools) pass CORS and no longer hit the Cloudflare Turnstile bot-challenge
that blocked it earlier in 2026-08. Its anonymous tier is still not fully
dependable, though: the exact same request has been observed returning
`200` and then `402 Payment Required` ("budget too low") seconds apart,
and only one model is exposed anonymously — a reasoning model that
sometimes streams its answer as a `reasoning` delta instead of `content`.
`providers.js`'s `pollinationsStream()` handles both, and surfaces a
"pick another provider and paste in a key" message on 402 instead of
retrying forever. Re-verify with an actual browser `fetch()` before
trusting curl alone, or before assuming this note is still accurate —
free anonymous tiers change behavior without notice.

## Local preview

Any static file server works, e.g. from the repo root:

```bash
npx http-server docs -p 8080
```

Then open `http://localhost:8080`.
