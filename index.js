import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { getSortedEntries, saveWorldInfo, loadWorldInfo, worldInfoCache } from '../../../world-info.js';
import { ToolManager } from '../../../tool-calling.js';

const MODULE_NAME = 'wi_function_call';
const EXT_FOLDER = 'third-party/SillyTavern-WI-FunctionCall';

const FIELD_ENABLED = 'wi_fc_enabled';
const FIELD_TOOL_NAME = 'wi_fc_tool_name';
const FIELD_TOOL_DESC = 'wi_fc_tool_description';

const DEFAULT_FUNCTION_DESCRIPTION = 'This function loads further WI entries on demand. It accepts an array with one or more of the following strings:\n';

const defaultSettings = {
    enabled: true,
    maxEntries: 10,
    functionDescription: DEFAULT_FUNCTION_DESCRIPTION,
};

// ── Settings ──────────────────────────────────────────────────────────────────

function loadSettings() {
    extension_settings[MODULE_NAME] ??= {};
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = value;
        }
    }

    $('#wi_fc_enabled').prop('checked', extension_settings[MODULE_NAME].enabled);
    $('#wi_fc_max_entries').val(extension_settings[MODULE_NAME].maxEntries);
    $('#wi_fc_function_description').val(extension_settings[MODULE_NAME].functionDescription);
}

function isExtensionEnabled() {
    return extension_settings[MODULE_NAME]?.enabled === true;
}

// ── Per-entry helpers ─────────────────────────────────────────────────────────

function getCurrentWorldName() {
    return $('#world_editor_select option:selected').text();
}

async function updateEntryField(worldName, uid, field, value) {
    // Bypass clone-on-get so we mutate the object already held by all entry handlers.
    // This ensures the field is visible to the kill-switch handler's stale data closure.
    const data = Map.prototype.get.call(worldInfoCache, worldName);
    if (!data?.entries[uid]) return;
    data.entries[uid][field] = value;
    await saveWorldInfo(worldName, data);
}

// ── Per-entry UI ──────────────────────────────────────────────────────────────

/**
 * Returns true when the warning indicator should be visible.
 * Shown whenever the checkbox is checked but the tool cannot actually fire —
 * either because tool calling is not supported by the current API settings,
 * or because the extension itself is disabled.
 * @param {boolean} isChecked - Whether the "Activate via tool call" checkbox is checked.
 */
function shouldShowWarning(isChecked) {
    return isChecked && (!ToolManager.isToolCallingSupported() || !isExtensionEnabled());
}

/**
 * Refreshes the warning icon visibility for a single injected entry block.
 * Called whenever the toggle changes or the global enabled setting changes.
 * @param {HTMLElement} block
 */
function updateWarningVisibility(block) {
    const toggle = block.querySelector('.wi-fc-toggle');
    const warning = block.querySelector('.wi-fc-warning');
    if (!toggle || !warning) return;
    warning.style.display = shouldShowWarning(toggle.checked) ? '' : 'none';
}

/**
 * Injects the "Activate via tool call" controls directly above the
 * "Additional Matching Sources" section of a WI entry's edit area.
 * Skips entries that have already been injected or whose edit area
 * is not yet in the DOM.
 * @param {HTMLElement} entryElement - A .world_entry element.
 * @param {string} [worldName] - The world name, captured synchronously by the caller.
 */
async function injectEntryControls(entryElement, worldName) {
    // The edit area is created lazily when the drawer opens — bail if absent.
    const editArea = entryElement.querySelector('.world_entry_edit');
    if (!editArea) return;

    // Already injected into this edit-area instance.
    if (editArea.querySelector('.wi-fc-block')) return;

    const uid = entryElement.getAttribute('uid');
    if (!uid) return;

    worldName ??= getCurrentWorldName();
    if (!worldName) return;

    const data = await loadWorldInfo(worldName);

    const entry = data?.entries[uid];
    if (!entry) return;

    const isEnabled = entry[FIELD_ENABLED] === true;
    const warnVisible = shouldShowWarning(isEnabled);

    // Build DOM
    const block = document.createElement('div');
    block.className = 'wi-fc-block';
    block.innerHTML = `
        <div class="wi-fc-toggle-row flex-container alignitemscenter">
            <label class="checkbox_label wi-fc-label" title="Allow the AI to activate this entry via a tool call">
                <input type="checkbox" class="wi-fc-toggle"${isEnabled ? ' checked' : ''} />
                <span>Activate via tool call</span>
            </label>
            <span class="wi-fc-warning" title="Tool calling is unavailable or the WI Function Call extension is disabled" style="${warnVisible ? '' : 'display:none'}">
                <i class="fa-solid fa-triangle-exclamation"></i>
            </span>
        </div>
        <div class="wi-fc-details"${isEnabled ? '' : ' style="display:none"'}>
            <div class="flex-container alignitemscenter gap5">
                <label class="wi-fc-detail-label">Tool name</label>
                <input type="text" class="wi-fc-tool-name text_pole" placeholder="e.g. get_mood" />
            </div>
            <div class="wi-fc-desc-group">
                <label class="wi-fc-detail-label">Description</label>
                <textarea class="wi-fc-tool-desc text_pole" rows="1" placeholder="Description the AI sees when deciding whether to call this"></textarea>
            </div>
        </div>
    `;

    // Set input values without HTML-escaping concerns
    block.querySelector('.wi-fc-tool-name').value = entry[FIELD_TOOL_NAME] ?? '';
    block.querySelector('.wi-fc-tool-desc').value = entry[FIELD_TOOL_DESC] ?? '';

    // Wire events
    const toggle = block.querySelector('.wi-fc-toggle');
    const details = block.querySelector('.wi-fc-details');

    toggle.addEventListener('change', async () => {
        details.style.display = toggle.checked ? '' : 'none';
        updateWarningVisibility(block);
        await updateEntryField(worldName, uid, FIELD_ENABLED, toggle.checked);
        registerWIFunctionTool();
    });

    block.querySelector('.wi-fc-tool-name').addEventListener('input', async (e) => {
        await updateEntryField(worldName, uid, FIELD_TOOL_NAME, e.target.value);
        registerWIFunctionTool();
    });

    block.querySelector('.wi-fc-tool-desc').addEventListener('input', async (e) => {
        await updateEntryField(worldName, uid, FIELD_TOOL_DESC, e.target.value);
        registerWIFunctionTool();
    });

    // Insert directly above the "Additional Matching Sources" drawer
    const additionalSources = editArea.querySelector('[data-i18n="Additional Matching Sources"]')?.closest('.inline-drawer');
    if (additionalSources) {
        editArea.insertBefore(block, additionalSources);
    } else {
        editArea.prepend(block);
    }
}

/**
 * Listens for the 'inline-drawer-toggle' custom event that SillyTavern fires
 * synchronously inside the click handler, AFTER addEditorDrawerContent() has
 * run. At that point .world_entry_edit is guaranteed to be in the DOM.
 *
 * The event is fired on the .inline-drawer element and bubbles up to the list,
 * so we can use jQuery delegation to catch all entries with one handler.
 */
function setupEntriesObserver() {
    const list = document.getElementById('world_popup_entries_list');
    if (!list) return;

    $(list).on('inline-drawer-toggle.wi-fc', '.world_entry .inline-drawer', function () {
        const entryEl = this.closest('.world_entry');
        if (entryEl) injectEntryControls(entryEl, getCurrentWorldName());
    });
}

// ── Tool registration ─────────────────────────────────────────────────────────

/**
 * Registers or unregisters the activateWI function tool depending on whether
 * any enabled entries exist and whether the current API supports tool calling.
 *
 * Safe to call at any time — always replaces any previous registration.
 * Must NOT be triggered by WORLDINFO_ENTRIES_LOADED because that event fires
 * inside getSortedEntries(), which this function also calls.
 */
async function registerWIFunctionTool() {
    if (!isExtensionEnabled() || !ToolManager.isToolCallingSupported()) {
        ToolManager.unregisterFunctionTool('activateWI');
        return;
    }

    const allEntries = await getSortedEntries();
    const toolEntries = allEntries.filter(e => e[FIELD_ENABLED] === true && !e.disable && e[FIELD_TOOL_NAME]);

    if (toolEntries.length === 0) {
        ToolManager.unregisterFunctionTool('activateWI');
        return;
    }

    const maxEntries = extension_settings[MODULE_NAME].maxEntries || 10;
    const limitedEntries = toolEntries.slice(0, maxEntries);
    const toolNames = limitedEntries.map(e => e[FIELD_TOOL_NAME]);
    const toolLines = limitedEntries.map(e => `"${e[FIELD_TOOL_NAME]}": ${e[FIELD_TOOL_DESC] || 'No description'}`).join('\n');
    const prefix = extension_settings[MODULE_NAME].functionDescription ?? DEFAULT_FUNCTION_DESCRIPTION;
    const description = `${prefix}${toolLines}`;

    ToolManager.registerFunctionTool({
        name: 'activateWI',
        displayName: 'Activate WI Entry',
        description,
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                names: {
                    type: 'array',
                    description: 'Array of tool names to activate.',
                    items: { type: 'string', enum: toolNames },
                },
            },
            required: ['names'],
        }),
        action: async ({ names }) => {
            if (!Array.isArray(names) || names.length === 0) return 'No names provided.';
            const entries = await getSortedEntries();
            const active = entries.filter(e =>
                e[FIELD_ENABLED] === true &&
                !e.disable &&
                e[FIELD_TOOL_NAME] &&
                names.includes(e[FIELD_TOOL_NAME]),
            );
            if (active.length === 0) return 'No matching WI tool entries found.';
            eventSource.emit(event_types.WORLDINFO_FORCE_ACTIVATE, active);
            return `Activated ${active.length} WI entr${active.length === 1 ? 'y' : 'ies'}.`;
        },
        formatMessage: () => '',
    });
}

// ── Init ──────────────────────────────────────────────────────────────────────

jQuery(async () => {
    const settingsHtml = await renderExtensionTemplateAsync(EXT_FOLDER, 'settings');
    $('#extensions_settings').append(settingsHtml);

    loadSettings();
    setupEntriesObserver();

    // Global settings handlers
    function refreshAllWarnings() {
        document.querySelectorAll('.wi-fc-block').forEach(updateWarningVisibility);
    }

    $('#wi_fc_enabled').on('change', function () {
        extension_settings[MODULE_NAME].enabled = this.checked;
        saveSettingsDebounced();
        refreshAllWarnings();
        registerWIFunctionTool();
    });

    $('#wi_fc_max_entries').on('input', function () {
        extension_settings[MODULE_NAME].maxEntries = parseInt(this.value, 10) || 10;
        saveSettingsDebounced();
    });

    $('#wi_fc_function_description').on('input', function () {
        extension_settings[MODULE_NAME].functionDescription = this.value;
        saveSettingsDebounced();
    });

    // Re-register the tool whenever the WI scan finishes (fires in getWorldInfoPrompt,
    // outside getSortedEntries, so there is no re-entrancy risk).
    eventSource.on(event_types.WORLDINFO_SCAN_DONE, registerWIFunctionTool);

    // Re-register when a WI book is saved (e.g. after toggling entries in the editor).
    eventSource.on(event_types.WORLDINFO_UPDATED, registerWIFunctionTool);

    // Re-register when the active lorebook selection changes (add/remove a lorebook).
    // WORLDINFO_UPDATED only fires on saveWorldInfo; deselecting a book never calls that.
    eventSource.on(event_types.WORLDINFO_SETTINGS_UPDATED, registerWIFunctionTool);

    // Re-register on chat switch — the active lorebook set changes entirely.
    eventSource.on(event_types.CHAT_CHANGED, registerWIFunctionTool);

    // Refresh warnings when API source, model, or connection profile changes —
    // any of these can flip ToolManager.isToolCallingSupported().
    for (const evt of [
        event_types.SETTINGS_UPDATED,
        event_types.CHATCOMPLETION_SOURCE_CHANGED,
        event_types.CHATCOMPLETION_MODEL_CHANGED,
        event_types.CONNECTION_PROFILE_LOADED,
        event_types.MAIN_API_CHANGED,
    ]) {
        eventSource.on(evt, refreshAllWarnings);
    }

    // Best-effort initial registration in case worlds are already cached at load time.
    registerWIFunctionTool();
});