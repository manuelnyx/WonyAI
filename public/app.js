/**
 * WonyAI — Client Application Logic
 * Deterministic State Machine, Smart Rate Limiter, Markdown Renderer, and API Client
 */

(function () {
    "use strict";

    // ── Rate & Payload Constants (Guest Tier vs 4x Member Tier — Token Limit Only) ──
    const MAX_INPUT_CHARS = 2000;
    const RATE_COOLDOWN_SEC = 3.0;
    const FULL_ACCOUNT_TOKENS = 60000; // Member Tier (4x token limit)
    const GUEST_TOKENS_LIMIT = 15000;  // Guest Tier (base token limit, resets on refresh/new session)
    const STORAGE_KEY = "wonyai_state_v2";
    const TITLES_STORAGE_KEY = "wonyai_titles_v2";
    const QUOTA_STORAGE_KEY = "wonyai_member_quota_v4";

    // In-memory token counter for Guest Tier (automatically resets to 0 on browser refresh or new guest session)
    let guestTokensUsed = 0;

    // ── Application State ──
    const state = {
        page: "landing", // "landing" | "auth" | "chat"
        authToken: null,
        refreshToken: null,
        userId: null,
        userEmail: null,
        guestMode: false,
        sessionId: generateUUID(),
        messages: [],
        chatTitle: null,
        msgCount: 0,
        lastMsgTs: 0,
        memoryEnabled: true,
        groqConfigured: true,
        sessions: [],
        isSending: false,
    };

    let savedTitles = {};

    // ── DOM References ──
    const el = {
        viewLanding: document.getElementById("view-landing"),
        viewAuth: document.getElementById("view-auth"),
        viewChat: document.getElementById("view-chat"),
        toastContainer: document.getElementById("toast-container"),

        // Landing
        btnLandingAuth: document.getElementById("btn-landing-auth"),
        btnLandingGuest: document.getElementById("btn-landing-guest"),

        // Auth
        authAlert: document.getElementById("auth-alert"),
        authFormsWrapper: document.getElementById("auth-forms-wrapper"),
        tabBtnLogin: document.getElementById("tab-btn-login"),
        tabBtnRegister: document.getElementById("tab-btn-register"),
        formLogin: document.getElementById("form-login"),
        formRegister: document.getElementById("form-register"),
        loginEmail: document.getElementById("login-email"),
        loginPass: document.getElementById("login-pass"),
        regEmail: document.getElementById("reg-email"),
        regPass: document.getElementById("reg-pass"),
        btnSubmitLogin: document.getElementById("btn-submit-login"),
        btnSubmitRegister: document.getElementById("btn-submit-register"),
        btnAuthGuest: document.getElementById("btn-auth-guest"),
        btnAuthBack: document.getElementById("btn-auth-back"),

        // Sidebar
        sidebar: document.getElementById("sidebar"),
        sidebarBackdrop: document.getElementById("sidebar-backdrop"),
        btnSidebarOpen: document.getElementById("btn-sidebar-open"),
        btnSidebarClose: document.getElementById("btn-sidebar-close"),
        sidebarUserLabel: document.getElementById("sidebar-user-label"),
        btnNewChat: document.getElementById("btn-new-chat"),
        sidebarGuestPanel: document.getElementById("sidebar-guest-panel"),
        sidebarAuthPanel: document.getElementById("sidebar-auth-panel"),
        btnSidebarSignin: document.getElementById("btn-sidebar-signin"),
        sessionsList: document.getElementById("sessions-list"),
        btnSignout: document.getElementById("btn-signout"),
        quotaTierBadge: document.getElementById("quota-tier-badge"),
        quotaBarFill: document.getElementById("quota-bar-fill"),
        quotaBarLocked: document.getElementById("quota-bar-locked"),
        quotaPercentText: document.getElementById("quota-percent-text"),
        quotaDetailText: document.getElementById("quota-detail-text"),

        // Chat Main
        apiKeyBanner: document.getElementById("api-key-banner"),
        chatHeaderEmpty: document.getElementById("chat-header-empty"),
        chatHeaderActive: document.getElementById("chat-header-active"),
        activeSessionTitle: document.getElementById("active-session-title"),
        chatAlert: document.getElementById("chat-alert"),
        messagesList: document.getElementById("messages-list"),
        formChat: document.getElementById("form-chat"),
        chatInput: document.getElementById("chat-input"),
        btnSend: document.getElementById("btn-send"),
    };

    // ── Utilities ──
    function generateUUID() {
        if (window.crypto && window.crypto.randomUUID) {
            return window.crypto.randomUUID();
        }
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    function showToast(message) {
        const item = document.createElement("div");
        item.className = "toast-item";
        item.textContent = message;
        el.toastContainer.appendChild(item);
        setTimeout(() => {
            item.remove();
        }, 3200);
    }

    function showAlert(targetEl, message) {
        if (!message) {
            targetEl.classList.add("hidden");
            targetEl.textContent = "";
            return;
        }
        targetEl.textContent = message;
        targetEl.classList.remove("hidden");
    }

    // ── State Persistence ──
    function loadStoredState() {
        try {
            const rawTitles = localStorage.getItem(TITLES_STORAGE_KEY);
            if (rawTitles) {
                savedTitles = JSON.parse(rawTitles) || {};
            }
            const raw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed.authToken) {
                state.authToken = parsed.authToken;
                state.refreshToken = parsed.refreshToken || null;
                state.userId = parsed.userId || null;
                state.userEmail = parsed.userEmail || null;
                state.guestMode = false;
                if (parsed.sessionId) state.sessionId = parsed.sessionId;
                if (Array.isArray(parsed.messages)) state.messages = parsed.messages;
                if (parsed.chatTitle) state.chatTitle = parsed.chatTitle;
                if (parsed.page) state.page = parsed.page;
            } else if (parsed.guestMode) {
                // On browser refresh in Guest Mode: start a fresh guest session with 0 token usage
                state.guestMode = true;
                state.sessionId = generateUUID();
                state.messages = [];
                state.chatTitle = null;
                state.page = parsed.page === "auth" ? "auth" : "chat";
                guestTokensUsed = 0;
            }
        } catch (_) {
            // Ignore malformed storage
        }
    }

    function saveState() {
        try {
            const payload = JSON.stringify({
                page: state.page,
                authToken: state.authToken,
                refreshToken: state.refreshToken,
                userId: state.userId,
                userEmail: state.userEmail,
                guestMode: state.guestMode,
                sessionId: state.sessionId,
                messages: state.messages,
                chatTitle: state.chatTitle,
                msgCount: state.msgCount,
            });
            sessionStorage.setItem(STORAGE_KEY, payload);
            if (state.authToken) {
                localStorage.setItem(STORAGE_KEY, payload);
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch (_) {}
    }

    function saveSessionTitle(sessionId, title) {
        if (!sessionId || !title) return;
        savedTitles[sessionId] = title;
        try {
            localStorage.setItem(TITLES_STORAGE_KEY, JSON.stringify(savedTitles));
        } catch (_) {}
    }

    // ── Token Quota Accounting (Guest Tier vs 4x Member Tier — Token Limit Only) ──
    function getTodayDateKey() {
        const now = new Date();
        return now.toISOString().slice(0, 10);
    }

    function getTierLimits() {
        const isGuest = state.guestMode || !state.authToken;
        if (isGuest) {
            return {
                isGuest: true,
                maxTokens: GUEST_TOKENS_LIMIT,
                badgeLabel: "Guest Tier",
            };
        }
        return {
            isGuest: false,
            maxTokens: FULL_ACCOUNT_TOKENS,
            badgeLabel: "4x Member Tier",
        };
    }

    function getDailyUsage() {
        const isGuest = state.guestMode || !state.authToken;
        if (isGuest) {
            return { tokens: guestTokensUsed };
        }
        const today = getTodayDateKey();
        const actor = `user_${state.userId || "auth"}`;
        try {
            const raw = localStorage.getItem(QUOTA_STORAGE_KEY);
            const all = raw ? JSON.parse(raw) : {};
            if (all.date !== today) {
                return { tokens: 0 };
            }
            const entry = (all.actors && all.actors[actor]) || { tokens: 0 };
            return {
                tokens: Number(entry.tokens) || 0,
            };
        } catch (_) {
            return { tokens: 0 };
        }
    }

    function recordDailyUsage(addedTokens, authoritativeTotal = null) {
        const isGuest = state.guestMode || !state.authToken;
        if (isGuest) {
            if (typeof authoritativeTotal === "number") {
                guestTokensUsed = authoritativeTotal;
            } else {
                guestTokensUsed += Number(addedTokens) || 0;
            }
            renderQuotaWidget();
            return;
        }
        const today = getTodayDateKey();
        const actor = `user_${state.userId || "auth"}`;
        try {
            const raw = localStorage.getItem(QUOTA_STORAGE_KEY);
            let all = raw ? JSON.parse(raw) : {};
            if (all.date !== today || typeof all.actors !== "object") {
                all = { date: today, actors: {} };
            }
            const prev = all.actors[actor] || { tokens: 0 };
            const nextTokens =
                typeof authoritativeTotal === "number"
                    ? authoritativeTotal
                    : (Number(prev.tokens) || 0) + (Number(addedTokens) || 0);
            all.actors[actor] = {
                tokens: Math.max(0, nextTokens),
            };
            localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(all));
        } catch (_) {}
        renderQuotaWidget();
    }

    function renderQuotaWidget() {
        if (!el.quotaTierBadge) return;
        const limits = getTierLimits();
        const usage = getDailyUsage();

        const usedPercent = Math.min(
            100,
            Math.round((usage.tokens / limits.maxTokens) * 100)
        );

        el.quotaTierBadge.textContent = limits.badgeLabel;
        el.quotaTierBadge.classList.toggle("badge-auth", !limits.isGuest);
        el.quotaBarFill.style.width = `${usedPercent}%`;

        el.quotaPercentText.textContent = `${usedPercent}% used`;
        const tokFormatted =
            usage.tokens >= 1000
                ? `${(usage.tokens / 1000).toFixed(1)}k`
                : `${usage.tokens}`;
        const maxTokFormatted = `${limits.maxTokens / 1000}k`;
        el.quotaDetailText.textContent = `${tokFormatted} / ${maxTokFormatted} tokens`;
    }

    // ── Route Guard & Navigation ──
    function canChat() {
        return Boolean(state.authToken || state.guestMode);
    }

    function applyRouteGuard() {
        const authed = Boolean(state.authToken);
        const guest = Boolean(state.guestMode);
        if (authed) {
            state.guestMode = false;
        }
        if (state.page === "chat" && !authed && !guest) {
            state.page = "landing";
        } else if ((state.page === "auth" || state.page === "landing") && authed) {
            state.page = "chat";
        }
    }

    function go(page) {
        state.page = ["landing", "auth", "chat"].includes(page) ? page : "landing";
        applyRouteGuard();
        saveState();
        renderPage();
    }

    async function enterChat({ guest = false, auth = null } = {}) {
        if (auth) {
            state.authToken = auth.token;
            state.refreshToken = auth.refresh_token || null;
            state.userId = auth.user_id;
            state.userEmail = auth.email;
            state.guestMode = false;
        } else if (guest) {
            state.guestMode = true;
            state.authToken = null;
            state.refreshToken = null;
            state.userId = null;
            state.userEmail = null;
            guestTokensUsed = 0;
        }
        state.sessionId = generateUUID();
        state.messages = [];
        state.chatTitle = null;
        state.page = "chat";
        saveState();
        renderPage();
        if (state.authToken) {
            await fetchSessions();
        }
    }

    function resetToLanding() {
        state.authToken = null;
        state.refreshToken = null;
        state.userId = null;
        state.userEmail = null;
        state.guestMode = false;
        state.messages = [];
        state.chatTitle = null;
        state.sessions = [];
        state.sessionId = generateUUID();
        state.page = "landing";
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_KEY);
        renderPage();
    }

    // ── Markdown Renderer (Full Support: Code Blocks, Tables, Headings, Lists, Source Pills) ──
    function escapeHtml(str) {
        return String(str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function formatInlineMarkdown(str) {
        const inlineCodes = [];
        // Protect inline code `...` first so bold/italic/links inside backticks are not mangled
        let s = str.replace(/`([^`\n]+)`/g, function (_, code) {
            const idx = inlineCodes.length;
            inlineCodes.push(`<code>${code}</code>`);
            return `\x00INLINECODE_${idx}\x00`;
        });
        // Bold **...**
        s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        // Italic *...*
        s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
        // Links [label](https://...) — strict http/https URL allowlist
        s = s.replace(
            /\[([^\]]+)\]\((https?:\/\/[a-zA-Z0-9._~:/?#\[\]@!$&'()*+,;=%-]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
        );
        inlineCodes.forEach((html, idx) => {
            s = s.replace(`\x00INLINECODE_${idx}\x00`, html);
        });
        return s;
    }

    function parseMarkdownTable(lines) {
        const parseRow = (line) =>
            line
                .trim()
                .replace(/^\|/, "")
                .replace(/\|$/, "")
                .split("|")
                .map((cell) => formatInlineMarkdown(cell.trim()));

        const headers = parseRow(lines[0]);
        const bodyRows = lines.slice(2).filter((l) => l.trim().includes("|"));
        const thHtml = headers.map((h) => `<th>${h}</th>`).join("");
        const trHtml = bodyRows
            .map((rowLine) => {
                const cells = parseRow(rowLine);
                return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
            })
            .join("");
        return `<div class="table-wrap"><table><thead><tr>${thHtml}</tr></thead><tbody>${trHtml}</tbody></table></div>`;
    }

    function renderMarkdown(md) {
        if (!md) return "";
        const codeBlocks = [];
        // Extract fenced code blocks ```lang ... ``` using NUL sentinel (cannot collide with user text)
        let text = md.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, function (_, _lang, code) {
            const idx = codeBlocks.length;
            codeBlocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
            return `\n\n\x00CODEBLOCK_${idx}\x00\n\n`;
        });

        text = escapeHtml(text);

        // Extract "**Sumber:** [Title](url) · ..." footer line if present
        let sourcesHtml = "";
        text = text.replace(/\n*\*\*Sumber:\*\*\s*(.+)$/m, function (_, rawLinks) {
            const pills = [];
            const linkRe = /\[([^\]]+)\]\((https?:\/\/[a-zA-Z0-9._~:/?#\[\]@!$&'()*+,;=%-]+)\)/g;
            let match;
            while ((match = linkRe.exec(rawLinks)) !== null) {
                pills.push(
                    `<a href="${match[2]}" class="source-pill" target="_blank" rel="noopener noreferrer" title="${match[1]}">${match[1]}</a>`
                );
            }
            if (pills.length > 0) {
                sourcesHtml = `<div class="sources-row"><span class="sources-label">Sumber</span>${pills.join("")}</div>`;
            }
            return "";
        });

        // Line-by-line state parser supporting mixed headings, lists, blockquotes, tables, and paragraphs
        const lines = text.split("\n");
        const outHtml = [];
        let i = 0;

        while (i < lines.length) {
            const rawLine = lines[i];
            const trimmed = rawLine.trim();

            if (!trimmed) {
                i++;
                continue;
            }

            if (/^\x00CODEBLOCK_\d+\x00$/.test(trimmed)) {
                outHtml.push(trimmed);
                i++;
                continue;
            }

            // Markdown Table
            if (
                i + 1 < lines.length &&
                trimmed.includes("|") &&
                /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
            ) {
                const tableLines = [];
                while (i < lines.length && lines[i].trim().includes("|")) {
                    tableLines.push(lines[i]);
                    i++;
                }
                outHtml.push(parseMarkdownTable(tableLines));
                continue;
            }

            // Heading (# .. ####)
            if (/^#{1,4}\s+/.test(trimmed)) {
                const level = Math.min(trimmed.match(/^#+/)[0].length, 4);
                const content = formatInlineMarkdown(trimmed.replace(/^#{1,4}\s+/, ""));
                outHtml.push(`<h${level}>${content}</h${level}>`);
                i++;
                continue;
            }

            // Blockquote (&gt; ...)
            if (/^&gt;\s?/.test(trimmed)) {
                const quoteLines = [];
                while (i < lines.length && /^&gt;\s?/.test(lines[i].trim())) {
                    quoteLines.push(formatInlineMarkdown(lines[i].trim().replace(/^&gt;\s?/, "")));
                    i++;
                }
                outHtml.push(`<blockquote>${quoteLines.join("<br />")}</blockquote>`);
                continue;
            }

            // Unordered list (-, *, •)
            if (/^[-*•]\s+/.test(trimmed)) {
                const ulItems = [];
                while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
                    ulItems.push(
                        `<li>${formatInlineMarkdown(lines[i].trim().replace(/^[-*•]\s+/, ""))}</li>`
                    );
                    i++;
                }
                outHtml.push(`<ul>${ulItems.join("")}</ul>`);
                continue;
            }

            // Ordered list (1., 2., ...)
            if (/^\d+\.\s+/.test(trimmed)) {
                const olItems = [];
                while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
                    olItems.push(
                        `<li>${formatInlineMarkdown(lines[i].trim().replace(/^\d+\.\s+/, ""))}</li>`
                    );
                    i++;
                }
                outHtml.push(`<ol>${olItems.join("")}</ol>`);
                continue;
            }

            // Standard paragraph lines until next blank line or structural element
            const paraLines = [];
            while (i < lines.length) {
                const cur = lines[i].trim();
                if (
                    !cur ||
                    /^\x00CODEBLOCK_\d+\x00$/.test(cur) ||
                    /^#{1,4}\s+/.test(cur) ||
                    /^&gt;\s?/.test(cur) ||
                    /^[-*•]\s+/.test(cur) ||
                    /^\d+\.\s+/.test(cur) ||
                    (i + 1 < lines.length &&
                        cur.includes("|") &&
                        /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1]))
                ) {
                    break;
                }
                paraLines.push(formatInlineMarkdown(cur));
                i++;
            }
            if (paraLines.length > 0) {
                outHtml.push(`<p>${paraLines.join("<br />")}</p>`);
            }
        }

        let finalHtml = outHtml.join("") + sourcesHtml;
        codeBlocks.forEach((blockHtml, idx) => {
            finalHtml = finalHtml.replace(`\x00CODEBLOCK_${idx}\x00`, blockHtml);
        });
        return finalHtml;
    }

    // ── Rendering Views ──
    function renderPage() {
        applyRouteGuard();
        el.viewLanding.classList.toggle("hidden", state.page !== "landing");
        el.viewAuth.classList.toggle("hidden", state.page !== "auth");
        el.viewChat.classList.toggle("hidden", state.page !== "chat");

        if (state.page === "auth") {
            showAlert(el.authAlert, "");
            if (!state.memoryEnabled) {
                showAlert(
                    el.authAlert,
                    "Supabase is not configured. Add SUPABASE_URL and SUPABASE_KEY to environment variables."
                );
                el.authFormsWrapper.classList.add("hidden");
            } else {
                el.authFormsWrapper.classList.remove("hidden");
            }
        } else if (state.page === "chat") {
            renderChatWorkspace();
        }
    }

    function renderChatWorkspace() {
        const isGuest = state.guestMode || !state.authToken;
        el.sidebarUserLabel.textContent = isGuest ? "Guest mode" : state.userEmail || "";
        el.sidebarGuestPanel.classList.toggle("hidden", !isGuest);
        el.sidebarAuthPanel.classList.toggle("hidden", isGuest);

        el.apiKeyBanner.classList.toggle("hidden", state.groqConfigured);
        el.formChat.classList.toggle("hidden", !state.groqConfigured);

        // Header state
        const hasMessages = state.messages.length > 0;
        el.chatHeaderEmpty.classList.toggle("hidden", hasMessages);
        el.chatHeaderActive.classList.toggle("hidden", !hasMessages);

        if (hasMessages) {
            let sessionTitle =
                state.chatTitle ||
                savedTitles[state.sessionId] ||
                (state.sessions.find((s) => s.session_id === state.sessionId) || {}).title ||
                "WonyAI";
            if (sessionTitle.length > 60) {
                sessionTitle = sessionTitle.slice(0, 60) + "...";
            }
            el.activeSessionTitle.textContent = sessionTitle;
        }

        renderMessages();
        renderSessionsList();
        renderQuotaWidget();
    }

    function renderMessages() {
        el.messagesList.innerHTML = "";
        for (const msg of state.messages) {
            if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;
            const row = document.createElement("div");
            row.className = `chat-msg ${msg.role}`;

            const avatar = document.createElement("div");
            avatar.className = "msg-avatar";
            if (msg.role === "user") {
                avatar.textContent = "U";
            } else {
                avatar.innerHTML = '<img src="/logo.jpg" alt="W" class="msg-avatar-img" />';
            }

            const body = document.createElement("div");
            body.className = "msg-body";
            body.innerHTML = renderMarkdown(msg.content || "");

            row.appendChild(avatar);
            row.appendChild(body);
            el.messagesList.appendChild(row);
        }
        scrollToBottom();
    }

    function appendThinkingBubble() {
        const row = document.createElement("div");
        row.className = "chat-msg assistant";
        row.id = "thinking-bubble";

        const avatar = document.createElement("div");
        avatar.className = "msg-avatar";
        avatar.innerHTML = '<img src="/logo.jpg" alt="W" class="msg-avatar-img" />';

        const body = document.createElement("div");
        body.className = "msg-body thinking-text";
        body.textContent = "Thinking...";

        row.appendChild(avatar);
        row.appendChild(body);
        el.messagesList.appendChild(row);
        scrollToBottom();
    }

    function removeThinkingBubble() {
        const bubble = document.getElementById("thinking-bubble");
        if (bubble) bubble.remove();
    }

    function renderSessionsList() {
        if (state.guestMode || !state.authToken) return;
        el.sessionsList.innerHTML = "";
        const recent = state.sessions.slice(-15).reverse();
        if (recent.length === 0) {
            const empty = document.createElement("div");
            empty.className = "no-sessions-text";
            empty.textContent = "No conversations yet.";
            el.sessionsList.appendChild(empty);
            return;
        }

        for (const s of recent) {
            const row = document.createElement("div");
            row.className = "session-row";

            let rawTitle = savedTitles[s.session_id] || s.title || "New Chat";
            if (s.session_id === state.sessionId && state.chatTitle) {
                rawTitle = state.chatTitle;
            }
            const label = rawTitle.length >= 40 ? rawTitle.slice(0, 40) + "..." : rawTitle;

            const btnSelect = document.createElement("button");
            btnSelect.type = "button";
            btnSelect.className =
                "btn-outline session-item-btn" +
                (s.session_id === state.sessionId ? " active-session" : "");
            btnSelect.textContent = label;
            btnSelect.title = rawTitle;
            btnSelect.addEventListener("click", () => loadSessionHistory(s.session_id));

            const btnDel = document.createElement("button");
            btnDel.type = "button";
            btnDel.className = "btn-outline session-del-btn";
            btnDel.textContent = "🗑";
            btnDel.title = "Delete conversation";
            btnDel.addEventListener("click", () => deleteSession(s.session_id));

            row.appendChild(btnSelect);
            row.appendChild(btnDel);
            el.sessionsList.appendChild(row);
        }
    }

    function scrollToBottom() {
        window.requestAnimationFrame(() => {
            window.scrollTo({
                top: document.body.scrollHeight,
                behavior: "smooth",
            });
        });
    }

    // ── Sidebar Toggle (Mobile & Desktop) ──
    function setSidebarCollapsed(collapsed) {
        el.sidebar.classList.toggle("collapsed", collapsed);
        el.btnSidebarOpen.classList.toggle("hidden", !collapsed);
        const isMobile = window.innerWidth <= 768;
        el.sidebarBackdrop.classList.toggle("hidden", collapsed || !isMobile);
    }

    // ── API Calls ──
    async function fetchConfig() {
        try {
            const r = await fetch("/api/config");
            if (r.ok) {
                const data = await r.json();
                state.memoryEnabled = Boolean(data.memory_enabled);
                state.groqConfigured = Boolean(data.groq_configured);
                renderPage();
            }
        } catch (_) {}
    }

    async function tryRefreshAuthToken() {
        if (!state.refreshToken) return false;
        try {
            const r = await fetch("/api/auth/refresh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refresh_token: state.refreshToken }),
            });
            if (!r.ok) return false;
            const data = await r.json();
            if (data && data.token) {
                state.authToken = data.token;
                if (data.refresh_token) state.refreshToken = data.refresh_token;
                if (data.user_id) state.userId = data.user_id;
                if (data.email) state.userEmail = data.email;
                saveState();
                return true;
            }
        } catch (_) {}
        return false;
    }

    async function fetchSessions(isRetry = false) {
        if (!state.authToken || !state.userId) return;
        try {
            const r = await fetch(`/api/sessions?user_id=${encodeURIComponent(state.userId)}`, {
                headers: { Authorization: `Bearer ${state.authToken}` },
            });
            if (r.status === 401) {
                if (!isRetry && (await tryRefreshAuthToken())) {
                    return fetchSessions(true);
                }
                resetToLanding();
                go("auth");
                showToast("Session expired. Please sign in again.");
                return;
            }
            if (r.ok) {
                const data = await r.json();
                state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
                if (typeof data.today_tokens_used === "number") {
                    recordDailyUsage(0, data.today_tokens_used);
                }
                renderSessionsList();
            }
        } catch (_) {}
    }

    async function loadSessionHistory(sessionId) {
        if (!state.authToken || !state.userId) return;
        try {
            const r = await fetch(
                `/api/sessions/${encodeURIComponent(sessionId)}?user_id=${encodeURIComponent(state.userId)}`,
                {
                    headers: { Authorization: `Bearer ${state.authToken}` },
                }
            );
            if (r.ok) {
                const data = await r.json();
                state.sessionId = sessionId;
                state.messages = Array.isArray(data.messages) ? data.messages : [];
                state.chatTitle = savedTitles[sessionId] || null;
                saveState();
                renderChatWorkspace();
                if (window.innerWidth <= 768) {
                    setSidebarCollapsed(true);
                }
            }
        } catch (_) {}
    }

    async function deleteSession(sessionId) {
        if (!state.authToken || !state.userId) return;
        try {
            await fetch(
                `/api/sessions/${encodeURIComponent(sessionId)}?user_id=${encodeURIComponent(state.userId)}`,
                {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${state.authToken}` },
                }
            );
            if (sessionId === state.sessionId) {
                state.sessionId = generateUUID();
                state.messages = [];
                state.chatTitle = null;
                saveState();
            }
            await fetchSessions();
            renderChatWorkspace();
        } catch (_) {}
    }

    // ── Chat Submission Flow ──
    async function handleChatSubmit(e) {
        e.preventDefault();
        if (state.isSending) return;

        let prompt = (el.chatInput.value || "").trim();
        if (!prompt) return;

        showAlert(el.chatAlert, "");

        // Rate limiting & Tier Quota (Guest 25% vs Account 100%)
        const now = Date.now() / 1000;
        const sinceLast = now - state.lastMsgTs;
        if (sinceLast < RATE_COOLDOWN_SEC) {
            const wait = (RATE_COOLDOWN_SEC - sinceLast).toFixed(1);
            showAlert(el.chatAlert, `Terlalu cepat, tunggu ${wait}s sebelum kirim lagi.`);
            return;
        }

        const limits = getTierLimits();
        const usage = getDailyUsage();
        if (usage.tokens >= limits.maxTokens) {
            if (limits.isGuest) {
                showAlert(
                    el.chatAlert,
                    "Limit token Guest Tier (15.000 token) sudah tercapai. Silakan Sign In / Create Account di sidebar untuk mendapatkan 4x limit token (60.000 token) beserta penyimpanan memori chat!"
                );
            } else {
                showAlert(
                    el.chatAlert,
                    "Batas token harian akun (60.000 token) telah tercapai. Kuota akan ter-reset otomatis besok."
                );
            }
            return;
        }

        state.lastMsgTs = now;
        state.msgCount += 1;

        if (prompt.length > MAX_INPUT_CHARS) {
            prompt = prompt.slice(0, MAX_INPUT_CHARS);
            showToast(`Pesan dipotong hingga ${MAX_INPUT_CHARS} karakter.`);
        }

        // Clear input & resize
        el.chatInput.value = "";
        el.chatInput.style.height = "auto";

        const historyBefore = state.messages.slice(-8);
        state.messages.push({ role: "user", content: prompt });
        saveState();
        renderChatWorkspace();

        state.isSending = true;
        el.btnSend.disabled = true;
        appendThinkingBubble();

        try {
            const headers = { "Content-Type": "application/json" };
            if (state.authToken) {
                headers["Authorization"] = `Bearer ${state.authToken}`;
            }

            const nowDate = new Date();
            const wibStr = nowDate.toLocaleString("id-ID", {
                timeZone: "Asia/Jakarta",
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            });
            const witaStr = nowDate.toLocaleTimeString("id-ID", {
                timeZone: "Asia/Makassar",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            });
            const witStr = nowDate.toLocaleTimeString("id-ID", {
                timeZone: "Asia/Jayapura",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            });
            const clientClock = `${wibStr} WIB (UTC+7) | ${witaStr} WITA (UTC+8) | ${witStr} WIT (UTC+9)`;

            let r = await fetch("/api/chat", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    prompt,
                    session_id: state.sessionId,
                    history: historyBefore,
                    user_id: state.userId,
                    guest_mode: state.guestMode,
                    used_tokens: usage.tokens,
                    client_clock: clientClock,
                }),
            });

            if (r.status === 401 && state.authToken && (await tryRefreshAuthToken())) {
                headers["Authorization"] = `Bearer ${state.authToken}`;
                r = await fetch("/api/chat", {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        prompt,
                        session_id: state.sessionId,
                        history: historyBefore,
                        user_id: state.userId,
                        guest_mode: state.guestMode,
                        used_tokens: usage.tokens,
                        client_clock: clientClock,
                    }),
                });
            }

            removeThinkingBubble();

            if (!r.ok) {
                const errData = await r.json().catch(() => ({}));
                const errMsg = errData.detail || `Server Error (HTTP ${r.status})`;
                showAlert(el.chatAlert, errMsg);
            } else {
                const data = await r.json();
                const reply = data.reply || "";
                const turnTokens = Number(data.tokens_used) || Math.max(150, Math.round((prompt.length + reply.length) / 4));
                const authoritativeTotal =
                    typeof data.today_tokens_used === "number" ? data.today_tokens_used : null;
                recordDailyUsage(turnTokens, authoritativeTotal);
                state.messages.push({ role: "assistant", content: reply });
                saveState();
                renderChatWorkspace();

                // Non-blocking AI title generation on first meaningful topical message (ignore "helaw", "lama ye", etc.)
                const trimmedPrompt = prompt.trim();
                const isCasualGreeting =
                    /^(p|pp|tes|test|hi+|halo+|hai+|helaw+|halow+|hello+|hey+|pagi|siang|sore|malam|how are u|how r u|lama ye|lama ya|lu sp|lu siapa)[?!.\s]*$/i.test(
                        trimmedPrompt
                    );
                if (
                    !state.chatTitle &&
                    !isCasualGreeting &&
                    trimmedPrompt.length >= 10 &&
                    trimmedPrompt.split(/\s+/).length >= 2
                ) {
                    triggerTitleGeneration(state.sessionId, trimmedPrompt);
                }
                if (state.authToken) {
                    fetchSessions();
                }
            }
        } catch (err) {
            removeThinkingBubble();
            showAlert(
                el.chatAlert,
                "Connection error. Please check your internet and try again."
            );
        } finally {
            state.isSending = false;
            el.btnSend.disabled = false;
            el.chatInput.focus();
        }
    }

    async function triggerTitleGeneration(targetSessionId, firstMessage) {
        try {
            const r = await fetch("/api/title", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ first_message: firstMessage }),
            });
            if (r.ok) {
                const data = await r.json();
                if (data.title) {
                    saveSessionTitle(targetSessionId, data.title);
                    if (state.sessionId === targetSessionId) {
                        state.chatTitle = data.title;
                        saveState();
                        renderChatWorkspace();
                    }
                }
            }
        } catch (_) {}
    }

    // ── Event Listeners ──
    function bindEvents() {
        // Landing page
        el.btnLandingAuth.addEventListener("click", () => {
            state.guestMode = false;
            go("auth");
        });
        el.btnLandingGuest.addEventListener("click", () => {
            enterChat({ guest: true });
        });

        // Auth tabs
        el.tabBtnLogin.addEventListener("click", () => {
            el.tabBtnLogin.classList.add("active");
            el.tabBtnRegister.classList.remove("active");
            el.formLogin.classList.remove("hidden");
            el.formRegister.classList.add("hidden");
            showAlert(el.authAlert, "");
        });

        el.tabBtnRegister.addEventListener("click", () => {
            el.tabBtnRegister.classList.add("active");
            el.tabBtnLogin.classList.remove("active");
            el.formRegister.classList.remove("hidden");
            el.formLogin.classList.add("hidden");
            showAlert(el.authAlert, "");
        });

        // Auth login submit
        el.formLogin.addEventListener("submit", async (e) => {
            e.preventDefault();
            const email = el.loginEmail.value.trim();
            const password = el.loginPass.value;
            if (!email || !password) {
                showAlert(el.authAlert, "Please enter email and password.");
                return;
            }
            el.btnSubmitLogin.disabled = true;
            el.btnSubmitLogin.textContent = "Signing in...";
            showAlert(el.authAlert, "");
            try {
                const r = await fetch("/api/auth/signin", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password }),
                });
                const data = await r.json().catch(() => ({}));
                if (!r.ok) {
                    showAlert(el.authAlert, data.detail || "Login failed.");
                } else {
                    el.loginPass.value = "";
                    await enterChat({ auth: data });
                }
            } catch (err) {
                showAlert(el.authAlert, "Connection error while signing in.");
            } finally {
                el.btnSubmitLogin.disabled = false;
                el.btnSubmitLogin.textContent = "Sign In";
            }
        });

        // Auth register submit
        el.formRegister.addEventListener("submit", async (e) => {
            e.preventDefault();
            const email = el.regEmail.value.trim();
            const password = el.regPass.value;
            if (!email || !password) {
                showAlert(el.authAlert, "Please fill in all fields.");
                return;
            }
            if (password.length < 6) {
                showAlert(el.authAlert, "Password must be at least 6 characters.");
                return;
            }
            el.btnSubmitRegister.disabled = true;
            el.btnSubmitRegister.textContent = "Creating account...";
            showAlert(el.authAlert, "");
            try {
                const r = await fetch("/api/auth/signup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password }),
                });
                const data = await r.json().catch(() => ({}));
                if (!r.ok) {
                    showAlert(el.authAlert, data.detail || "Signup failed.");
                } else {
                    el.regPass.value = "";
                    await enterChat({ auth: data });
                }
            } catch (err) {
                showAlert(el.authAlert, "Connection error while creating account.");
            } finally {
                el.btnSubmitRegister.disabled = false;
                el.btnSubmitRegister.textContent = "Create Account";
            }
        });

        el.btnAuthGuest.addEventListener("click", () => enterChat({ guest: true }));
        el.btnAuthBack.addEventListener("click", () => go("landing"));

        // Sidebar controls
        el.btnSidebarClose.addEventListener("click", () => setSidebarCollapsed(true));
        el.btnSidebarOpen.addEventListener("click", () => setSidebarCollapsed(false));
        el.sidebarBackdrop.addEventListener("click", () => setSidebarCollapsed(true));

        el.btnNewChat.addEventListener("click", () => {
            state.sessionId = generateUUID();
            state.messages = [];
            state.chatTitle = null;
            showAlert(el.chatAlert, "");
            saveState();
            renderChatWorkspace();
            showToast("New chat started.");
            if (window.innerWidth <= 768) {
                setSidebarCollapsed(true);
            }
        });

        el.btnSidebarSignin.addEventListener("click", () => {
            state.guestMode = false;
            go("auth");
        });

        el.btnSignout.addEventListener("click", async () => {
            if (state.authToken) {
                fetch("/api/auth/signout", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${state.authToken}` },
                }).catch(() => {});
            }
            resetToLanding();
        });

        // Chat Input & Auto-resize
        el.formChat.addEventListener("submit", handleChatSubmit);
        el.chatInput.addEventListener("input", () => {
            el.chatInput.style.height = "auto";
            el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 144) + "px";
        });
        el.chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                el.formChat.requestSubmit();
            }
        });
    }

    // ── Initialize ──
    async function init() {
        loadStoredState();
        bindEvents();
        if (window.innerWidth <= 768) {
            setSidebarCollapsed(true);
        } else {
            setSidebarCollapsed(false);
        }
        renderPage();
        await fetchConfig();
        if (state.authToken && state.page === "chat") {
            await fetchSessions();
        }
    }

    init();
})();
