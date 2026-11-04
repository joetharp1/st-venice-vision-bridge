import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptAssistantImages, isVeniceConnection, imageRequestBody } from '../core.mjs';
import { createBridge } from '../runtime.mjs';

const picture = (url = 'data:image/png;base64,TEST') => ({ type: 'image_url', image_url: { url, detail: 'auto' } });
const text = value => ({ type: 'text', text: value });
const settings = () => ({ api_key: 'test-only-key', model: 'chroma', width: 832, height: 1216, safe_mode: true, hide_watermark: true, negative_prompt: 'blur' });
const connection = () => ({ mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://api.venice.ai/api/v1', media_inlining: true, function_calling: true } });

test('reproduces the logged failure: old assistant picture moved, fresh user picture preserved', () => {
    const history = [
        { role: 'system', content: 'Stay in character' },
        { role: 'assistant', name: 'TestCharacter', content: [text('Kitchen portrait'), picture()] },
        { role: 'user', content: [text('What is in the cat picture?'), picture('cat')] },
    ];
    const before = structuredClone(history);
    const result = adaptAssistantImages(history);
    assert.equal(result.imagesMoved, 1);
    assert.deepEqual(result.messages.map(m => m.role), ['system', 'assistant', 'user', 'user']);
    assert.deepEqual(result.messages[1].content, [text('Kitchen portrait')]);
    assert.deepEqual(result.messages[2].content[1], picture());
    assert.strictEqual(result.messages[3], history[2]);
    assert.deepEqual(history, before);
    assert.equal(adaptAssistantImages(result.messages).imagesMoved, 0);
});

test('multiple pictures, empty assistant text, tool metadata and image detail survive', () => {
    const result = adaptAssistantImages([{ role: 'assistant', content: [picture('a'), picture('b')], name: 'TestCharacter' }]);
    assert.equal(result.messages[0].content, '');
    assert.equal(result.messages[0].name, 'TestCharacter');
    assert.deepEqual(result.messages[1].content.slice(1), [picture('a'), picture('b')]);
});

test('never inserts pictures between assistant tool calls and multiple tool results', () => {
    const calls = [{ id: 'call1', type: 'function', function: { name: 'one', arguments: '{}' } }, { id: 'call2', type: 'function', function: { name: 'two', arguments: '{}' } }];
    const result = adaptAssistantImages([
        { role: 'assistant', content: [picture()], tool_calls: calls },
        { role: 'tool', tool_call_id: 'call1', content: 'ok' },
        { role: 'tool', tool_call_id: 'call2', content: 'ok' },
        { role: 'assistant', content: 'Done' },
    ]);
    assert.deepEqual(result.messages.map(m => m.role), ['assistant', 'tool', 'tool', 'user', 'assistant']);
    assert.deepEqual(result.messages[0].tool_calls, calls);
    assert.equal(result.imagesDeferred, 0);
});

test('incomplete tool exchange defers image rather than breaking tool-result adjacency', () => {
    const result = adaptAssistantImages([{ role: 'assistant', content: [picture()], tool_calls: [{ id: 'pending' }] }]);
    assert.equal(result.imagesDeferred, 1);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].content, '');
});

test('text-only and user image messages are unchanged', () => {
    const messages = [{ role: 'assistant', content: 'hello' }, { role: 'user', content: [picture()] }];
    const result = adaptAssistantImages(messages);
    assert.deepEqual(result.messages, messages);
    assert.equal(result.imagesMoved, 0);
});

test('provider gate rejects unrelated endpoints and lookalike hosts', () => {
    assert.equal(isVeniceConnection(connection()), true);
    for (const url of ['https://api.venice.ai.evil.test/api/v1', 'http://api.venice.ai/api/v1', 'https://api.openai.com/v1', 'https://api.venice.ai/elsewhere', 'bad']) {
        const c = connection(); c.chatCompletionSettings.custom_url = url;
        assert.equal(isVeniceConnection(c), false, url);
    }
    const c = connection(); c.mainApi = 'textgenerationwebui';
    assert.equal(isVeniceConnection(c), false);
});

test('image tool cannot override model, size, filters or destination through its arguments', () => {
    const s = settings();
    const b = imageRequestBody(s, { prompt: '  a study  ', negative_prompt: 'text', model: 'other', safe_mode: false });
    assert.equal(b.prompt, 'a study'); assert.equal(b.model, 'chroma'); assert.equal(b.safe_mode, true);
    assert.equal(b.negative_prompt, 'text, blur'); assert.equal(b.width, 832);
    assert.throws(() => imageRequestBody(s, { prompt: ' ' }));
    assert.throws(() => imageRequestBody(s, { prompt: 'x'.repeat(1501) }));
});

function fixture() {
    let c = { ...connection(), characters: [{ avatar: 'TestCharacter.png' }], characterId: 0, chatId: 'test-chat', name2: 'TestCharacter', chat: [{ is_user: true, mes: 'Show me your study' }] };
    const original = settings();
    const own = { enabled: true, characters: { 'TestCharacter.png': true } };
    const requests = [], saved = [], posted = [];
    let fetchImpl = async () => ({ ok: true, json: async () => ({ images: ['TEST_BASE64'] }) });
    const bridge = createBridge({
        getContext: () => c, getSettings: () => own, getGeneratorSettings: () => original,
        fetch: async (...args) => { requests.push(args); return fetchImpl(...args); },
        saveImage: async (...args) => { saved.push(args); return '/user/images/TestCharacter/test.png'; },
        publishImage: async ({ url, prompt, context }) => {
            posted.push({ url, prompt, context });
            context.chat.push({ is_user: false, is_system: false, mes: prompt, extra: { media: [{ url }], venice_bridge: { via_tool: true } } });
        },
    });
    return { bridge, own, original, requests, saved, posted, get c() { return c; }, setContext: value => { c = value; }, setFetch: fn => { fetchImpl = fn; } };
}

test('tool roundtrip generates, saves, posts as character, and adapts follow-up to user image', async () => {
    const f = fixture(), before = structuredClone(f.original);
    const result = JSON.parse(await f.bridge.tool().action({ prompt: 'A warm study' }));
    assert.equal(result.status, 'created');
    assert.equal(f.requests[0][0], 'https://api.venice.ai/api/v1/image/generate');
    assert.equal(f.requests[0][1].headers.Authorization, 'Bearer test-only-key');
    assert.equal(f.posted.length, 1); assert.equal(f.c.chat[1].is_user, false);
    assert.deepEqual(f.original, before);
    const outbound = { chat: [{ role: 'assistant', content: [text(f.c.chat[1].mes), picture(result.image_url)] }], dryRun: false };
    f.bridge.adapt(outbound);
    assert.deepEqual(outbound.chat.map(m => m.role), ['assistant', 'user']);
    assert.equal(f.c.chat[1].is_user, false);
});

test('one attempt per user turn, including failures; a new user message allows another', async () => {
    const f = fixture();
    f.setFetch(async () => ({ ok: false, status: 429 }));
    await assert.rejects(f.bridge.generate({ prompt: 'study' }), /HTTP 429/);
    await assert.rejects(f.bridge.generate({ prompt: 'retry' }), /One image attempt/);
    assert.equal(f.requests.length, 1);
    f.c.chat.push({ is_user: true, mes: 'Try once more now' });
    f.setFetch(async () => ({ ok: true, json: async () => ({ images: ['IMAGE'] }) }));
    await f.bridge.generate({ prompt: 'study' });
    assert.equal(f.requests.length, 2);
});

test('persisted successful tool image blocks repeat after bridge/browser reload', async () => {
    const f = fixture();
    f.c.chat.push({ is_user: false, extra: { venice_bridge: { via_tool: true } } });
    await assert.rejects(f.bridge.generate({ prompt: 'again' }), /One image attempt/);
    assert.equal(f.requests.length, 0);
});

test('wrong chat never receives an in-flight generation', async () => {
    const f = fixture();
    f.setFetch(async () => {
        f.setContext({ ...f.c, chat: [], chatId: 'another-chat' });
        return { ok: true, json: async () => ({ images: ['IMAGE'] }) };
    });
    await assert.rejects(f.bridge.generate({ prompt: 'study' }), /chat changed/);
    assert.equal(f.saved.length, 1); assert.equal(f.posted.length, 0);
});

test('concurrent requests cannot double spend', async () => {
    const f = fixture();
    let finish;
    f.setFetch(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.bridge.generate({ prompt: 'study' });
    await assert.rejects(f.bridge.generate({ prompt: 'second' }), /already being generated/);
    finish({ ok: true, json: async () => ({ images: ['IMAGE'] }) });
    await pending;
    assert.equal(f.requests.length, 1);
});

test('tool stays unavailable for unselected characters, groups and disabled configurations', () => {
    const f = fixture();
    assert.equal(f.bridge.ready(), true);
    f.own.characters['TestCharacter.png'] = false; assert.equal(f.bridge.ready(), false);
    f.own.characters['TestCharacter.png'] = true;
    f.c.groupId = 'group'; assert.equal(f.bridge.ready(), false);
    delete f.c.groupId;
    f.c.chatCompletionSettings.media_inlining = false; assert.equal(f.bridge.ready(), false);
    f.c.chatCompletionSettings.media_inlining = true;
    f.c.chatCompletionSettings.function_calling = false; assert.equal(f.bridge.ready(), false);
});

test('adapter leaves other providers untouched and disabling restores original output', () => {
    const f = fixture(), event = { chat: [{ role: 'assistant', content: [picture()] }] };
    const before = structuredClone(event);
    f.c.chatCompletionSettings.custom_url = 'https://other.test/v1';
    f.bridge.adapt(event); assert.deepEqual(event, before);
    f.c.chatCompletionSettings.custom_url = 'https://api.venice.ai/api/v1';
    f.own.enabled = false;
    f.bridge.adapt(event); assert.deepEqual(event, before);
});

test('cancel aborts an active request without automatic retry', async () => {
    const f = fixture();
    f.setFetch((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = f.bridge.generate({ prompt: 'study' });
    f.bridge.cancel();
    await assert.rejects(pending, /stopped or timed out/);
    assert.equal(f.requests.length, 1); assert.equal(f.bridge.busy, false);
});
