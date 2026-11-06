import test from 'node:test';
import { createPortraitContinuation } from '../continuation.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createImageTransport } from '../transport.mjs';
import { createRequestDiagnostics } from '../diagnostics.mjs';
import { parseModels } from '../models.mjs';
import { createBridge } from '../runtime.mjs';
import { characterKey, isVeniceConnection } from '../core.mjs';
import { createOrientationNormalizer } from '../orientation.mjs';

test('ST 1.19 host contract: initialize UI, enable character, invoke tool, render, save, adapt', async () => {
    const controls = new Map(), events = new Map(), tools = new Map(), rendered = [];
    const extension_settings = {
        'st-venice-image': { api_key: 'fake', model: 'chroma', width: 832, height: 1216, hide_watermark: true, safe_mode: true },
    };
    let saved = 0, conversions = 0, continuation, followups = 0;
    const png = 'data:image/png;base64,' + btoa('\x89PNG\r\n\x1a\nfixture');
    const tagged = 'data:image/jpeg;base64,' + Buffer.from('ffd8ffe1002245786966000049492a00080000000100120103000100000006000000000000000000ffd9', 'hex').toString('base64');
    const context = {
        mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://api.venice.ai/api/v1', media_inlining: true, function_calling: true },
        characters: [{ avatar: 'TestCharacter.png' }], characterId: 0, chatId: 'test', name2: 'TestCharacter',
        chat: [{ is_user: true, mes: 'Send me a study picture' }],
        registerFunctionTool: definition => tools.set(definition.name, definition),
        addOneMessage: message => rendered.push(message), saveChat: async () => { saved++; },
    };
    const event_types = { CHAT_COMPLETION_SETTINGS_READY: 'settings_ready', GENERATION_STARTED: 'started', GENERATION_ENDED: 'ended', MESSAGE_SENT: 'sent', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', CHAT_CHANGED: 'chat_id_changed', GENERATION_STOPPED: 'generation_stopped', MESSAGE_RECEIVED: 'message_received', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' };
    const eventSource = { on(name, callback) { events.set(name, callback); }, async emit(name, ...args) { await events.get(name)?.(...args); } };
    const $ = selector => {
        if (!controls.has(selector)) controls.set(selector, { properties: {}, handlers: {}, prop(name, value) { this.properties[name] = value; return this; }, text(value) { this.textValue = value; return this; }, val(value) { this.value = value; return this; }, append(value) { this.html = value; return this; }, on(name, handler) { this.handlers[name] = handler; return this; } });
        return controls.get(selector);
    };
    const sandbox = vm.createContext({ location: { origin: 'https://st.test' }, document: { getElementById: () => ({ value: '' }) }, $, jQuery: callback => callback(), console: { info() {} }, crypto: { randomUUID: () => 'test-id' }, toastr: { error: assert.fail },
        fetch: async () => ({ ok: true, json: async () => ({ images: ['FAKE'] }), blob: async () => new Blob([Uint8Array.from(atob(png.split(',')[1]), c => c.charCodeAt(0))]) }) });
    const exportsByImport = {
        '../../../extensions.js': { extension_settings, getContext: () => context },
        '../../../chats.js': { hasPendingFileAttachment: () => false },
        './transport.mjs': { createImageTransport: options => createImageTransport({ ...options, render: async () => png }) },
        './diagnostics.mjs': { createRequestDiagnostics },
        './continuation.mjs': { createPortraitContinuation: options => (continuation = createPortraitContinuation({ ...options, setTimer: () => 1, clearTimer: () => {} })) },
        '../../../../script.js': { Generate: async (type, options) => { assert.equal(type, 'normal'); assert.equal(options.automatic_trigger, true); followups++; }, isGenerating: () => false, eventSource, event_types, saveSettingsDebounced() {}, saveSettings() {}, getRequestHeaders() {} },
        '../../../utils.js': { saveBase64AsFile: async () => '/user/images/TestCharacter/bridge.png' },
        '../../../RossAscends-mods.js': { getMessageTimeStamp: () => 'test-time' },
        '../../../constants.js': { MEDIA_DISPLAY: { GALLERY: 'gallery' }, MEDIA_SOURCE: { GENERATED: 'generated' }, MEDIA_TYPE: { IMAGE: 'image' } },
        './orientation.mjs': { createOrientationNormalizer: options => createOrientationNormalizer({ ...options, render: async () => { await new Promise(resolve => setTimeout(resolve, 5)); conversions++; return 'data:image/jpeg;base64,UPRIGHT'; } }) },
        './core.mjs': { characterKey, isVeniceConnection }, './runtime.mjs': { createBridge },
        './album-ui.mjs': { mountAlbum() {} },
        './models-ui.mjs': { mountModels() {} },
        './portraits.mjs': { loadPortrait: async () => png, USER_PORTRAIT_KEY: '__human_reference__' },
        './portraits-ui.mjs': { mountPortraits() { return { useAlbumPortrait() {} }; } },
    };
    const module = new vm.SourceTextModule(await readFile(new URL('../index.js', import.meta.url), 'utf8'), { context: sandbox });
    await module.link(specifier => {
        const values = exportsByImport[specifier];
        assert.ok(values, `Unexpected import ${specifier}`);
        return new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context: sandbox });
    });
    await module.evaluate();
    assert.ok(controls.get('#extensions_settings').html.includes('Venice Image Bridge'));
    controls.get('#venice_bridge_diagnostic_arm').handlers.click();
    assert.equal(JSON.parse(controls.get('#venice_bridge_diagnostic_report').value).captureRemaining, 3);
    controls.get('#venice_bridge_diagnostic_clear').handlers.click();
    assert.equal(JSON.parse(controls.get('#venice_bridge_diagnostic_report').value).captureRemaining, 0);
    const tool = tools.get('VeniceCreateImage');
    assert.equal(tool.shouldRegister(), false);
    controls.get('#venice_bridge_character').handlers.change.call({ checked: true });
    assert.equal(tool.shouldRegister(), true);
    await tool.action({ prompt: 'A warm study' });
    assert.equal(saved, 1); assert.equal(rendered.length, 1);
    assert.equal(context.chat[1].is_user, false);
    assert.equal(context.chat[1].mes, 'Photo.');
    assert.equal(context.chat[1].extra.media[0].title, 'Photo.');
    const request = { chat: [{ role: 'assistant', content: [{ type: 'text', text: context.chat[1].mes }, { type: 'image_url', image_url: { url: '/user/images/TestCharacter/bridge.png' } }] }], dryRun: false };
    await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, request);
    assert.equal(request.chat.length, 2);
    assert.equal(request.chat[1].role, 'user');
    assert.equal(context.chat[1].extra.media[0].url, '/user/images/TestCharacter/bridge.png');
    assert.equal(extension_settings['st-venice-image'].api_key, 'fake');
    context.chat.push({ is_user: true, mes: 'A self portrait please' });
    extension_settings['st-venice-vision-bridge'].editModels = parseModels({ data: [{ id: 'ref', type: 'inpaint', model_spec: { constraints: {} } }] }, 'inpaint');
    extension_settings['st-venice-vision-bridge'].portraits = { 'TestCharacter.png': { url: '/user/files/ref.png', model: 'ref' } };
    await tools.get('VeniceCreateSelfPortrait').action({ prompt: 'This entire requested description belongs only in the image request and never in the caption or media title' });
    assert.equal(context.chat.at(-1).mes, '');
    assert.equal(context.chat.at(-1).extra.media[0].title, 'Photo.');
    const savedPortrait = structuredClone(context.chat.at(-1));
    const captionless = { chat: [{ role: 'assistant', content: [{ type: 'text', text: '' }, { type: 'image_url', image_url: { url: savedPortrait.extra.media[0].url } }] }] };
    await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, captionless);
    assert.equal(captionless.chat.length, 1);
    assert.equal(captionless.chat[0].role, 'user');
    assert.equal(captionless.chat[0].content[1].image_url.url, savedPortrait.extra.media[0].url);
    assert.equal(JSON.stringify(context.chat.at(-1)), JSON.stringify(savedPortrait));
    assert.equal(saved, 2); assert.equal(followups, 0);
    await eventSource.emit(event_types.GENERATION_ENDED);
    await continuation.flush(); await continuation.flush();
    assert.equal(followups, 1);
    assert.equal(tools.get('VeniceCreateSelfPortrait').shouldRegister(), false);
    const large = 'data:image/png;base64,' + 'A'.repeat(5 * 1024 * 1024);
    const transportRequest = { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: large } }] }] };
    const originalTransport = structuredClone(transportRequest);
    await eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, transportRequest);
    assert.equal(transportRequest.messages[0].content[0].image_url.url, png);
    assert.equal(originalTransport.messages[0].content[0].image_url.url, large);
    assert.match(controls.get('#venice_bridge_transport').textValue, /viewing copies reduced/);
    const userPhoto = () => ({ chat: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: tagged, detail: 'high' } }] }] });
    const dry = userPhoto(); dry.dryRun = true;
    await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, dry); assert.equal(conversions, 0);
    const actual = userPhoto(); await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, actual);
    assert.equal(conversions, 1); assert.equal(actual.chat[0].content[0].image_url.url, 'data:image/jpeg;base64,UPRIGHT');
    assert.equal(actual.chat[0].content[0].image_url.detail, 'high');
    extension_settings['st-venice-vision-bridge'].enabled = false;
    const disabled = userPhoto(); await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, disabled);
    assert.equal(disabled.chat[0].content[0].image_url.url, tagged);
    const noTransport = structuredClone(originalTransport);
    await eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, noTransport);
    assert.deepEqual(noTransport, originalTransport);
    extension_settings['st-venice-vision-bridge'].enabled = true;
    context.chatCompletionSettings.custom_url = 'https://example.test/v1';
    const other = userPhoto(); await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, other);
    assert.equal(other.chat[0].content[0].image_url.url, tagged);
    await eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, noTransport);
    assert.deepEqual(noTransport, originalTransport);

});
