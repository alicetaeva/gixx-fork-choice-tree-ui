const MODULE_NAME = "choice-tree-ui";

// Отладочные тосты на экране (полезно в Termux, где нет консоли).
// Когда всё заработает — поставь false.
const CTU_DEBUG = false;

const DEFAULT_SETTINGS = Object.freeze({
    theme: "rose-glass",
    apiViaSt: false,
    enabled: true,
    autoGenerate: true,
    maxChoices: 4,
    compactMode: false,
    customPrompt: "",
    apiUrl: "",
    apiKey: "",
    apiModel: "",
    apiProfiles: [],
    activeApiProfile: "",
    promptPresets: [],
    activePreset: "",
});

const TONE_META = { tender: {}, sharp: {}, bold: {}, wild: {} };
const TONE_ORDER = ["tender", "sharp", "bold", "wild"];

const BUILTIN_ARCHETYPES = [
    { icon: "💙", label: "Нежный" },
    { icon: "🧊", label: "Резкий" },
    { icon: "🔥", label: "Дерзкий" },
    { icon: "🎲", label: "Дикий" },
];

const GENERIC_ICONS = ["●", "◆", "▲", "★"];
const BAD_LABELS = new Set(["", "unidentified", "unknown", "n/a", "null", "undefined"]);


// ═════════════ Логи (для телефона, где нет консоли F12) ═════════════
const CTU_VERSION = "3.1.0";
const CTU_LOG_KEY = "ctu_log_v1";
const CTU_LOG_MAX = 500;
let ctuLogBuf = [];
let ctuLogInternal = false;
let ctuLogSaveTimer = null;
let ctuLogViewTimer = null;

try {
    const saved = JSON.parse(localStorage.getItem(CTU_LOG_KEY) || "[]");
    if (Array.isArray(saved)) ctuLogBuf = saved.slice(-CTU_LOG_MAX);
} catch (_) {}

const CTU_SECRET_RE = /^(api[_-]?key|authorization|proxy_password|password|secret)$/i;

function ctuSafe(value, depth = 0) {
    if (value === undefined) return undefined;
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: String(value.stack || "").split("\n").slice(0, 6).join("\n"),
        };
    }
    if (typeof value === "string") {
        return value.length > 1500 ? value.slice(0, 1500) + `…(+${value.length - 1500})` : value;
    }
    if (value === null || typeof value !== "object") return value;
    if (depth > 3) return "[…]";
    if (Array.isArray(value)) return value.slice(0, 30).map((v) => ctuSafe(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) {
        out[k] = CTU_SECRET_RE.test(k) ? "***" : ctuSafe(v, depth + 1);
    }
    return out;
}

function ctuLogPersist() {
    try {
        localStorage.setItem(CTU_LOG_KEY, JSON.stringify(ctuLogBuf));
    } catch (_) {
        try { localStorage.setItem(CTU_LOG_KEY, JSON.stringify(ctuLogBuf.slice(-100))); } catch (__) {}
    }
}

function ctuPush(level, msg, data) {
    const entry = { t: new Date().toISOString(), l: level, m: ctuSafe(String(msg)) };
    const d = ctuSafe(data);
    if (d !== undefined) entry.d = d;
    ctuLogBuf.push(entry);
    if (ctuLogBuf.length > CTU_LOG_MAX) ctuLogBuf.splice(0, ctuLogBuf.length - CTU_LOG_MAX);
    clearTimeout(ctuLogSaveTimer);
    ctuLogSaveTimer = setTimeout(ctuLogPersist, 400);
    clearTimeout(ctuLogViewTimer);
    ctuLogViewTimer = setTimeout(ctuRefreshLogView, 250);
}

function ctuLog(level, msg, data) {
    ctuPush(level, msg, data);
    ctuLogInternal = true;
    try {
        const fn = (level === "debug" ? console.log : console[level]) || console.log;
        if (data === undefined) fn.call(console, `[${MODULE_NAME}]`, msg);
        else fn.call(console, `[${MODULE_NAME}]`, msg, ctuSafe(data));
    } finally {
        ctuLogInternal = false;
    }
}

// Все console.*("[choice-tree-ui] ...") тоже попадают в лог
(function ctuHookConsole() {
    for (const level of ["log", "info", "warn", "error"]) {
        const orig = console[level];
        if (typeof orig !== "function" || orig.__ctu) continue;
        const wrapped = function (...args) {
            try {
                if (!ctuLogInternal && typeof args[0] === "string" && args[0].startsWith(`[${MODULE_NAME}]`)) {
                    const first = args[0].slice(MODULE_NAME.length + 2).trim();
                    const rest = args.slice(1).map((a) => ctuSafe(a));
                    ctuPush(level === "log" ? "info" : level, first, rest.length ? rest : undefined);
                }
            } catch (_) {}
            return orig.apply(this, args);
        };
        wrapped.__ctu = true;
        console[level] = wrapped;
    }
})();

window.addEventListener("error", (e) => {
    const src = String(e.filename || "");
    if (src.includes("choice-tree") || src.includes(MODULE_NAME)) {
        ctuPush("error", "JS error", { message: e.message, file: src, line: e.lineno, col: e.colno });
    }
});
window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    if (String(r?.stack || "").includes("choice-tree") || String(r?.message || "").includes(MODULE_NAME)) {
        ctuPush("error", "Unhandled rejection", r);
    }
});

function ctuEnvSnapshot() {
    let s = {};
    try { s = getSettings(); } catch (_) {}
    let apiUrl;
    try {
        const u = new URL(s.apiUrl);
        apiUrl = u.origin + u.pathname;
    } catch (_) {
        apiUrl = s.apiUrl ? "(невалидный URL) " + String(s.apiUrl).slice(0, 80) : "(пусто — используется ST)";
    }
    return {
        build: CTU_VERSION,
        time: new Date().toString(),
        page: location.origin,
        secureContext: window.isSecureContext,
        online: navigator.onLine,
        userAgent: navigator.userAgent,
        language: navigator.language,
        theme: s.theme,
        api: {
            url: apiUrl,
            keySet: !!s.apiKey,
            keyLength: s.apiKey ? s.apiKey.length : 0,
            model: s.apiModel,
            viaSt: !!s.apiViaSt,
            profile: s.activeApiProfile,
        },
        maxChoices: s.maxChoices,
        compactMode: s.compactMode,
        preset: s.activePreset,
    };
}

function ctuLogsAsText() {
    const head = [
        "=== Choice Tree UI — лог (время в UTC; ключи и текст чата не записываются) ===",
        JSON.stringify(ctuEnvSnapshot(), null, 2),
        "=== записи ===",
    ];
    const lines = ctuLogBuf.map((e) => {
        const d = e.d !== undefined ? " " + (typeof e.d === "string" ? e.d : JSON.stringify(e.d)) : "";
        return `[${e.t.slice(0, 10)} ${e.t.slice(11, 23)}] ${String(e.l).toUpperCase().padEnd(5)} ${e.m}${d}`;
    });
    return head.concat(lines).join("\n");
}

function ctuRefreshLogView() {
    const cnt = document.getElementById("ctu-log-count");
    if (cnt) cnt.textContent = `(${ctuLogBuf.length})`;
    const ta = document.getElementById("ctu-log-view");
    const det = document.getElementById("ctu-log-details");
    if (!ta || !det?.open) return;
    ta.value = ctuLogsAsText();
    ta.scrollTop = ta.scrollHeight;
}

async function ctuCopyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) {}
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
    } catch (_) {
        return false;
    }
}

function ctuDownloadText(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

async function ctuFetchTimeout(url, opts = {}, ms = 20000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

// ═════════════ Темы оформления ═════════════
const CTU_THEMES = [
    {
        "id": "rose-glass",
        "name": "Розовое стекло",
        "hint": "классика по умолчанию",
        "bg": "#1a1420",
        "accent": "#f9a8c9",
        "alt": "#a7d2ff",
        "tones": [
            "#a7d2ff",
            "#c8dcff",
            "#ffb496",
            "#dcaaff"
        ]
    },
    {
        "id": "lacquer",
        "name": "Лаковая шкатулка",
        "hint": "чёрный лак, киноварь, золотая нить",
        "bg": "#120b0b",
        "accent": "#e2502f",
        "alt": "#d4a85c",
        "tones": [
            "#e8a0a0",
            "#9fb4c7",
            "#e2502f",
            "#d4a85c"
        ]
    },
    {
        "id": "verdigris",
        "name": "Патина",
        "hint": "окисленная медь и бронза",
        "bg": "#0e1818",
        "accent": "#5fbfa8",
        "alt": "#c28a5a",
        "tones": [
            "#7fd0bd",
            "#8fb2c4",
            "#d08a5c",
            "#b5a3d6"
        ]
    },
    {
        "id": "moth",
        "name": "Мотылёк",
        "hint": "тёплая тьма и лунный свет лампы",
        "bg": "#1a1410",
        "accent": "#f2e3a1",
        "alt": "#d9b779",
        "tones": [
            "#f0d9a0",
            "#b9c4b0",
            "#e0a070",
            "#cdb4d8"
        ]
    },
    {
        "id": "cyanotype",
        "name": "Цианотипия",
        "hint": "синька, чертёжная сетка",
        "bg": "#0a2454",
        "accent": "#cfe3ff",
        "alt": "#7fb0ff",
        "tones": [
            "#aee0ff",
            "#ffffff",
            "#ffd27a",
            "#ff9ec1"
        ]
    },
    {
        "id": "oxblood",
        "name": "Бордо и сливки",
        "hint": "кремовая бумага, цвет бычьей крови",
        "bg": "#faf3e6",
        "accent": "#7d1f2c",
        "alt": "#b08a4a",
        "tones": [
            "#b5546a",
            "#4f6b7a",
            "#b0452a",
            "#6b4a8c"
        ]
    },
    {
        "id": "amber",
        "name": "Дымчатый янтарь",
        "hint": "густой мёд за тёмным стеклом",
        "bg": "#1c1208",
        "accent": "#f0a830",
        "alt": "#ffd27a",
        "tones": [
            "#ffcf8a",
            "#c9b99a",
            "#ff8a4c",
            "#c7a2e8"
        ]
    },
    {
        "id": "opal",
        "name": "Опал",
        "hint": "перламутровые переливы",
        "bg": "#fafafd",
        "accent": "#7a6ff0",
        "alt": "#3fc2b5",
        "tones": [
            "#e0629a",
            "#4a7fd0",
            "#e08a3a",
            "#8a5fe0"
        ]
    },
    {
        "id": "mercury",
        "name": "Ртуть",
        "hint": "холодный хром, жидкий металл",
        "bg": "#14161a",
        "accent": "#d7dde6",
        "alt": "#8fa3b8",
        "tones": [
            "#b8d4e8",
            "#e2e6ec",
            "#c9a9a0",
            "#a9b4d8"
        ]
    },
    {
        "id": "ember",
        "name": "Зола и угли",
        "hint": "пепел, под которым тлеет жар",
        "bg": "#181616",
        "accent": "#ff6a2b",
        "alt": "#ffb347",
        "tones": [
            "#ffb38a",
            "#9aa7b0",
            "#ff6a2b",
            "#e85d9a"
        ]
    },
    {
        "id": "indigo",
        "name": "Индиго и шафран",
        "hint": "крашеная ткань, золотая нить",
        "bg": "#13183a",
        "accent": "#f4b942",
        "alt": "#9fb0ff",
        "tones": [
            "#a9b8ff",
            "#d8d4c4",
            "#f4b942",
            "#f08ab4"
        ]
    },
    {
        "id": "lichen",
        "name": "Лишайник",
        "hint": "матовый камень, мох и тишина",
        "bg": "#222622",
        "accent": "#a9c48a",
        "alt": "#d6c58a",
        "tones": [
            "#b9d4a0",
            "#9db5b8",
            "#d9a066",
            "#bba0c8"
        ]
    },
    {
        "id": "lantern",
        "name": "Бумажный фонарь",
        "hint": "рисовая бумага и тёплое свечение",
        "bg": "#fff8ea",
        "accent": "#e0702a",
        "alt": "#d9a441",
        "tones": [
            "#d9798a",
            "#5f7f8a",
            "#d6521f",
            "#8a5fa8"
        ]
    },
    {
        "id": "absinthe",
        "name": "Абсент",
        "hint": "зелёная фея в тёмном бокале",
        "bg": "#0e1810",
        "accent": "#c4e86b",
        "alt": "#7fd1a0",
        "tones": [
            "#a6e3b8",
            "#9fc0d0",
            "#e6d86b",
            "#c8a6e6"
        ]
    },
    {
        "id": "tidepool",
        "name": "Заводь",
        "hint": "глубокая бирюза и коралл",
        "bg": "#082028",
        "accent": "#ff8a7a",
        "alt": "#4fd1c5",
        "tones": [
            "#7fe0d4",
            "#8fb8d8",
            "#ff8a7a",
            "#f0a6d8"
        ]
    }
];

function applyTheme() {
    let id = "rose-glass";
    try { id = getSettings().theme || "rose-glass"; } catch (_) {}
    if (!CTU_THEMES.some((x) => x.id === id)) id = "rose-glass";
    document.documentElement.setAttribute("data-ctu-theme", id);
}

function renderThemePicker() {
    const grid = document.getElementById("ctu-theme-grid");
    if (!grid) return;
    const cur = getSettings().theme || "rose-glass";
    grid.innerHTML = "";
    for (const th of CTU_THEMES) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ctu-theme-tile" + (th.id === cur ? " active" : "");
        b.dataset.theme = th.id;
        b.innerHTML = `
            <div class="ctu-theme-swatch" style="background:linear-gradient(135deg, ${th.bg} 40%, ${th.accent} 150%);">
                ${th.tones.map((c) => `<i style="background:${c}"></i>`).join("")}
            </div>
            <div class="ctu-theme-name">${escapeHtml(th.name)}</div>
            <div class="ctu-theme-hint">${escapeHtml(th.hint)}</div>`;
        grid.appendChild(b);
    }
    const nameEl = document.getElementById("ctu-theme-current");
    if (nameEl) nameEl.textContent = CTU_THEMES.find((x) => x.id === cur)?.name || "";
}

// ═════════════ Связь с API: напрямую или через сервер ST ═════════════
function ctuBaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}

async function ctuBackendFetch(path, payload) {
    const ctx = SillyTavern.getContext();
    const headers =
        typeof ctx.getRequestHeaders === "function"
            ? ctx.getRequestHeaders()
            : { "Content-Type": "application/json" };
    return ctuFetchTimeout(path, { method: "POST", headers, body: JSON.stringify(payload) }, 120000);
}

async function ctuRunDiagnostics() {
    const s = getSettings();
    const base = ctuBaseUrl(s.apiUrl);
    ctuLog("info", "━━━ ДИАГНОСТИКА НАЧАТА ━━━", ctuEnvSnapshot());
    if (!base || !s.apiKey) {
        ctuLog("warn", "Свой API не задан (URL/ключ пусты) — расширение использует модель SillyTavern. Проверять нечего.");
        return "Свой API не задан";
    }
    if (location.protocol === "https:" && base.startsWith("http:")) {
        ctuLog("warn", "Смешанный контент: страница на https, API на http — браузер заблокирует прямой запрос", { page: location.origin, api: base });
    }

    let directOk = false;
    let t0 = performance.now();
    try {
        const r = await ctuFetchTimeout(`${base}/models`, { headers: { Authorization: `Bearer ${s.apiKey}` } }, 15000);
        directOk = true;
        ctuLog("info", "1/4 Прямой запрос из браузера: ОК", { status: r.status, ms: Math.round(performance.now() - t0) });
    } catch (e) {
        ctuLog("error", "1/4 Прямой запрос из браузера: ОШИБКА", { err: e, ms: Math.round(performance.now() - t0) });
        t0 = performance.now();
        try {
            await ctuFetchTimeout(`${base}/models`, { mode: "no-cors" }, 15000);
            ctuLog("warn", "2/4 no-cors: сервер ДОСТУПЕН, значит браузер режет ответ из-за CORS (лечится запросом через ST)", { ms: Math.round(performance.now() - t0) });
        } catch (e2) {
            ctuLog("error", "2/4 no-cors: сервер НЕДОСТУПЕН из браузера (DNS / сеть / блокировка / неверный адрес / смешанный контент)", { err: e2 });
        }
    }
    if (directOk) ctuLog("info", "2/4 no-cors: пропущено (прямой запрос работает)");

    t0 = performance.now();
    try {
        const r = await ctuBackendFetch("/api/backends/chat-completions/status", {
            chat_completion_source: "openai", reverse_proxy: base, proxy_password: s.apiKey,
        });
        const txt = await r.text();
        ctuLog(r.ok ? "info" : "error", "3/4 Список моделей через сервер ST", { status: r.status, ms: Math.round(performance.now() - t0), preview: txt.slice(0, 400) });
    } catch (e) {
        ctuLog("error", "3/4 Сервер ST недоступен (запрос к /api/backends/...)", { err: e });
    }

    t0 = performance.now();
    try {
        const r = await ctuBackendFetch("/api/backends/chat-completions/generate", {
            chat_completion_source: "openai", reverse_proxy: base, proxy_password: s.apiKey,
            model: s.apiModel || "gpt-4o-mini", messages: [{ role: "user", content: "ping" }],
            max_tokens: 16, stream: false, temperature: 0,
        });
        const txt = await r.text();
        ctuLog(r.ok ? "info" : "error", "4/4 Тестовая генерация через сервер ST", { status: r.status, ms: Math.round(performance.now() - t0), preview: txt.slice(0, 500) });
    } catch (e) {
        ctuLog("error", "4/4 Тестовая генерация через ST: ОШИБКА", { err: e });
    }
    ctuLog("info", "━━━ ДИАГНОСТИКА ЗАВЕРШЕНА ━━━");
    return "Готово";
}

function bindThemeAndLogEvents() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    const s = getSettings();
    const $ = (id) => document.getElementById(id);
    const msg = (text) => {
        const el = $("ctu-log-msg");
        if (!el) return;
        el.textContent = text;
        el.style.display = text ? "block" : "none";
    };

    $("ctu-theme-grid")?.addEventListener("click", (e) => {
        const tile = e.target.closest(".ctu-theme-tile");
        if (!tile) return;
        s.theme = tile.dataset.theme;
        saveSettingsDebounced();
        applyTheme();
        renderThemePicker();
        ctuLog("info", "Тема: " + s.theme);
    });

    $("ctu-api-via-st")?.addEventListener("change", (e) => {
        s.apiViaSt = e.target.checked;
        saveSettingsDebounced();
        ctuLog("info", "Всегда через сервер ST: " + s.apiViaSt);
    });

    $("ctu-log-details")?.addEventListener("toggle", ctuRefreshLogView);
    $("ctu-log-refresh")?.addEventListener("click", () => { ctuRefreshLogView(); msg("Обновлено"); });

    $("ctu-log-copy")?.addEventListener("click", async () => {
        const text = ctuLogsAsText();
        if (await ctuCopyText(text)) msg("✓ Скопировано в буфер обмена");
        else {
            const ta = $("ctu-log-view");
            if (ta) { ta.value = text; ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); }
            msg("Автокопирование недоступно — текст выделен, выбери «Копировать» в меню телефона");
        }
    });

    $("ctu-log-download")?.addEventListener("click", () => {
        const d = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
        ctuDownloadText(`choice-tree-ui-log-${d}.txt`, ctuLogsAsText());
        msg("Файл скачивается (папка «Загрузки»)");
    });

    const shareBtn = $("ctu-log-share");
    if (shareBtn) {
        if (navigator.share) {
            shareBtn.addEventListener("click", async () => {
                try { await navigator.share({ title: "Choice Tree UI — лог", text: ctuLogsAsText() }); }
                catch (e) { if (e?.name !== "AbortError") msg("Не удалось поделиться: " + e.message); }
            });
        } else shareBtn.style.display = "none";
    }

    $("ctu-log-clear")?.addEventListener("click", () => {
        ctuLogBuf = [];
        ctuLogPersist();
        ctuLog("info", "Лог очищен");
        ctuRefreshLogView();
        msg("Лог очищен");
    });

    $("ctu-log-diag")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        msg("Диагностика идёт… (до минуты)");
        try {
            const r = await ctuRunDiagnostics();
            msg(r + " — нажми «Копировать» и пришли мне");
        } catch (err) {
            ctuLog("error", "Диагностика упала", err);
            msg("Ошибка диагностики: " + err.message);
        } finally {
            btn.disabled = false;
            const det = $("ctu-log-details");
            if (det) det.open = true;
            ctuRefreshLogView();
        }
    });
}


function ctuDebug(msg) {
    console.log(`[${MODULE_NAME}]`, msg);
    if (!CTU_DEBUG) return;
    try {
        toastr.info(String(msg).slice(0, 300), "CTU debug", { timeOut: 15000 });
    } catch (_) {}
}

/**
 * Приводит "сырой" вариант ответа от модели к безопасному виду.
 * [PATCH] Принимает и строки, и объекты с альтернативными ключами текста.
 */
function normalizeChoice(raw, index, archetypes) {
    const c = (typeof raw === "string") ? { text: raw } : { ...(raw || {}) };
    if (!c.text) {
        c.text = c.response ?? c.option ?? c.content ?? c.message ?? c.reply ?? "";
    }

    let styleTone = String(c.tone || "").toLowerCase().trim();
    if (!TONE_META[styleTone]) {
        styleTone = TONE_ORDER[index % TONE_ORDER.length];
    }

    const fallbackSet = (archetypes && archetypes.length) ? archetypes : BUILTIN_ARCHETYPES;
    const fallback = fallbackSet[index] || {};

    let label = String(c.label ?? "").trim();
    if (BAD_LABELS.has(label.toLowerCase())) {
        label = (fallback.label && fallback.label.trim()) || `Вариант ${index + 1}`;
    }

    let icon = String(c.icon ?? "").trim();
    if (!icon) {
        icon = (fallback.icon && fallback.icon.trim()) || GENERIC_ICONS[index % GENERIC_ICONS.length];
    }

    return { ...c, tone: styleTone, label, icon };
}

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], k)) {
            extensionSettings[MODULE_NAME][k] = structuredClone(v);
        }
    }
    return extensionSettings[MODULE_NAME];
}

function getActivePresetObj() {
    const s = getSettings();
    if (!s.activePreset) return null;
    return s.promptPresets.find((p) => p.name === s.activePreset) || null;
}

function isInActiveChat() {
    const ctx = SillyTavern.getContext();
    if (ctx.characterId === undefined && !ctx.groupId) return false;
    if (!ctx.chat || ctx.chat.length === 0) return false;
    const lastMsg = ctx.chat[ctx.chat.length - 1];
    if (lastMsg?.is_user) return false;
    return true;
}

function injectSettingsPanel() {
    if (document.getElementById("ctu-settings-block")) return;

    const panel = document.createElement("div");
    panel.id = "ctu-settings-block";
    panel.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>✦ Choice Tree UI <span style="opacity:.45;font-size:10px;font-weight:400;">v${CTU_VERSION}</span></b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="ctu-settings-panel">

                    <label class="checkbox_label">
                        <input type="checkbox" id="ctu-enabled" />
                        <span>Расширение включено</span>
                    </label>

                    <label class="checkbox_label">
                        <input type="checkbox" id="ctu-auto-generate" />
                        <span>Автогенерация после ответа AI</span>
                    </label>

                    <label class="checkbox_label" title="Показывает только кнопки без текста вариантов. Текст всё равно генерируется и вставляется при нажатии.">
                        <input type="checkbox" id="ctu-compact-mode" />
                        <span>Компактный режим <span style="opacity:0.5;font-size:11px;">(только кнопки)</span></span>
                    </label>

                    <div style="margin-top:10px;">
                        <label>Количество вариантов: <b id="ctu-choices-val">4</b></label><br>
                        <input type="range" id="ctu-max-choices" min="2" max="4" step="1" value="4"
                               class="neo-range-slider" style="width:100%;margin-top:6px;" />
                    </div>

                    <hr class="sysHR" />

                    <details id="ctu-theme-details">
                        <summary style="cursor:pointer;font-size:12px;opacity:0.8;padding:4px 0;user-select:none;">
                            🎨 Тема оформления
                            <span id="ctu-theme-current" style="opacity:0.55;font-size:11px;margin-left:4px;"></span>
                        </summary>
                        <div id="ctu-theme-grid" class="ctu-theme-grid"></div>
                        <div class="ctu-container ctu-preview">
                            <div class="ctu-header">
                                <span class="ctu-header-icon">✦</span>
                                <span class="ctu-header-title">Предпросмотр</span>
                            </div>
                            <div class="ctu-grid">
                                <div class="ctu-choice-btn ctu-tone-tender"><div class="ctu-btn-inner"><div class="ctu-btn-header"><span class="ctu-btn-icon">💙</span><span class="ctu-btn-label">Нежный</span></div><p class="ctu-btn-text">Тихо коснуться его руки и улыбнуться.</p></div><div class="ctu-btn-glow"></div></div>
                                <div class="ctu-choice-btn ctu-tone-sharp"><div class="ctu-btn-inner"><div class="ctu-btn-header"><span class="ctu-btn-icon">🧊</span><span class="ctu-btn-label">Резкий</span></div><p class="ctu-btn-text">— Хватит играть. Скажи прямо.</p></div><div class="ctu-btn-glow"></div></div>
                                <div class="ctu-choice-btn ctu-tone-bold"><div class="ctu-btn-inner"><div class="ctu-btn-header"><span class="ctu-btn-icon">🔥</span><span class="ctu-btn-label">Дерзкий</span></div><p class="ctu-btn-text">Шагнуть ближе и не отводить взгляд.</p></div><div class="ctu-btn-glow"></div></div>
                                <div class="ctu-choice-btn ctu-tone-wild"><div class="ctu-btn-inner"><div class="ctu-btn-header"><span class="ctu-btn-icon">🎲</span><span class="ctu-btn-label">Дикий</span></div><p class="ctu-btn-text">Рассмеяться и утащить его на крышу.</p></div><div class="ctu-btn-glow"></div></div>
                            </div>
                        </div>
                    </details>

                    <hr class="sysHR" />

                    <div style="margin-bottom:8px;">
                        <label style="font-size:12px;opacity:0.7;display:block;margin-bottom:5px;">
                            Свой промпт для генерации
                            <span style="opacity:0.5;font-size:11px;">(пусто = дефолтный)</span>
                        </label>

                        <div style="display:flex;gap:6px;margin-bottom:6px;">
                            <select id="ctu-preset-select"
                                style="flex:1;font-size:11px;background:rgba(255,255,255,0.07);
                                       border:1px solid rgba(255,255,255,0.15);border-radius:6px;
                                       padding:6px 8px;color:inherit;box-sizing:border-box;">
                                <option value="">— свой текст (без пресета) —</option>
                            </select>
                            <input type="button" id="ctu-preset-delete"
                                   class="menu_button" value="🗑" title="Удалить выбранный пресет"
                                   style="flex:0 0 auto;padding:0 10px;" />
                        </div>

                        <textarea id="ctu-custom-prompt"
                            placeholder="Оставь пустым чтобы использовать встроенный промпт..."
                            style="width:100%;height:80px;resize:vertical;font-size:11px;
                                   background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);
                                   border-radius:6px;padding:7px;color:inherit;box-sizing:border-box;
                                   font-family:inherit;line-height:1.4;"
                        ></textarea>

                        <div style="display:flex;gap:6px;margin-top:5px;">
                            <input type="button" id="ctu-save-prompt"
                                   class="menu_button" style="flex:1;"
                                   value="Сохранить промпт" />
                            <input type="button" id="ctu-reset-prompt"
                                   class="menu_button" style="flex:1;"
                                   value="Сбросить" />
                        </div>

                        <div style="display:flex;gap:6px;margin-top:5px;">
                            <input type="text" id="ctu-preset-name"
                                   placeholder="Название пресета..."
                                   style="flex:1;font-size:11px;background:rgba(255,255,255,0.05);
                                          border:1px solid rgba(255,255,255,0.15);border-radius:6px;
                                          padding:6px 8px;color:inherit;box-sizing:border-box;" />
                            <input type="button" id="ctu-preset-save-as"
                                   class="menu_button" style="flex:0 0 auto;"
                                   value="💾 Сохранить как пресет" />
                        </div>

                        <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;">
                            <input type="button" id="ctu-preset-export"
                                   class="menu_button" style="flex:1;"
                                   value="⬇ Экспорт выбранного"
                                   title="Скачать выбранный пресет в JSON" />
                            <input type="button" id="ctu-preset-export-all"
                                   class="menu_button" style="flex:1;"
                                   value="⬇ Экспорт всех"
                                   title="Скачать все пресеты в один JSON" />
                            <input type="button" id="ctu-preset-import"
                                   class="menu_button" style="flex:1;"
                                   value="⬆ Импорт"
                                   title="Загрузить пресет(ы) из JSON-файла" />
                            <input type="file" id="ctu-preset-import-file"
                                   accept=".json,application/json" style="display:none;" />
                        </div>

                        <details id="ctu-archetype-details" style="margin-top:7px;">
                            <summary style="cursor:pointer;font-size:11px;opacity:0.6;padding:3px 0;user-select:none;">
                                🎭 Названия/иконки вариантов для этого пресета
                                <span style="opacity:0.5;">(необязательно)</span>
                            </summary>
                            <div style="font-size:10px;opacity:0.5;margin:4px 0 6px;">
                                Если модель не пришлёт своё название для варианта — будет использовано отсюда,
                                по позиции (1-й, 2-й...). Пусто = будет "Вариант 1/2/3/4".
                            </div>
                            <div id="ctu-archetype-rows" style="display:flex;flex-direction:column;gap:4px;"></div>
                        </details>
                    </div>

                    <hr class="sysHR" />

                    <details id="ctu-api-details" style="margin-bottom:8px;">
                        <summary style="cursor:pointer;font-size:12px;opacity:0.7;padding:4px 0;user-select:none;">
                            ⚡ API настройки
                            <span id="ctu-api-status-badge" style="display:none;margin-left:6px;
                                font-size:10px;background:rgba(80,200,120,0.2);color:#7deba0;
                                border:1px solid rgba(80,200,120,0.35);border-radius:4px;padding:1px 6px;">
                                ✓ подключён
                            </span>
                        </summary>
                        <div style="margin-top:8px;display:flex;flex-direction:column;gap:7px;">

                            <div>
                                <label style="font-size:11px;opacity:0.6;display:block;margin-bottom:3px;">Профиль подключения</label>
                                <div style="display:flex;gap:6px;">
                                    <select id="ctu-api-profile-select"
                                        style="flex:1;font-size:11px;background:rgba(255,255,255,0.07);
                                               border:1px solid rgba(255,255,255,0.15);border-radius:6px;
                                               padding:6px 8px;color:inherit;box-sizing:border-box;">
                                        <option value="">— вручную (без профиля) —</option>
                                    </select>
                                    <input type="button" id="ctu-api-profile-delete"
                                           class="menu_button" value="🗑" title="Удалить выбранный профиль"
                                           style="flex:0 0 auto;padding:0 10px;" />
                                </div>
                            </div>

                            <div>
                                <label style="font-size:11px;opacity:0.6;display:block;margin-bottom:3px;">URL (напр. https://api.openai.com/v1)</label>
                                <input type="text" id="ctu-api-url"
                                    placeholder="Оставь пустым — используется ST"
                                    style="width:100%;font-size:11px;background:rgba(255,255,255,0.05);
                                           border:1px solid rgba(255,255,255,0.15);border-radius:6px;
                                           padding:6px 8px;color:inherit;box-sizing:border-box;" />
                            </div>

                            <div>
                                <label style="font-size:11px;opacity:0.6;display:block;margin-bottom:3px;">API ключ</label>
                                <input type="password" id="ctu-api-key"
                                    placeholder="sk-..."
                                    style="width:100%;font-size:11px;background:rgba(255,255,255,0.05);
                                           border:1px solid rgba(255,255,255,0.15);border-radius:6px;
                                           padding:6px 8px;color:inherit;box-sizing:border-box;" />
                            </div>

                            <input type="button" id="ctu-fetch-models"
                                   class="menu_button wide100p"
                                   value="↻ Загрузить модели"
                                   style="display:none;" />

                            <div id="ctu-model-wrap">
                                <label style="font-size:11px;opacity:0.6;display:block;margin-bottom:3px;">
                                    Модель
                                    <span id="ctu-model-count" style="opacity:0.4;font-size:10px;margin-left:4px;"></span>
                                </label>
                                <select id="ctu-api-model-select"
                                    style="width:100%;font-size:11px;background:rgba(255,255,255,0.07);
                                           border:1px solid rgba(255,255,255,0.15);border-radius:6px;
                                           padding:6px 8px;color:inherit;box-sizing:border-box;display:none;">
                                </select>
                                <input type="text" id="ctu-api-model"
                                    placeholder="Введи вручную или загрузи список выше"
                                    style="width:100%;font-size:11px;background:rgba(255,255,255,0.05);
                                           border:1px solid rgba(255,255,255,0.15);border-radius:6px;
                                           padding:6px 8px;color:inherit;box-sizing:border-box;" />
                            </div>

                            <div style="display:flex;gap:6px;">
                                <input type="text" id="ctu-api-profile-name"
                                       placeholder="Название профиля..."
                                       style="flex:1;font-size:11px;background:rgba(255,255,255,0.05);
                                              border:1px solid rgba(255,255,255,0.15);border-radius:6px;
                                              padding:6px 8px;color:inherit;box-sizing:border-box;" />
                                <input type="button" id="ctu-api-profile-save-as"
                                       class="menu_button" style="flex:0 0 auto;"
                                       value="💾 Сохранить как профиль" />
                            </div>

                            <label class="checkbox_label" title="Запросы идут через сервер SillyTavern. Обходит CORS-блокировку браузера. Не работает, если API доступен только с твоего устройства, а ST запущен на другом.">
                                <input type="checkbox" id="ctu-api-via-st" />
                                <span>Всегда через сервер ST <span style="opacity:0.5;font-size:11px;">(обход CORS)</span></span>
                            </label>

                            <div id="ctu-api-msg" style="font-size:11px;display:none;padding:5px 8px;
                                border-radius:6px;"></div>

                            <input type="button" id="ctu-save-api"
                                   class="menu_button wide100p"
                                   value="Сохранить API" />
                            <input type="button" id="ctu-clear-api"
                                   class="menu_button wide100p"
                                   value="Очистить API (вернуть ST)"
                                   style="opacity:0.6;" />
                        </div>
                    </details>

                    <hr class="sysHR" />

                    <input type="button" id="ctu-generate-now"
                           class="menu_button wide100p"
                           value="✦ Сгенерировать варианты сейчас" />

                    <hr class="sysHR" />

                    <details id="ctu-log-details">
                        <summary style="cursor:pointer;font-size:12px;opacity:0.8;padding:4px 0;user-select:none;">
                            🪵 Логи и диагностика <span id="ctu-log-count" style="opacity:0.5;font-size:11px;"></span>
                        </summary>
                        <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
                            <div style="font-size:10px;opacity:0.55;line-height:1.4;">
                                Для проблем с подключением: нажми «Диагностика», потом «Копировать» (или «Скачать») и пришли текст.
                                API-ключи и тексты чата в лог не попадают.
                            </div>
                            <input type="button" id="ctu-log-diag" class="menu_button wide100p" value="📡 Диагностика API" />
                            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                                <input type="button" id="ctu-log-copy" class="menu_button" style="flex:1;" value="📋 Копировать" />
                                <input type="button" id="ctu-log-download" class="menu_button" style="flex:1;" value="⬇ Скачать .txt" />
                                <input type="button" id="ctu-log-share" class="menu_button" style="flex:1;" value="📤 Поделиться" />
                            </div>
                            <div style="display:flex;gap:6px;">
                                <input type="button" id="ctu-log-refresh" class="menu_button" style="flex:1;" value="🔄 Обновить" />
                                <input type="button" id="ctu-log-clear" class="menu_button" style="flex:1;" value="🗑 Очистить" />
                            </div>
                            <div id="ctu-log-msg" style="font-size:11px;display:none;padding:5px 8px;border-radius:6px;background:rgba(128,128,128,0.15);"></div>
                            <textarea id="ctu-log-view" class="ctu-log-view" readonly spellcheck="false"
                                      placeholder="Лог пуст. Вызови генерацию или нажми «Диагностика»."></textarea>
                        </div>
                    </details>
                </div>
            </div>
        </div>`;

    const target =
        document.querySelector("#extensions_settings2") ||
        document.querySelector("#extensions_settings");

    if (target) {
        target.appendChild(panel);
        syncUI();
        bindSettingsEvents();
    } else {
        const obs = new MutationObserver(() => {
            const t =
                document.querySelector("#extensions_settings2") ||
                document.querySelector("#extensions_settings");
            if (t) {
                obs.disconnect();
                t.appendChild(panel);
                syncUI();
                bindSettingsEvents();
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }
}

function syncUI() {
    const s = getSettings();
    const $ = (id) => document.getElementById(id);
    if ($("ctu-enabled")) $("ctu-enabled").checked = s.enabled;
    if ($("ctu-auto-generate")) $("ctu-auto-generate").checked = s.autoGenerate;
    if ($("ctu-compact-mode")) $("ctu-compact-mode").checked = s.compactMode;
    if ($("ctu-max-choices")) $("ctu-max-choices").value = s.maxChoices;
    if ($("ctu-choices-val")) $("ctu-choices-val").textContent = s.maxChoices;
    if ($("ctu-custom-prompt"))
        $("ctu-custom-prompt").value = s.customPrompt || DEFAULT_PROMPT_TEMPLATE;
    if ($("ctu-api-url")) $("ctu-api-url").value = s.apiUrl || "";
    if ($("ctu-api-key")) $("ctu-api-key").value = s.apiKey || "";
    if ($("ctu-api-model")) $("ctu-api-model").value = s.apiModel || "";
    updateApiStatusBadge();
    populateApiProfileSelect();
    if ($("ctu-api-profile-name")) $("ctu-api-profile-name").value = s.activeApiProfile || "";
    populatePresetSelect();

    const active = getActivePresetObj();
    renderArchetypeRows(active?.archetypes || []);
    if ($("ctu-preset-name")) $("ctu-preset-name").value = s.activePreset || "";
    if ($("ctu-api-via-st")) $("ctu-api-via-st").checked = !!s.apiViaSt;
    renderThemePicker();
    ctuRefreshLogView();
}

function populatePresetSelect() {
    const s = getSettings();
    const select = document.getElementById("ctu-preset-select");
    if (!select) return;

    select.innerHTML = `<option value="">— свой текст (без пресета) —</option>`;
    s.promptPresets.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = p.name;
        if (p.name === s.activePreset) opt.selected = true;
        select.appendChild(opt);
    });

    if (!s.activePreset) select.value = "";
}

function renderArchetypeRows(archetypes = []) {
    const wrap = document.getElementById("ctu-archetype-rows");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (let i = 0; i < 4; i++) {
        const a = archetypes[i] || {};
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:4px;align-items:center;";
        row.innerHTML = `
            <input type="text" class="ctu-arche-icon" data-idx="${i}" maxlength="4"
                value="${escapeHtml(a.icon || "")}"
                placeholder="${GENERIC_ICONS[i]}"
                style="width:38px;text-align:center;font-size:12px;background:rgba(255,255,255,0.05);
                       border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:5px 2px;color:inherit;box-sizing:border-box;" />
            <input type="text" class="ctu-arche-label" data-idx="${i}"
                value="${escapeHtml(a.label || "")}"
                placeholder="Вариант ${i + 1}"
                style="flex:1;font-size:11px;background:rgba(255,255,255,0.05);
                       border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:5px 8px;color:inherit;box-sizing:border-box;" />
        `;
        wrap.appendChild(row);
    }
}

function readArchetypesFromUI() {
    const icons = [...document.querySelectorAll(".ctu-arche-icon")].sort(
        (a, b) => +a.dataset.idx - +b.dataset.idx,
    );
    const labels = [...document.querySelectorAll(".ctu-arche-label")].sort(
        (a, b) => +a.dataset.idx - +b.dataset.idx,
    );
    return icons.map((iconInput, i) => ({
        icon: iconInput.value.trim(),
        label: labels[i]?.value.trim() || "",
    }));
}

function findPreset(name) {
    const s = getSettings();
    return s.promptPresets.find((p) => p.name === name);
}

function loadPresetIntoEditor(name) {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    const s = getSettings();
    const $ = (id) => document.getElementById(id);

    if (!name) {
        s.activePreset = "";
        saveSettingsDebounced();
        renderArchetypeRows([]);
        if ($("ctu-preset-name")) $("ctu-preset-name").value = "";
        return;
    }

    const preset = findPreset(name);
    if (!preset) return;

    s.activePreset = name;
    s.customPrompt = preset.text;
    if ($("ctu-custom-prompt")) $("ctu-custom-prompt").value = preset.text;
    if ($("ctu-preset-name")) $("ctu-preset-name").value = name;
    renderArchetypeRows(preset.archetypes || []);
    saveSettingsDebounced();
}

function savePresetAs(name, text, archetypes) {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    const s = getSettings();

    const trimmedName = (name || "").trim();
    if (!trimmedName) {
        toastr.warning("Введите название пресета");
        return false;
    }
    if (!text || !text.trim()) {
        toastr.warning("Промпт пуст — нечего сохранять");
        return false;
    }

    const cleanArchetypes = (archetypes || []).map((a) => ({
        icon: a.icon || "",
        label: a.label || "",
    }));

    const existing = findPreset(trimmedName);
    if (existing) {
        existing.text = text;
        existing.archetypes = cleanArchetypes;
    } else {
        s.promptPresets.push({ name: trimmedName, text, archetypes: cleanArchetypes });
    }

    s.activePreset = trimmedName;
    s.customPrompt = text;
    saveSettingsDebounced();
    populatePresetSelect();
    toastr.success(`Пресет "${trimmedName}" сохранён!`);
    return true;
}

function deletePreset(name) {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    const s = getSettings();

    if (!name) {
        toastr.info("Сначала выберите пресет из списка");
        return;
    }

    const idx = s.promptPresets.findIndex((p) => p.name === name);
    if (idx === -1) return;

    s.promptPresets.splice(idx, 1);
    if (s.activePreset === name) s.activePreset = "";

    saveSettingsDebounced();
    populatePresetSelect();
    renderArchetypeRows([]);
    toastr.info(`Пресет "${name}" удалён`);
}

const PRESET_EXPORT_TYPE = "choice-tree-ui-presets";

function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileName(name) {
    return String(name || "preset").replace(/[\/:*?"<>|]+/g, "_").trim() || "preset";
}

function exportPresets(names) {
    const s = getSettings();
    const list = s.promptPresets
        .filter((p) => names.includes(p.name))
        .map((p) => ({
            name: p.name,
            text: p.text,
            archetypes: (p.archetypes || []).map((a) => ({
                icon: a?.icon || "",
                label: a?.label || "",
            })),
        }));

    if (!list.length) {
        toastr.info("Нет пресетов для экспорта");
        return;
    }

    const filename = list.length === 1
        ? `ctu-preset-${safeFileName(list[0].name)}.json`
        : "ctu-presets-all.json";

    downloadJson(filename, { type: PRESET_EXPORT_TYPE, version: 1, presets: list });
    toastr.success(
        list.length === 1
            ? `Пресет "${list[0].name}" экспортирован`
            : `Экспортировано пресетов: ${list.length}`,
    );
}

function sanitizeImportedPreset(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const text = typeof raw.text === "string" ? raw.text : "";
    if (!name || !text.trim()) return null;

    const archetypes = Array.isArray(raw.archetypes)
        ? raw.archetypes.slice(0, 4).map((a) => ({
              icon: typeof a?.icon === "string" ? a.icon.trim() : "",
              label: typeof a?.label === "string" ? a.label.trim() : "",
          }))
        : [];

    return { name, text, archetypes };
}

function uniquePresetName(name) {
    if (!findPreset(name)) return name;
    let i = 2;
    let candidate = `${name} (${i})`;
    while (findPreset(candidate)) {
        i++;
        candidate = `${name} (${i})`;
    }
    return candidate;
}

function importPresetsFromData(data) {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    const s = getSettings();

    let rawList;
    if (Array.isArray(data)) rawList = data;
    else if (Array.isArray(data?.presets)) rawList = data.presets;
    else if (data && typeof data === "object" && data.name && data.text) rawList = [data];
    else rawList = [];

    const imported = [];
    let skipped = 0;
    let renamed = 0;
    for (const raw of rawList) {
        const preset = sanitizeImportedPreset(raw);
        if (!preset) {
            skipped++;
            continue;
        }
        const uniqueName = uniquePresetName(preset.name);
        if (uniqueName !== preset.name) renamed++;
        preset.name = uniqueName;
        s.promptPresets.push(preset);
        imported.push(preset);
    }

    if (!imported.length) {
        toastr.error("В файле не найдено подходящих пресетов");
        return;
    }

    saveSettingsDebounced();
    populatePresetSelect();

    let msg = `Импортировано пресетов: ${imported.length}`;
    if (renamed) msg += ` (переименовано из-за совпадения имён: ${renamed})`;
    if (skipped) msg += `, пропущено некорректных: ${skipped}`;
    toastr.success(msg);
}

function importPresetsFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            importPresetsFromData(JSON.parse(String(reader.result)));
        } catch (err) {
            toastr.error("Не удалось прочитать файл: это не корректный JSON");
        }
    };
    reader.onerror = () => toastr.error("Не удалось прочитать файл");
    reader.readAsText(file);
}

function updateApiStatusBadge() {
    const s = getSettings();
    const badge = document.getElementById("ctu-api-status-badge");
    const fetchBtn = document.getElementById("ctu-fetch-models");
    if (!badge) return;
    const active = !!(s.apiUrl && s.apiKey);
    badge.style.display = active ? "inline" : "none";
    if (fetchBtn) fetchBtn.style.display = active ? "block" : "none";
}

function findApiProfile(name) {
    const s = getSettings();
    return s.apiProfiles.find((p) => p.name === name);
}

function populateApiProfileSelect() {
    const s = getSettings();
    const select = document.getElementById("ctu-api-profile-select");
    if (!select) return;

    select.innerHTML = `<option value="">— вручную (без профиля) —</option>`;
    s.apiProfiles.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = p.name;
        if (p.name === s.activeApiProfile) opt.selected = true;
        select.appendChild(opt);
    });

    if (!s.activeApiProfile) select.value = "";
}

function resetModelPickerToManual() {
    const sel = document.getElementById("ctu-api-model-select");
    const inp = document.getElementById("ctu-api-model");
    if (sel) {
        sel.innerHTML = "";
        sel.style.display = "none";
    }
    if (inp) inp.style.display = "block";
}

function loadApiProfileIntoEditor(name) {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    const s = getSettings();
    const $ = (id) => document.getElementById(id);

    if (!name) {
        s.activeApiProfile = "";
        saveSettingsDebounced();
        if ($("ctu-api-profile-name")) $("ctu-api-profile-name").value = "";
        return;
    }

    const profile = findApiProfile(name);
    if (!profile) return;

    s.activeApiProfile = name;
    s.apiUrl = profile.apiUrl || "";
    s.apiKey = profile.apiKey || "";
    s.apiModel = profile.apiModel || "";
    saveSettingsDebounced();

    if ($("ctu-api-url")) $("ctu-api-url").value = s.apiUrl;
    if ($("ctu-api-key")) $("ctu-api-key").value = s.apiKey;
    if ($("ctu-api-model")) $("ctu-api-model").value = s.apiModel;
    if ($("ctu-api-profile-name")) $("ctu-api-profile-name").value = name;

    resetModelPickerToManual();
    updateApiStatusBadge();
    toastr.success(`Профиль "${name}" подключён!`);
}

function saveApiProfileAs(name, apiUrl, apiKey, apiModel) {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    const s = getSettings();

    const trimmedName = (name || "").trim();
    if (!trimmedName) {
        toastr.warning("Введите название профиля");
        return false;
    }
    if (!apiUrl || !apiUrl.trim()) {
        toastr.warning("URL пуст — нечего сохранять");
        return false;
    }

    const existing = findApiProfile(trimmedName);
    if (existing) {
        existing.apiUrl = apiUrl;
        existing.apiKey = apiKey;
        existing.apiModel = apiModel;
    } else {
        s.apiProfiles.push({ name: trimmedName, apiUrl, apiKey, apiModel });
    }

    s.activeApiProfile = trimmedName;
    s.apiUrl = apiUrl;
    s.apiKey = apiKey;
    s.apiModel = apiModel;
    saveSettingsDebounced();
    populateApiProfileSelect();
    updateApiStatusBadge();
    toastr.success(`Профиль "${trimmedName}" сохранён!`);
    return true;
}

function deleteApiProfile(name) {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    const s = getSettings();

    if (!name) {
        toastr.info("Сначала выберите профиль из списка");
        return;
    }

    const idx = s.apiProfiles.findIndex((p) => p.name === name);
    if (idx === -1) return;

    s.apiProfiles.splice(idx, 1);
    if (s.activeApiProfile === name) s.activeApiProfile = "";

    saveSettingsDebounced();
    populateApiProfileSelect();
    toastr.info(`Профиль "${name}" удалён`);
}

async function fetchAndShowModels() {
    const s = getSettings();
    if (!s.apiUrl || !s.apiKey) {
        showApiMsg("Сначала введи URL и ключ", "warn");
        return;
    }

    const fetchBtn = document.getElementById("ctu-fetch-models");
    if (fetchBtn) fetchBtn.value = "↻ Загружаю...";

    try {
        const base = ctuBaseUrl(s.apiUrl);
        let resp;
        const viaSt = () =>
            ctuBackendFetch("/api/backends/chat-completions/status", {
                chat_completion_source: "openai",
                reverse_proxy: base,
                proxy_password: s.apiKey,
            });
        if (s.apiViaSt) {
            resp = await viaSt();
        } else {
            try {
                resp = await ctuFetchTimeout(`${base}/models`, {
                    headers: { Authorization: `Bearer ${s.apiKey}` },
                }, 20000);
            } catch (netErr) {
                ctuLog("warn", "models: прямой запрос не прошёл, иду через сервер ST", netErr);
                resp = await viaSt();
            }
        }
        ctuLog("info", "models: ответ", { status: resp.status });

        if (!resp.ok) throw new Error(`${resp.status}`);
        let data = await resp.json();
        if (data?.error && !Array.isArray(data?.data)) {
            ctuLog("error", "models: сервер ST не смог получить список", data);
            throw new Error("сервер ST не получил список моделей (проверь URL и ключ)");
        }
        if (Array.isArray(data?.data?.data)) data = data.data;

        let models = [];
        if (Array.isArray(data.data)) {
            models = data.data
                .map((m) => m.id || m.name)
                .filter(Boolean)
                .sort();
        } else if (Array.isArray(data.models)) {
            models = data.models
                .map((m) => m.name || m.id)
                .filter(Boolean)
                .sort();
        }

        if (!models.length) throw new Error("Список моделей пуст");

        populateModelSelect(models);
        showApiMsg(`✓ Найдено ${models.length} моделей`, "ok");
    } catch (e) {
        showApiMsg(`Ошибка: ${e.message}`, "err");
    } finally {
        if (fetchBtn) fetchBtn.value = "↻ Загрузить модели";
    }
}

function populateModelSelect(models) {
    const select = document.getElementById("ctu-api-model-select");
    const input = document.getElementById("ctu-api-model");
    const counter = document.getElementById("ctu-model-count");
    const s = getSettings();
    if (!select) return;

    select.innerHTML = "";
    models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (m === s.apiModel) opt.selected = true;
        select.appendChild(opt);
    });

    if (s.apiModel && !models.includes(s.apiModel)) {
        const opt = document.createElement("option");
        opt.value = s.apiModel;
        opt.textContent = `${s.apiModel} (текущая)`;
        opt.selected = true;
        select.insertBefore(opt, select.firstChild);
    }

    select.style.display = "block";
    if (input) input.style.display = "none";
    if (counter) counter.textContent = `(${models.length})`;

    select.onchange = () => {
        if (input) input.value = select.value;
    };
}

function showApiMsg(text, type) {
    const el = document.getElementById("ctu-api-msg");
    if (!el) return;
    el.textContent = text;
    el.style.display = "block";
    el.style.background =
        type === "ok"
            ? "rgba(80,200,120,0.12)"
            : type === "warn"
              ? "rgba(255,200,80,0.12)"
              : "rgba(255,80,80,0.12)";
    el.style.color =
        type === "ok" ? "#7deba0" : type === "warn" ? "#ffd070" : "#ff8080";
    clearTimeout(el._t);
    el._t = setTimeout(() => {
        el.style.display = "none";
    }, 4000);
}

function bindSettingsEvents() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    const s = getSettings();
    const $ = (id) => document.getElementById(id);

    bindThemeAndLogEvents();

    $("ctu-enabled")?.addEventListener("change", (e) => {
        s.enabled = e.target.checked;
        saveSettingsDebounced();
    });
    $("ctu-auto-generate")?.addEventListener("change", (e) => {
        s.autoGenerate = e.target.checked;
        saveSettingsDebounced();
    });
    $("ctu-compact-mode")?.addEventListener("change", (e) => {
        s.compactMode = e.target.checked;
        saveSettingsDebounced();
    });
    $("ctu-max-choices")?.addEventListener("input", (e) => {
        s.maxChoices = +e.target.value;
        const v = $("ctu-choices-val");
        if (v) v.textContent = e.target.value;
        saveSettingsDebounced();
    });

    $("ctu-save-prompt")?.addEventListener("click", () => {
        const val = $("ctu-custom-prompt")?.value?.trim() || "";
        s.customPrompt = (val === DEFAULT_PROMPT_TEMPLATE.trim()) ? "" : val;
        saveSettingsDebounced();
        toastr.success("Промпт сохранён!");
    });
    $("ctu-reset-prompt")?.addEventListener("click", () => {
        s.customPrompt = "";
        s.activePreset = "";
        if ($("ctu-custom-prompt")) $("ctu-custom-prompt").value = DEFAULT_PROMPT_TEMPLATE;
        if ($("ctu-preset-select")) $("ctu-preset-select").value = "";
        if ($("ctu-preset-name")) $("ctu-preset-name").value = "";
        renderArchetypeRows([]);
        saveSettingsDebounced();
        toastr.info("Промпт сброшен к дефолтному");
    });

    $("ctu-preset-select")?.addEventListener("change", (e) => {
        loadPresetIntoEditor(e.target.value);
    });
    $("ctu-preset-save-as")?.addEventListener("click", () => {
        const name = $("ctu-preset-name")?.value || "";
        const text = $("ctu-custom-prompt")?.value || "";
        const archetypes = readArchetypesFromUI();
        if (savePresetAs(name, text, archetypes)) {
            const select = $("ctu-preset-select");
            if (select) select.value = name.trim();
        }
    });
    $("ctu-preset-delete")?.addEventListener("click", () => {
        const name = $("ctu-preset-select")?.value || "";
        deletePreset(name);
        if ($("ctu-preset-name")) $("ctu-preset-name").value = "";
    });

    $("ctu-preset-export")?.addEventListener("click", () => {
        const name = $("ctu-preset-select")?.value || "";
        if (!name) {
            toastr.info("Сначала выберите пресет из списка");
            return;
        }
        exportPresets([name]);
    });
    $("ctu-preset-export-all")?.addEventListener("click", () => {
        exportPresets(s.promptPresets.map((p) => p.name));
    });
    $("ctu-preset-import")?.addEventListener("click", () => {
        $("ctu-preset-import-file")?.click();
    });
    $("ctu-preset-import-file")?.addEventListener("change", (e) => {
        importPresetsFromFile(e.target.files?.[0]);
        e.target.value = "";
    });

    $("ctu-generate-now")?.addEventListener("click", generateChoices);

    function autoSaveApi() {
        const url = $("ctu-api-url")?.value?.trim() || "";
        const key = $("ctu-api-key")?.value?.trim() || "";
        s.apiUrl = url;
        s.apiKey = key;
        saveSettingsDebounced();
        updateApiStatusBadge();
    }

    $("ctu-api-url")?.addEventListener("change", autoSaveApi);
    $("ctu-api-key")?.addEventListener("change", autoSaveApi);

    $("ctu-fetch-models")?.addEventListener("click", fetchAndShowModels);

    $("ctu-api-profile-select")?.addEventListener("change", (e) => {
        loadApiProfileIntoEditor(e.target.value);
    });
    $("ctu-api-profile-save-as")?.addEventListener("click", () => {
        const name = $("ctu-api-profile-name")?.value || "";
        const url = $("ctu-api-url")?.value?.trim() || "";
        const key = $("ctu-api-key")?.value?.trim() || "";
        const sel = $("ctu-api-model-select");
        const inp = $("ctu-api-model");
        const model =
            (sel?.style.display !== "none" ? sel?.value : inp?.value)?.trim() ||
            "";
        if (saveApiProfileAs(name, url, key, model)) {
            const select = $("ctu-api-profile-select");
            if (select) select.value = name.trim();
        }
    });
    $("ctu-api-profile-delete")?.addEventListener("click", () => {
        const name = $("ctu-api-profile-select")?.value || "";
        deleteApiProfile(name);
        if ($("ctu-api-profile-name")) $("ctu-api-profile-name").value = "";
    });

    $("ctu-save-api")?.addEventListener("click", () => {
        s.apiUrl = $("ctu-api-url")?.value?.trim() || "";
        s.apiKey = $("ctu-api-key")?.value?.trim() || "";
        const sel = $("ctu-api-model-select");
        const inp = $("ctu-api-model");
        s.apiModel =
            (sel?.style.display !== "none" ? sel?.value : inp?.value)?.trim() ||
            "";
        saveSettingsDebounced();
        updateApiStatusBadge();
        if (s.apiUrl && s.apiKey) {
            toastr.success(
                `API сохранён${s.apiModel ? ` (${s.apiModel})` : ""}!`,
            );
        } else {
            toastr.info("API очищен — используется ST.");
        }
    });

    $("ctu-clear-api")?.addEventListener("click", () => {
        s.apiUrl = "";
        s.apiKey = "";
        s.apiModel = "";
        s.activeApiProfile = "";
        if ($("ctu-api-url")) $("ctu-api-url").value = "";
        if ($("ctu-api-key")) $("ctu-api-key").value = "";
        if ($("ctu-api-model")) $("ctu-api-model").value = "";
        if ($("ctu-api-profile-name")) $("ctu-api-profile-name").value = "";
        resetModelPickerToManual();
        populateApiProfileSelect();
        saveSettingsDebounced();
        updateApiStatusBadge();
        toastr.info("API очищен — используется ST.");
    });
}

const DEFAULT_PROMPT_TEMPLATE = `You are a roleplay assistant. Your task is to suggest {{count}} possible responses to continue the conversation.

<conversation>
{{history}}
</conversation>

<task>
Write {{count}} distinct response options for what the user could say or do next.
Each option should be a natural continuation of the conversation, responding to the last message.
Match the tone, language, and intensity of the current scene exactly.
</task>

<archetypes>
[1] 💙 "Tender" — soft, vulnerable, shows emotion through action
[2] 🧊 "Sharp" — dry, keeps distance, cold as shield or power
[3] 🔥 "Bold" — confident, takes initiative, drives the scene
[4] 🎲 "Wild" — breaks expectations, unpredictable but on point
</archetypes>

<rules>
- Each option must be 1-3 sentences maximum
- Write ONLY the user's words/actions, NOT the character's reactions
- No clichés, no emotional explanations — only action and dialogue
- Match the writing style of the conversation history
- The "label" field MUST be a short human-readable name (2-5 words, e.g. "Soft agreement", "Cold refusal", "Bold action", "Unexpected turn")
- Never leave "label" empty, never write "unidentified", "unknown", or "Option 1"
- Do not think out loud, do not explain your reasoning, do not add any text before or after the JSON
- Output the JSON immediately, as compactly as possible
</rules>

Return ONLY valid JSON, no markdown, no explanations, no preamble:
{
    "choices": [
        {"id": 1, "tone": "tender", "icon": "💙", "label": "Soft agreement", "text": "I understand... let me think about it."},
        {"id": 2, "tone": "sharp", "icon": "🧊", "label": "Cold refusal", "text": "No. I won't do that."},
        {"id": 3, "tone": "bold", "icon": "🔥", "label": "Bold action", "text": "Enough talk. Come with me."},
        {"id": 4, "tone": "wild", "icon": "🎲", "label": "Unexpected turn", "text": "Wait... did you hear that?"}
    ]
}

Now write exactly {{count}} options for this conversation:`;

function buildDefaultPrompt(ctx, count) {
    const chat = ctx.chat || [];
    const userName = ctx.name1 || "User";
    const charName = ctx.name2 || "Character";

    const historyText = chat
        .slice(-8)
        .map((m) => {
            const name = m.name || (m.is_user ? userName : charName);
            return `${name}: ${m.mes}`;
        })
        .join("\n\n");

    return DEFAULT_PROMPT_TEMPLATE
        .replace(/\{\{count\}\}/g, () => String(count))
        .replace(/\{\{user\}\}/g, () => userName)
        .replace(/\{\{char\}\}/g, () => charName)
        .replace(/\{\{history\}\}/g, () => historyText);
}

/**
 * [PATCH] Строит JSON-шаблон для подстановки вместо {{json_template}}.
 * Иконки берутся из архетипов активного пресета.
 */
function buildJsonTemplate(count, archetypes) {
    const fb = (archetypes && archetypes.length) ? archetypes : BUILTIN_ARCHETYPES;
    return Array.from({ length: count }, (_, i) => {
        const a = fb[i] || {};
        const tone = TONE_ORDER[i % TONE_ORDER.length];
        const icon = a.icon || GENERIC_ICONS[i % GENERIC_ICONS.length];
        return `{"id": ${i + 1}, "tone": "${tone}", "icon": "${icon}", "label": "<2-4 word name>", "text": "<the option itself>"}`;
    }).join(",\n    ");
}

/**
 * [PATCH] Теперь подставляет {{json_template}}. Стрелочные функции в replace
 * защищают от спецпаттернов ($&, $1) в тексте истории. history — последней.
 */
function buildPrompt() {
    const s = getSettings();
    const ctx = SillyTavern.getContext();

    const custom = (s.customPrompt || "").trim();
    if (custom.length > 10 && custom !== DEFAULT_PROMPT_TEMPLATE.trim()) {
        const chat = ctx.chat || [];
        const userName = ctx.name1 || "User";
        const charName = ctx.name2 || "Character";
        const count = s.maxChoices;

        const historyText = chat
            .slice(-8)
            .map((m) => {
                const name = m.name || (m.is_user ? userName : charName);
                return `${name}: ${m.mes}`;
            })
            .join("\n\n");

        const lastMsg = [...chat].reverse().find((m) => !m.is_user)?.mes || "";
        const jsonTemplate = buildJsonTemplate(count, getActivePresetObj()?.archetypes);

        return s.customPrompt
            .replace(/\{\{json_template\}\}/g, () => jsonTemplate)
            .replace(/\{\{user\}\}/g, () => userName)
            .replace(/\{\{char\}\}/g, () => charName)
            .replace(/\{\{count\}\}/g, () => String(count))
            .replace(/\{\{lastMessage\}\}/g, () => lastMsg.slice(0, 300))
            .replace(/\{\{history\}\}/g, () => historyText);
    }

    return buildDefaultPrompt(ctx, s.maxChoices);
}

const JSON_VALID_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

/**
 * Находит индекс закрывающей скобки, учитывая вложенность и строки.
 */
function findMatchingBracket(text, startIdx, openCh, closeCh) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === openCh) {
            depth++;
        } else if (ch === closeCh) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * Ищет объект с полем "choices" (или "options"/"responses"/"variants").
 * Если не нашли — fallback на первый валидный объект.
 */
function extractJsonObject(text) {
    const fieldPatterns = [
        /"choices"\s*:/,
        /"options"\s*:/,
        /"responses"\s*:/,
        /"variants"\s*:/,
        /\bchoices\s*:/,
        /\boptions\s*:/,
        /\bresponses\s*:/,
        /\bvariants\s*:/,
    ];

    for (const pattern of fieldPatterns) {
        const match = text.match(pattern);
        if (match) {
            const fieldIdx = match.index;
            let start = -1;
            let depth = 0;
            let inString = false;
            let escaped = false;

            for (let i = fieldIdx; i >= 0; i--) {
                const ch = text[i];

                if (inString) {
                    if (escaped) {
                        escaped = false;
                        continue;
                    }
                    if (ch === "\\") {
                        escaped = true;
                        continue;
                    }
                    if (ch === '"') inString = false;
                    continue;
                }

                if (ch === '"') {
                    inString = true;
                    continue;
                }
                if (ch === "}") depth++;
                else if (ch === "{") {
                    if (depth === 0) {
                        start = i;
                        break;
                    }
                    depth--;
                }
            }

            if (start !== -1) {
                const end = findMatchingBracket(text, start, "{", "}");
                if (end !== -1) {
                    return text.slice(start, end + 1);
                }
            }
        }
    }

    let start = text.indexOf("{");
    while (start !== -1) {
        const end = findMatchingBracket(text, start, "{", "}");
        if (end !== -1) {
            return text.slice(start, end + 1);
        }
        start = text.indexOf("{", start + 1);
    }

    return null;
}

/**
 * Разбирает содержимое JSON-массива на отдельные объекты.
 * Незавершённый (обрезанный) последний объект не попадает в результат.
 */
function collectTopLevelObjects(text) {
    const objects = [];
    let depth = 0;
    let inString = false;
    let escaped = false;
    let start = -1;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === "{") {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === "}") {
            depth--;
            if (depth === 0 && start !== -1) {
                objects.push(text.slice(start, i + 1));
                start = -1;
            }
        }
    }
    return objects;
}

/**
 * Санитизация JSON: экранирует неэкранированные кавычки и переносы строк
 * внутри строк, чинит невалидные escape-последовательности.
 */
function sanitizeJsonString(jsonStr) {
    let result = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < jsonStr.length; i++) {
        const ch = jsonStr[i];
        const nextCh = jsonStr[i + 1];

        if (inString) {
            if (escaped) {
                result += ch;
                escaped = false;
                continue;
            }

            if (ch === "\\") {
                if (nextCh && JSON_VALID_ESCAPES.has(nextCh)) {
                    result += ch;
                    escaped = true;
                } else {
                    result += "\\\\";
                }
                continue;
            }

            if (ch === "\n") {
                result += "\\n";
                continue;
            }
            if (ch === "\r") {
                continue;
            }
            if (ch === "\t") {
                result += "\\t";
                continue;
            }

            if (ch === '"') {
                let j = i + 1;
                while (j < jsonStr.length && /\s/.test(jsonStr[j])) j++;
                const nextSignificant = jsonStr[j];

                const isEndOfString =
                    nextSignificant === undefined ||
                    nextSignificant === ":" ||
                    nextSignificant === "," ||
                    nextSignificant === "}" ||
                    nextSignificant === "]";

                if (isEndOfString) {
                    inString = false;
                    result += ch;
                } else {
                    result += '\\"';
                }
                continue;
            }

            result += ch;
            continue;
        }

        if (ch === '"') {
            inString = true;
            result += ch;
            continue;
        }
        result += ch;
    }

    return result;
}

const stripTrailingCommas = (s) => s.replace(/,\s*([}\]])/g, "$1");

/**
 * Разбирает каждый вариант по отдельности, чтобы один сломанный вариант
 * не обнулял остальные.
 */
function parseIndividualChoices(innerText) {
    const objStrings = collectTopLevelObjects(innerText);
    const results = [];

    for (const objStr of objStrings) {
        const attempt1 = stripTrailingCommas(objStr);
        try {
            results.push(JSON.parse(attempt1));
            continue;
        } catch (_) {}

        try {
            results.push(JSON.parse(stripTrailingCommas(sanitizeJsonString(objStr))));
        } catch (_) {
            // Этот вариант не спасти — пропускаем
        }
    }

    return results.length ? results : null;
}

/**
 * Запасной путь: ищем массив вариантов по разным именам полей.
 * Если закрывающей "]" нет (ответ обрезан), берём весь хвост текста.
 */
function salvageChoicesArray(jsonStr) {
    const fieldPatterns = [
        /"choices"\s*:/,
        /"options"\s*:/,
        /"responses"\s*:/,
        /"variants"\s*:/,
        /\bchoices\s*:/,
        /\boptions\s*:/,
        /\bresponses\s*:/,
        /\bvariants\s*:/,
    ];

    let bracketIdx = -1;

    for (const pattern of fieldPatterns) {
        const match = jsonStr.match(pattern);
        if (match) {
            bracketIdx = jsonStr.indexOf("[", match.index);
            if (bracketIdx !== -1) break;
        }
    }

    if (bracketIdx === -1) {
        bracketIdx = jsonStr.indexOf("[");
    }

    if (bracketIdx === -1) return null;

    const endIdx = findMatchingBracket(jsonStr, bracketIdx, "[", "]");

    const inner =
        endIdx !== -1
            ? jsonStr.slice(bracketIdx + 1, endIdx)
            : jsonStr.slice(bracketIdx + 1);

    return parseIndividualChoices(inner);
}

/**
 * Главный парсер ответов модели. Умеет: массив вместо объекта, разные имена
 * полей, Markdown, рассуждения перед JSON, обрезанный (truncated) JSON.
 */
function parseChoices(raw) {
    if (!raw?.trim()) return null;
    try {
        let clean = raw
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");

        // Удаляем <think> блоки (reasoning модели)
        clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, "");

        // Удаляем валидные HTML-теги (начинаются с буквы)
        clean = clean.replace(/<\/?[a-zA-Z][^>]*>/g, "");

        clean = clean.trim();

        let jsonStr = extractJsonObject(clean);

        if (!jsonStr) {
            const arrayMatch = clean.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                jsonStr = arrayMatch[0];
            }
        }

        if (!jsonStr) {
            const salvagedFromRaw = salvageChoicesArray(clean);
            if (salvagedFromRaw?.length) {
                console.warn(
                    `[${MODULE_NAME}] Response looked truncated (no closing brackets found), recovered ${salvagedFromRaw.length} choice(s) from partial JSON`,
                );
                return salvagedFromRaw;
            }
            console.warn(`[${MODULE_NAME}] No JSON object found in response`);
            return null;
        }

        jsonStr = jsonStr.replace(/```json\s*/gi, "").replace(/```\s*/gi, "");
        jsonStr = stripTrailingCommas(jsonStr);

        let data = null;

        try {
            data = JSON.parse(jsonStr);
        } catch (_) {
            try {
                data = JSON.parse(stripTrailingCommas(sanitizeJsonString(jsonStr)));
            } catch (_) {
                data = null;
            }
        }

        let choices = null;

        if (data) {
            if (Array.isArray(data.choices) && data.choices.length) {
                choices = data.choices;
            } else if (Array.isArray(data.options) && data.options.length) {
                choices = data.options;
            } else if (Array.isArray(data.responses) && data.responses.length) {
                choices = data.responses;
            } else if (Array.isArray(data.variants) && data.variants.length) {
                choices = data.variants;
            } else if (Array.isArray(data)) {
                choices = data;
            }
        }

        if (choices) return choices;

        const salvaged = salvageChoicesArray(jsonStr) || salvageChoicesArray(clean);
        if (salvaged?.length) return salvaged;

        console.warn(`[${MODULE_NAME}] Could not extract choices from parsed data`);
        return null;
    } catch (e) {
        console.error(
            `[${MODULE_NAME}] parse error:`,
            e.message,
            raw?.slice(0, 300),
        );
        return null;
    }
}

/**
 * Приводит поле content ответа API к строке (некоторые прокси возвращают
 * массив частей [{type:"text", text:"..."}]).
 */
function extractContentText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => (typeof part === "string" ? part : part?.text || ""))
            .join("");
    }
    return content ? JSON.stringify(content) : "";
}

/**
 * Вызов кастомного API.
 * [PATCH] MAX_TOKENS = 8192; безопасное чтение тела ответа (text → JSON.parse);
 * отладочный тост с finish_reason и usage.
 */
async function callCustomApi(prompt) {
    const s = getSettings();
    const baseUrl = ctuBaseUrl(s.apiUrl);
    const endpoint = `${baseUrl}/chat/completions`;

    const sel = document.getElementById("ctu-api-model-select");
    const modelFromSelect = sel?.style.display !== "none" ? sel?.value : null;
    const model = modelFromSelect || s.apiModel || "gpt-4o-mini";

    const MAX_TOKENS = 8192;

    async function doFetch(body) {
        const mixed = location.protocol === "https:" && endpoint.startsWith("http:");
        ctuLog("info", "API → запрос", {
            endpoint,
            model: body.model,
            mode: s.apiViaSt ? "через сервер ST" : "напрямую (с запасным путём через ST)",
            promptChars: prompt.length,
            tokenParam: body.max_completion_tokens ? "max_completion_tokens" : "max_tokens",
            mixedContent: mixed,
            online: navigator.onLine,
        });

        const viaSt = () =>
            ctuBackendFetch("/api/backends/chat-completions/generate", {
                ...body,
                chat_completion_source: "openai",
                reverse_proxy: baseUrl,
                proxy_password: s.apiKey,
                stream: false,
            });

        let resp;
        let via = "direct";
        const t0 = performance.now();

        if (s.apiViaSt) {
            via = "ST";
            try {
                resp = await viaSt();
            } catch (err) {
                ctuLog("error", "Запрос через сервер ST не удался", err);
                throw new Error(`Network error (через сервер ST): ${err.message}. Открой «Логи» в настройках расширения.`);
            }
        } else {
            try {
                resp = await ctuFetchTimeout(endpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${s.apiKey}`,
                    },
                    body: JSON.stringify(body),
                }, 120000);
            } catch (err) {
                ctuLog("warn", "Прямой запрос не прошёл (скорее всего CORS/сеть) — пробую через сервер ST", {
                    err,
                    ms: Math.round(performance.now() - t0),
                    mixedContent: mixed,
                });
                via = "ST (запасной путь)";
                try {
                    resp = await viaSt();
                } catch (err2) {
                    ctuLog("error", "Запасной путь через сервер ST тоже не удался", err2);
                    throw new Error(
                        `Network error: напрямую — ${err.message}; через сервер ST — ${err2.message}. ` +
                        `Открой «Логи» в настройках расширения и нажми «Диагностика».`,
                    );
                }
            }
        }

        const text = await resp.text().catch(() => "");
        let json;
        let parseOk = true;
        try {
            json = JSON.parse(text);
        } catch (parseErr) {
            parseOk = false;
        }
        ctuLog(resp.ok && parseOk ? "info" : "error", "API ← ответ", {
            via,
            status: resp.status,
            statusText: resp.statusText,
            ms: Math.round(performance.now() - t0),
            contentType: resp.headers.get("content-type"),
            bodyChars: text.length,
            ...(resp.ok && parseOk ? {} : { bodyPreview: text.slice(0, 500) }),
        });
        if (!parseOk) {
            throw new Error(
                `Invalid JSON response (HTTP ${resp.status}, ${via}): ${text.slice(0, 200)}`,
            );
        }
        return { resp, json };
    }

    const baseBody = {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        stream: false,
    };

    let { resp: response, json: data } = await doFetch({
        ...baseBody,
        max_tokens: MAX_TOKENS,
    });

    // Некоторые провайдеры требуют "max_completion_tokens" вместо "max_tokens"
    const errMsg = data?.error?.message || "";
    if (data?.error && /max_tokens/i.test(errMsg) && /max_completion_tokens/i.test(errMsg)) {
        ({ resp: response, json: data } = await doFetch({
            ...baseBody,
            max_completion_tokens: MAX_TOKENS,
        }));
    }

    if (data?.error) {
        const msg = data.error.message || JSON.stringify(data.error);
        throw new Error(`API error: ${msg}`);
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }

    const choice = data.choices?.[0];

    ctuDebug(
        `API: finish=${choice?.finish_reason} usage=${JSON.stringify(data.usage || {})} ` +
        `content=${choice?.message?.content ? "есть" : "ПУСТО"}`,
    );

    if (choice?.finish_reason === "length") {
        console.warn(
            `[${MODULE_NAME}] Response was truncated by the token limit (finish_reason=length). ` +
            `Likely a "thinking" model spending its token budget on hidden reasoning.`,
        );
    }

    return extractContentText(choice?.message?.content) || null;
}

/**
 * [PATCH] Вызов модели SillyTavern через generateRaw (шлёт только наш промпт,
 * без карточки персонажа и истории чата). Сначала новая сигнатура (объект),
 * потом старая (позиционные аргументы).
 */
async function callStModel(prompt) {
    const ctx = SillyTavern.getContext();
    let r = "";

    if (typeof ctx.generateRaw === "function") {
        try {
            r = await ctx.generateRaw({ prompt, systemPrompt: "", responseLength: 2048 });
        } catch (e) {
            console.warn(`[${MODULE_NAME}] generateRaw(object) failed`, e);
        }
        if (!r || !String(r).trim()) {
            try {
                r = await ctx.generateRaw(prompt, null, false, false, "", 2048);
            } catch (e) {
                console.warn(`[${MODULE_NAME}] generateRaw(positional) failed`, e);
            }
        }
    }

    // Последний шанс: generateQuietPrompt (тянет контекст персонажа)
    if (!r || !String(r).trim()) {
        try {
            r = await ctx.generateQuietPrompt({ quietPrompt: prompt });
        } catch (e) {
            console.warn(`[${MODULE_NAME}] generateQuietPrompt(object) failed`, e);
            try {
                r = await ctx.generateQuietPrompt(prompt, false, false);
            } catch (e2) {
                console.error(`[${MODULE_NAME}] all ST generation attempts failed`, e2);
                throw new Error("Не удалось вызвать модель SillyTavern");
            }
        }
    }

    return r;
}

async function generateChoices() {
    const s = getSettings();

    if (!s.enabled) {
        toastr.info("Choice Tree UI отключён");
        return;
    }

    if (!isInActiveChat()) {
        toastr.warning("Choice Tree UI: откройте чат с персонажем");
        return;
    }

    showLoader();

    try {
        const prompt = buildPrompt();
        const activePresetArchetypes = getActivePresetObj()?.archetypes || null;

        let result;
        if (s.apiUrl && s.apiKey) {
            result = await callCustomApi(prompt);
        } else {
            result = await callStModel(prompt);
        }

        result = typeof result === "string" ? result : extractContentText(result);

        ctuDebug(
            `ответ: ${result ? result.length + " симв." : "ПУСТО"} | "${(result || "").slice(0, 120)}"`,
        );

        if (!result || !result.trim()) {
            hideLoader();
            toastr.warning(
                "Пустой ответ от модели. Если это \"думающая\" модель (GPT-5.x, Gemini flash-thinking) — " +
                "возможно, весь лимит токенов ушёл на скрытые рассуждения. Попробуйте увеличить лимит токенов " +
                "в настройках API или уменьшить количество вариантов.",
            );
            return;
        }

        console.log(`[${MODULE_NAME}] Raw response (first 500 chars):`, result.slice(0, 500));

        const rawChoices = parseChoices(result);
        if (rawChoices?.length) {
            if (rawChoices.length < s.maxChoices) {
                toastr.info(
                    `Получено ${rawChoices.length} из ${s.maxChoices} вариантов — похоже, ответ модели ` +
                    `был обрезан. Попробуйте увеличить лимит токенов в настройках API или уменьшить число вариантов.`,
                );
            }
            const choices = rawChoices.map((c, i) =>
                normalizeChoice(c, i, activePresetArchetypes),
            );

            const emptyCount = choices.filter((c) => !String(c.text || "").trim()).length;
            if (emptyCount) {
                ctuDebug(`Вариантов без текста: ${emptyCount} из ${choices.length}. Сырой ответ: ${result.slice(0, 200)}`);
            }

            renderButtons(choices);
        } else {
            hideLoader();
            console.error(`[${MODULE_NAME}] Failed to parse response:`, result);
            toastr.warning(
                "Choice Tree UI: не удалось распарсить ответ модели. Посмотрите F12 → Console для деталей.",
            );
        }
    } catch (err) {
        console.error(`[${MODULE_NAME}] Ошибка:`, err);
        toastr.error(`Choice Tree UI: ${err.message}`);
        hideLoader();
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function renderButtons(choices) {
    removeContainer();
    const s = getSettings();

    const wrap = document.createElement("div");
    wrap.id = "ctu-container";
    wrap.className = `ctu-container${s.compactMode ? " ctu-compact" : ""}`;

    const header = document.createElement("div");
    header.className = "ctu-header";
    header.innerHTML = `
        <span class="ctu-header-icon">✦</span>
        <span class="ctu-header-title">${s.compactMode ? "Ответить..." : "Выберите ответ"}</span>
        <button class="ctu-close-btn" title="Закрыть">✕</button>`;
    header.querySelector(".ctu-close-btn").onclick = removeContainer;
    wrap.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "ctu-grid";

    choices.forEach((c, i) => {
        const tone = (c.tone || "tender").toLowerCase();
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `ctu-choice-btn ctu-tone-${tone}`;
        btn.style.animationDelay = `${i * 60}ms`;
        btn.dataset.choiceText = c.text || "";
        btn.dataset.expanded = "false";

        if (s.compactMode) {
            btn.innerHTML = `
        <div class="ctu-btn-inner ctu-btn-inner--compact">
            <span class="ctu-btn-icon">${c.icon || "●"}</span>
            <span class="ctu-btn-label">${escapeHtml(c.label)}</span>
        </div>
        <div class="ctu-btn-glow"></div>`;
            btn.addEventListener("click", () =>
                applyChoice(c.text || ""),
            );
            grid.appendChild(btn);
            return;
        }

        btn.innerHTML = `
            <div class="ctu-btn-inner">
                <div class="ctu-btn-header">
                    <span class="ctu-btn-icon">${c.icon || "●"}</span>
                    <span class="ctu-btn-label">${escapeHtml(c.label)}</span>
                </div>

                <p class="ctu-btn-text">${escapeHtml(c.text || "")}</p>

                <div class="ctu-btn-full">
                    <div class="ctu-btn-full-text">${escapeHtml(c.text || "")}</div>

                    <div class="ctu-btn-actions">
                        <button type="button" class="ctu-action-btn ctu-action-btn--primary" data-act="insert">
                            Вставить
                        </button>
                        <button type="button" class="ctu-action-btn ctu-action-btn--accent" data-act="send">
                            Отправить
                        </button>
                    </div>
                </div>
            </div>
            <div class="ctu-btn-glow"></div>
        `;

        btn.addEventListener("click", (event) => {
            const actionBtn = event.target.closest(".ctu-action-btn");
            if (actionBtn) return;

            toggleExpandedChoice(btn);
        });

        btn.querySelectorAll(".ctu-action-btn").forEach((actionButton) => {
            actionButton.addEventListener("click", (event) => {
                event.stopPropagation();

                const action = actionButton.dataset.act;
                const text = c.text || "";

                if (action === "insert") {
                    applyChoice(text);
                    btn.classList.add("ctu-btn-picked");
                    setTimeout(
                        () => btn.classList.remove("ctu-btn-picked"),
                        450,
                    );
                    return;
                }

                if (action === "send") {
                    applyChoice(text);
                    removeContainer();
                    document.getElementById("send_but")?.click();
                    return;
                }

            });
        });

        grid.appendChild(btn);
    });

    wrap.appendChild(grid);

    const chatEl = document.getElementById("chat");
    const lastMsg = chatEl?.querySelector(".mes:last-child");
    if (lastMsg) lastMsg.after(wrap);
    else if (chatEl) chatEl.appendChild(wrap);
    else document.getElementById("send_form")?.before(wrap);

    setTimeout(
        () => wrap.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        150,
    );
}

function toggleExpandedChoice(targetBtn) {
    const all = document.querySelectorAll(".ctu-choice-btn");

    all.forEach((btn) => {
        if (btn === targetBtn) return;

        btn.classList.remove("ctu-expanded");
        btn.dataset.expanded = "false";
    });

    const isExpanded = targetBtn.dataset.expanded === "true";
    targetBtn.dataset.expanded = isExpanded ? "false" : "true";
    targetBtn.classList.toggle("ctu-expanded", !isExpanded);

    if (!isExpanded) {
        setTimeout(() => {
            targetBtn.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "nearest",
            });
        }, 80);
    }
}

function applyChoice(text) {
    const ta = document.getElementById("send_textarea");
    if (ta) {
        ta.value = text;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.focus();
    }
}

function removeContainer() {
    const el = document.getElementById("ctu-container");
    if (!el) return;
    el.classList.add("ctu-fade-out");
    setTimeout(() => el.remove(), 280);
}

function showLoader() {
    removeContainer();
    const s = getSettings();
    const el = document.createElement("div");
    el.id = "ctu-container";
    el.className = `ctu-container ctu-loading${s.compactMode ? " ctu-compact" : ""}`;
    el.innerHTML = `
        <div class="ctu-header">
            <span class="ctu-header-icon">✦</span>
            <span class="ctu-header-title">Генерация вариантов...</span>
        </div>
        <div class="ctu-skeleton-grid">
            ${[0, 60, 120, 180]
                .map(
                    (d) => `
                <div class="ctu-skeleton" style="animation-delay:${d}ms">
                    <div class="ctu-skeleton-line short"></div>
                    ${s.compactMode ? "" : '<div class="ctu-skeleton-line"></div><div class="ctu-skeleton-line medium"></div>'}
                </div>`,
                )
                .join("")}
        </div>`;
    const lastMsg = document.querySelector("#chat .mes:last-child");
    lastMsg
        ? lastMsg.after(el)
        : document.getElementById("chat")?.appendChild(el);
}

function hideLoader() {
    const el = document.getElementById("ctu-container");
    if (el?.classList.contains("ctu-loading")) el.remove();
}

function injectButton() {
    if (document.getElementById("ctu-manual-btn")) return;
    const btn = document.createElement("button");
    btn.id = "ctu-manual-btn";
    btn.className = "ctu-manual-btn";
    btn.title = "Варианты ответа (Choice Tree UI)";
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
    </svg>`;
    btn.addEventListener("click", generateChoices);
    document
        .getElementById("send_but")
        ?.parentNode?.insertBefore(btn, document.getElementById("send_but"));
}

function bindHooks() {
    const { eventSource, event_types } = SillyTavern.getContext();

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
        const s = getSettings();
        if (s.enabled && s.autoGenerate && isInActiveChat()) {
            setTimeout(generateChoices, 500);
        }
    });

    eventSource.on(event_types.CHAT_CHANGED, removeContainer);
}

(function init() {
    const { eventSource, event_types } = SillyTavern.getContext();
    // тема нужна сразу, ещё до готовности приложения
    try { applyTheme(); } catch (_) {}
    ctuLog("info", `Расширение загружено, сборка ${CTU_VERSION}`);
    eventSource.on(event_types.APP_READY, () => {
        applyTheme();
        injectSettingsPanel();
        injectButton();
        bindHooks();
    });
})();
