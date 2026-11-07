import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createV4Provider, extendNativeProvider, MODELS, PROVIDER_NAME } from '../elevenlabs-v4.mjs';

const root = process.env.ST_ROOT || '/workspace/scratch/d5e75b8f0021/research/st-1.19.0';
async function realBase(t) {
    let source;
    try { source = await readFile(`${root}/public/scripts/extensions/tts/elevenlabs.js`, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT' && !process.env.ST_ROOT) { t.skip('Set ST_ROOT for the pinned ST source.'); return; } throw error; }
    const context = vm.createContext({ console, event_types: {}, eventSource: {}, SECRET_KEYS: {}, secret_state: {} });
    return vm.runInContext(source.replace(/^import .*;\n/gm, '').replace('export { ElevenLabsTtsProvider };', '') + '\nElevenLabsTtsProvider;', context);
}

test('real ST provider supplies voice listing/key management; v4 dropdown excludes legacy models and speed control', async t => {
    const Base = await realBase(t); if (!Base) return;
    const Provider = createV4Provider(Base, { getRequestHeaders: () => ({}) });
    const a = new Provider(), b = new Provider();
    assert.equal(a.defaultSettings.model, 'eleven_v4_turbo');
    assert.equal(a.defaultSettings.stability, 0.4); assert.equal(a.defaultSettings.similarity_boost, 0.8);
    a.defaultSettings.voiceMap.test = 'one'; assert.deepEqual(b.defaultSettings.voiceMap, {});
    assert.equal(a.fetchTtsVoiceObjects, Base.prototype.fetchTtsVoiceObjects);
    assert.match(a.settingsHtml, /data-key="api_key_elevenlabs"/);
    const select = a.settingsHtml.match(/<select id="elevenlabs_tts_model"[\s\S]*?<\/select>/)[0];
    assert.match(select, /eleven_v4_turbo/); assert.match(select, /value="eleven_v4"/);
    assert.doesNotMatch(select, /v2|v3/);
    assert.match(a.settingsHtml, /id="elevenlabs_tts_speed" type="hidden"/);
    assert.doesNotMatch(a.settingsHtml, /<label for="elevenlabs_tts_speed"/);
    assert.equal(a.shouldInvolveExtendedSettings(), false);
});

for (const model of MODELS) test(`${model}: exact tagged text, secure ST endpoint, allowed settings only, no old audio reuse`, async t => {
    const Base = await realBase(t); if (!Base) return;
    const calls = [], audio = new Response('test audio', { headers: { 'content-type': 'audio/mpeg' } });
    const Provider = createV4Provider(Base, { getRequestHeaders: () => ({ 'X-CSRF-Token': 'test' }), request: async (...args) => { calls.push(args); return audio; } });
    const p = new Provider(); p.settings = { ...p.defaultSettings, model, style_exaggeration: 0.9, speaker_boost: true, speed: 1.2 };
    p.findTtsGenerationInHistory = () => assert.fail('Must not replay another model');
    const text = '[whispers] Hello. [sighs]';
    assert.equal(await p.generateTts(text, 'test-voice'), audio);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], '/api/speech/elevenlabs/synthesize');
    assert.deepEqual(JSON.parse(calls[0][1].body), { voiceId: 'test-voice', request: { model_id: model, text, voice_settings: { stability: 0.4, similarity_boost: 0.8 } } });
    assert.equal(calls[0][1].headers['X-CSRF-Token'], 'test');
});

test('invalid settings stop before network; failed provider response throws without fallback or repeat', async () => {
    const calls = [];
    const Provider = createV4Provider(class {}, { getRequestHeaders: () => ({}), request: async (...args) => { calls.push(args); return new Response('', { status: 500 }); } });
    const p = new Provider(); p.settings = { ...p.defaultSettings, stability: 2 };
    await assert.rejects(p.generateTts('Hello', 'test'), /between/); assert.equal(calls.length, 0);
    p.settings.stability = 0.4; p.settings.model = 'unknown';
    await assert.rejects(p.generateTts('Hello', 'test'), /Choose/);
    p.settings.model = 'eleven_v4_turbo';
    await assert.rejects(p.generateTts('Hello', 'test'), /HTTP 500/); assert.equal(calls.length, 1);
});

test('saved model/voice map restored without mutating source settings', async () => {
    class Base { async loadSettings(s) { this.settings = s; } }
    const Provider = createV4Provider(Base, { getRequestHeaders: () => ({}) });
    const p = new Provider(), settings = { model: 'eleven_v4', voiceMap: { Ava: 'Chosen voice' } };
    await p.loadSettings(settings); assert.deepEqual(p.settings, settings); assert.notEqual(p.settings, settings);
    await p.loadSettings({ model: 'obsolete' }); assert.equal(p.settings.model, 'eleven_v4_turbo');
});

test('native adapter preserves legacy generation and mappings; v4 survives repeated installation and returns to legacy', async t => {
    const Base = await realBase(t); if (!Base) return;
    const legacyCalls = [], calls = [], controls = [];
    Base.prototype.generateTts = async function (...args) { legacyCalls.push(args); return 'legacy audio'; };
    Base.prototype.loadSettings = async function (settings) { this.settings = settings; };
    Base.prototype.onSettingsChange = function () { return 'saved'; };
    const p = new Base();
    const saved = { ...p.defaultSettings, model: 'eleven_v4_turbo', voiceMap: { Ava: 'Chosen voice' } };
    const deps = { getRequestHeaders: () => ({}), updateControls: m => controls.push(m), request: async (...args) => { calls.push(args); return new Response('v4 audio'); } };
    extendNativeProvider(Base, deps); extendNativeProvider(Base, deps);
    await p.loadSettings(saved);
    assert.equal(p.settings, saved); assert.deepEqual(p.settings.voiceMap, { Ava: 'Chosen voice' });
    assert.equal(p.settingsHtml.match(/value="eleven_v4_turbo"/g).length, 1);
    assert.match(p.settingsHtml, /value="eleven_turbo_v2_5"/);
    assert.equal(await (await p.generateTts('[whispers] Hello', 'chosen')).text(), 'v4 audio');
    assert.equal(calls.length, 1); assert.equal(legacyCalls.length, 0);
    assert.equal(p.shouldInvolveExtendedSettings(), false);
    assert.equal(p.onSettingsChange(), 'saved');
    assert.deepEqual(controls, ['eleven_v4_turbo', 'eleven_v4_turbo']);
    p.settings.model = 'eleven_multilingual_v2';
    assert.equal(await p.generateTts('Hello', 'chosen'), 'legacy audio');
    assert.equal(legacyCalls.length, 1); assert.equal(calls.length, 1);
    assert.equal(p.shouldInvolveExtendedSettings(), true);
});

test('pinned source contracts support registration and unfiltered server synthesis forwarding', async t => {
    let tts, speech;
    try { [tts, speech] = await Promise.all([readFile(`${root}/public/scripts/extensions/tts/index.js`, 'utf8'), readFile(`${root}/src/endpoints/speech.js`, 'utf8')]); }
    catch (error) { if (error.code === 'ENOENT' && !process.env.ST_ROOT) { t.skip('Set ST_ROOT'); return; } throw error; }
    assert.match(tts, /export function registerTtsProvider\(name, provider\)/);
    assert.match(tts, /extension_settings.tts.currentProvider === name/);
    assert.match(speech, /const \{ voiceId, request \} = req.body/);
    assert.match(speech, /body: JSON.stringify\(request\)/);
    assert.match(speech, /readSecret\(req.user.directories, SECRET_KEYS.ELEVENLABS\)/);
    assert.equal(PROVIDER_NAME, 'ElevenLabs');
});
