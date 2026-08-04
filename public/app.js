(() => {
  "use strict";

  const el = {
    sidebar: document.getElementById("sidebar"),
    sidebarToggle: document.getElementById("sidebar-toggle"),
    fileTree: document.getElementById("file-tree"),
    statusDot: document.getElementById("status-dot"),
    statusText: document.getElementById("status-text"),
    cwdLabel: document.getElementById("cwd-label"),
    modelBadge: document.getElementById("model-badge"),
    yoloBadge: document.getElementById("yolo-badge"),
    resetBtn: document.getElementById("reset-btn"),
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
    tasksSection: document.getElementById("tasks-section"),
    taskList: document.getElementById("task-list"),
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
  };

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
      interruptPendingToolCards();
      if (state.pendingPermissionId) {
        el.permOverlay.hidden = true;
        state.pendingPermissionId = null;
      }
      setBusy(false);
      if (wasBusy) {
        appendErrorMessage("Connection to the agent was lost. Reconnecting… you'll need to resend your last message.");
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
  }

  function send(msg) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(msg));
    }
  }

  // ---------- Server message handling ----------

  function handleServerMessage(msg) {
    switch (msg.type) {
      case "init": {
        const switched = state.currentRoot && state.currentRoot !== msg.root;
        state.currentRoot = msg.root;
        state.recentFolders = msg.recentFolders || [];
        state.currentProvider = msg.provider;
        state.currentModel = msg.model;
        el.cwdLabel.textContent = msg.root;
        el.cwdLabel.title = msg.root;
        updateModelBadge();
        el.yoloBadge.hidden = !msg.yolo;
        if (switched) {
          state.toolCards.clear();
          renderTasks([]);
          el.codePanel.hidden = true;
          showEmptyState("Switched project folder.");
        }
        loadTree(el.fileTree, ".");
        break;
      }
      case "thinking":
        showThinking(msg.value);
        break;
      case "tool_call":
        addToolCard(msg.id, msg.name, msg.label);
        break;
      case "tool_result":
        updateToolCard(msg.id, msg.output, msg.ok);
        break;
      case "assistant":
        showThinking(false);
        appendAssistantMessage(msg.text);
        setBusy(false);
        break;
      case "error":
        showThinking(false);
        appendErrorMessage(msg.text);
        setBusy(false);
        break;
      case "permission_request":
        showPermissionModal(msg.id, msg.toolName, msg.label, msg.preview);
        break;
      case "tasks":
        renderTasks(msg.tasks);
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

  // ---------- Tasks ----------

  const TASK_GLYPH = { pending: "○", in_progress: "◐", completed: "✓" };

  function renderTasks(tasks) {
    el.taskList.innerHTML = "";
    el.tasksSection.hidden = !tasks || tasks.length === 0;
    if (!tasks) return;
    for (const t of tasks) {
      const row = document.createElement("div");
      row.className = `task-item ${t.status}`;
      row.innerHTML = `<span class="task-glyph">${TASK_GLYPH[t.status] || "?"}</span><span class="task-subject">${escapeHtml(t.subject)}</span>`;
      el.taskList.appendChild(row);
    }
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
  }

  el.sendBtn.addEventListener("click", sendUserMessage);
  el.composerInput.addEventListener("input", autoGrow);
  el.composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  });

  el.resetBtn.addEventListener("click", () => {
    send({ type: "reset" });
    state.toolCards.clear();
    renderTasks([]);
    showEmptyState("Conversation reset.");
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
      el.codePanelContent.textContent = data.content ?? data.error ?? "(empty)";
    } catch {
      el.codePanelContent.textContent = "(failed to load file)";
    }
  }

  el.codePanelClose.addEventListener("click", () => {
    el.codePanel.hidden = true;
  });

  el.sidebarToggle.addEventListener("click", () => {
    el.sidebar.classList.toggle("open");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!el.codePanel.hidden) el.codePanel.hidden = true;
    if (!el.folderOverlay.hidden) el.folderOverlay.hidden = true;
    if (!el.modelOverlay.hidden) el.modelOverlay.hidden = true;
  });

  // ---------- Init ----------

  if (window.innerWidth < 480) {
    el.composerInput.placeholder = "Ask the agent…";
  }

  setBusy(false);
  connect();
})();
