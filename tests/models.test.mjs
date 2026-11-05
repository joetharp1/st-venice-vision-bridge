import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModels, fetchModels, modelOptions, selectedGeneratorSettings, priceLabel, MODELS_URL } from '../models.mjs';
import { imageRequestBody } from '../core.mjs';
import { createBridge } from '../runtime.mjs';

// Synthetic fixtures follow Venice's documented model_spec.constraints schema.
const catalogue = { data: [
    { id: 'pixel', type: 'image', model_spec: { name: 'Pixel', constraints: { widthHeightDivisor: 16 }, pricing: { generation: { usd: 0.01 } } } },
    { id: 'ratio', type: 'image', model_spec: { name: 'Ratio', constraints: { aspectRatios: ['1:1', '3:2'], defaultAspectRatio: '3:2' } } },
    { id: 'tier', type: 'image', model_spec: { name: 'Tier', privacy: 'anonymized', constraints: {
        aspectRatios: ['1:1', '16:9'], defaultAspectRatio: '1:1', resolutions: ['1K', '2K'], defaultResolution: '1K',
        qualities: ['low', 'high'], defaultQuality: 'high', promptCharacterLimit: 1500,
    }, pricing: { quality: { '1K': { high: { usd: 0.12 }, low: { usd: 0.03 } } } } } },
    { id: 'bria-bg-remover', type: 'image' }, { id: 'edit', type: 'image-edit' }, { id: 'chat', type: 'text' },
    { id: 'offline', type: 'image', model_spec: { offline: true } },
] };
const legacy = { api_key: 'test-key', model: 'chroma', width: 832, height: 1216, safe_mode: true, hide_watermark: true, negative_prompt: 'blur' };
const own = id => ({ imageModel: id, imageModels: parseModels(catalogue), imageOptions: {} });

test('catalogue includes new image IDs and excludes other operations; malformed response fails', () => {
    assert.deepEqual(parseModels(catalogue).map(m => m.id).sort(), ['offline', 'pixel', 'ratio', 'tier']);
    assert.throws(() => parseModels({}), /invalid model catalogue/);
    assert.throws(() => parseModels({ data: [] }), /no text-to-image/);
});
test('loads only fixed Venice catalogue endpoint with existing key; handles rejection without generation', async () => {
    let calls = 0;
    const models = await fetchModels(async (url, options) => {
        calls++; assert.equal(url, MODELS_URL); assert.equal(options.method, 'GET');
        assert.equal(options.headers.Authorization, 'Bearer test-key'); assert.equal(options.cache, 'no-store');
        return { ok: true, json: async () => catalogue };
    }, 'test-key');
    assert.equal(models.length, 4); assert.equal(calls, 1);
    await assert.rejects(fetchModels(async () => ({ ok: false, status: 403 }), 'test-key'), /HTTP 403/);
    await assert.rejects(fetchModels(() => assert.fail('Must not fetch without a key'), ''), /API key/);
});
test('original mode preserves existing settings, chosen model cannot change key or filters', () => {
    assert.strictEqual(selectedGeneratorSettings(legacy, {}), legacy);
    const b = imageRequestBody(selectedGeneratorSettings(legacy, own('ratio')), { prompt: 'test', model: 'evil', safe_mode: false });
    assert.equal(b.model, 'ratio'); assert.equal(b.safe_mode, true); assert.equal(b.hide_watermark, true);
    assert.equal(b.aspect_ratio, '3:2'); assert.ok(!('width' in b)); assert.ok(!('height' in b));
    assert.ok(!('resolution' in b)); assert.ok(!('quality' in b)); assert.equal(b.negative_prompt, 'blur');
});
test('tiered model sends supported ratio/resolution/quality and shows matching price', () => {
    const o = own('tier'); o.imageOptions.tier = { aspect_ratio: '16:9', resolution: '1K', quality: 'low' };
    const s = selectedGeneratorSettings(legacy, o), b = imageRequestBody(s, { prompt: 'test' });
    assert.equal(b.aspect_ratio, '16:9'); assert.equal(b.resolution, '1K'); assert.equal(b.quality, 'low');
    assert.ok(!('width' in b)); assert.match(priceLabel(s.catalogueModel, s.imageOptions), /\$0.03/);
    s.imageOptions.resolution = '8K'; assert.throws(() => imageRequestBody(s, { prompt: 'test' }), /supported resolution/);
});
test('pixel dimensions are validated; unknown and offline selection never silently substitutes model', () => {
    const s = selectedGeneratorSettings(legacy, own('pixel')), b = imageRequestBody(s, { prompt: 'test' });
    assert.equal(b.width, 832); assert.equal(b.height, 1216); assert.ok(!('aspect_ratio' in b));
    s.imageOptions.width = 831; assert.throws(() => imageRequestBody(s, { prompt: 'test' }), /multiple of 16/);
    s.imageOptions.width = 1600; assert.throws(() => imageRequestBody(s, { prompt: 'test' }), /64–1280/);
    assert.throws(() => selectedGeneratorSettings(legacy, own('missing')), /missing/);
    assert.throws(() => imageRequestBody(selectedGeneratorSettings(legacy, own('offline')), { prompt: 'test' }), /offline/);
});
test('unsupported saved options resolve to advertised defaults, prompt limit includes combined negative', () => {
    const m = parseModels(catalogue).find(m => m.id === 'tier');
    const options = modelOptions(m, { quality: 'medium', resolution: '8K' }, legacy);
    assert.equal(options.quality, 'high'); assert.equal(options.resolution, '1K');
    const s = selectedGeneratorSettings({ ...legacy, negative_prompt: 'x'.repeat(1499) }, own('tier'));
    assert.throws(() => imageRequestBody(s, { prompt: 'test', negative_prompt: 'more' }), /at most 1500/);
});
test('manual and tool paths both generate with catalogue selection; manual does not bypass concurrency guard', async () => {
    const settings = { ...own('tier'), enabled: true, characters: { 'Test.png': true } };
    const context = { mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://api.venice.ai/api/v1', media_inlining: true, function_calling: true },
        characters: [{ avatar: 'Test.png' }], characterId: 0, chatId: 'test', name2: 'Test', chat: [{ is_user: true, mes: 'picture' }] };
    const posted = [], bodies = []; let finish;
    const bridge = createBridge({ getContext: () => context, getSettings: () => settings, getGeneratorSettings: () => legacy,
        fetch: async (url, options) => { bodies.push(JSON.parse(options.body)); return new Promise(resolve => { finish = resolve; }); },
        saveImage: async () => '/user/images/Test/pic.png', publishImage: async image => posted.push(image) });
    const first = bridge.tool().action({ prompt: 'A garden' });
    await assert.rejects(bridge.generateManual({ prompt: 'Duplicate' }), /already being generated/);
    finish({ ok: true, json: async () => ({ images: ['test'] }) }); await first;
    await assert.rejects(bridge.generate({ prompt: 'Tool retry' }), /One image attempt/);
    context.chatCompletionSettings.function_calling = false;
    assert.equal(bridge.ready(), false); assert.equal(bridge.manualReady(), true);
    const manual = bridge.generateManual({ prompt: 'A lake' });
    finish({ ok: true, json: async () => ({ images: ['test'] }) }); await manual;
    assert.deepEqual(bodies.map(b => b.model), ['tier', 'tier']); assert.equal(posted[0].manual, false); assert.equal(posted[1].manual, true);
    assert.ok(bodies.every(b => b.resolution === '1K' && !('width' in b)));
});
