import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionVideo, VIDEO_DEFAULTS, VIDEO_TOOL, stillPlan, budget, chargedUSD, findAnnouncement, DAY } from '../video-core.mjs';
import { createVideoRig, planVideo, JOB_TTL, VIDEO_MODEL } from '../video-rig-core.mjs';
import { portraitPlan, INITIATION_TAIL } from '../portraits.mjs';
import { createBridge } from '../runtime.mjs';

const own = () => ({ portraits: { 'Ava.png': { url: '/user/files/ava.png', model: 'seed', options: { aspect_ratio: '1:1' } },
    __human_reference__: { url: '/user/files/joe.png', model: 'seed', options: { aspect_ratio: '1:1' } } },
    editModels: [{ id: 'seed', constraints: { aspectRatios: ['1:1', '9:16', '16:9'], resolutions: ['1K'], qualities: ['high'],
        combineImages: true, maxInputImages: 2, promptCharacterLimit: 3000 }, pricing: { quality: { '1K': { high: { usd: .1 } } }, inputImages: { included: 1, additional: { usd: .03 } } } }] });
const args = { subject: 'companion', scene: 'Fully clothed beside a window.', motion: 'Small smile. Camera fixed.', aspect_ratio: '9:16', duration: 5 };
const turn = n => ({ id: `turn-${n}`, target: { avatar: 'Ava.png', chatId: `chat-${n}`, name: 'Ava' }, userIndex: 0 });
const ticket = () => ({ still: { usd: .1 }, videoUSD: .55, plan: { params: { model: VIDEO_MODEL, duration: '5s', resolution: '720p' }, mode: 'ambient', prompt: 'motion' } });
function fixture() {
    let now = Date.UTC(2026, 10, 9, 12), db = { jobs: [], videoConfig: { ...structuredClone(VIDEO_DEFAULTS), characters: { 'Ava.png': true }, dailyUSD: 3.9, monthlyUSD: 58.5 } }, id = 0;
    const held = new Set(), calls = [], receipts = {};
    let announcement = null, visible = true, queueError, stillError, submitGate, quote = .55, renderGate;
    const d = {
        now: () => now, uuid: () => `job-${++id}`, read: async () => structuredClone(db),
        update: async fn => { const copy = structuredClone(db); fn(copy); db = copy; return structuredClone(db); },
        lock: async (key, fn, optional) => {
            if (held.has(key)) { if (optional) return; throw new Error('Test concurrent blocking call'); }
            held.add(key); try { return await fn(); } finally { held.delete(key); }
        },
        prepare: async () => ticket(), refreshQuote: async () => ({ ...ticket(), videoUSD: quote }),
        announcement: async () => announcement, canStart: () => visible,
        withStillLock: fn => fn(),
        renderStill: async job => { calls.push('still'); if (renderGate) await renderGate; if (stillError) throw stillError; return { path: `/user/files/venice_video_${job.id}_still.png`, bytes: 100, sha256: 'fixture', width: 720, height: 1280, jobId: job.id, turnId: job.turn.id }; },
        videoSubmission: async () => ({ usd: quote, params: ticket().plan.params, body: { model: VIDEO_MODEL, image_url: 'fresh' } }),
        queue: async () => { calls.push('queue'); if (submitGate) await submitGate; if (queueError) throw queueError; return { queue_id: 'queue-' + calls.filter(x => x === 'queue').length, model: VIDEO_MODEL }; },
        backupReceipt: (id, r) => receipts[id] = r, clearReceipt: id => delete receipts[id], receipts: () => receipts,
        retrieve: async () => { calls.push('retrieve'); return { blob: new Blob(['fake']) }; },
        saveVideo: async job => ({ path: `/user/files/venice_video_${job.id}.mp4`, bytes: 200, verifiedAt: now }),
        cleanup: async () => calls.push('cleanup'), attach: async () => { calls.push('attach'); return true; },
        deleteOwnedAsset: async (j, asset) => { calls.push('delete:' + asset.path); return true; },
    };
    const make = () => createCompanionVideo(d, createVideoRig(d));
    return { d, calls, make, engine: make(), get db() { return db; }, set announcement(v) { announcement = v; },
        set visible(v) { visible = v; }, set queueError(v) { queueError = v; }, set stillError(v) { stillError = v; },
        set submitGate(v) { submitGate = v; }, set renderGate(v) { renderGate = v; }, set quote(v) { quote = v; },
        advance: ms => now += ms, receipts };
}

test('video still uses exact saved reference pipeline and a scoped ratio without leaking to the next ordinary image', () => {
    const s = own(), before = structuredClone(s);
    const p = stillPlan(s, 'Ava.png', {}, args);
    assert.equal(p.body.aspect_ratio, '9:16'); assert.ok(p.body.prompt.endsWith(INITIATION_TAIL)); assert.equal(p.usd, .1);
    assert.deepEqual(s, before);
    assert.equal(portraitPlan(s, 'Ava.png', {}, { prompt: 'Another normal photo' }).body.aspect_ratio, '1:1');
    const both = stillPlan(s, 'Ava.png', {}, { ...args, subject: 'together' });
    assert.deepEqual(both.urls, ['/user/files/joe.png', '/user/files/ava.png']); assert.equal(both.usd, .13);
    assert.ok(both.body.prompt.includes(INITIATION_TAIL));
    assert.equal(stillPlan(s, 'Ava.png', {}, { ...args, subject: 'user' }).url, '/user/files/joe.png');
});
test('unknown extra reference pricing or unsupported ratio blocks a paid still', () => {
    const s = own(); delete s.editModels[0].pricing.inputImages;
    assert.throws(() => stillPlan(s, 'Ava.png', {}, { ...args, subject: 'together' }), /price is unknown/);
    assert.throws(() => stillPlan(s, 'Ava.png', {}, { ...args, aspect_ratio: '4:3' }), /Choose/);
});
test('video duration and resolution are catalogue gated; silent cannot masquerade as ambient', () => {
    const catalogue = { data: [{ id: VIDEO_MODEL, model_spec: { constraints: { durations: ['5s', '10s'], resolutions: ['1080p', '720p'] } } }] };
    assert.equal(planVideo(catalogue, 'ambient', 720, 1280, 'move', 10).params.duration, '10s');
    assert.equal(planVideo(catalogue, 'ambient', 720, 1280, 'move').params.resolution, '720p');
    assert.throws(() => planVideo(catalogue, 'ambient', 720, 1280, 'move', 15), /duration/);
    assert.throws(() => planVideo(catalogue, 'silent', 720, 1280, 'move'), /Silent mode unavailable/);
});
test('tool reserves once, spends nothing before a saved announcement, then renders and delivers exactly once', async () => {
    const f = fixture(), result = await f.engine.request(args, turn(1));
    assert.equal((await f.engine.request(args, turn(1))).duplicate, true);
    await f.engine.tick(); assert.deepEqual(f.calls, []); assert.equal(f.db.jobs.length, 1);
    f.announcement = { text: 'Let me send you a little clip.' };
    await f.engine.tick(); await f.engine.tick();
    assert.equal(f.db.jobs[0].id, result.id); assert.equal(f.db.jobs[0].state, 'delivered');
    assert.deepEqual(f.calls, ['still', 'queue', 'retrieve', 'cleanup', 'attach']);
});
test('failed or cancelled text continuation releases reservation without any rendering', async () => {
    const f = fixture(); await f.engine.request(args, turn(1)); f.announcement = 'abort';
    await f.engine.tick(); assert.equal(f.db.jobs[0].state, 'failed'); assert.equal(chargedUSD(f.db.jobs[0]), 0); assert.deepEqual(f.calls, []);
});
test('backgrounded or wrong-chat jobs hold before paid submission and resume when eligible', async () => {
    const f = fixture(); await f.engine.request(args, turn(1)); f.announcement = { text: 'Clip coming.' }; f.visible = false;
    await f.engine.tick(); assert.deepEqual(f.calls, []); assert.equal(f.db.jobs[0].state, 'prepared');
    f.visible = true; await f.engine.tick(); assert.equal(f.db.jobs[0].state, 'delivered');
});
test('two profile-wide slots across chats, third refused, pending submissions cannot overlap', async () => {
    const f = fixture(); await f.engine.request(args, turn(1)); await f.engine.request(args, turn(2));
    await assert.rejects(f.engine.request(args, turn(3)), /Two video jobs/);
    let release; f.submitGate = new Promise(r => release = r); f.announcement = { text: 'Coming.' };
    const first = f.engine.process('job-1');
    while (!f.calls.includes('queue')) await new Promise(r => setTimeout(r, 0));
    await f.engine.process('job-2'); assert.equal(f.calls.filter(x => x === 'queue').length, 1);
    assert.equal(await f.engine.request(args, turn(4)), undefined);
    release(); await first; f.submitGate = null; await f.engine.process('job-2');
    assert.equal(f.calls.filter(x => x === 'queue').length, 2);
});
test('fresh quote change is enforced before the still, and unknown video price never reaches queue', async () => {
    const f = fixture(); await f.engine.request(args, turn(1)); f.announcement = { text: 'Coming.' }; f.quote = 4;
    await f.engine.tick(); assert.equal(f.db.jobs[0].state, 'failed'); assert.deepEqual(f.calls, []);
});
test('network ambiguity holds the possible charge, never resubmits after reload or TTL', async () => {
    const f = fixture(); await f.engine.request(args, turn(1)); f.announcement = { text: 'Coming.' }; f.queueError = new TypeError('Failed to fetch');
    await f.engine.tick(); assert.equal(f.db.jobs[0].state, 'uncertain'); assert.equal(chargedUSD(f.db.jobs[0]), .65);
    assert.match(f.db.jobs[0].error, /network/);
    await f.make().tick(); assert.equal(f.calls.filter(x => x === 'queue').length, 1);
    f.advance(JOB_TTL + 1); await f.make().tick(); assert.equal(f.db.jobs[0].state, 'abandoned'); assert.equal(chargedUSD(f.db.jobs[0]), .65);
});
test('provider rejection releases the video reservation but retains the paid still cost', async () => {
    const f = fixture(); await f.engine.request(args, turn(1)); f.announcement = { text: 'Coming.' };
    f.queueError = Object.assign(new Error('Bad parameters'), { definiteRejection: true });
    await f.engine.tick(); assert.equal(f.db.jobs[0].state, 'failed'); assert.equal(chargedUSD(f.db.jobs[0]), .1);
});
test('persisted queue and emergency receipt both recover across an entirely new engine without resubmitting', async () => {
    const f = fixture(); await f.engine.request(args, turn(1)); f.announcement = { text: 'Coming.' };
    await f.engine.process('job-1'); assert.equal(f.db.jobs[0].state, 'queued');
    await f.make().tick(); assert.equal(f.db.jobs[0].state, 'delivered'); assert.equal(f.calls.filter(x => x === 'queue').length, 1);
    const g = fixture(); await g.engine.request(args, turn(1));
    await g.d.update(db => Object.assign(db.jobs[0], { state: 'submitting', videoCharge: true }));
    g.receipts['job-1'] = { queue_id: 'confirmed-before-close', model: VIDEO_MODEL };
    await g.make().tick(); assert.equal(g.db.jobs[0].state, 'delivered'); assert.equal(g.calls.includes('queue'), false);
});
test('reload during a paid still never creates a replacement still', async () => {
    const f = fixture(); await f.engine.request(args, turn(1));
    await f.d.update(db => Object.assign(db.jobs[0], { state: 'preparing', stillCharge: true }));
    await f.make().tick(); assert.deepEqual(f.calls, []);
    f.advance(JOB_TTL + 1); await f.make().tick(); assert.equal(f.db.jobs[0].state, 'abandoned'); assert.equal(chargedUSD(f.db.jobs[0]), .1);
});
test('rolling cap, local calendar-day count, reservations and actual spend are independent bounds', () => {
    const f = fixture(), db = f.db, now = f.d.now();
    db.jobs = Array.from({ length: 6 }, (_, i) => ({ created: now, kind: 'companion', state: 'delivered', stillCharge: true, videoCharge: true, stillUSD: .1, videoUSD: .55 }));
    assert.throws(() => budget(db, now, .65), /submission limit/);
    db.jobs.forEach(j => j.created -= DAY);
    assert.equal(budget(db, now, .65).dailyCount, 0);
    db.videoConfig.monthlyCount = 6; assert.throws(() => budget(db, now, .65), /submission limit/);
    db.jobs = []; db.videoConfig.dailyUSD = .6; assert.throws(() => budget(db, now, .65), /spending limit/);
});
test('retention deletes only terminal owned assets and leaves pending jobs untouched', async () => {
    const f = fixture(); await f.engine.request(args, turn(1)); f.announcement = { text: 'Coming.' }; await f.engine.tick();
    f.advance(31 * DAY); await f.engine.retention();
    assert.equal(f.db.jobs[0].state, 'expired'); assert.ok(f.db.jobs[0].source.deletedAt); assert.ok(f.db.jobs[0].saved.deletedAt);
    assert.equal(f.calls.filter(x => x.startsWith('delete:')).length, 2);
    await f.engine.retention(); assert.equal(f.calls.filter(x => x.startsWith('delete:')).length, 2);
});
test('announcement requires this exact tool result and a subsequent assistant line, never an older message', () => {
    const job = { id: 'job-1' }, old = { is_user: false, mes: 'Old line.' };
    const tool = { is_system: true, extra: { tool_invocations: [{ name: VIDEO_TOOL, result: JSON.stringify({ id: 'job-1' }) }] } };
    assert.equal(findAnnouncement([old, tool], job), null);
    assert.equal(findAnnouncement([old, tool, { is_user: true, mes: 'New message' }], job), 'abort');
    assert.equal(findAnnouncement([old, tool, { is_user: false, mes: 'Sending a clip.' }], job).text, 'Sending a clip.');
    assert.equal(findAnnouncement([old, { ...tool, extra: { tool_invocations: [{ name: VIDEO_TOOL, result: '{"id":"another"}' }] } }, old], job), null);
});
test('shared image preparation lock releases even when the video still throws', async () => {
    const bridge = createBridge({ getContext: () => ({}), getSettings: () => ({}) });
    await assert.rejects(bridge.withVideoStillLock(async () => {
        assert.equal(bridge.busy, true);
        await assert.rejects(bridge.withVideoStillLock(async () => {}), /already being prepared/);
        throw new Error('still failed');
    }), /still failed/);
    assert.equal(bridge.busy, false);
    assert.equal(await bridge.withVideoStillLock(async () => 'ready'), 'ready');
});
