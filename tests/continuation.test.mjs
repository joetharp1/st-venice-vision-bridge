import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPortraitContinuation } from '../continuation.mjs';

function fixture() {
    let busy = true, draft = false, current = true, time = 1000;
    const user = { is_user: true, mes: 'A photo please' }, photo = { mes: '', extra: { media: [{ url: '/photo.png' }] } };
    const c = { chatId: 'a', characterId: 0, chat: [user, photo] }, calls = [], errors = [], timers = new Map();
    let seq = 0;
    const deps = { getContext: () => c, isGenerating: () => busy, hasDraft: () => draft,
        now: () => time, setTimer: fn => { timers.set(++seq, fn); return seq; }, clearTimer: key => timers.delete(key),
        generate: async (...args) => calls.push(args), onError: e => errors.push(e.message) };
    const q = createPortraitContinuation(deps);
    const entry = { context: c, messageId: 1, userMessage: user, isCurrent: () => current };
    return { q, deps, entry, calls, errors, timers, c, setBusy: b => { busy = b; }, setDraft: b => { draft = b; },
        switchChat: () => { current = false; }, expire: () => { time += 150001; } };
}

test('published portrait queues exactly one normal automatic continuation after the tool turn ends', async () => {
    const f = fixture(); assert.equal(f.q.enqueue(f.entry), true);
    assert.equal(f.q.enqueue(f.entry), false);
    await f.q.flush(); assert.equal(f.calls.length, 0, 'Never nest Generate inside a running tool');
    f.setBusy(false); f.q.generationEnded();
    await Promise.all([f.q.flush(), f.q.flush()]);
    assert.deepEqual(f.calls, [['normal', { automatic_trigger: true }]]);
    f.q.generationEnded(); await f.q.flush();
    assert.equal(f.q.enqueue(f.entry), false); assert.equal(f.calls.length, 1);
});

test('ST native tool continuation consumes the queued reaction without a second generation', async () => {
    const f = fixture(); f.q.enqueue(f.entry);
    f.q.generationStarted('normal', {}, true); // Context dry run is not a reaction.
    f.q.generationStarted('normal', {}, false);
    f.setBusy(false); f.q.generationEnded(); await f.q.flush();
    assert.equal(f.calls.length, 0, 'The native normal generation is the one continuation');
});

for (const change of ['switchChat', 'setDraft', 'reply', 'cancel', 'expire', 'deletePhoto']) {
    test(`portrait reaction is discarded on ${change}`, async () => {
        const f = fixture(); f.q.enqueue(f.entry);
        if (change === 'reply') f.c.chat.push({ is_user: true, mes: 'I replied already' });
        else if (change === 'cancel') f.q.cancel();
        else if (change === 'deletePhoto') f.c.chat.splice(1, 1);
        else f[change](true);
        f.setBusy(false); await f.q.flush();
        assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
    });
}

test('a failed reaction is reported once without retry or image regeneration', async () => {
    const f = fixture(); f.deps.generate = undefined;
    const errors = [], calls = [];
    const q = createPortraitContinuation({ ...f.deps, isGenerating: () => false,
        generate: async () => { calls.push(1); throw Error('Provider failure'); }, onError: e => errors.push(e.message) });
    q.enqueue(f.entry); await q.flush(); q.generationEnded(); await q.flush();
    assert.deepEqual(calls, [1]); assert.deepEqual(errors, ['Provider failure']);
});

test('ST source exports continuation imports and performs native normal follow-up after tool results', async t => {
    const root = process.env.ST_ROOT || '/workspace/scratch/d5e75b8f0021/research/st-1.19.0';
    let script, chats;
    try {
        script = await readFile(`${root}/public/script.js`, 'utf8');
        chats = await readFile(`${root}/public/scripts/chats.js`, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT' && !process.env.ST_ROOT) { t.skip('Set ST_ROOT to verified SillyTavern 1.19.0 source.'); return; }
        throw error;
    }
    assert.match(script, /export async function Generate\(/);
    assert.match(script, /export const isGenerating = \(\) =>/);
    assert.match(chats, /export function hasPendingFileAttachment\(/);
    assert.match(script, /saveFunctionToolInvocations\(invocationResult.invocations\);\s*return Generate\('normal'/);
    assert.match(script, /eventSource.emit\(event_types.GENERATION_ENDED/);
});
