import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestDiagnostics, describeRequest } from '../diagnostics.mjs';

const origin = 'https://st.test', path = '/api/backends/chat-completions/generate';
const data = () => ({ chat_completion_source: 'custom', custom_url: 'https://api.venice.ai/api/v1', model: 'test-model', stream: false,
    frequency_penalty: 0.15, messages: [{ role: 'user', content: 'PRIVATE CONVERSATION fragmentSecret987' }] });
const request = extra => ({ method: 'POST', body: JSON.stringify({ ...data(), ...extra }) });
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
const latest = d => JSON.parse(d.report()).requests.at(-1);

test('disabled capture passes exact arguments, original response and original error without reporting', async () => {
    const init = request(), response = new Response('unchanged'), failure = new Error('original');
    let calls = 0;
    const d = createRequestDiagnostics({ origin, enabled: () => true, fetch: async (url, options) => {
        assert.equal(url, path); assert.equal(options, init); if (++calls === 2) throw failure; return response;
    } });
    assert.equal(await d.fetch(path, init), response);
    assert.equal(await response.text(), 'unchanged');
    await assert.rejects(d.fetch(path, init), error => error === failure);
    assert.deepEqual(JSON.parse(d.report()).requests, []);
});

test('JSON failure reports actual settings and redacts echoed text, images, credentials and unknown input fields', async () => {
    const body = { error: { message: 'Invalid request parameters: fragmentSecret987 Bearer SECRET-TOKEN data:image/png;base64,PRIVATEPHOTO https://private.test/file', details: [{ loc: ['messages', 0, 'content'], msg: 'PRIVATE CONVERSATION fragmentSecret987', input: 'DO NOT COPY THIS' }] }, choices: [{ message: { content: 'PRIVATE RESPONSE' } }] };
    const response = new Response(JSON.stringify(body), { status: 400, headers: { 'content-type': 'application/json' } });
    const d = createRequestDiagnostics({ origin, enabled: () => true, fetch: async () => response });
    d.arm(); const actual = await d.fetch(path, request());
    assert.equal(actual, response); assert.deepEqual(await actual.json(), body); await wait();
    const report = d.report(), r = latest(d);
    assert.equal(r.httpStatus, 400); assert.equal(r.request.stream, false); assert.equal(r.request.sampling.frequency_penalty, 0.15);
    assert.equal(r.outcome, 'Error returned to browser');
    for (const secret of ['PRIVATE', 'fragmentSecret987', 'SECRET-TOKEN', 'private.test', 'DO NOT COPY THIS']) assert.ok(!report.includes(secret), secret);
    assert.match(report, /Invalid request parameters/); assert.match(report, /messages/);
});

test('SSE error inside HTTP 200 is captured, while the full original stream stays readable', async () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"PRIVATE GENERATED WORDS"}}]}\n\n', 'data: {"error":{"message":"Cannot override enforced sampling params","param":"frequency_penalty"}}\n\n', 'data: [DONE]\n\n'];
    const response = new Response(new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    const d = createRequestDiagnostics({ origin, enabled: () => true, fetch: async () => response }); d.arm();
    const actual = await d.fetch(path, request({ stream: true })); assert.equal(await actual.text(), chunks.join('')); await wait();
    assert.equal(latest(d).httpStatus, 200); assert.equal(latest(d).request.stream, true);
    assert.match(d.report(), /Cannot override/); assert.ok(!d.report().includes('PRIVATE GENERATED WORDS'));
});

test('only matching Venice chat fetches consume capture; at most three, expires in five minutes', async () => {
    let clock = 1000, enabled = true, calls = 0;
    const d = createRequestDiagnostics({ origin, now: () => clock, enabled: () => enabled, fetch: async () => { calls++; return new Response('{}'); } });
    d.arm();
    await d.fetch('/api/images/generate', request());
    await d.fetch('https://other.test' + path, request());
    await d.fetch(path, request({ custom_url: 'https://not-venice.test' }));
    enabled = false; await d.fetch(path, request()); enabled = true;
    assert.equal(JSON.parse(d.report()).requests.length, 0);
    for (let i = 0; i < 4; i++) await d.fetch(path, request());
    assert.equal(JSON.parse(d.report()).requests.length, 3); assert.equal(calls, 8);
    d.arm(); clock += 300001; await d.fetch(path, request()); assert.equal(JSON.parse(d.report()).requests.length, 0);
    d.clear(); assert.equal(JSON.parse(d.report()).captureRemaining, 0);
});

test('clear during an in-flight response never restores a cleared report', async () => {
    let release;
    const response = new Promise(resolve => { release = resolve; });
    const d = createRequestDiagnostics({ origin, enabled: () => true, fetch: () => response }); d.arm();
    const result = d.fetch(path, request()); d.clear(); release(new Response('{"error":{"message":"old"}}'));
    await result; await wait(); assert.deepEqual(JSON.parse(d.report()).requests, []);
});

test('structural description finds empty assistant and broken tool adjacency without copying IDs or content', () => {
    const d = data(); d.messages.push({ role: 'assistant', content: '' }, { role: 'assistant', content: null, tool_calls: [{ id: 'PRIVATE-ID' }] }, { role: 'user', content: [{ type: 'image_url', image_url: { url: 'PRIVATE-IMAGE' } }] }, { role: 'tool', tool_call_id: 'PRIVATE-ID', content: 'PRIVATE-RESULT' });
    const result = describeRequest(d, 1234);
    assert.equal(result.images, 1); assert.equal(result.bytes, 1234);
    assert.deepEqual(result.structuralWarnings, [{ index: 1, issue: 'empty content without a tool call' }, { index: 3, issue: 'message before all tool results' }]);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('bounded observer does not cancel the original stream, and update callback failures cannot break fetch', async () => {
    let controller, cancelled = false;
    const response = new Response(new ReadableStream({ start(c) { controller = c; }, cancel() { cancelled = true; } }));
    const d = createRequestDiagnostics({ origin, enabled: () => true, timeoutMs: 5, onUpdate() { throw Error('UI fault'); }, fetch: async () => response });
    d.arm(); const actual = await d.fetch(path, request()); await wait();
    assert.equal(cancelled, false); assert.match(latest(d).observation, /timed out/);
    controller.enqueue(new TextEncoder().encode('original still readable')); controller.close();
    assert.equal(await actual.text(), 'original still readable');
});

test('oversized response is not included; report remains bounded', async () => {
    const body = 'SECRET'.repeat(2000);
    const d = createRequestDiagnostics({ origin, enabled: () => true, maxBytes: 100, fetch: async () => new Response(body) }); d.arm();
    const response = await d.fetch(path, request()); assert.equal(await response.text(), body); await wait();
    assert.match(latest(d).observation, /size limit/); assert.ok(!d.report().includes('SECRET'));
});

test('flags the live empty-text array and preserves standard Bad Request wording', async () => {
    const messages = [{ role: 'assistant', content: [{ type: 'text', text: '' }] }, { role: 'user', content: 'Request help please' }];
    assert.deepEqual(describeRequest({ messages }, 0).structuralWarnings, [{ index: 0, issue: 'empty content without a tool call' }]);
    const d = createRequestDiagnostics({ origin, enabled: () => true, fetch: async () => new Response('{"error":{"message":"Bad Request"}}') });
    d.arm(); const response = await d.fetch(path, request({ messages })); await response.text(); await wait();
    assert.equal(latest(d).error.error.message, 'Bad Request');
});
