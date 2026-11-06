import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageTransport, REQUEST_BUDGET } from '../transport.mjs';
const picture = n => 'data:image/png;base64,' + 'A'.repeat(n);
const part = url => ({ type: 'image_url', image_url: { url, detail: 'high' } });
const byteSize = value => new TextEncoder().encode(JSON.stringify(value)).length;

test('oversized history is bounded without dropping images, text, identities or tool metadata', async () => {
    const stats = [], renders = [];
    const prepare = createImageTransport({ maxBytes: 64000, maxImageChars: 20000,
        render: async (url, cap) => { renders.push(cap); return picture(cap - 40); }, onStats: x => stats.push(x) });
    const data = { model: 'fixture', messages: [
        { role: 'system', content: 'Character and memories 🧡' },
        { role: 'assistant', content: [part(picture(50000))], tool_calls: [{ id: 'a' }] },
        { role: 'tool', tool_call_id: 'a', content: 'Saved photo' },
        { role: 'user', content: [{ type: 'text', text: 'My message' }, part(picture(60000)), part(picture(2000))] },
    ], temperature: .9 };
    const original = structuredClone(data), out = await prepare(data);
    assert.deepEqual(data, original); assert.ok(byteSize(out) <= 64000);
    assert.equal(out.messages.length, data.messages.length);
    assert.equal(out.messages.flatMap(m => m.content).filter(p => p?.type === 'image_url').length, 3);
    assert.deepEqual(out.messages[1].tool_calls, data.messages[1].tool_calls);
    assert.equal(out.messages[2], data.messages[2]); assert.equal(out.messages[0], data.messages[0]);
    assert.equal(out.messages[3].content[1].image_url.detail, 'high');
    assert.equal(stats[0].beforeBytes, byteSize(data)); assert.equal(stats[0].afterBytes, byteSize(out));
    await prepare(data); assert.equal(renders.length, 2, 'Same target copies are cached');
});

test('aggregate image budget catches many individually small images and exact UTF-8 overhead', async () => {
    const prepare = createImageTransport({ maxBytes: 64000, maxImageChars: 50000, render: async (_, cap) => picture(cap - 40) });
    const data = { messages: [{ role: 'user', content: [{ type: 'text', text: 'é你好'.repeat(50) }, ...Array.from({ length: 12 }, () => part(picture(12000)))] }] };
    const out = await prepare(data);
    assert.ok(byteSize(out) <= 64000); assert.equal(out.messages[0].content.length, 13);
});

test('small images and text-only requests pass through unchanged', async () => {
    const prepare = createImageTransport({ render: () => assert.fail('Unnecessary conversion') });
    for (const data of [{ messages: [{ role: 'user', content: 'hello' }] }, { messages: [{ role: 'user', content: [part(picture(300))] }] }]) {
        assert.equal(await prepare(data), data);
    }
});

test('failures do not mutate the request or silently discard an image', async () => {
    const data = { messages: [{ role: 'user', content: [part(picture(80000))] }] };
    const original = structuredClone(data);
    const bad = createImageTransport({ maxBytes: 64000, render: async () => { throw Error('decode failed'); } });
    await assert.rejects(bad(data), /decode failed/); assert.deepEqual(data, original);
    const wrong = createImageTransport({ maxBytes: 64000, render: async () => 'https://wrong.example/' });
    await assert.rejects(wrong(data), /did not meet/); assert.deepEqual(data, original);
    const largeText = { messages: [{ content: [{ type: 'text', text: 'x'.repeat(REQUEST_BUDGET) }, part(picture(100))] }] };
    await assert.rejects(createImageTransport()(largeText), /text and tool data/);
});

test('switch or stop during conversion discards the viewing request and preserves originals', async () => {
    let current = true;
    const data = { messages: [{ content: [part(picture(80000))] }] }, original = structuredClone(data);
    const prepare = createImageTransport({ maxBytes: 64000, render: async () => { current = false; return picture(100); } });
    await assert.rejects(prepare(data, { isCurrent: () => current }), /stopped or the chat changed/);
    assert.deepEqual(data, original);
});
