/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 *
 * Browser-only chat demo. No backend: Google Sign-In runs entirely
 * client-side (Google Identity Services), nothing about who signed in is
 * stored anywhere — it's just used to show a name/photo for this session.
 * The API key you enter is kept only in this browser's localStorage and is
 * sent directly from your browser to the provider you pick — it is never
 * seen by any server of ours, because there isn't one.
 */
(function () {
  "use strict";

  // Fill this in with your own OAuth 2.0 Web Client ID from
  // https://console.cloud.google.com/apis/credentials (see docs/README.md).
  // Sign-in simply won't work until this is a real client ID.
  const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com";

  const STORAGE_KEY = "wrexlyn_web_setup";

  // ---------- Interactive background glow ----------
  // Purely decorative — skipped entirely under prefers-reduced-motion rather than just slowed down, since a
  // cursor-chasing glow is motion, not just a transition.
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const root = document.documentElement;
    let pending = null;
    window.addEventListener(
      "pointermove",
      (e) => {
        if (pending) return;
        pending = requestAnimationFrame(() => {
          root.style.setProperty("--mx", `${e.clientX}px`);
          root.style.setProperty("--my", `${e.clientY}px`);
          pending = null;
        });
      },
      { passive: true }
    );
  }

  const el = {
    gate: document.getElementById("gate"),
    gateSignedOut: document.getElementById("gate-signed-out"),
    gateSetup: document.getElementById("gate-setup"),
    googleBtn: document.getElementById("google-signin-btn"),
    userChip: document.getElementById("user-chip"),
    userAvatar: document.getElementById("user-avatar"),
    userName: document.getElementById("user-name"),
    signoutLink: document.getElementById("signout-link"),
    providerSelect: document.getElementById("provider-select"),
    apiKeyInput: document.getElementById("api-key-input"),
    apiKeyLabel: document.getElementById("api-key-label"),
    providerNote: document.getElementById("provider-note"),
    setupError: document.getElementById("setup-error"),
    startBtn: document.getElementById("start-btn"),
    quickstartBtn: document.getElementById("quickstart-btn"),
    chatShell: document.getElementById("chat-shell"),
    chatMetaProvider: document.getElementById("chat-meta-provider"),
    changeSetupLink: document.getElementById("change-setup-link"),
    chatLog: document.getElementById("chat-log"),
    composerInput: document.getElementById("composer-input"),
    sendBtn: document.getElementById("send-btn"),
  };

  let currentUser = null; // { name, email, picture } from the Google ID token — session-only, never persisted
  let setup = null; // { provider, apiKey } — persisted to localStorage on this device only

  function populateProviderSelect() {
    el.providerSelect.innerHTML = Object.keys(PROVIDER_META)
      .map((id) => `<option value="${id}">${PROVIDER_META[id].label}</option>`)
      .join("");
  }
  populateProviderSelect();

  // ---------- Google Sign-In ----------

  function decodeJwt(token) {
    const payload = token.split(".")[1];
    const json = decodeURIComponent(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  }

  function handleGoogleCredential(response) {
    const claims = decodeJwt(response.credential);
    currentUser = { name: claims.name || claims.email, email: claims.email, picture: claims.picture };
    renderSignedIn();
  }

  function initGoogleSignIn() {
    if (GOOGLE_CLIENT_ID.startsWith("YOUR_")) {
      el.gateSignedOut.innerHTML =
        '<p class="error-text">Google Sign-In isn\'t configured yet — see docs/README.md for the two-minute setup ' +
        "(create an OAuth Client ID, paste it into app.js). Showing the setup panel directly for now so you can " +
        'still try the chat demo.</p><button class="btn btn-primary btn-full" id="skip-signin-btn">Continue without signing in</button>';
      document.getElementById("skip-signin-btn").addEventListener("click", () => {
        currentUser = { name: "Guest", email: "", picture: "" };
        renderSignedIn();
      });
      return;
    }
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
    });
    window.google.accounts.id.renderButton(el.googleBtn, { theme: "outline", size: "large", text: "signin_with" });
  }

  function renderSignedIn() {
    el.gateSignedOut.hidden = true;
    el.gateSetup.hidden = false;
    el.userChip.hidden = false;
    if (currentUser.picture) {
      el.userAvatar.src = currentUser.picture;
      el.userAvatar.hidden = false;
    }
    el.userName.textContent = currentUser.name;
    loadSetup();
  }

  function signOut() {
    currentUser = null;
    setup = null;
    el.userChip.hidden = true;
    el.userAvatar.hidden = true;
    el.chatShell.classList.remove("active");
    el.gate.hidden = false;
    el.gateSetup.hidden = true;
    el.gateSignedOut.hidden = false;
    if (window.google && !GOOGLE_CLIENT_ID.startsWith("YOUR_")) window.google.accounts.id.disableAutoSelect();
  }

  el.signoutLink.addEventListener("click", signOut);

  // ---------- Provider + API key setup ----------

  function renderProviderNote() {
    const meta = PROVIDER_META[el.providerSelect.value];
    el.apiKeyLabel.hidden = !meta.needsKey;
    el.apiKeyInput.hidden = !meta.needsKey;
    el.providerNote.innerHTML = meta.note;
  }

  function loadSetup() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && PROVIDER_META[saved.provider]) {
        el.providerSelect.value = saved.provider;
        el.apiKeyInput.value = saved.apiKey || "";
      }
    } catch {
      // corrupt/absent — start fresh
    }
    renderProviderNote();
  }

  el.providerSelect.addEventListener("change", renderProviderNote);

  el.startBtn.addEventListener("click", async () => {
    const provider = el.providerSelect.value;
    const meta = PROVIDER_META[provider];
    const apiKey = el.apiKeyInput.value.trim();
    if (meta.needsKey && !apiKey) {
      el.setupError.textContent = `${meta.label} needs an API key — paste one in, or switch providers.`;
      return;
    }
    el.setupError.textContent = "";
    await beginChat(provider, apiKey);
  });

  el.quickstartBtn.addEventListener("click", async () => {
    await beginChat("pollinations", "");
  });

  /** Resolves the provider's currently-available model (live list, cached, or a last-resort hardcoded
   *  fallback — see resolveModel() in providers.js) before entering the chat, so the model shown and the
   *  model actually sent in every request are always the same, real, working id. */
  async function beginChat(provider, apiKey) {
    const prevLabel = el.startBtn.textContent;
    el.startBtn.disabled = true;
    el.startBtn.textContent = "Checking available models…";
    let model;
    try {
      model = await resolveModel(provider, apiKey);
    } finally {
      el.startBtn.disabled = false;
      el.startBtn.textContent = prevLabel;
    }
    setup = { provider, apiKey, model };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
    startChat();
  }

  el.changeSetupLink.addEventListener("click", () => {
    el.chatShell.classList.remove("active");
    el.gate.hidden = false;
    el.gateSetup.hidden = false;
    el.gateSignedOut.hidden = true;
  });

  function startChat() {
    el.gate.hidden = true;
    el.chatShell.classList.add("active");
    el.chatMetaProvider.textContent = `${PROVIDER_META[setup.provider].label} · ${setup.model}`;
    el.composerInput.focus();
  }

  // ---------- Chat ----------

  const messages = [{ role: "system", content: WREXLYN_SYSTEM_PROMPT }];
  let busy = false;

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderMarkdown(raw) {
    const lines = raw.split("\n");
    let html = "";
    let inCode = false;
    let codeBuf = [];
    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (inCode) {
          html += `<pre>${escapeHtml(codeBuf.join("\n"))}</pre>`;
          codeBuf = [];
        }
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        continue;
      }
      let s = escapeHtml(line);
      s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
      s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      html += line.trim() === "" ? "<br>" : `<div>${s}</div>`;
    }
    if (codeBuf.length) html += `<pre>${escapeHtml(codeBuf.join("\n"))}</pre>`;
    return html;
  }

  function appendMessage(role, text) {
    const row = document.createElement("div");
    row.className = `msg msg-${role}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (role === "assistant") bubble.innerHTML = renderMarkdown(text);
    else bubble.textContent = text;
    row.appendChild(bubble);
    el.chatLog.appendChild(row);
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
    return bubble;
  }

  function showThinking() {
    const row = document.createElement("div");
    row.className = "thinking-dots";
    row.id = "thinking-row";
    row.textContent = "thinking…";
    el.chatLog.appendChild(row);
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }
  function hideThinking() {
    const row = document.getElementById("thinking-row");
    if (row) row.remove();
  }

  async function sendMessage() {
    const text = el.composerInput.value.trim();
    if (!text || busy) return;
    el.composerInput.value = "";
    el.composerInput.style.height = "auto";
    appendMessage("user", text);
    messages.push({ role: "user", content: text });

    busy = true;
    el.sendBtn.disabled = true;
    showThinking();

    let assistantBubble = null;
    let acc = "";
    try {
      const meta = PROVIDER_META[setup.provider];
      await meta.stream(messages, setup.apiKey, setup.model, (chunk) => {
        hideThinking();
        acc += chunk;
        if (!assistantBubble) assistantBubble = appendMessage("assistant", "");
        assistantBubble.innerHTML = renderMarkdown(acc);
        el.chatLog.scrollTop = el.chatLog.scrollHeight;
      });
      hideThinking();
      if (!acc) acc = "(no response)";
      if (!assistantBubble) appendMessage("assistant", acc);
      messages.push({ role: "assistant", content: acc });
    } catch (err) {
      hideThinking();
      appendMessage("error", `⚠ ${err.message || String(err)}`);
    } finally {
      busy = false;
      el.sendBtn.disabled = false;
      el.composerInput.focus();
    }
  }

  el.sendBtn.addEventListener("click", sendMessage);
  el.composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  el.composerInput.addEventListener("input", () => {
    el.composerInput.style.height = "auto";
    el.composerInput.style.height = Math.min(el.composerInput.scrollHeight, 160) + "px";
  });

  initGoogleSignIn();
})();
