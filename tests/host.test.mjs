import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createBridge } from '../runtime.mjs';
import { characterKey, isVeniceConnection } from '../core.mjs';

test('ST 1.19 host contract: initialize UI, enable character, invoke tool, render, save, adapt', async () => {
    const controls = new Map(), events = new Map(), tools = new Map(), rendered = [];
    const extension_settings = {
        'st-venice-image': { api_key: 'fake', model: 'chroma', width: 832, height: 1216, hide_watermark: true, safe_mode: true },
    };
    let saved = 0;
    const context = {
        mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://api.venice.ai/api/v1', media_inlining: true, function_calling: true },
        characters: [{ avatar: 'TestCharacter.png' }], characterId: 0, chatId: 'test', name2: 'TestCharacter',
        chat: [{ is_user: true, mes: 'Send me a study picture' }],
        registerFunctionTool: definition => tools.set(definition.name, definition),
        addOneMessage: message => rendered.push(message), saveChat: async () => { saved++; },
    };
    const event_types = { CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', CHAT_CHANGED: 'chat_id_changed', GENERATION_STOPPED: 'generation_stopped', MESSAGE_RECEIVED: 'message_received', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' };
    const eventSource = { on(name, callback) { events.set(name, callback); }, async emit(name, ...args) { await events.get(name)?.(...args); } };
    const $ = selector => {
        if (!controls.has(selector)) controls.set(selector, { properties: {}, handlers: {}, prop(name, value) { this.properties[name] = value; return this; }, text(value) { this.textValue = value; return this; }, append(value) { this.html = value; return this; }, on(name, handler) { this.handlers[name] = handler; return this; } });
        return controls.get(selector);
    };
    const sandbox = vm.createContext({ $, jQuery: callback => callback(), console: { info() {} }, crypto: { randomUUID: () => 'test-id' }, toastr: { error: assert.fail },
        fetch: async () => ({ ok: true, json: async () => ({ images: ['FAKE'] }) }) });
    const exportsByImport = {
        '../../../extensions.js': { extension_settings, getContext: () => context },
        '../../../../script.js': { eventSource, event_types, saveSettingsDebounced() {}, saveSettings() {}, getRequestHeaders() {} },
        '../../../utils.js': { saveBase64AsFile: async () => '/user/images/TestCharacter/bridge.png' },
        '../../../RossAscends-mods.js': { getMessageTimeStamp: () => 'test-time' },
        '../../../constants.js': { MEDIA_DISPLAY: { GALLERY: 'gallery' }, MEDIA_SOURCE: { GENERATED: 'generated' }, MEDIA_TYPE: { IMAGE: 'image' } },
        './core.mjs': { characterKey, isVeniceConnection }, './runtime.mjs': { createBridge },
        './album-ui.mjs': { mountAlbum() {} },
    };
    const module = new vm.SourceTextModule(await readFile(new URL('../index.js', import.meta.url), 'utf8'), { context: sandbox });
    await module.link(specifier => {
        const values = exportsByImport[specifier];
        assert.ok(values, `Unexpected import ${specifier}`);
        return new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context: sandbox });
    });
    await module.evaluate();
    assert.ok(controls.get('#extensions_settings').html.includes('Venice Image Bridge'));
    const tool = tools.get('VeniceCreateImage');
    assert.equal(tool.shouldRegister(), false);
    controls.get('#venice_bridge_character').handlers.change.call({ checked: true });
    assert.equal(tool.shouldRegister(), true);
    await tool.action({ prompt: 'A warm study' });
    assert.equal(saved, 1); assert.equal(rendered.length, 1);
    assert.equal(context.chat[1].is_user, false);
    const request = { chat: [{ role: 'assistant', content: [{ type: 'text', text: context.chat[1].mes }, { type: 'image_url', image_url: { url: '/user/images/TestCharacter/bridge.png' } }] }], dryRun: false };
    await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, request);
    assert.equal(request.chat.length, 2);
    assert.equal(request.chat[1].role, 'user');
    assert.equal(context.chat[1].extra.media[0].url, '/user/images/TestCharacter/bridge.png');
    assert.equal(extension_settings['st-venice-image'].api_key, 'fake');
});
