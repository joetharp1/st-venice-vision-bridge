import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoRig, planVideo, quoteUsd, money, VIDEO_MODEL, JOB_TTL } from '../video-rig-core.mjs';

const catalogue = (audio = true) => ({ data: [{ id: VIDEO_MODEL, model_spec: { capabilities: { supportsAudioConfig: audio }, constraints: { durations: ['5s', '10s', '15s'], resolutions: ['1080p', '720p'], prompt_character_limit: 1500 } } }] });
const plan = () => planVideo(catalogue(), 'silent', 1280, 720, 'Blink slowly.');
function harness() {
    let db = { jobs: [] }, seq = 0, time = 10000;
    const receipts = {}, locks = new Map(), events = [];
    const d = {
        now: () => time, uuid: () => `job-${++seq}`,
        read: async () => structuredClone(db),
        update: async fn => { const next = structuredClone(db); fn(next); db = next; },
        lock: async (name, fn, optional) => {
            if (optional && locks.has(name)) return;
            const preceding = locks.get(name) || Promise.resolve();
            let release; const held = new Promise(r => release = r);
            locks.set(name, held); await preceding;
            try { return await fn(); } finally { release(); if (locks.get(name) === held) locks.delete(name); }
        },
        assertTarget: () => {},
        queue: async body => { events.push(['queue', body]); return { model: VIDEO_MODEL, queue_id: `queue-${seq}`, download_url: 'https://delivery.test/private' }; },
        backupReceipt: (id, r) => { receipts[id] = r; }, clearReceipt: id => delete receipts[id], receipts: () => receipts,
        retrieve: async job => { events.push(['retrieve', job.queueId]); return { pending: true }; },
        saveVideo: async job => { events.push(['save', job.id]); return { path: '/user/files/test.mp4', verifiedAt: time }; },
        cleanup: async job => { assert.ok(job.saved?.verifiedAt); events.push(['cleanup', job.id]); },
        attach: async job => { events.push(['attach', job.id]); return true; },
    };
    return { d, events, get db() { return db; }, setTime: t => time = t,
        ticket: id => ({ id, quotedAt: time, usd: .55, plan: plan(), target: { avatar: 'Ava.png', chatId: 'morning' }, image: 'data:image/png;base64,TEST', sourceHash: 'hash' }) };
}
test('audition uses cheapest advertised resolution and explicit audio=false; ordinary image settings are not touched', () => {
    const cat = catalogue(), before = structuredClone(cat);
    assert.deepEqual(planVideo(cat, 'silent', 1280, 720, 'Blink.').params, { model: VIDEO_MODEL, duration: '5s', resolution: '720p', audio: false });
    assert.deepEqual(cat, before);
    assert.throws(() => planVideo(catalogue(false), 'silent', 1280, 720, 'Blink.'), /Silent mode unavailable/);
    assert.equal('audio' in planVideo(catalogue(false), 'ambient', 1280, 720, 'Blink.').params, false);
});
test('missing capabilities/settings, unsupported ratio, unknown or over-cap prices fail before spending', () => {
    assert.throws(() => planVideo({ data: [] }, 'silent', 1280, 720, 'Blink.'), /not available/);
    const c = catalogue(); c.data[0].model_spec.constraints.aspect_ratios = ['9:16'];
    assert.throws(() => planVideo(c, 'ambient', 1280, 720, 'Blink.'), /dimensions/);
    for (const q of [null, {}, { quote: '0.55' }, { quote: NaN }, { quote: -1 }, { quote: 3.01 }]) assert.throws(() => quoteUsd(q));
    assert.equal(money(.55), 'US$0.55 · 55 credits');
    assert.equal(quoteUsd({ quote: 3 }), 3);
});
test('hard reload mid-render resumes exactly the confirmed queue; never resubmits', async () => {
    const h = harness(); const first = createVideoRig(h.d);
    const id = await first.start(h.ticket('a'));
    assert.equal(h.db.jobs[0].state, 'queued');
    // A new engine has no in-memory generation state; only persistent d.read survives.
    const reloaded = createVideoRig(h.d); await reloaded.tick(); await reloaded.tick();
    assert.equal(h.events.filter(e => e[0] === 'queue').length, 1);
    assert.deepEqual(h.events.filter(e => e[0] === 'retrieve').map(e => e[1]), ['queue-1', 'queue-1']);
    assert.equal(h.db.jobs[0].id, id);
});
test('closed-tab reopen saves, verifies, cleans up and attaches exactly once to captured chat', async () => {
    const h = harness(); await createVideoRig(h.d).start(h.ticket('a'));
    h.d.retrieve = async () => ({ blob: new Blob(['fixture']) });
    h.d.attach = async job => { assert.deepEqual(job.target, { avatar: 'Ava.png', chatId: 'morning' }); h.events.push(['attach', job.id]); return true; };
    const reopened = createVideoRig(h.d); await reopened.tick(); await reopened.tick();
    assert.equal(h.events.filter(e => e[0] === 'queue').length, 1);
    assert.deepEqual(h.events.filter(e => e[0] !== 'queue').map(e => e[0]), ['save', 'cleanup', 'attach']);
    assert.equal(h.db.jobs[0].state, 'delivered');
});
test('wrong chat holds a ready video, then attaches on return without regeneration', async () => {
    const h = harness(); const rig = createVideoRig(h.d); await rig.start(h.ticket('a'));
    h.d.retrieve = async () => ({ blob: new Blob(['fixture']) });
    h.d.attach = async () => false;
    await rig.tick(); assert.equal(h.db.jobs[0].state, 'ready');
    h.d.attach = async () => true;
    await rig.tick(); assert.equal(h.db.jobs[0].state, 'delivered');
    assert.equal(h.events.filter(e => e[0] === 'queue').length, 1);
});
test('concurrency is two across chats but submission two waits for confirmed submission one', async () => {
    const h = harness(); const rig = createVideoRig(h.d);
    let release; const wait = new Promise(r => release = r), queue = h.d.queue;
    h.d.queue = async body => { await wait; return queue(body); };
    const a = rig.start(h.ticket('a'));
    const second = h.ticket('b'); second.target.chatId = 'evening';
    const b = rig.start(second);
    await new Promise(r => setImmediate(r));
    assert.equal(h.db.jobs.length, 1); assert.equal(h.db.jobs[0].state, 'submitting');
    release(); await Promise.all([a, b]);
    assert.equal(h.db.jobs.length, 2);
    await assert.rejects(rig.start(h.ticket('c')), /Two video jobs/);
    await assert.rejects(rig.start(h.ticket('a')), /already been submitted/);
});
test('unknown submission blocks another and survives reload without automatic retries; expires at two hours', async () => {
    const h = harness(); h.d.queue = async () => { throw new TypeError('Failed to fetch'); };
    const rig = createVideoRig(h.d); await assert.rejects(rig.start(h.ticket('a')), /Failed to fetch/);
    assert.equal(h.db.jobs[0].state, 'uncertain'); assert.equal(h.db.jobs[0].charge, 'unknown');
    await createVideoRig(h.d).tick();
    await assert.rejects(rig.start(h.ticket('b')), /earlier submission is unresolved/);
    h.setTime(10000 + JOB_TTL); await rig.tick();
    assert.equal(h.db.jobs[0].state, 'abandoned'); assert.equal(h.db.jobs[0].charge, 'unknown');
});
test('server pre-submit persistence failure makes zero provider calls', async () => {
    const h = harness(); h.d.update = async () => { throw new Error('storage offline'); };
    await assert.rejects(createVideoRig(h.d).start(h.ticket('a')), /storage offline/);
    assert.equal(h.events.length, 0);
});
test('queue receipt survives failed server commit and recovers without spending again', async () => {
    const h = harness(); const update = h.d.update;
    let updates = 0; h.d.update = async fn => { if (++updates === 2) throw new Error('save failed'); return update(fn); };
    await assert.rejects(createVideoRig(h.d).start(h.ticket('a')), /save failed/);
    assert.equal(h.db.jobs[0].state, 'submitting');
    h.d.update = update;
    await createVideoRig(h.d).tick();
    assert.equal(h.db.jobs[0].queueId, 'queue-1');
    assert.equal(h.events.filter(e => e[0] === 'queue').length, 1);
});
test('failed upload does not delete provider copy, retains queue and retries retrieval only', async () => {
    const h = harness(); h.d.retrieve = async () => ({ blob: new Blob(['fixture']) });
    h.d.saveVideo = async () => { throw new Error('HTTP 413'); };
    const rig = createVideoRig(h.d); await rig.start(h.ticket('a')); await rig.tick();
    assert.equal(h.db.jobs[0].state, 'saving');
    assert.equal(h.events.some(e => e[0] === 'cleanup'), false);
    assert.equal(h.events.filter(e => e[0] === 'queue').length, 1);
});
test('chat delivery failure retries saved media rather than rendering again', async () => {
    const h = harness(); h.d.retrieve = async () => ({ blob: new Blob(['fixture']) });
    h.d.attach = async () => { throw new Error('chat read-back failed'); };
    const rig = createVideoRig(h.d); await rig.start(h.ticket('a')); await rig.tick();
    assert.equal(h.db.jobs[0].state, 'ready');
    h.d.attach = async () => true; h.setTime(50000); await rig.tick();
    assert.equal(h.db.jobs[0].state, 'delivered');
    assert.equal(h.events.filter(e => e[0] === 'save').length, 1);
});
test('retrieval authentication outage retains the queue, while explicit provider rejection releases execution', async () => {
    const h = harness(), rig = createVideoRig(h.d);
    await rig.start(h.ticket('a'));
    h.d.retrieve = async () => { throw Object.assign(new Error('HTTP 401'), { definiteRejection: true }); };
    await rig.tick(); assert.equal(h.db.jobs[0].state, 'queued');
    h.setTime(50000);
    h.d.retrieve = async () => { throw Object.assign(new Error('provider rejection'), { providerFailure: true, refunded: true }); };
    await rig.tick(); assert.equal(h.db.jobs[0].state, 'failed'); assert.equal(h.db.jobs[0].charge, 'refunded');
});
test('provider cleanup failure can recover after chat delivery without a second attachment or generation', async () => {
    const h = harness(), rig = createVideoRig(h.d);
    h.d.retrieve = async () => ({ blob: new Blob(['fixture']) });
    h.d.cleanup = async () => { throw new Error('cleanup timeout'); };
    await rig.start(h.ticket('a')); await rig.tick();
    assert.equal(h.db.jobs[0].state, 'delivered'); assert.ok(h.db.jobs[0].cleanupError);
    h.setTime(50000); h.d.cleanup = async () => {};
    await rig.tick(); assert.equal(h.db.jobs[0].providerCleaned, true);
    assert.equal(h.events.filter(e => e[0] === 'attach').length, 1);
    assert.equal(h.events.filter(e => e[0] === 'queue').length, 1);
});
