/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
(() => {
  "use strict";

  const el = {
    sidebar: document.getElementById("sidebar"),
    sidebarToggle: document.getElementById("sidebar-toggle"),
    fileTree: document.getElementById("file-tree"),
    statusDot: document.getElementById("status-dot"),
    statusText: document.getElementById("status-text"),
    hudDiagnostic: document.getElementById("hud-diagnostic"),
    cwdLabel: document.getElementById("cwd-label"),
    projectCard: document.getElementById("project-card"),
    projectCardName: document.getElementById("project-card-name"),
    modelBadge: document.getElementById("model-badge"),
    yoloBadge: document.getElementById("yolo-badge"),
    chatLog: document.getElementById("chat-log"),
    composerInput: document.getElementById("composer-input"),
    sendBtn: document.getElementById("send-btn"),
    codePanel: document.getElementById("code-panel"),
    codePanelTitle: document.getElementById("code-panel-title"),
    codePanelContent: document.getElementById("code-panel-content"),
    codePanelClose: document.getElementById("code-panel-close"),
    permOverlay: document.getElementById("permission-overlay"),
    permTool: document.getElementById("permission-tool"),
    permLabel: document.getElementById("permission-label"),
    permPreview: document.getElementById("permission-preview"),
    permRisk: document.getElementById("permission-risk"),
    permHighRiskWarning: document.getElementById("permission-high-risk-warning"),
    permAllow: document.getElementById("perm-allow"),
    permAlways: document.getElementById("perm-always"),
    permDeny: document.getElementById("perm-deny"),
    progressSection: document.getElementById("progress-section"),
    createdFilesSection: document.getElementById("created-files-section"),
    newChatBtn: document.getElementById("new-chat-btn"),
    sessionList: document.getElementById("session-list"),
    folderBtn: document.getElementById("folder-btn"),
    folderOverlay: document.getElementById("folder-overlay"),
    folderInput: document.getElementById("folder-input"),
    recentFolders: document.getElementById("recent-folders"),
    folderCancel: document.getElementById("folder-cancel"),
    folderSwitch: document.getElementById("folder-switch"),
    folderBrowserUp: document.getElementById("folder-browser-up"),
    folderBrowserPath: document.getElementById("folder-browser-path"),
    folderBrowserList: document.getElementById("folder-browser-list"),
    folderNewName: document.getElementById("folder-new-name"),
    folderNewCreate: document.getElementById("folder-new-create"),
    folderNewError: document.getElementById("folder-new-error"),
    uploadInput: document.getElementById("upload-input"),
    modelOverlay: document.getElementById("model-overlay"),
    modelSearch: document.getElementById("model-search"),
    modelList: document.getElementById("model-list"),
    modelCancel: document.getElementById("model-cancel"),
    modelProviderNote: document.getElementById("model-provider-note"),
    modelProviderChips: document.getElementById("model-provider-chips"),
    themeBtn: document.getElementById("theme-btn"),
    themeOverlay: document.getElementById("theme-overlay"),
    themeList: document.getElementById("theme-list"),
    themeCancel: document.getElementById("theme-cancel"),
    settingsBtn: document.getElementById("settings-btn"),
    settingsOverlay: document.getElementById("settings-overlay"),
    settingsClose: document.getElementById("settings-close"),
    settingsTabInstructions: document.getElementById("settings-tab-instructions"),
    settingsTabMcp: document.getElementById("settings-tab-mcp"),
    settingsTabApiKeys: document.getElementById("settings-tab-apikeys"),
    settingsTabSkills: document.getElementById("settings-tab-skills"),
    settingsTabPhone: document.getElementById("settings-tab-phone"),
    settingsPanelInstructions: document.getElementById("settings-panel-instructions"),
    settingsPanelMcp: document.getElementById("settings-panel-mcp"),
    settingsPanelApiKeys: document.getElementById("settings-panel-apikeys"),
    settingsPanelSkills: document.getElementById("settings-panel-skills"),
    settingsPanelPhone: document.getElementById("settings-panel-phone"),
    settingsApiKeysStatus: document.getElementById("settings-apikeys-status"),
    apikeyRows: document.getElementById("apikey-rows"),
    phoneQrcode: document.getElementById("phone-qrcode"),
    phoneConnectUrl: document.getElementById("phone-connect-url"),
    settingsInstructionsInput: document.getElementById("settings-instructions-input"),
    settingsInstructionsSave: document.getElementById("settings-instructions-save"),
    settingsInstructionsStatus: document.getElementById("settings-instructions-status"),
    mcpGallery: document.getElementById("mcp-gallery"),
    mcpServerList: document.getElementById("mcp-server-list"),
    mcpAddBtn: document.getElementById("mcp-add-btn"),
    settingsMcpSave: document.getElementById("settings-mcp-save"),
    settingsMcpStatus: document.getElementById("settings-mcp-status"),
    learnedSkillsList: document.getElementById("learned-skills-list"),
    starterSkillsList: document.getElementById("starter-skills-list"),
    skillLibrarySection: document.getElementById("skill-library-section"),
    skillLibraryList: document.getElementById("skill-library-list"),
  };

  const TOOL_ICONS = {
    read_file: "R",
    write_file: "W",
    edit_file: "E",
    list_dir: "D",
    glob_search: "G",
    grep_search: "S",
    run_shell_command: "$",
    update_tasks: "☑",
    create_docx: "📄",
    create_pptx: "📊",
    create_xlsx: "📈",
  };

  const state = {
    ws: null,
    busy: false,
    toolCards: new Map(),
    thinkingRow: null,
    pendingPermissionId: null,
    currentRoot: "",
    recentFolders: [],
    currentProvider: "",
    currentModel: "",
    modelCache: null,
    sessionId: "",
    sessions: [],
    createdFiles: [],
    streamingBubble: null,
  };

  // ---------- Auth ----------
  // The server requires a bearer token on every /api/ route and the WebSocket
  // handshake (see src/web/server.ts). It arrives one of two ways: as a
  // `?token=` URL param the very first time this machine's own browser opens
  // the app (from the URL the server printed at startup), or as a `?pair=`
  // URL param from a scanned QR code, exchanged once for the real token via
  // /api/pair. Either way it's moved into sessionStorage and stripped from
  // the URL immediately — never left sitting in the address bar/history.
  const AUTH_STORAGE_KEY = "wrexlyn_auth_token";

  function getAuthToken() {
    return sessionStorage.getItem(AUTH_STORAGE_KEY);
  }

  function stripSearchParams(names) {
    const params = new URLSearchParams(location.search);
    for (const name of names) params.delete(name);
    const query = params.toString();
    history.replaceState(null, "", location.pathname + (query ? `?${query}` : ""));
  }

  async function bootstrapAuthToken() {
    const params = new URLSearchParams(location.search);
    const urlToken = params.get("token");
    const pairToken = params.get("pair");

    if (urlToken) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, urlToken);
      stripSearchParams(["token"]);
      return;
    }

    if (pairToken) {
      try {
        const res = await fetch(`/api/pair?token=${encodeURIComponent(pairToken)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.authToken) sessionStorage.setItem(AUTH_STORAGE_KEY, data.authToken);
        }
      } catch {
        // fall through — connect() will fail its auth check and the UI shows a disconnected state
      }
      stripSearchParams(["pair"]);
    }
  }

  /** Use this instead of raw fetch() for every /api/ call — attaches the auth token the same way every time. */
  async function apiFetch(url, opts = {}) {
    const token = getAuthToken();
    const headers = new Headers(opts.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...opts, headers });
  }

  const BINARY_FILE_EXTS = new Set(["docx", "pptx", "xlsx", "pdf", "png", "jpg", "jpeg", "gif", "ico", "zip", "wasm", "bin"]);
  const FILE_ICONS = {
    docx: "📄", pptx: "📊", xlsx: "📈", pdf: "📕",
    png: "🖼", jpg: "🖼", jpeg: "🖼", gif: "🖼",
    md: "📝", json: "🧾", js: "📜", ts: "📜", html: "🌐", css: "🎨",
  };
  function fileIcon(name) {
    const ext = name.split(".").pop().toLowerCase();
    return FILE_ICONS[ext] || "📄";
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function clearEmptyState() {
    const empty = el.chatLog.querySelector(".empty-state");
    if (empty) empty.remove();
  }

  function showEmptyState(title) {
    el.chatLog.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-glyph">&gt;_</div>
        <div class="empty-state-title">${escapeHtml(title)}</div>
        <div class="empty-state-sub">Describe what you want built, fixed, or explained.</div>
      </div>`;
  }

  function scrollToBottom() {
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }

  // ---------- Connection ----------

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const token = getAuthToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    const ws = new WebSocket(`${protocol}//${location.host}/${qs}`);
    state.ws = ws;

    ws.addEventListener("open", () => setBusy(false));
    ws.addEventListener("close", () => {
      const wasBusy = state.busy;
      showThinking(false);
      state.streamingBubble = null;
      interruptPendingToolCards();
      if (state.pendingPermissionId) {
        el.permOverlay.hidden = true;
        state.pendingPermissionId = null;
      }
      setBusy(false);
      if (wasBusy) {
        appendErrorMessage("Connection to the agent was lost. Reconnecting… you'll need to resend your last message.");
        stopFakeProgress();
        pushFeedItem("🔌", "Connection lost", "tool-fail");
        setHudSummary("Disconnected");
      }
      setTimeout(connect, 2000);
    });
    ws.addEventListener("error", () => ws.close());
    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      handleServerMessage(msg);
    });
  }

  function setStatus(kind) {
    el.statusDot.className = `status-dot ${kind}`;
    el.statusText.textContent =
      kind === "connected" ? "connected" : kind === "busy" ? "working…" : "disconnected";
    renderHudDiagnostic(kind);
  }

  // ---------- Tactical HUD diagnostic line (cosmetic — decorative telemetry, not a real metric) ----------

  let hudDiagnosticKind = "disconnected";

  function renderHudDiagnostic(kind) {
    hudDiagnosticKind = kind;
    if (!el.hudDiagnostic) return;
    const ms = new Date();
    const clock =
      String(ms.getHours()).padStart(2, "0") +
      ":" +
      String(ms.getMinutes()).padStart(2, "0") +
      ":" +
      String(ms.getSeconds()).padStart(2, "0") +
      "." +
      String(ms.getMilliseconds()).padStart(3, "0");
    let sys, line, cls;
    if (kind === "disconnected") {
      sys = "OFFLINE";
      line = "LINK_LOST";
      cls = "hud-diag-fail";
    } else if (kind === "busy") {
      sys = "ACTIVE";
      const pct = (50 + 45 * Math.abs(Math.sin(Date.now() / 900))).toFixed(1);
      line = `AGENT_THINKING [${pct}%]`;
      cls = "hud-diag-busy";
    } else {
      sys = "OPTIMAL";
      line = "STANDBY";
      cls = "hud-diag-ok";
    }
    el.hudDiagnostic.innerHTML =
      `${clock} // SYS_STATUS: <span class="${cls}">${sys}</span> // ${line}`;
  }

  setInterval(() => {
    if (document.documentElement.getAttribute("data-theme") === "tactical") {
      renderHudDiagnostic(hudDiagnosticKind);
    }
  }, 150);

  function send(msg) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(msg));
    }
  }

  // ---------- Server message handling ----------

  function handleServerMessage(msg) {
    switch (msg.type) {
      case "init": {
        const rootChanged = state.currentRoot && state.currentRoot !== msg.root;
        state.currentRoot = msg.root;
        state.recentFolders = msg.recentFolders || [];
        state.currentProvider = msg.provider;
        state.currentModel = msg.model;
        state.sessionId = msg.sessionId;
        el.cwdLabel.textContent = msg.root;
        el.cwdLabel.title = msg.root;
        updateProjectCard(msg.root);
        updateModelBadge();
        el.yoloBadge.hidden = !msg.yolo;
        // The server always follows "init" with fresh "history"/"tasks" for
        // whatever session is now active — clear the view and let those
        // messages repopulate it (an empty history just leaves it empty).
        state.toolCards.clear();
        state.streamingBubble = null;
        hudReset();
        renderCreatedFiles([]);
        el.codePanel.hidden = true;
        showEmptyState(rootChanged ? "Switched project folder." : "Ready when you are.");
        loadTree(el.fileTree, ".");
        break;
      }
      case "sessions":
        state.sessions = msg.sessions;
        state.sessionId = msg.activeId;
        renderSessionList();
        break;
      case "thinking":
        showThinking(msg.value);
        hudOnThinking(msg.value);
        break;
      case "tool_call":
        addToolCard(msg.id, msg.name, msg.label, msg.risk);
        hudOnToolCall(msg.id, msg.name, msg.label);
        break;
      case "tool_result":
        updateToolCard(msg.id, msg.output, msg.ok);
        hudOnToolResult(msg.id, msg.ok);
        break;
      case "verification_result":
        renderVerificationResult(msg.result);
        break;
      case "critique_result":
        renderCritiqueResult(msg.pass, msg.reason);
        break;
      case "transaction_summary":
        renderTransactionSummary(msg.transactionId, msg.confidence, msg.outcome, msg.rollbackAvailable);
        break;
      case "rollback_result":
        handleRollbackResult(msg.transactionId, msg.ok, msg.items);
        break;
      case "assistant_delta":
        appendAssistantDelta(msg.chunk);
        break;
      case "assistant_delta_end":
        finalizeAssistantMessage(msg.text, msg.final);
        if (msg.final) {
          setBusy(false);
          hudOnTurnEnd(true);
        }
        break;
      case "error":
        showThinking(false);
        appendErrorMessage(msg.text);
        setBusy(false);
        hudOnTurnEnd(false);
        break;
      case "permission_request":
        showPermissionModal(msg.id, msg.toolName, msg.label, msg.risk, msg.preview);
        break;
      case "tasks":
        applyTasks(msg.tasks);
        break;
      case "files":
        renderCreatedFiles(msg.files);
        break;
      case "history":
        replayHistory(msg.items);
        break;
      case "model_changed":
        state.currentModel = msg.model;
        updateModelBadge();
        break;
      case "provider_changed":
        state.currentProvider = msg.provider;
        state.currentModel = msg.model;
        state.modelCache = null;
        updateModelBadge();
        break;
      case "settings_saved":
        if (msg.which === "instructions") flashStatus(el.settingsInstructionsStatus, "Saved.");
        if (msg.which === "api_keys" || msg.which === "custom_provider") {
          flashStatus(el.settingsApiKeysStatus, "Saved.");
          loadApiKeysStatus();
        }
        break;
      case "mcp_reloaded":
        flashStatus(el.settingsMcpStatus, `Saved — ${msg.toolCount} tool${msg.toolCount === 1 ? "" : "s"} available.`);
        break;
      case "skills_changed":
        if (!el.settingsPanelSkills.hidden) loadSkillsPanel();
        break;
    }
  }

  function updateModelBadge() {
    const text = state.currentProvider ? `${state.currentProvider} · ${state.currentModel}` : state.currentModel;
    el.modelBadge.textContent = text;
    el.modelBadge.title = `${text} — click to change`;
  }

  function updateProjectCard(root) {
    if (!root) return;
    const name = root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || root;
    el.projectCardName.textContent = name;
    el.projectCardName.title = root;
  }

  // ---------- Live activity HUD (percentage ring + live feed) ----------

  const RING_RADIUS = 26;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  const hud = {
    built: false,
    visible: false,
    tasks: [],
    feed: [],
    feedSeq: 0,
    feedCollapsed: false,
    stepperCollapsed: false,
    stepperUserToggled: false,
    toolLabels: new Map(),
    fakePercent: 0,
    fakeTimer: null,
  };

  function ensureHudSkeleton() {
    if (hud.built) return;
    el.progressSection.innerHTML = `
      <div class="sidebar-section-title">Live Activity</div>
      <div class="progress-panel" id="hud-panel" title="Click to expand/collapse the step list">
        <div class="progress-ring-wrap">
          <svg class="progress-ring" viewBox="0 0 64 64">
            <circle class="progress-ring-bg" cx="32" cy="32" r="${RING_RADIUS}"></circle>
            <circle class="progress-ring-fill" id="hud-ring-fill" cx="32" cy="32" r="${RING_RADIUS}"
              stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${RING_CIRCUMFERENCE}"></circle>
          </svg>
          <div class="progress-percent" id="hud-percent">0<span class="progress-percent-sign">%</span></div>
        </div>
        <div class="progress-summary" id="hud-summary">Idle</div>
        <span class="progress-caret" id="hud-caret">&#9662;</span>
      </div>
      <div class="progress-stepper" id="hud-stepper" hidden></div>
      <div class="feed-panel">
        <div class="feed-header" id="feed-toggle" title="Click to expand/collapse">
          <span class="feed-live-dot"></span>
          <span class="feed-title">Live feed</span>
          <span class="feed-caret">&#9662;</span>
        </div>
        <div class="feed-list" id="feed-list"></div>
      </div>
    `;
    el.hudPanel = document.getElementById("hud-panel");
    el.hudRingFill = document.getElementById("hud-ring-fill");
    el.hudPercent = document.getElementById("hud-percent");
    el.hudSummary = document.getElementById("hud-summary");
    el.hudStepper = document.getElementById("hud-stepper");
    el.hudCaret = document.getElementById("hud-caret");
    document.getElementById("hud-panel").addEventListener("click", () => {
      if (!hud.tasks.length) return;
      hud.stepperUserToggled = true;
      hud.stepperCollapsed = !hud.stepperCollapsed;
      applyStepperCollapse();
    });
    el.feedToggle = document.getElementById("feed-toggle");
    el.feedList = document.getElementById("feed-list");
    el.feedToggle.addEventListener("click", () => {
      hud.feedCollapsed = !hud.feedCollapsed;
      el.feedToggle.classList.toggle("collapsed", hud.feedCollapsed);
      el.feedList.classList.toggle("collapsed", hud.feedCollapsed);
    });
    hud.built = true;
  }

  function setHudVisible(visible) {
    hud.visible = visible;
    ensureHudSkeleton();
    el.progressSection.hidden = !visible;
  }

  function setHudPercent(percent) {
    ensureHudSkeleton();
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    const offset = RING_CIRCUMFERENCE * (1 - clamped / 100);
    el.hudRingFill.style.strokeDashoffset = String(offset);
    el.hudPercent.innerHTML = `${clamped}<span class="progress-percent-sign">%</span>`;
    el.hudPanel.classList.toggle("active", clamped < 100);
  }

  function setHudSummary(text) {
    ensureHudSkeleton();
    el.hudSummary.textContent = text;
  }

  function formatFeedAge(ts) {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 1) return "now";
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)}m ago`;
  }

  function jumpToToolCard(toolId) {
    const card = state.toolCards.get(toolId);
    if (!card) return;
    card.classList.add("open");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("tool-card-flash");
    setTimeout(() => card.classList.remove("tool-card-flash"), 900);
  }

  function pushFeedItem(icon, text, kind, toolId) {
    ensureHudSkeleton();
    const item = { id: ++hud.feedSeq, icon, text, kind, ts: Date.now(), toolId };
    hud.feed.unshift(item);
    if (hud.feed.length > 40) hud.feed.length = 40;

    const row = document.createElement("div");
    row.className = `feed-item feed-item-${kind} feed-item-enter`;
    row.dataset.id = String(item.id);
    row.innerHTML = `
      <span class="feed-icon">${icon}</span>
      <span class="feed-text">${escapeHtml(text)}</span>
      <span class="feed-time">now</span>
    `;
    if (toolId) {
      row.classList.add("feed-item-clickable");
      row.title = "Click to jump to this step";
      row.addEventListener("click", () => jumpToToolCard(toolId));
    }
    el.feedList.insertBefore(row, el.feedList.firstChild);
    requestAnimationFrame(() => row.classList.remove("feed-item-enter"));
    while (el.feedList.children.length > 40) el.feedList.removeChild(el.feedList.lastChild);
  }

  setInterval(() => {
    if (!hud.built) return;
    for (const row of el.feedList.querySelectorAll(".feed-item")) {
      const item = hud.feed.find((f) => String(f.id) === row.dataset.id);
      const timeEl = row.querySelector(".feed-time");
      if (item && timeEl) timeEl.textContent = formatFeedAge(item.ts);
    }
  }, 1000);

  function stopFakeProgress() {
    if (hud.fakeTimer) {
      clearInterval(hud.fakeTimer);
      hud.fakeTimer = null;
    }
  }

  function startFakeProgress() {
    stopFakeProgress();
    hud.fakePercent = 5;
    setHudPercent(hud.fakePercent);
    hud.fakeTimer = setInterval(() => {
      if (hud.tasks.length) return;
      const remaining = 92 - hud.fakePercent;
      hud.fakePercent = Math.min(92, hud.fakePercent + Math.max(0.3, remaining * 0.05));
      setHudPercent(hud.fakePercent);
    }, 240);
  }

  function bumpFakeProgress(amount) {
    if (hud.tasks.length) return;
    hud.fakePercent = Math.min(92, hud.fakePercent + amount);
    setHudPercent(hud.fakePercent);
  }

  function applyStepperCollapse() {
    el.hudStepper.hidden = !hud.tasks.length || hud.stepperCollapsed;
    el.hudCaret.classList.toggle("collapsed", hud.stepperCollapsed);
  }

  function renderStepper() {
    ensureHudSkeleton();
    if (!hud.tasks.length) {
      el.hudStepper.innerHTML = "";
      applyStepperCollapse();
      return;
    }
    const steps = hud.tasks
      .map((t, i) => {
        const isLast = i === hud.tasks.length - 1;
        const dotContent = t.status === "completed" ? "&#10003;" : "";
        const line = isLast ? "" : `<span class="stepper-line ${t.status === "completed" ? "filled" : ""}"></span>`;
        return `
          <div class="stepper-step">
            <div class="stepper-marker">
              <span class="stepper-dot ${t.status}">${dotContent}</span>
              ${line}
            </div>
            <div class="stepper-label ${t.status}">${escapeHtml(t.subject)}</div>
          </div>
        `;
      })
      .join("");
    el.hudStepper.innerHTML = steps;
    applyStepperCollapse();
  }

  function applyTasks(tasks) {
    hud.tasks = Array.isArray(tasks) ? tasks : [];
    if (hud.tasks.length) {
      setHudVisible(true);
      stopFakeProgress();
      const total = hud.tasks.length;
      const completed = hud.tasks.filter((t) => t.status === "completed").length;
      setHudPercent(Math.round((completed / total) * 100));
      setHudSummary(`${completed} / ${total} steps complete`);
      // A session that loads (or replays) with every step already done shouldn't
      // spend permanent sidebar space on an expanded checklist — same declutter
      // logic as the post-turn auto-collapse, just also covering the initial
      // render. Once the user has clicked the toggle themselves, leave it alone.
      if (completed === total && !hud.stepperUserToggled) hud.stepperCollapsed = true;
    } else if (!state.busy) {
      setHudSummary("Idle");
    }
    renderStepper();
  }

  function hudReset() {
    ensureHudSkeleton();
    hud.tasks = [];
    hud.feed = [];
    hud.toolLabels.clear();
    el.feedList.innerHTML = "";
    stopFakeProgress();
    setHudPercent(0);
    setHudSummary("Idle");
    renderStepper();
    setHudVisible(false);
  }

  function hudOnTurnStart() {
    hudReset();
    setHudVisible(true);
    setHudSummary("Starting…");
    startFakeProgress();
    pushFeedItem("🧠", "Sent to model", "start");
  }

  function hudOnThinking(isThinking) {
    if (!hud.visible || !isThinking) return;
    setHudSummary("Thinking…");
    pushFeedItem("🧠", "Thinking…", "thinking");
    bumpFakeProgress(4);
  }

  function hudOnToolCall(id, name, label) {
    hud.toolLabels.set(id, label);
    setHudSummary(`Running ${label}`);
    pushFeedItem(TOOL_ICONS[name] || (name.startsWith("mcp__") ? "⚡" : "T"), `Running ${label}`, "tool", id);
    bumpFakeProgress(9);
  }

  function hudOnToolResult(id, ok) {
    const label = hud.toolLabels.get(id) || "step";
    pushFeedItem(ok ? "✅" : "⚠️", `${label} — ${ok ? "done" : "failed"}`, ok ? "tool-ok" : "tool-fail", id);
    bumpFakeProgress(6);
  }

  function hudOnTurnEnd(ok) {
    if (!hud.visible) return;
    stopFakeProgress();
    if (!hud.tasks.length) {
      setHudPercent(100);
      setHudSummary(ok ? "Done" : "Stopped");
    }
    pushFeedItem(ok ? "🏁" : "⚠️", ok ? "Response ready" : "Turn ended with an error", ok ? "done" : "tool-fail");
    setTimeout(() => {
      if (!state.busy) setHudVisible(hud.tasks.length > 0);
      // Once a turn with a real task list finishes, tuck the step-by-step
      // detail away by default — the ring/summary line stays, one click
      // re-expands it. Otherwise a completed checklist sits there taking up
      // sidebar space for the rest of the session.
      if (hud.tasks.length > 0 && !hud.stepperCollapsed) {
        hud.stepperCollapsed = true;
        applyStepperCollapse();
      }
    }, 2200);
  }

  // ---------- History replay ----------

  function replayHistory(items) {
    if (!items || !items.length) return;
    clearEmptyState();

    const divider = document.createElement("div");
    divider.className = "history-divider";
    divider.textContent = "Resumed previous session";
    el.chatLog.appendChild(divider);

    for (const item of items) {
      if (item.type === "user") appendUserMessage(item.text);
      else if (item.type === "assistant") appendAssistantMessage(item.text);
      else if (item.type === "error") appendErrorMessage(item.text);
      else if (item.type === "tool") {
        addToolCard(item.id, item.name, item.label);
        updateToolCard(item.id, item.output, item.ok);
      } else if (item.type === "verification") {
        renderVerificationResult(item.result);
      } else if (item.type === "critique") {
        renderCritiqueResult(item.pass, item.reason);
      } else if (item.type === "transaction_summary") {
        renderTransactionSummary(item.transactionId, item.confidence, item.outcome, item.rollbackAvailable);
      }
    }
    scrollToBottom();
  }

  // ---------- Chat rendering ----------

  function appendUserMessage(text) {
    clearEmptyState();
    const row = document.createElement("div");
    row.className = "msg msg-user";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    el.chatLog.appendChild(row);
    scrollToBottom();
  }

  function inlineMarkdown(line) {
    let s = escapeHtml(line);
    s = s.replace(/`([^`]+)`/g, '<code class="msg-inline-code">$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return s;
  }

  /** Minimal, safe markdown: escapes first, then only ever injects tags we control. */
  function renderMarkdown(raw) {
    const lines = raw.split("\n");
    let html = "";
    let inList = false;
    let inCode = false;
    let codeBuffer = [];

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (inCode) {
          html += `<pre class="msg-code">${escapeHtml(codeBuffer.join("\n"))}</pre>`;
          codeBuffer = [];
        }
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        codeBuffer.push(line);
        continue;
      }

      const bulletMatch = line.match(/^\s*[-*]\s+(.*)/);
      if (bulletMatch) {
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        html += `<li>${inlineMarkdown(bulletMatch[1])}</li>`;
        continue;
      }
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += line.trim() === "" ? "<br>" : `<div>${inlineMarkdown(line)}</div>`;
    }
    if (inList) html += "</ul>";
    if (codeBuffer.length) html += `<pre class="msg-code">${escapeHtml(codeBuffer.join("\n"))}</pre>`;
    return html;
  }

  function appendAssistantMessage(text) {
    clearEmptyState();
    const row = document.createElement("div");
    row.className = "msg msg-assistant";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = renderMarkdown(text);
    row.appendChild(bubble);
    el.chatLog.appendChild(row);
    scrollToBottom();
  }

  // ---------- Streaming assistant messages ----------
  // The model's response arrives token-by-token over the socket. state.streamingBubble
  // tracks the in-progress <div class="bubble"> so successive deltas append into the
  // same element instead of creating a new message each time.

  function appendAssistantDelta(chunk) {
    showThinking(false);
    if (!state.streamingBubble) {
      clearEmptyState();
      const row = document.createElement("div");
      row.className = "msg msg-assistant";
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      row.appendChild(bubble);
      el.chatLog.appendChild(row);
      state.streamingBubble = { bubble, text: "" };
    }
    state.streamingBubble.text += chunk;
    state.streamingBubble.bubble.innerHTML = renderMarkdown(state.streamingBubble.text) + '<span class="stream-caret">&#9615;</span>';
    scrollToBottom();
  }

  function finalizeAssistantMessage(fullText, isFinal) {
    if (state.streamingBubble) {
      state.streamingBubble.bubble.innerHTML = renderMarkdown(fullText);
      state.streamingBubble = null;
    } else if (fullText) {
      // Nothing streamed for this message (e.g. a provider with no delta content) — show it directly.
      appendAssistantMessage(fullText);
    }
    if (isFinal) scrollToBottom();
  }

  function appendErrorMessage(text) {
    clearEmptyState();
    const row = document.createElement("div");
    row.className = "msg msg-assistant msg-error";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = `⚠ ${text}`;
    row.appendChild(bubble);
    el.chatLog.appendChild(row);
    scrollToBottom();
  }

  function showThinking(isThinking) {
    if (isThinking) {
      if (state.thinkingRow) return;
      clearEmptyState();
      const row = document.createElement("div");
      row.className = "thinking-row";
      row.innerHTML = `<span class="dots"><span></span><span></span><span></span></span> thinking`;
      el.chatLog.appendChild(row);
      state.thinkingRow = row;
      scrollToBottom();
    } else if (state.thinkingRow) {
      state.thinkingRow.remove();
      state.thinkingRow = null;
    }
  }

  function interruptPendingToolCards() {
    for (const card of state.toolCards.values()) {
      const status = card.querySelector(".tool-status");
      if (status && status.classList.contains("pending")) {
        status.textContent = "interrupted";
        status.className = "tool-status fail";
      }
    }
    state.toolCards.clear();
  }

  function addToolCard(id, name, label, risk) {
    clearEmptyState();
    showThinking(false);

    const card = document.createElement("div");
    card.className = "tool-card";

    const icon = TOOL_ICONS[name] || (name.startsWith("mcp__") ? "⚡" : "T");
    const riskBadge =
      risk && risk !== "low" ? `<span class="risk-badge risk-badge-sm risk-${risk}">${risk}</span>` : "";
    card.innerHTML = `
      <div class="tool-card-header">
        <span class="tool-icon">${escapeHtml(icon)}</span>
        <span class="tool-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        ${riskBadge}
        <span class="tool-status pending">running…</span>
        <span class="tool-caret">&#9656;</span>
      </div>
      <div class="tool-card-body"><pre class="tool-output">Waiting for result…</pre></div>
    `;
    card.querySelector(".tool-card-header").addEventListener("click", () => {
      card.classList.toggle("open");
    });

    el.chatLog.appendChild(card);
    state.toolCards.set(id, card);
    scrollToBottom();
  }

  function updateToolCard(id, output, ok) {
    const card = state.toolCards.get(id);
    if (!card) return;

    const status = card.querySelector(".tool-status");
    status.textContent = ok ? "done" : "failed";
    status.className = `tool-status ${ok ? "ok" : "fail"}`;

    const pre = card.querySelector(".tool-output");
    pre.textContent = output;

    if (!ok) card.classList.add("open");
    scrollToBottom();
  }

  // ---------- Verification + transaction summary (V-Cycle) ----------

  const OUTCOME_LABELS = {
    verified: "Verified",
    reviewed: "Reviewed",
    partially_verified: "Partially verified",
    unverified: "Unverified",
    failed: "Verification failed",
    blocked: "Blocked",
    no_changes: "No changes",
  };

  const OUTCOME_CLASS = {
    verified: "outcome-verified",
    reviewed: "outcome-reviewed",
    partially_verified: "outcome-partial",
    unverified: "outcome-unverified",
    failed: "outcome-failed",
    blocked: "outcome-blocked",
    no_changes: "outcome-none",
  };

  function renderVerificationResult(result) {
    if (!result || !result.ranAny) return;
    clearEmptyState();
    const row = document.createElement("div");
    row.className = `verification-card ${result.ok ? "verification-ok" : "verification-fail"}`;
    const checksHtml = result.checks
      .map(
        (c) => `
          <div class="verification-check">
            <span class="verification-check-icon">${c.ok ? "✓" : "✗"}</span>
            <span class="verification-check-name">${escapeHtml(c.name)}</span>
          </div>`
      )
      .join("");
    row.innerHTML = `
      <div class="verification-header">
        <span>${result.ok ? "✅" : "⚠️"}</span>
        <span>Verification ${result.ok ? "passed" : "failed"}</span>
      </div>
      <div class="verification-checks">${checksHtml}</div>
    `;
    el.chatLog.appendChild(row);
    scrollToBottom();
  }

  function renderCritiqueResult(pass, reason) {
    // A PASS is routine and happens after every mutating round — the transient
    // feed is enough. A FAIL is worth a permanent, visible entry in the chat
    // log, since it means the model is about to get a correction message.
    pushFeedItem(
      pass ? "🔍" : "🛑",
      pass ? "Independent review — looks correct" : `Independent review flagged an issue`,
      pass ? "tool-ok" : "tool-fail"
    );
    if (pass) return;

    clearEmptyState();
    const row = document.createElement("div");
    row.className = "verification-card verification-fail";
    row.innerHTML = `
      <div class="verification-header">
        <span>🛑</span>
        <span>Independent review found an issue</span>
      </div>
      <div class="verification-checks">
        <div class="verification-check">
          <span class="verification-check-icon">✗</span>
          <span class="verification-check-name">${escapeHtml(reason)}</span>
        </div>
      </div>
    `;
    el.chatLog.appendChild(row);
    scrollToBottom();
  }

  function renderTransactionSummary(transactionId, confidence, outcome, rollbackAvailable) {
    clearEmptyState();
    const row = document.createElement("div");
    row.className = `transaction-summary ${OUTCOME_CLASS[outcome] || "outcome-unverified"}`;
    row.dataset.transactionId = transactionId;
    row.innerHTML = `
      <div class="transaction-outcome">${escapeHtml(OUTCOME_LABELS[outcome] || outcome)}</div>
      <div class="transaction-confidence" title="Internal confidence score (repair rounds + convergence adjustment)">conf ${confidence}</div>
      ${rollbackAvailable ? `<button class="btn btn-secondary transaction-revert-btn">Revert changes</button>` : ""}
    `;
    if (rollbackAvailable) {
      row.querySelector(".transaction-revert-btn").addEventListener("click", (e) => {
        e.target.disabled = true;
        e.target.textContent = "Reverting…";
        send({ type: "rollback_request", transactionId });
      });
    }
    el.chatLog.appendChild(row);
    scrollToBottom();
  }

  function handleRollbackResult(transactionId, ok, items) {
    const row = el.chatLog.querySelector(`.transaction-summary[data-transaction-id="${CSS.escape(transactionId)}"]`);
    const btn = row ? row.querySelector(".transaction-revert-btn") : null;
    const restored = items.filter((i) => i.status === "restored").length;
    const conflicts = items.filter((i) => i.status === "skipped_conflict").length;

    if (btn) {
      btn.textContent = !ok
        ? "Revert failed"
        : conflicts
          ? `Reverted ${restored} file(s), ${conflicts} skipped`
          : `Reverted ${restored} file(s)`;
      btn.classList.toggle("revert-failed", !ok);
      btn.classList.toggle("revert-partial", ok && conflicts > 0);
    }

    const problems = items.filter((i) => i.status !== "restored");
    if (row && problems.length) {
      const detail = document.createElement("div");
      detail.className = "transaction-revert-detail";
      detail.textContent = problems.map((i) => `${i.path}: ${i.reason || i.status}`).join("\n");
      row.appendChild(detail);
    }

    const summaryText = !ok ? "Revert failed" : conflicts ? `Reverted ${restored}, skipped ${conflicts} (conflict)` : `Reverted ${restored} file(s)`;
    pushFeedItem(ok && !conflicts ? "↩️" : "⚠️", summaryText, ok ? "tool-ok" : "tool-fail");
  }

  // ---------- Permission modal ----------

  function renderPreviewHtml(text) {
    return text
      .split("\n")
      .map((line) => {
        const esc = escapeHtml(line) || " ";
        if (line.startsWith("+")) return `<span class="diff-add">${esc}</span>`;
        if (line.startsWith("-")) return `<span class="diff-del">${esc}</span>`;
        return `<span>${esc}</span>`;
      })
      .join("\n");
  }

  const RISK_LABELS = { low: "LOW RISK", medium: "MEDIUM RISK", high: "HIGH RISK" };

  function showPermissionModal(id, toolName, label, risk, preview) {
    state.pendingPermissionId = id;
    el.permTool.textContent = toolName;
    el.permLabel.textContent = label;

    const r = risk || "medium";
    el.permRisk.textContent = RISK_LABELS[r] || RISK_LABELS.medium;
    el.permRisk.className = `risk-badge risk-${r}`;
    el.permRisk.hidden = false;
    el.permHighRiskWarning.hidden = r !== "high";
    // A risky action can never become a silent standing approval — the
    // server enforces this too, but hiding the button here avoids a
    // confusing "it let me click Always but nothing changed" moment.
    el.permAlways.hidden = r === "high";

    if (preview) {
      el.permPreview.innerHTML = renderPreviewHtml(preview);
      el.permPreview.hidden = false;
    } else {
      el.permPreview.hidden = true;
    }

    el.permOverlay.hidden = false;
  }

  function resolvePermission(decision) {
    if (!state.pendingPermissionId) return;
    send({ type: "permission_response", id: state.pendingPermissionId, decision });
    state.pendingPermissionId = null;
    el.permOverlay.hidden = true;
  }

  el.permAllow.addEventListener("click", () => resolvePermission("once"));
  el.permAlways.addEventListener("click", () => resolvePermission("always"));
  el.permDeny.addEventListener("click", () => resolvePermission("deny"));

  // ---------- Composer ----------

  function setBusy(busy) {
    state.busy = busy;
    const disconnected = !(state.ws && state.ws.readyState === WebSocket.OPEN);
    el.composerInput.disabled = busy || disconnected;
    el.sendBtn.disabled = busy || disconnected;
    setStatus(disconnected ? "disconnected" : busy ? "busy" : "connected");
    el.progressSection.classList.toggle("hud-busy", busy);
  }

  function autoGrow() {
    el.composerInput.style.height = "auto";
    el.composerInput.style.height = `${Math.min(el.composerInput.scrollHeight, 200)}px`;
  }

  function sendUserMessage() {
    const text = el.composerInput.value.trim();
    if (!text || state.busy) return;
    appendUserMessage(text);
    send({ type: "user_message", text });
    el.composerInput.value = "";
    autoGrow();
    setBusy(true);
    hudOnTurnStart();
  }

  el.sendBtn.addEventListener("click", sendUserMessage);
  el.composerInput.addEventListener("input", autoGrow);
  el.composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  });

  // ---------- Chats (sessions) ----------

  // "Today" / "Yesterday" bucket by calendar date, not a rolling 24h window —
  // matches how most chat apps group history (a chat from 11pm yesterday and
  // one from 1am today are both "recent" but shouldn't both say "Today").
  function sessionGroupLabel(timestamp) {
    if (!timestamp) return "Older";
    const startOfDay = (ms) => {
      const d = new Date(ms);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    };
    const daysAgo = Math.round((startOfDay(Date.now()) - startOfDay(timestamp)) / 86400000);
    if (daysAgo <= 0) return "Today";
    if (daysAgo === 1) return "Yesterday";
    if (daysAgo <= 7) return "Previous 7 Days";
    return "Older";
  }

  function renderSessionList() {
    el.sessionList.innerHTML = "";
    if (!state.sessions.length) {
      el.sessionList.innerHTML = `<div class="session-list-empty">No chats yet.</div>`;
      return;
    }
    // state.sessions arrives sorted newest-first (server-side); grouping preserves that order.
    const groups = new Map();
    for (const s of state.sessions) {
      const label = sessionGroupLabel(s.updatedAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(s);
    }
    for (const label of ["Today", "Yesterday", "Previous 7 Days", "Older"]) {
      const sessions = groups.get(label);
      if (!sessions || !sessions.length) continue;

      const heading = document.createElement("div");
      heading.className = "session-group-title";
      heading.textContent = label;
      el.sessionList.appendChild(heading);

      for (const s of sessions) {
        const row = document.createElement("div");
        row.className = `session-item${s.id === state.sessionId ? " active" : ""}`;
        row.innerHTML = `
          <div class="session-item-text">
            <div class="session-item-title">${escapeHtml(s.title)}</div>
            <div class="session-item-time">${formatRelativeTime(s.updatedAt)}</div>
          </div>
          <span class="session-item-delete" title="Delete chat">&times;</span>
        `;
        row.addEventListener("click", () => {
          if (s.id !== state.sessionId) send({ type: "switch_session", id: s.id });
        });
        row.querySelector(".session-item-delete").addEventListener("click", (e) => {
          e.stopPropagation();
          send({ type: "delete_session", id: s.id });
        });
        el.sessionList.appendChild(row);
      }
    }
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return "";
    const diffMs = Date.now() - timestamp;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  el.newChatBtn.addEventListener("click", () => {
    send({ type: "new_session" });
  });

  // ---------- Switch project folder ----------

  const browseState = { path: null, parent: null };

  async function browseTo(targetPath) {
    try {
      const res = await apiFetch(`/api/browse?path=${encodeURIComponent(targetPath || "")}`);
      const data = await res.json();
      if (data.error) {
        el.folderBrowserList.innerHTML = `<div class="folder-browser-empty">${escapeHtml(data.error)}</div>`;
        return;
      }
      browseState.path = data.path;
      browseState.parent = data.parent;
      el.folderBrowserPath.textContent = data.path || "Drives";
      el.folderBrowserPath.title = data.path || "";
      el.folderBrowserUp.disabled = data.parent === null;

      el.folderBrowserList.innerHTML = "";
      if (!data.entries.length) {
        el.folderBrowserList.innerHTML = `<div class="folder-browser-empty">No subfolders</div>`;
      }
      for (const entry of data.entries) {
        const row = document.createElement("div");
        row.className = "folder-browser-item";
        row.title = entry.path;
        row.innerHTML = `<span>&#128193;</span><span>${escapeHtml(entry.name)}</span>`;
        row.addEventListener("click", () => browseTo(entry.path));
        el.folderBrowserList.appendChild(row);
      }
      if (data.path) el.folderInput.value = data.path;
    } catch {
      el.folderBrowserList.innerHTML = `<div class="folder-browser-empty">Failed to browse.</div>`;
    }
  }

  function openFolderModal() {
    el.folderInput.value = state.currentRoot;
    el.folderNewName.value = "";
    el.folderNewError.hidden = true;
    el.recentFolders.innerHTML = "";
    for (const folder of state.recentFolders) {
      const row = document.createElement("div");
      row.className = "recent-folder-item";
      row.textContent = folder;
      row.title = folder;
      row.addEventListener("click", () => {
        el.folderInput.value = folder;
        browseTo(folder);
      });
      el.recentFolders.appendChild(row);
    }
    el.folderOverlay.hidden = false;
    el.folderInput.focus();
    browseTo(state.currentRoot);
  }

  function switchFolder() {
    const path = el.folderInput.value.trim();
    if (!path) return;
    send({ type: "switch_folder", path });
    el.folderOverlay.hidden = true;
  }

  el.folderBtn.addEventListener("click", openFolderModal);
  el.projectCard.addEventListener("click", openFolderModal);
  el.folderCancel.addEventListener("click", () => {
    el.folderOverlay.hidden = true;
  });
  el.folderSwitch.addEventListener("click", switchFolder);
  el.folderInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      switchFolder();
    }
  });

  el.folderBrowserUp.addEventListener("click", () => {
    if (browseState.parent !== null) browseTo(browseState.parent);
  });

  async function createProjectFolder() {
    const name = el.folderNewName.value.trim();
    el.folderNewError.hidden = true;
    if (!name) return;
    if (!browseState.path) {
      el.folderNewError.textContent = "Pick a drive/folder first.";
      el.folderNewError.hidden = false;
      return;
    }
    try {
      const res = await apiFetch("/api/browse/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPath: browseState.path, name }),
      });
      const data = await res.json();
      if (data.error) {
        el.folderNewError.textContent = data.error;
        el.folderNewError.hidden = false;
        return;
      }
      el.folderNewName.value = "";
      await browseTo(data.path);
    } catch {
      el.folderNewError.textContent = "Failed to create the folder.";
      el.folderNewError.hidden = false;
    }
  }

  el.folderNewCreate.addEventListener("click", createProjectFolder);
  el.folderNewName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      createProjectFolder();
    }
  });

  // ---------- Model picker ----------

  const PROVIDER_LABELS = {
    pollinations: "Pollinations",
    groq: "Groq",
    openrouter: "OpenRouter",
    gemini: "Google Gemini",
    cerebras: "Cerebras",
    mistral: "Mistral",
    custom: "Custom / Local",
  };

  // Which provider's models the picker is currently browsing — starts on the active one each time it opens, but
  // browsing a different provider (to preview/switch to it) shouldn't touch state.currentProvider until confirmed.
  let pickerProvider = "";
  let pickerKeyStatus = {};

  async function openModelModal() {
    el.modelOverlay.hidden = false;
    el.modelSearch.value = "";
    el.modelSearch.focus();
    pickerProvider = state.currentProvider;

    try {
      const res = await apiFetch("/api/api-keys");
      pickerKeyStatus = await res.json();
    } catch {
      pickerKeyStatus = {};
    }
    renderProviderChips();
    await loadModelsForPicker();
  }

  function renderProviderChips() {
    el.modelProviderChips.innerHTML = "";
    for (const provider of ["pollinations", ...API_KEY_PROVIDERS, "custom"]) {
      const hasKey = provider === "pollinations" || !!pickerKeyStatus[provider]?.set;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `provider-chip${provider === pickerProvider ? " active" : ""}${hasKey ? "" : " disabled"}`;
      chip.textContent = PROVIDER_LABELS[provider] || provider;
      chip.disabled = !hasKey;
      chip.title = hasKey ? "" : "Add an API key in Settings > API Keys first";
      chip.addEventListener("click", () => {
        if (pickerProvider === provider) return;
        pickerProvider = provider;
        renderProviderChips();
        loadModelsForPicker();
      });
      el.modelProviderChips.appendChild(chip);
    }
  }

  async function loadModelsForPicker() {
    el.modelProviderNote.textContent = `Provider: ${PROVIDER_LABELS[pickerProvider] || pickerProvider}`;

    if (state.modelCache && state.modelCache.provider === pickerProvider) {
      renderModelList(state.modelCache.models);
      return;
    }

    el.modelList.innerHTML = `<div class="model-list-loading">Loading models…</div>`;
    try {
      const res = await apiFetch(`/api/models?provider=${encodeURIComponent(pickerProvider)}`);
      const data = await res.json();
      const models = data.models || [];
      state.modelCache = { provider: pickerProvider, models };
      if (!models.length) return renderNoModels(data.note);
      renderModelList(models);
    } catch (err) {
      el.modelList.innerHTML = `<div class="model-list-empty">Failed to load models: ${escapeHtml(String(err.message || err))}</div>`;
    }
  }

  // Pollinations has no model list (no tool-calling model choice) — if that's also the already-active provider
  // there's nothing to do here, but if the user is browsing it as a *switch target* they still need a way to
  // confirm the switch, so give them one explicit row instead of a dead end.
  function renderNoModels(note) {
    if (pickerProvider === state.currentProvider) {
      el.modelList.innerHTML = `<div class="model-list-empty">${escapeHtml(note || "No selectable models for this provider.")}</div>`;
      return;
    }
    el.modelList.innerHTML = "";
    const row = document.createElement("div");
    row.className = "model-item";
    row.innerHTML = `
      <div>
        <div class="model-item-name">Switch to ${escapeHtml(PROVIDER_LABELS[pickerProvider] || pickerProvider)}</div>
        <div class="model-item-id">${escapeHtml(note || "No model list for this provider.")}</div>
      </div>
    `;
    row.addEventListener("click", () => {
      send({ type: "switch_provider", provider: pickerProvider });
      el.modelOverlay.hidden = true;
    });
    el.modelList.appendChild(row);
  }

  function renderModelList(models) {
    const query = el.modelSearch.value.trim().toLowerCase();
    const filtered = query
      ? models.filter((m) => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query))
      : models;

    el.modelList.innerHTML = "";
    if (!filtered.length) {
      el.modelList.innerHTML = `<div class="model-list-empty">No models match "${escapeHtml(query)}"</div>`;
      return;
    }

    for (const model of filtered) {
      const isActive = pickerProvider === state.currentProvider && model.id === state.currentModel;
      const row = document.createElement("div");
      row.className = `model-item${isActive ? " active" : ""}`;
      row.innerHTML = `
        <div>
          <div class="model-item-name">${escapeHtml(model.name)}</div>
          <div class="model-item-id">${escapeHtml(model.id)}</div>
        </div>
        ${model.free ? '<span class="model-item-free">FREE</span>' : ""}
      `;
      row.addEventListener("click", () => {
        if (pickerProvider === state.currentProvider) {
          send({ type: "switch_model", model: model.id });
        } else {
          send({ type: "switch_provider", provider: pickerProvider, model: model.id });
        }
        el.modelOverlay.hidden = true;
      });
      el.modelList.appendChild(row);
    }
  }

  el.modelBadge.addEventListener("click", openModelModal);
  el.modelCancel.addEventListener("click", () => {
    el.modelOverlay.hidden = true;
  });
  el.modelSearch.addEventListener("input", () => {
    if (state.modelCache) renderModelList(state.modelCache.models);
  });

  // ---------- Theme picker ----------

  const THEME_STORAGE_KEY = "wrexlyn-theme";
  const THEMES = [
    { id: "tactical", name: "Tactical Cockpit", swatch: ["#030303", "#00f0ff", "#ff6b00"] },
    { id: "space", name: "Space", swatch: ["#0a0d12", "#22d3ee", "#a78bfa"] },
    { id: "tech", name: "Tech", swatch: ["#05070a", "#39ff88", "#22d3ee"] },
    { id: "aurora", name: "Aurora", swatch: ["#0a0a14", "#a78bfa", "#2dd4bf"] },
    { id: "sunset", name: "Sunset", swatch: ["#120a0d", "#fb923c", "#f472b6"] },
    { id: "midnight", name: "Midnight", swatch: ["#070a12", "#5b8def", "#7dd3fc"] },
  ];

  function applyTheme(themeId) {
    if (themeId === "space") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", themeId);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeId);
    } catch {
      // best-effort — a private-browsing quota error just means the choice won't persist
    }
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "space";
  }

  function renderThemeList() {
    const active = currentTheme();
    el.themeList.innerHTML = "";
    for (const theme of THEMES) {
      const row = document.createElement("div");
      row.className = `theme-item${theme.id === active ? " active" : ""}`;
      row.innerHTML = `
        <span class="theme-swatch">
          ${theme.swatch.map((c) => `<span class="theme-swatch-dot" style="background:${c}"></span>`).join("")}
        </span>
        <span class="theme-item-name">${escapeHtml(theme.name)}</span>
        ${theme.id === active ? '<span class="theme-item-check">&#10003;</span>' : ""}
      `;
      row.addEventListener("click", () => {
        applyTheme(theme.id);
        renderThemeList();
      });
      el.themeList.appendChild(row);
    }
  }

  el.themeBtn.addEventListener("click", () => {
    renderThemeList();
    el.themeOverlay.hidden = false;
  });
  el.themeCancel.addEventListener("click", () => {
    el.themeOverlay.hidden = true;
  });

  // ---------- Settings (global instructions + MCP servers / app connectors) ----------

  let mcpServers = {};

  function showSettingsTab(tab) {
    el.settingsTabInstructions.classList.toggle("active", tab === "instructions");
    el.settingsTabMcp.classList.toggle("active", tab === "mcp");
    el.settingsTabApiKeys.classList.toggle("active", tab === "apikeys");
    el.settingsTabSkills.classList.toggle("active", tab === "skills");
    el.settingsTabPhone.classList.toggle("active", tab === "phone");
    el.settingsPanelInstructions.hidden = tab !== "instructions";
    el.settingsPanelMcp.hidden = tab !== "mcp";
    el.settingsPanelApiKeys.hidden = tab !== "apikeys";
    el.settingsPanelSkills.hidden = tab !== "skills";
    el.settingsPanelPhone.hidden = tab !== "phone";
    if (tab === "skills") loadSkillsPanel();
  }

  // Rows are built from this list rather than hand-duplicated HTML, so adding a future provider
  // is a one-line addition here instead of touching index.html + three places in this file.
  const API_KEY_PROVIDER_META = [
    { id: "groq", label: "Groq", placeholder: "gsk_...", signupUrl: "https://console.groq.com/keys" },
    { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-...", signupUrl: "https://openrouter.ai/keys" },
    { id: "gemini", label: "Google Gemini", placeholder: "AIza...", signupUrl: "https://aistudio.google.com/apikey" },
    { id: "cerebras", label: "Cerebras", placeholder: "csk-...", signupUrl: "https://cloud.cerebras.ai" },
    { id: "mistral", label: "Mistral", placeholder: "...", signupUrl: "https://console.mistral.ai" },
  ];
  const API_KEY_PROVIDERS = API_KEY_PROVIDER_META.map((m) => m.id);

  function ensureApiKeyRows() {
    if (el.apikeyRows.children.length) return;
    for (const meta of API_KEY_PROVIDER_META) {
      const row = document.createElement("div");
      row.className = "apikey-row";
      row.innerHTML = `
        <div class="apikey-row-label">
          <span>${escapeHtml(meta.label)}</span>
          <span id="apikey-${meta.id}-current" class="apikey-current">Not set</span>
        </div>
        <div class="apikey-row-fields">
          <input id="apikey-${meta.id}-input" class="folder-input" type="password" placeholder="${escapeHtml(meta.placeholder)}" autocomplete="off" />
          <button id="apikey-${meta.id}-clear" class="btn btn-secondary">Clear</button>
          <button id="apikey-${meta.id}-save" class="btn btn-primary">Save</button>
        </div>
        <a class="apikey-signup-link" href="${meta.signupUrl}" target="_blank" rel="noopener">Get a free key &rarr;</a>
      `;
      row.querySelector(`#apikey-${meta.id}-save`).addEventListener("click", () => {
        const apiKey = row.querySelector(`#apikey-${meta.id}-input`).value.trim();
        if (!apiKey) return;
        send({ type: "update_api_key", provider: meta.id, apiKey });
      });
      row.querySelector(`#apikey-${meta.id}-clear`).addEventListener("click", () => {
        send({ type: "clear_api_key", provider: meta.id });
      });
      el.apikeyRows.appendChild(row);
    }
  }

  async function loadApiKeysStatus() {
    ensureApiKeyRows();
    let data = {};
    try {
      const res = await apiFetch("/api/api-keys");
      data = await res.json();
    } catch {
      data = {};
    }
    for (const provider of API_KEY_PROVIDERS) {
      const info = data[provider] || { set: false, masked: null };
      const currentEl = document.getElementById(`apikey-${provider}-current`);
      const inputEl = document.getElementById(`apikey-${provider}-input`);
      currentEl.textContent = info.set ? `Set (${info.masked})` : "Not set";
      currentEl.classList.toggle("apikey-current-set", info.set);
      inputEl.value = "";
    }

    const custom = data.custom || { set: false, masked: null, baseUrl: null, model: null };
    const customCurrent = document.getElementById("apikey-custom-current");
    customCurrent.textContent = custom.set ? `Set (${custom.model})` : "Not set";
    customCurrent.classList.toggle("apikey-current-set", custom.set);
    document.getElementById("apikey-custom-baseurl").value = custom.baseUrl || "";
    document.getElementById("apikey-custom-model").value = custom.model || "";
    document.getElementById("apikey-custom-apikey").value = "";
  }

  document.getElementById("apikey-custom-save").addEventListener("click", () => {
    const baseUrl = document.getElementById("apikey-custom-baseurl").value.trim();
    const model = document.getElementById("apikey-custom-model").value.trim();
    const apiKey = document.getElementById("apikey-custom-apikey").value.trim();
    if (!baseUrl || !model) return;
    send({ type: "update_custom_provider", baseUrl, model, apiKey });
  });
  document.getElementById("apikey-custom-clear").addEventListener("click", () => {
    send({ type: "clear_api_key", provider: "custom" });
  });

  // ---------- Skills ----------

  async function loadSkillsPanel() {
    await Promise.all([loadLearnedSkills(), loadStarterSkills(), loadSkillLibrary()]);
  }

  async function loadLearnedSkills() {
    let skills = [];
    try {
      const res = await apiFetch("/api/skills");
      skills = (await res.json()).skills || [];
    } catch {
      skills = [];
    }
    el.learnedSkillsList.innerHTML = "";
    if (!skills.length) {
      el.learnedSkillsList.innerHTML = `<div class="skills-list-empty">No skills saved yet — ask the agent to save one after a multi-step task, or add a starter below.</div>`;
      return;
    }
    for (const skill of skills) {
      const item = document.createElement("div");
      item.className = "skill-item";
      const badges = [];
      if (skill.script) badges.push(`<span class="skill-item-badge" title="${escapeHtml(skill.script.description)}">📎 script attached</span>`);
      if (skill.updatedAt) badges.push(`<span class="skill-item-badge">updated ${formatRelativeTime(skill.updatedAt)}</span>`);
      item.innerHTML = `
        <div class="skill-item-body">
          <div class="skill-item-name">${escapeHtml(skill.name)}</div>
          <div class="skill-item-desc">${escapeHtml(skill.description)}</div>
          ${badges.length ? `<div class="skill-item-badges">${badges.join("")}</div>` : ""}
          <details class="skill-item-steps">
            <summary>Steps</summary>
            <pre>${escapeHtml(skill.steps)}</pre>
          </details>
        </div>
        <button class="skill-item-action skill-item-danger" type="button">Delete</button>
      `;
      item.querySelector("button").addEventListener("click", () => {
        send({ type: "delete_skill", name: skill.name });
      });
      el.learnedSkillsList.appendChild(item);
    }
  }

  async function loadStarterSkills() {
    let starters = [];
    let learnedNames = new Set();
    try {
      const [starterRes, learnedRes] = await Promise.all([apiFetch("/api/starter-skills"), apiFetch("/api/skills")]);
      starters = (await starterRes.json()).skills || [];
      learnedNames = new Set(((await learnedRes.json()).skills || []).map((s) => s.name));
    } catch {
      starters = [];
    }
    el.starterSkillsList.innerHTML = "";
    for (const skill of starters) {
      const alreadyAdded = learnedNames.has(skill.name);
      const item = document.createElement("div");
      item.className = "skill-item";
      item.innerHTML = `
        <div class="skill-item-body">
          <div class="skill-item-name">${escapeHtml(skill.name)}</div>
          <div class="skill-item-desc">${escapeHtml(skill.description)}</div>
        </div>
        <button class="skill-item-action" type="button" ${alreadyAdded ? "disabled" : ""}>${alreadyAdded ? "Added" : "Add"}</button>
      `;
      const btn = item.querySelector("button");
      if (!alreadyAdded) {
        btn.addEventListener("click", () => send({ type: "add_starter_skill", name: skill.name }));
      }
      el.starterSkillsList.appendChild(item);
    }
  }

  async function loadSkillLibrary() {
    let skills = [];
    try {
      const res = await apiFetch("/api/skill-library");
      skills = (await res.json()).skills || [];
    } catch {
      skills = [];
    }
    el.skillLibrarySection.hidden = skills.length === 0;
    el.skillLibraryList.innerHTML = "";
    for (const skill of skills) {
      const item = document.createElement("div");
      item.className = "skill-item";
      item.innerHTML = `
        <div class="skill-item-body">
          <div class="skill-item-name">${escapeHtml(skill.name)}</div>
          <div class="skill-item-desc">${escapeHtml(skill.description)}</div>
        </div>
      `;
      el.skillLibraryList.appendChild(item);
    }
  }

  async function loadPhoneConnectInfo() {
    el.phoneQrcode.innerHTML = "";
    el.phoneConnectUrl.textContent = "Loading…";
    try {
      const res = await apiFetch("/api/lan-info");
      const data = await res.json();
      if (!data.lan) {
        el.phoneConnectUrl.textContent = "LAN access is off. Restart Wrexlyn with --lan to allow phone/network access.";
        return;
      }
      if (!data.addresses || !data.addresses.length) {
        el.phoneConnectUrl.textContent = "No network address found — connect this computer to Wi-Fi first.";
        return;
      }
      el.phoneConnectUrl.textContent = `Scan with your phone's camera — this link expires in 10 minutes and works once.`;
      // Each fetch of the QR image mints a fresh single-use pairing token server-side, so this image itself is
      // only ever fetched with the (already-authenticated) request below, not embedded as a bare <img src>.
      const qrRes = await apiFetch(`/api/lan-qrcode?_=${Date.now()}`);
      if (qrRes.ok) {
        const svgText = await qrRes.text();
        el.phoneQrcode.innerHTML = svgText;
      }
    } catch {
      el.phoneConnectUrl.textContent = "Failed to look up this computer's network address.";
    }
  }

  function flashStatus(statusEl, text) {
    statusEl.textContent = text;
    statusEl.classList.add("visible");
    setTimeout(() => statusEl.classList.remove("visible"), 2500);
  }

  function buildMcpServerRow(name, config) {
    const row = document.createElement("div");
    row.className = "mcp-server-row";
    row.innerHTML = `
      <div class="mcp-server-row-header">
        <input class="folder-input mcp-name-input" type="text" value="${escapeHtml(name)}" placeholder="Server name" />
        <span class="mcp-server-remove" title="Remove server">&times;</span>
      </div>
      <div class="mcp-server-fields">
        <label>Command</label>
        <input class="folder-input mcp-command-input" type="text" value="${escapeHtml(config.command || "")}" placeholder="e.g. npx" />
        <label>Args</label>
        <input class="folder-input mcp-args-input" type="text" value="${escapeHtml((config.args || []).join(" "))}" placeholder="space-separated args" />
      </div>
    `;
    row.querySelector(".mcp-server-remove").addEventListener("click", () => row.remove());
    return row;
  }

  function renderMcpServerList() {
    el.mcpServerList.innerHTML = "";
    const names = Object.keys(mcpServers);
    if (!names.length) {
      el.mcpServerList.innerHTML = `<div class="mcp-empty">No MCP servers or app connectors configured yet.</div>`;
      return;
    }
    for (const name of names) el.mcpServerList.appendChild(buildMcpServerRow(name, mcpServers[name]));
  }

  // Deliberately a short, conservative list: only servers confirmed current and
  // official in the modelcontextprotocol/servers registry at the time this was
  // written. These run via npx/uvx — i.e. they execute code — so this list isn't
  // padded with unverified third-party packages just to look comprehensive.
  const MCP_CONNECTOR_CATALOG = [
    {
      id: "filesystem",
      name: "Filesystem",
      icon: "&#128193;",
      description: "Read/write files outside this project's sandbox.",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/folder"],
    },
    {
      id: "git",
      name: "Git",
      icon: "&#127807;",
      description: "History, diff, and commit tools for a specific repo.",
      command: "uvx",
      args: ["mcp-server-git", "--repository", "/path/to/repo"],
    },
    {
      id: "memory",
      name: "Memory",
      icon: "&#129504;",
      description: "Persistent knowledge graph memory across sessions.",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    },
    {
      id: "sequential-thinking",
      name: "Sequential Thinking",
      icon: "&#129513;",
      description: "Structured step-by-step reasoning tool.",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequentialthinking"],
    },
    {
      id: "time",
      name: "Time",
      icon: "&#128337;",
      description: "Current time and timezone conversion.",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-time"],
    },
  ];

  function renderMcpGallery() {
    el.mcpGallery.innerHTML = "";
    for (const connector of MCP_CONNECTOR_CATALOG) {
      const alreadyAdded = connector.name in mcpServers;
      const card = document.createElement("div");
      card.className = "mcp-gallery-card";
      card.innerHTML = `
        <div class="mcp-gallery-card-title"><span>${connector.icon}</span><span>${escapeHtml(connector.name)}</span></div>
        <div class="mcp-gallery-card-desc">${escapeHtml(connector.description)}</div>
        <button class="mcp-gallery-card-add" ${alreadyAdded ? "disabled" : ""}>${alreadyAdded ? "Added" : "+ Add"}</button>
      `;
      const addBtn = card.querySelector(".mcp-gallery-card-add");
      addBtn.addEventListener("click", () => {
        if (el.mcpServerList.querySelector(".mcp-empty")) el.mcpServerList.innerHTML = "";
        mcpServers[connector.name] = { command: connector.command, args: connector.args };
        const row = buildMcpServerRow(connector.name, mcpServers[connector.name]);
        el.mcpServerList.appendChild(row);
        row.scrollIntoView({ block: "nearest" });
        addBtn.disabled = true;
        addBtn.textContent = "Added";
      });
      el.mcpGallery.appendChild(card);
    }
  }

  function collectMcpServersFromForm() {
    const servers = {};
    for (const row of el.mcpServerList.querySelectorAll(".mcp-server-row")) {
      const name = row.querySelector(".mcp-name-input").value.trim();
      const command = row.querySelector(".mcp-command-input").value.trim();
      const args = row.querySelector(".mcp-args-input").value.trim();
      if (!name || !command) continue;
      servers[name] = { command, args: args ? args.split(/\s+/) : [] };
    }
    return servers;
  }

  async function openSettingsModal() {
    showSettingsTab("instructions");
    el.settingsInstructionsStatus.classList.remove("visible");
    el.settingsMcpStatus.classList.remove("visible");
    el.settingsOverlay.hidden = false;

    try {
      const res = await apiFetch("/api/global-instructions");
      const data = await res.json();
      el.settingsInstructionsInput.value = data.text || "";
    } catch {
      el.settingsInstructionsInput.value = "";
    }

    try {
      const res = await apiFetch("/api/mcp-config");
      const data = await res.json();
      mcpServers = data.mcpServers || {};
    } catch {
      mcpServers = {};
    }
    renderMcpServerList();
    renderMcpGallery();
    await loadApiKeysStatus();
  }

  el.settingsBtn.addEventListener("click", openSettingsModal);
  el.settingsClose.addEventListener("click", () => {
    el.settingsOverlay.hidden = true;
  });
  el.settingsTabInstructions.addEventListener("click", () => showSettingsTab("instructions"));
  el.settingsTabMcp.addEventListener("click", () => showSettingsTab("mcp"));
  el.settingsTabApiKeys.addEventListener("click", () => showSettingsTab("apikeys"));
  el.settingsTabSkills.addEventListener("click", () => showSettingsTab("skills"));
  el.settingsTabPhone.addEventListener("click", () => {
    showSettingsTab("phone");
    loadPhoneConnectInfo();
  });

  el.settingsInstructionsSave.addEventListener("click", () => {
    send({ type: "update_global_instructions", text: el.settingsInstructionsInput.value });
  });

  el.mcpAddBtn.addEventListener("click", () => {
    if (el.mcpServerList.querySelector(".mcp-empty")) el.mcpServerList.innerHTML = "";
    el.mcpServerList.appendChild(buildMcpServerRow("", { command: "", args: [] }));
  });

  el.settingsMcpSave.addEventListener("click", () => {
    send({ type: "update_mcp_config", mcpServers: collectMcpServersFromForm() });
  });

  // ---------- File upload ----------

  async function uploadFile(file) {
    clearEmptyState();
    const statusRow = document.createElement("div");
    statusRow.className = "thinking-row";
    statusRow.textContent = `Uploading ${file.name}…`;
    el.chatLog.appendChild(statusRow);
    scrollToBottom();

    try {
      const buffer = await file.arrayBuffer();
      const res = await apiFetch(`/api/upload?path=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: buffer,
      });
      const data = await res.json();
      statusRow.remove();
      if (!res.ok) {
        appendErrorMessage(`Upload failed for ${file.name}: ${data.error || res.statusText}`);
      } else {
        const row = document.createElement("div");
        row.className = "msg msg-assistant";
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.textContent = `📎 Uploaded ${data.path} (${formatBytes(data.bytes)})`;
        row.appendChild(bubble);
        el.chatLog.appendChild(row);
        scrollToBottom();
        loadTree(el.fileTree, ".");
      }
    } catch (err) {
      statusRow.remove();
      appendErrorMessage(`Upload failed for ${file.name}: ${err.message || err}`);
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  el.uploadInput.addEventListener("change", () => {
    for (const file of el.uploadInput.files) uploadFile(file);
    el.uploadInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) =>
    el.chatLog.addEventListener(evt, (e) => {
      e.preventDefault();
      el.chatLog.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    el.chatLog.addEventListener(evt, (e) => {
      e.preventDefault();
      el.chatLog.classList.remove("drag-over");
    })
  );
  el.chatLog.addEventListener("drop", (e) => {
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) uploadFile(file);
  });

  // ---------- File tree ----------

  async function loadTree(container, relPath) {
    container.innerHTML = "";
    try {
      const res = await apiFetch(`/api/tree?path=${encodeURIComponent(relPath)}`);
      const data = await res.json();
      if (!data.entries) return;
      for (const entry of data.entries) {
        container.appendChild(buildTreeNode(entry, relPath));
      }
    } catch {
      container.innerHTML = `<div class="tree-row">(failed to load)</div>`;
    }
  }

  function buildTreeNode(entry, parentPath) {
    const fullPath = parentPath === "." ? entry.name : `${parentPath}/${entry.name}`;

    const node = document.createElement("div");
    node.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row";
    row.innerHTML = `
      <span class="tree-caret">${entry.isDir ? "&#9656;" : ""}</span>
      <span class="tree-icon">${entry.isDir ? "&#128193;" : "&#128196;"}</span>
      <span class="tree-name">${escapeHtml(entry.name)}</span>
    `;
    node.appendChild(row);

    if (entry.isDir) {
      const children = document.createElement("div");
      children.className = "tree-children";
      node.appendChild(children);

      let loaded = false;
      row.addEventListener("click", async () => {
        node.classList.toggle("open");
        if (node.classList.contains("open") && !loaded) {
          loaded = true;
          await loadTree(children, fullPath);
        }
      });
    } else {
      row.addEventListener("click", () => {
        const ext = entry.name.split(".").pop().toLowerCase();
        if (BINARY_FILE_EXTS.has(ext)) {
          downloadFile(fullPath);
          return;
        }
        document.querySelectorAll(".tree-row.active").forEach((r) => r.classList.remove("active"));
        row.classList.add("active");
        openFile(fullPath);
      });
    }

    return node;
  }

  async function openFile(relPath) {
    el.codePanel.hidden = false;
    el.codePanelTitle.textContent = relPath;
    el.codePanelTitle.title = relPath;
    el.codePanelContent.textContent = "Loading…";
    try {
      const res = await apiFetch(`/api/file?path=${encodeURIComponent(relPath)}`);
      const data = await res.json();
      if (data.binary) {
        el.codePanelContent.textContent = "(binary file — use the download button instead of previewing)";
      } else {
        el.codePanelContent.textContent = data.content ?? data.error ?? "(empty)";
      }
    } catch {
      el.codePanelContent.textContent = "(failed to load file)";
    }
  }

  el.codePanelClose.addEventListener("click", () => {
    el.codePanel.hidden = true;
  });

  // ---------- Created files (written/generated by the agent this chat) ----------

  async function downloadFile(relPath) {
    // A plain <a href> can't carry the Authorization header the server now requires, so this fetches the file
    // (authenticated) and downloads the resulting blob instead of navigating directly to the API URL.
    try {
      const res = await apiFetch(`/api/download?path=${encodeURIComponent(relPath)}`);
      if (!res.ok) {
        appendErrorMessage(`Download failed for ${relPath}: ${res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = relPath.split("/").pop();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      appendErrorMessage(`Download failed for ${relPath}.`);
    }
  }

  function renderCreatedFiles(files) {
    state.createdFiles = Array.isArray(files) ? files : [];
    const section = el.createdFilesSection;
    if (!state.createdFiles.length) {
      section.hidden = true;
      section.innerHTML = "";
      return;
    }

    section.hidden = false;
    section.innerHTML = `
      <div class="sidebar-section-title">Created Files</div>
      <div class="created-files-list"></div>
    `;
    const list = section.querySelector(".created-files-list");

    for (const relPath of state.createdFiles) {
      const name = relPath.split("/").pop();
      const ext = name.split(".").pop().toLowerCase();
      const isBinary = BINARY_FILE_EXTS.has(ext);

      const row = document.createElement("div");
      row.className = "created-file-row";
      row.title = relPath;
      row.innerHTML = `
        <span class="created-file-icon">${fileIcon(name)}</span>
        <span class="created-file-name">${escapeHtml(name)}</span>
        <span class="created-file-download" title="Download">&#8681;</span>
      `;
      row.addEventListener("click", () => {
        if (isBinary) {
          downloadFile(relPath);
        } else {
          list.querySelectorAll(".created-file-row.active").forEach((r) => r.classList.remove("active"));
          row.classList.add("active");
          openFile(relPath);
        }
      });
      row.querySelector(".created-file-download").addEventListener("click", (e) => {
        e.stopPropagation();
        downloadFile(relPath);
      });
      list.appendChild(row);
    }
  }

  el.sidebarToggle.addEventListener("click", () => {
    el.sidebar.classList.toggle("open");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!el.codePanel.hidden) el.codePanel.hidden = true;
    if (!el.folderOverlay.hidden) el.folderOverlay.hidden = true;
    if (!el.modelOverlay.hidden) el.modelOverlay.hidden = true;
    if (!el.themeOverlay.hidden) el.themeOverlay.hidden = true;
    if (!el.settingsOverlay.hidden) el.settingsOverlay.hidden = true;
  });

  // ---------- Init ----------

  if (window.innerWidth < 480) {
    el.composerInput.placeholder = "Ask the agent…";
  }

  setBusy(false);
  bootstrapAuthToken().then(connect);
})();
