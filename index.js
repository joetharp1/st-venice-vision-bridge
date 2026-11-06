import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced, saveSettings, getRequestHeaders } from '../../../../script.js';
import { saveBase64AsFile } from '../../../utils.js';
import { getMessageTimeStamp } from '../../../RossAscends-mods.js';
import { MEDIA_DISPLAY, MEDIA_SOURCE, MEDIA_TYPE } from '../../../constants.js';
import { characterKey, isVeniceConnection } from './core.mjs';
import { createBridge } from './runtime.mjs';
import { mountAlbum } from './album-ui.mjs';
import { mountModels } from './models-ui.mjs';
import { mountPortraits } from './portraits-ui.mjs';
import { loadPortrait } from './portraits.mjs';

const NAME = 'st-venice-vision-bridge';
function settings() {
    const s = extension_settings[NAME] ||= {};
    s.enabled ??= true;
    s.characters ??= {};
    return s;
}

const saveImage = (base64, name, extension = 'png') => saveBase64AsFile(base64, name || 'Character', `venice_bridge_${crypto.randomUUID()}`, extension);
const loadReference = (url, signal) => loadPortrait(url, location.origin, (...args) => fetch(...args), signal);
async function persistPortraitSettings() {
    const revision = crypto.randomUUID(); settings().portraitRevision = revision;
    await saveSettings();
    const response = await fetch('/api/settings/get', { method: 'POST', headers: getRequestHeaders(), body: '{}', signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error('Could not confirm reference settings on the server. Try again.');
    const data = await response.json();
    if (JSON.parse(data.settings).extension_settings?.[NAME]?.portraitRevision !== revision) {
        throw new Error('The server has not confirmed reference settings. Wait for any reply to finish and try again.');
    }
}
let lastMoved = 0;
const bridge = createBridge({
    getContext, getSettings: settings,
    getGeneratorSettings: () => extension_settings['st-venice-image'],
    fetch: (...args) => fetch(...args),
    saveImage, loadReference,
    publishImage: async ({ url, prompt, context, isCurrent, manual, portrait, via, attemptId, onPublished }) => {
        const message = {
            name: context.name2, is_user: false, is_system: false,
            send_date: getMessageTimeStamp(),
            mes: via === 'initiation' ? '' : `Generated image. Requested description: ${prompt}`,
            extra: {
                media: [{ url, type: MEDIA_TYPE.IMAGE, title: prompt, generation_type: 'venice', source: MEDIA_SOURCE.GENERATED }],
                media_display: MEDIA_DISPLAY.GALLERY, media_index: 0, inline_image: false,
                venice_bridge: { version: 1, via_tool: !manual && via !== 'initiation', via, reference_used: !!portrait },
                ...(via === 'initiation' ? { ava_initiation: { attemptId, type: 'photo', timestamp: Date.now() } } : {}),
            },
        };
        if (!isCurrent()) throw new Error('Chat changed before the image could be posted. It is saved in the gallery.');
        context.chat.push(message);
        const id = context.chat.length - 1;
        // Match ST's built-in generator: render, emit message events, then save.
        context.addOneMessage(message);
        if (onPublished) onPublished(id, message);
        await eventSource.emit(event_types.MESSAGE_RECEIVED, id, 'extension');
        await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, id, 'extension');
        if (isCurrent()) await context.saveChat();
        return id;
    },
    onAdapt: ({ imagesMoved, dryRun }) => {
        if (!dryRun) {
            lastMoved = imagesMoved;
            if (imagesMoved) console.info(`[Venice Image Bridge] Moved ${imagesMoved} assistant image(s) into user image inputs; displayed chat unchanged.`);
        }
    },
});
// Publish the already-created singleton; importing runtime.mjs must never create
// a second limiter/controller. No API key or mutable settings are exposed here.
globalThis[Symbol.for('ava.veniceBridge')] = bridge;

function refresh() {
    const c = getContext(), key = characterKey(c);
    $('#venice_bridge_enabled').prop('checked', settings().enabled);
    $('#venice_bridge_character').prop('disabled', !key).prop('checked', !!(key && settings().characters[key]));
    $('#venice_bridge_character_name').text(key ? c.name2 : 'Select a character in a one-to-one chat');
    const status = !settings().enabled ? 'Bridge disabled.'
        : !isVeniceConnection(c) ? 'Waiting for a Custom OpenAI connection to https://api.venice.ai/api/v1.'
        : !c.chatCompletionSettings.media_inlining ? 'Turn on Send inline images/media in Chat Completion settings.'
        : bridge.ready() ? 'Image-role fix active. Image tool available for this character.'
        : 'Image-role fix active. To offer the image tool, enable this character below, configure Venice Image Generation, and enable function calling in Chat Completion settings.';
    $('#venice_bridge_status').text(`${status} Images adapted in last request: ${lastMoved}.`);
}

jQuery(() => {
    settings();
    if (!event_types.CHAT_COMPLETION_PROMPT_READY || typeof getContext().registerFunctionTool !== 'function') {
        toastr.error('Venice Image Bridge requires SillyTavern 1.19.0-compatible extension APIs.');
        return;
    }
    $('#extensions_settings').append(`
      <div class="extension_container" id="venice_bridge_settings">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header"><b>Venice Image Bridge</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
          <div class="inline-drawer-content">
            <label class="checkbox_label"><input type="checkbox" id="venice_bridge_enabled"><span>Keep assistant pictures compatible with Venice</span></label>
            <p>Pictures stay in the chat under their original author. Image inputs are sent separately in the format Venice accepts.</p>
            <label class="checkbox_label"><input type="checkbox" id="venice_bridge_character"><span>Allow <span id="venice_bridge_character_name"></span> to generate images</span></label>
            <p>Uses your existing Venice Image Generation API key. Choose from the live image catalogue below, or keep your original model setting. Each image uses Venice credits. Maximum one tool attempt per user turn. Group chats are not supported.</p>
            <div id="venice_bridge_refresh" class="menu_button">Refresh status</div>
            <p id="venice_bridge_status"></p>
            <div id="venice_bridge_models"></div><div id="venice_bridge_portraits"></div>
            <small>Version 0.5.0 · Built for SillyTavern 1.19.0</small>
          </div>
        </div>
      </div>`);
    $('#venice_bridge_enabled').on('change', function () { settings().enabled = !!this.checked; saveSettingsDebounced(); refresh(); });
    $('#venice_bridge_character').on('change', function () {
        const key = characterKey(getContext());
        if (key) settings().characters[key] = !!this.checked;
        saveSettingsDebounced(); refresh();
    });
    $('#venice_bridge_refresh').on('click', refresh);
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, event => bridge.adapt(event));
    eventSource.on(event_types.CHAT_CHANGED, refresh);
    eventSource.on(event_types.GENERATION_STOPPED, () => bridge.handleGenerationStopped());
    getContext().registerFunctionTool(bridge.tool());
    getContext().registerFunctionTool(bridge.portraitTool());
    mountModels({ getSettings: settings, getGeneratorSettings: () => extension_settings['st-venice-image'],
        save: saveSettingsDebounced, request: (...args) => fetch(...args), bridge });
    let album;
    const portraits = mountPortraits({ getContext, getSettings: settings, getGeneratorSettings: () => extension_settings['st-venice-image'],
        request: (...args) => fetch(...args), loadReference, persist: persistPortraitSettings, bridge, eventSource, event_types,
        saveReference: async (dataUrl, title, key) => {
            if (characterKey(getContext()) !== key) throw new Error('Character changed before saving the reference.');
            const record = await album.save({ dataUrl, title, notes: 'Fixed reference portrait. Keep this original file.', shared: false });
            album.refreshUI?.();
            return record.url;
        } });
    album = mountAlbum({ onReference: portraits.useAlbumPortrait, getContext, getSettings: settings, extension_settings, eventSource, event_types,
        saveSettings, saveSettingsDebounced, getRequestHeaders, getMessageTimeStamp, MEDIA_TYPE, MEDIA_SOURCE, MEDIA_DISPLAY });
    refresh();
    console.info('[Venice Image Bridge] 0.5.0 loaded');
});
