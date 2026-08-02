const MODULE_NAME = "choice-tree-ui";

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    autoGenerate: true,
    maxChoices: 4,
    compactMode: false,
    customPrompt: "",
    apiUrl: "",
    apiKey: "",
    apiModel: "",
    promptPresets: [],   // [{ name: string, text: string }]
    activePreset: "",    // имя активного пресета ("" = ручной / кастомный текст)
});

// ---------------------------------------------------------------------
// Справочник "тонов" ответа. Используется, чтобы у вариантов ВСЕГДА
// были корректные иконка и название, даже если модель (например,
// Claude Sonnet 5 через кастомный API) вернула невалидный / незнакомый
// tone, пустой label, либо буквально "unidentified"/"unknown".
// ---------------------------------------------------------------------
const TONE_META = {
    tender: { icon: "💙", label: "Нежный" },
    sharp: { icon: "🧊", label: "Резкий" },
    bold: { icon: "🔥", label: "Дерзкий" },
    wild: { icon: "🎲", label: "Дикий" },
};
const TONE_ORDER = ["tender", "sharp", "bold", "wild"];
const BAD_LABELS = new Set(["", "unidentified", "unknown", "n/a", "null", "undefined"]);

/**
 * Приводит "сырой" вариант ответа от модели к безопасному виду:
 * гарантирует валидный tone/icon/label, никогда не пропускает
 * "unidentified" и подобный мусор в UI.
 */
function normalizeChoice(raw, index) {
    const c = raw || {};

    let toneKey = String(c.tone || "").toLowerCase().trim();
    if (!TONE_META[toneKey]) {
        toneKey = TONE_ORDER[index % TONE_ORDER.length];
    }
    const meta = TONE_META[toneKey];

    const rawLabel = String(c.label ?? "").trim();
    const label = BAD_LABELS.has(rawLabel.toLowerCase()) ? meta.label : rawLabel;

    const rawIcon = String(c.icon ?? "").trim();
    const icon = rawIcon ? rawIcon : meta.icon;

    return { ...c, tone: toneKey, label, icon };
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
                <b>✦ Choice Tree UI</b>
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
    populatePresetSelect();
}

// ---------------------------------------------------------------------
// Пресеты кастомного промпта
// ---------------------------------------------------------------------

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
        return;
    }

    const preset = findPreset(name);
    if (!preset) return;

    s.activePreset = name;
    s.customPrompt = preset.text;
    if ($("ctu-custom-prompt")) $("ctu-custom-prompt").value = preset.text;
    if ($("ctu-preset-name")) $("ctu-preset-name").value = name;
    saveSettingsDebounced();
}

function savePresetAs(name, text) {
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

    const existing = findPreset(trimmedName);
    if (existing) {
        existing.text = text;
    } else {
        s.promptPresets.push({ name: trimmedName, text });
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
    toastr.info(`Пресет "${name}" удалён`);
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

async function fetchAndShowModels() {
    const s = getSettings();
    if (!s.apiUrl || !s.apiKey) {
        showApiMsg("Сначала введи URL и ключ", "warn");
        return;
    }

    const fetchBtn = document.getElementById("ctu-fetch-models");
    if (fetchBtn) fetchBtn.value = "↻ Загружаю...";

    try {
        const base = s.apiUrl
            .replace(/\/$/, "")
            .replace(/\/chat\/completions$/, "");
        const resp = await fetch(`${base}/models`, {
            headers: { Authorization: `Bearer ${s.apiKey}` },
        });

        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();

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

    // Ручное сохранение текста в текущий customPrompt (без создания пресета)
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
        saveSettingsDebounced();
        toastr.info("Промпт сброшен к дефолтному");
    });

    // Пресеты
    $("ctu-preset-select")?.addEventListener("change", (e) => {
        loadPresetIntoEditor(e.target.value);
    });
    $("ctu-preset-save-as")?.addEventListener("click", () => {
        const name = $("ctu-preset-name")?.value || "";
        const text = $("ctu-custom-prompt")?.value || "";
        if (savePresetAs(name, text)) {
            const select = $("ctu-preset-select");
            if (select) select.value = name.trim();
        }
    });
    $("ctu-preset-delete")?.addEventListener("click", () => {
        const name = $("ctu-preset-select")?.value || "";
        deletePreset(name);
        if ($("ctu-preset-name")) $("ctu-preset-name").value = "";
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
        if ($("ctu-api-url")) $("ctu-api-url").value = "";
        if ($("ctu-api-key")) $("ctu-api-key").value = "";
        if ($("ctu-api-model")) $("ctu-api-model").value = "";
        const sel = $("ctu-api-model-select");
        if (sel) {
            sel.innerHTML = "";
            sel.style.display = "none";
        }
        const inp = $("ctu-api-model");
        if (inp) inp.style.display = "block";
        saveSettingsDebounced();
        updateApiStatusBadge();
        toastr.info("API очищен — используется ST.");
    });
}

const DEFAULT_PROMPT_TEMPLATE = `You are a roleplay assistant. Write {{count}} response options for {{user}}.

<conversation>
{{history}}
</conversation>

<task>
Write {{count}} options for what {{user}} could say or do next. Answer on last message.
Match the tone, language and intensity of the current scene exactly.
</task>

<archetypes>
[1] 💙 "Tender" — soft, vulnerable, shows through action
[2] 🧊 "Sharp" — dry, keeps distance, cold as shield or power
[3] 🔥 "Bold" — confident, takes initiative, drive not aggression
[4] 🎲 "Wild" — breaks expectations, unpredictable but on point
</archetypes>

<rules>
- Keep each option to 1-3 sentences max
- No clichés, no emotional explanations — only action and words
- Do NOT write for {{char}}
- Match the writing style you see in the conversation history
- The "tone" field of every option MUST be exactly one of: tender, sharp, bold, wild (lowercase, no other values)
- The "label" field MUST be a short human-readable name (never leave it empty, never write "unidentified" or "unknown")
</rules>

Return ONLY raw JSON, no markdown:
{"choices":[
    {{json_template}}
]}`;

function buildDefaultPrompt(ctx, count) {
    const chat = ctx.chat || [];
    const historyText = chat
        .slice(-8)
        .map((m) => `${m.name}: ${m.mes}`)
        .join("\n\n");
    const userName = ctx.name1 || "User";
    const charName = ctx.name2 || "Character";

    const archetypes = [
        { id: 1, tone: "tender", icon: "💙", label: "Нежный" },
        { id: 2, tone: "sharp", icon: "🧊", label: "Резкий" },
        { id: 3, tone: "bold", icon: "🔥", label: "Дерзкий" },
        { id: 4, tone: "wild", icon: "🎲", label: "Дикий" },
    ].slice(0, count);

    const jsonTemplate = archetypes
        .map((a) => `{"id":${a.id},"tone":"${a.tone}","icon":"${a.icon}","label":"${a.label}","text":"TEXT"}`)
        .join(",\n    ");

    return DEFAULT_PROMPT_TEMPLATE
        .replace(/\{\{count\}\}/g, count)
        .replace(/\{\{history\}\}/g, historyText)
        .replace(/\{\{user\}\}/g, userName)
        .replace(/\{\{char\}\}/g, charName)
        .replace(/\{\{json_template\}\}/g, jsonTemplate);
}

function buildPrompt() {
    const s = getSettings();
    const ctx = SillyTavern.getContext();

    if (s.customPrompt && s.customPrompt.trim().length > 10 && s.customPrompt.trim() !== DEFAULT_PROMPT_TEMPLATE.trim()) {
        const chat = ctx.chat || [];
        const historyText = chat
            .slice(-8)
            .map((m) => `${m.name}: ${m.mes}`)
            .join("\n\n");
        const userName = ctx.name1 || "User";
        const charName = ctx.name2 || "Character";
        const lastMsg = [...chat].reverse().find((m) => !m.is_user)?.mes || "";
        const count = s.maxChoices;

        return s.customPrompt
            .replace(/\{\{history\}\}/g, historyText)
            .replace(/\{\{user\}\}/g, userName)
            .replace(/\{\{char\}\}/g, charName)
            .replace(/\{\{lastMessage\}\}/g, lastMsg.slice(0, 300))
            .replace(/\{\{count\}\}/g, count);
    }

    return buildDefaultPrompt(ctx, s.maxChoices);
}

function fixJsonQuotes(jsonStr) {
    let result = "";
    let inString = false;
    let escaped = false;
    let keyBuffer = "";
    let isTextValue = false;

    for (let i = 0; i < jsonStr.length; i++) {
        const ch = jsonStr[i];

        if (escaped) {
            result += ch;
            escaped = false;
            if (inString) keyBuffer += ch;
            continue;
        }

        if (ch === "\\") {
            result += ch;
            escaped = true;
            continue;
        }

        if (ch === '"') {
            if (!inString) {
                inString = true;
                keyBuffer = "";
                result += ch;
            } else {
                if (isTextValue) {
                    let j = i + 1;
                    while (
                        j < jsonStr.length &&
                        (jsonStr[j] === " " ||
                            jsonStr[j] === "\n" ||
                            jsonStr[j] === "\r")
                    )
                        j++;
                    const next = jsonStr[j];
                    if (next === "," || next === "}" || next === "]") {
                        inString = false;
                        isTextValue = false;
                        result += ch;
                    } else {
                        result += '\\"';
                    }
                } else {
                    inString = false;
                    const trimmed = keyBuffer.trim();
                    if (trimmed === "text") {
                        isTextValue = true;
                    }
                    result += ch;
                    keyBuffer = "";
                }
            }
            continue;
        }

        result += ch;
        if (inString) keyBuffer += ch;
    }

    return result;
}

function parseChoices(raw) {
    if (!raw?.trim()) return null;
    try {
        let clean = raw
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/<think>[^]*?(?=\{)/gi, "")
            .replace(/```json\s*/gi, "")
            .replace(/```\s*/gi, "")
            .trim();

        const start = clean.indexOf("{");
        const end = clean.lastIndexOf("}");
        if (start === -1 || end === -1) return null;

        let jsonStr = clean.slice(start, end + 1);

        jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");
        jsonStr = jsonStr.replace(/"<\/([^>]*?)>\s*([},\]])/g, '"$2');
        jsonStr = jsonStr.replace(/<\/[^>]*?>/g, "");

        let data;
        try {
            data = JSON.parse(jsonStr);
        } catch (_) {
            jsonStr = fixJsonQuotes(jsonStr);
            data = JSON.parse(jsonStr);
        }

        if (!Array.isArray(data.choices) || !data.choices.length) return null;
        return data.choices;
    } catch (e) {
        console.error(
            `[${MODULE_NAME}] parse error:`,
            e.message,
            raw?.slice(0, 300),
        );
        return null;
    }
}

async function callCustomApi(prompt) {
    const s = getSettings();
    const baseUrl = s.apiUrl
        .replace(/\/$/, "")
        .replace(/\/chat\/completions$/, "");
    const endpoint = `${baseUrl}/chat/completions`;

    const sel = document.getElementById("ctu-api-model-select");
    const modelFromSelect = sel?.style.display !== "none" ? sel?.value : null;
    const model = modelFromSelect || s.apiModel || "gpt-4o-mini";

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${s.apiKey}`,
        },
        body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.9,
            max_tokens: 1000,
        }),
    });

    const data = await response.json();

    if (data.error) {
        const msg = data.error.message || JSON.stringify(data.error);
        throw new Error(msg);
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return data.choices?.[0]?.message?.content || null;
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
        const ctx = SillyTavern.getContext();
        const prompt = buildPrompt();

        let result;
        if (s.apiUrl && s.apiKey) {
            result = await callCustomApi(prompt);
        } else {
            try {
                result = await ctx.generateQuietPrompt({ quietPrompt: prompt });
            } catch {
                result = await ctx.generateQuietPrompt(prompt, false, false);
            }
        }

        if (!result) {
            hideLoader();
            toastr.warning("Пустой ответ");
            return;
        }

        const rawChoices = parseChoices(result);
        if (rawChoices?.length) {
            const choices = rawChoices.map(normalizeChoice);
            renderButtons(choices);
        } else {
            hideLoader();
            toastr.warning(
                "Choice Tree UI: не удалось распарсить. F12 → Console",
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
            <span class="ctu-btn-label">${escapeHtml(c.label || c.tone)}</span>
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
                    <span class="ctu-btn-label">${escapeHtml(c.label || c.tone)}</span>
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
    eventSource.on(event_types.APP_READY, () => {
        injectSettingsPanel();
        injectButton();
        bindHooks();
    });
})();
