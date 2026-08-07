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
    uploadInput: document.getElementById("upload-input"),
    modelOverlay: document.getElementById("model-overlay"),
    modelSearch: document.getElementById("model-search"),
    modelList: document.getElementById("model-list"),
    modelCancel: document.getElementById("model-cancel"),
    modelProviderNote: document.getElementById("model-provider-note"),
    themeBtn: document.getElementById("theme-btn"),
    themeOverlay: document.getElementById("theme-overlay"),
    themeList: document.getElementById("theme-list"),
    themeCancel: document.getElementById("theme-cancel"),
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
    const ws = new WebSocket(`${protocol}//${location.host}`);
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
        addToolCard(msg.id, msg.name, msg.label);
        hudOnToolCall(msg.id, msg.name, msg.label);
        break;
      case "tool_result":
        updateToolCard(msg.id, msg.output, msg.ok);
        hudOnToolResult(msg.id, msg.ok);
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
        showPermissionModal(msg.id, msg.toolName, msg.label, msg.preview);
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
    }
  }

  function updateModelBadge() {
    const text = state.currentProvider ? `${state.currentProvider} · ${state.currentModel}` : state.currentModel;
    el.modelBadge.textContent = text;
    el.modelBadge.title = `${text} — click to change`;
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
    toolLabels: new Map(),
    fakePercent: 0,
    fakeTimer: null,
  };

  function ensureHudSkeleton() {
    if (hud.built) return;
    el.progressSection.innerHTML = `
      <div class="sidebar-section-title">Live Activity</div>
      <div class="progress-panel" id="hud-panel">
        <div class="progress-ring-wrap">
          <svg class="progress-ring" viewBox="0 0 64 64">
            <circle class="progress-ring-bg" cx="32" cy="32" r="${RING_RADIUS}"></circle>
            <circle class="progress-ring-fill" id="hud-ring-fill" cx="32" cy="32" r="${RING_RADIUS}"
              stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${RING_CIRCUMFERENCE}"></circle>
          </svg>
          <div class="progress-percent" id="hud-percent">0<span class="progress-percent-sign">%</span></div>
        </div>
        <div class="progress-summary" id="hud-summary">Idle</div>
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

  function renderStepper() {
    ensureHudSkeleton();
    if (!hud.tasks.length) {
      el.hudStepper.hidden = true;
      el.hudStepper.innerHTML = "";
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
    el.hudStepper.hidden = false;
    el.hudStepper.innerHTML = steps;
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

  function addToolCard(id, name, label) {
    clearEmptyState();
    showThinking(false);

    const card = document.createElement("div");
    card.className = "tool-card";

    const icon = TOOL_ICONS[name] || (name.startsWith("mcp__") ? "⚡" : "T");
    card.innerHTML = `
      <div class="tool-card-header">
        <span class="tool-icon">${escapeHtml(icon)}</span>
        <span class="tool-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
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

  function showPermissionModal(id, toolName, label, preview) {
    state.pendingPermissionId = id;
    el.permTool.textContent = toolName;
    el.permLabel.textContent = label;

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

  function renderSessionList() {
    el.sessionList.innerHTML = "";
    if (!state.sessions.length) {
      el.sessionList.innerHTML = `<div class="session-list-empty">No chats yet.</div>`;
      return;
    }
    for (const s of state.sessions) {
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

  function openFolderModal() {
    el.folderInput.value = state.currentRoot;
    el.recentFolders.innerHTML = "";
    for (const folder of state.recentFolders) {
      const row = document.createElement("div");
      row.className = "recent-folder-item";
      row.textContent = folder;
      row.title = folder;
      row.addEventListener("click", () => {
        el.folderInput.value = folder;
      });
      el.recentFolders.appendChild(row);
    }
    el.folderOverlay.hidden = false;
    el.folderInput.focus();
  }

  function switchFolder() {
    const path = el.folderInput.value.trim();
    if (!path) return;
    send({ type: "switch_folder", path });
    el.folderOverlay.hidden = true;
  }

  el.folderBtn.addEventListener("click", openFolderModal);
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

  // ---------- Model picker ----------

  async function openModelModal() {
    el.modelOverlay.hidden = false;
    el.modelSearch.value = "";
    el.modelSearch.focus();
    el.modelProviderNote.textContent = `Provider: ${state.currentProvider}`;

    if (state.modelCache && state.modelCache.provider === state.currentProvider) {
      renderModelList(state.modelCache.models);
      return;
    }

    el.modelList.innerHTML = `<div class="model-list-loading">Loading models…</div>`;
    try {
      const res = await fetch("/api/models");
      const data = await res.json();
      const models = data.models || [];
      state.modelCache = { provider: state.currentProvider, models };
      if (!models.length) {
        el.modelList.innerHTML = `<div class="model-list-empty">${escapeHtml(data.note || "No selectable models for this provider.")}</div>`;
        return;
      }
      renderModelList(models);
    } catch (err) {
      el.modelList.innerHTML = `<div class="model-list-empty">Failed to load models: ${escapeHtml(String(err.message || err))}</div>`;
    }
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
      const row = document.createElement("div");
      row.className = `model-item${model.id === state.currentModel ? " active" : ""}`;
      row.innerHTML = `
        <div>
          <div class="model-item-name">${escapeHtml(model.name)}</div>
          <div class="model-item-id">${escapeHtml(model.id)}</div>
        </div>
        ${model.free ? '<span class="model-item-free">FREE</span>' : ""}
      `;
      row.addEventListener("click", () => {
        send({ type: "switch_model", model: model.id });
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
      const res = await fetch(`/api/upload?path=${encodeURIComponent(file.name)}`, {
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
      const res = await fetch(`/api/tree?path=${encodeURIComponent(relPath)}`);
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
      const res = await fetch(`/api/file?path=${encodeURIComponent(relPath)}`);
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

  function downloadFile(relPath) {
    const a = document.createElement("a");
    a.href = `/api/download?path=${encodeURIComponent(relPath)}`;
    a.download = relPath.split("/").pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
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
  });

  // ---------- Init ----------

  if (window.innerWidth < 480) {
    el.composerInput.placeholder = "Ask the agent…";
  }

  setBusy(false);
  connect();
})();
