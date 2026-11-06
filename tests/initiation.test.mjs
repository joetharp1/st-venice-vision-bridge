import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../runtime.mjs';
import { parseModels } from '../models.mjs';
import { initiationPortraitArgs, IDENTITY_PROMPT, INITIATION_TAIL } from '../portraits.mjs';
const png = 'data:image/png;base64,' + btoa('\x89PNG\r\n\x1a\nfixture');
function setup() {
    const c = { mainApi: 'openai', characterId: 0, characters: [{ avatar: 'A' }], chatId: 'a', name2: 'A', chat: [{ is_user: true, mes: 'hello' }],
        chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://api.venice.ai/api/v1', media_inlining: true, function_calling: true } };
    const own = { enabled: true, characters: { A: true }, portraits: { A: { url: '/user/images/A/ref.png', model: 'reference' } },
        editModels: parseModels({ data: [{ id: 'reference', type: 'inpaint', model_spec: { constraints: { promptCharacterLimit: 1000, aspectRatios: ['1:1'] }, pricing: { inpaint: { usd: .06 } } } }] }, 'inpaint') };
    const legacy = { api_key: 'fake', model: 'test', width: 1024, height: 1024, safe_mode: true };
    const calls = [], posts = [], reservations = [];
    const deps = { getContext: () => c, getSettings: () => own, getGeneratorSettings: () => legacy,
        fetch: async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ images: ['fake'] }), blob: async () => new Blob([Uint8Array.from(atob(png.split(',')[1]), ch => ch.charCodeAt(0))]) }; },
        loadReference: async () => png, saveImage: async () => '/user/images/A/new.png',
        publishImage: async p => {
            const m = { mes: p.via === 'initiation' ? '' : p.prompt, extra: { venice_bridge: { via_tool: true, via: p.via }, ava_initiation: { attemptId: p.attemptId } } };
            c.chat.push(m); posts.push(p); p.onPublished?.(c.chat.length - 1, m); return c.chat.length - 1;
        } };
    const b = createBridge(deps);
    const allow = options => b.beginInitiation({ attemptId: 'timer', avatar: 'A', chatId: 'a', deadline: Date.now() + 150000,
        isCurrent: () => true, beforeRequest: price => reservations.push(price), onPublished() {}, ...options });
    return { c, own, legacy, deps, b, calls, posts, reservations, allow };
}
test('timer bypasses BOTH normal turn guards and leaves their history untouched', async () => {
    const h = setup(); await h.b.generate({ prompt: 'normal tool picture' });
    assert.equal(h.c.chat.at(-1).extra.venice_bridge.via_tool, true);
    const t = h.allow(); await h.b.generateInitiation(t, 'Standing in a library'); h.b.endInitiation(t);
    assert.equal(h.calls.length, 2); assert.equal(h.posts[1].via, 'initiation');
    await assert.rejects(h.b.generate({ prompt: 'still same real user turn' }), /One image attempt/);
    assert.deepEqual(h.reservations, [.06]);
});
test('timer needs no real user turn; function-calling setting may be off without changing manualReady', async () => {
    const h = setup(); h.c.chat = []; h.c.chatCompletionSettings.function_calling = false;
    const t = h.allow(); await h.b.generateInitiation(t, 'A bookshop'); h.b.endInitiation(t);
    assert.equal(h.posts.length, 1); assert.equal(h.c.chatCompletionSettings.function_calling, false);
});
test('timer image cannot block next real tool image, including reloaded limiter', async () => {
    const h = setup(); const t = h.allow(); await h.b.generateInitiation(t, 'A cafe'); h.b.endInitiation(t);
    await createBridge(h.deps).generate({ prompt: 'An ordinary image' }); assert.equal(h.calls.length, 2);
});
test('one-use allowance refuses repeated request across timer paths', async () => {
    const h = setup(); const t = h.allow(); await h.b.generateInitiation(t, 'A garden');
    await assert.rejects(h.b.generateInitiation(t, 'A second garden'), /already attempted/);
    assert.equal(h.calls.length, 1); h.b.endInitiation(t);
    await assert.rejects(h.b.generateInitiation(t, 'Reused'), /allowance/);
});
test('scene truncation preserves complete identity and exclusion tail with no negative field', async () => {
    const h = setup(), t = h.allow(); await h.b.generateInitiation(t, 'Bookshop '.repeat(400));
    const body = h.calls[0]; assert.ok(body.prompt.startsWith(IDENTITY_PROMPT)); assert.ok(body.prompt.endsWith(INITIATION_TAIL));
    assert.ok(body.prompt.length <= 1000); assert.equal(body.negative_prompt, undefined); assert.equal(body.safe_mode, true);
    h.b.endInitiation(t); h.legacy.safe_mode = false;
    const t2 = h.allow(); await h.b.generateInitiation(t2, 'Cafe'); assert.equal(h.calls[1].safe_mode, false);
});
test('missing prompt capacity or refused reservation stops before paid fetch', async () => {
    const h = setup(); h.own.editModels[0].constraints.promptCharacterLimit = 100;
    assert.throws(() => initiationPortraitArgs(h.own, 'A', 'abc'), /cannot hold/);
    h.own.editModels[0].constraints.promptCharacterLimit = 1000;
    const t = h.allow({ beforeRequest: () => { throw new Error('Budget exhausted'); } });
    await assert.rejects(h.b.generateInitiation(t, 'A garden'), /Budget exhausted/); assert.equal(h.calls.length, 0);
});
test('allowance expires in two minutes or outer deadline, and bad token cannot poison bridge', () => {
    const h = setup(); assert.throws(() => h.allow({ deadline: Date.now() - 1 }), /expired/);
    const start = Date.now(), t = h.allow(); assert.ok(t.expiresAt <= start + 120010); h.b.endInitiation(t);
    const deadline = Date.now() + 1000, t2 = h.allow({ deadline }); assert.equal(t2.expiresAt, deadline);
});
test('wrong chat and cancelled allowance cannot reach provider', async () => {
    const h = setup(); const t = h.allow(); h.c.chatId = 'new';
    await assert.rejects(h.b.generateInitiation(t, 'A cafe'), /another chat/); assert.equal(h.calls.length, 0);
    h.c.chatId = 'a'; h.b.cancel('timer'); await assert.rejects(h.b.generateInitiation(t, 'Cafe'), /cancelled/);
});
test('ST stop handler delegates to one shared coordinator, not a second cancel', () => {
    const h = setup(); let stops = 0, cancels = 0, latched = false;
    const coordinator = () => { stops++; if (latched) return; latched = true; cancels++; h.b.cancel('timer'); };
    h.b.claimInitiation({ attemptId: 'timer', onStop: coordinator });
    coordinator(); h.b.handleGenerationStopped(); h.b.handleGenerationStopped();
    assert.equal(stops, 3); assert.equal(cancels, 1); h.b.releaseInitiation('timer');
});
