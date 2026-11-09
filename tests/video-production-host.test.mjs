import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as core from '../video-core.mjs';
import * as rig from '../video-rig-core.mjs';
import * as portraits from '../portraits.mjs';
import * as models from '../models.mjs';
import * as images from '../core.mjs';

test('actual companion host freezes reference identity, prepares a fresh still and submits only its verified bytes', async () => {
    const calls = [], loads = [], saved = new Map();
    const png = new Blob([Buffer.from('89504e470d0a1a0a00000000', 'hex')], { type: 'image/png' });
    const dataURL = async b => `data:${b.type};base64,${Buffer.from(await b.arrayBuffer()).toString('base64')}`;
    const digest = async b => Buffer.from(await webcrypto.subtle.digest('SHA-256', await b.arrayBuffer())).toString('hex');
    const own = { enabled: true, portraits: { 'Ava.png': { url: '/user/files/ref.png', model: 'seed', options: { aspect_ratio: '1:1' } } } };
    const context = { chatId: 'original', characterId: 0, characters: [{ avatar: 'Ava.png' }], name2: 'Ava',
        mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://api.venice.ai/api/v1' }, chat: [{ is_user: true, mes: 'A clip', send_date: 'now' }] };
    const db = { jobs: [], videoConfig: { ...core.VIDEO_DEFAULTS, characters: { 'Ava.png': true } } };
    const base = {
        target: () => ({ avatar: 'Ava.png', chatId: context.chatId, name: 'Ava' }), cached: () => db,
        api: async (path, body) => {
            calls.push({ path, body });
            if (path === '/models?type=inpaint') return new Response(JSON.stringify({ data: [{ type: 'inpaint', id: 'seed', model_spec: {
                constraints: { aspectRatios: ['1:1', '9:16'], resolutions: ['1K'], qualities: ['high'], promptCharacterLimit: 3000 },
                pricing: { quality: { '1K': { high: { usd: .1 } } } } } }] }));
            assert.equal(path, '/image/multi-edit'); return new Response(png);
        },
        catalogue: async () => ({ data: [{ id: rig.VIDEO_MODEL, model_spec: { capabilities: { supportsAudioConfig: true }, constraints: { durations: ['5s'], resolutions: ['720p'], aspect_ratios: ['9:16'] } } }] }),
        quote: async () => ({ quote: .55 }),
        saveAsset: async (job, b, name) => { const path = '/user/files/' + name; saved.set(path, b); return { path, bytes: b.size, sha256: await digest(b), verifiedAt: 1 }; },
        request: async path => new Response(saved.get(path)),
        update: async fn => fn(db), savedChat: async () => [{}, ...context.chat],
    };
    const sandbox = vm.createContext({ console, Blob, Uint8Array, atob, Date, AbortSignal, structuredClone,
        document: { hidden: false, getElementById: () => null }, createImageBitmap: async () => ({ width: 720, height: 1280, close() {} }) });
    const exports = {
        './video-rig-host.mjs': { createRigHost: () => base, dataURL, digest, localFile: x => x },
        './video-rig-core.mjs': rig, './video-core.mjs': core, './portraits.mjs': portraits, './models.mjs': models, './core.mjs': images,
    };
    const m = new vm.SourceTextModule(await readFile(new URL('../video-host.mjs', import.meta.url), 'utf8'), { context: sandbox });
    await m.link(path => {
        const values = exports[path]; assert.ok(values, path);
        return new vm.SyntheticModule(Object.keys(values), function () { Object.entries(values).forEach(([k,v]) => this.setExport(k,v)); }, { context: sandbox });
    }); await m.evaluate();
    let generating = false;
    const d = m.namespace.createCompanionHost({ getContext: () => context, getSettings: () => own, extension_settings: {},
        isGenerating: () => generating, hasPendingFileAttachment: () => false,
        loadReference: async path => { loads.push(path); return dataURL(png); }, bridge: { busy: false, initiationStatus: () => ({ ready: true }), withVideoStillLock: fn => fn() } });
    const c = core.config(db), args = { subject: 'companion', scene: 'A still beside a window.', motion: 'A blink; camera fixed.', aspect_ratio: '9:16', duration: 5 };
    const prepared = await d.prepare(args, c); assert.equal(prepared.still.usd, .1); assert.equal(prepared.videoUSD, .55);
    own.portraits['Ava.png'].url = '/user/files/different.png';
    const job = { id: 'job-1', target: base.target(), turn: await d.turn(), ...prepared, mode: prepared.plan.mode, params: prepared.plan.params };
    db.jobs.push(job);
    const fresh = await d.refreshQuote(job, c); assert.equal(fresh.still.url, '/user/files/ref.png');
    job.source = await d.renderStill(job);
    assert.deepEqual(loads, ['/user/files/ref.png']); assert.equal(own.portraits['Ava.png'].options.aspect_ratio, '1:1');
    const submission = await d.videoSubmission(job);
    assert.equal(submission.body.image_url, await dataURL(png)); assert.equal(submission.body.audio, true);
    assert.equal(submission.body.aspect_ratio, undefined); assert.equal(submission.params.aspect_ratio, '9:16');
    assert.equal(calls.filter(c => c.path.startsWith('/image/')).length, 1);
    assert.equal(calls.find(c => c.path.startsWith('/image/')).body.aspect_ratio, '9:16');
    job.source.turnId = 'old-turn'; await assert.rejects(d.videoSubmission(job), /own new still/);
    job.source.turnId = job.turn.id; saved.set(job.source.path, new Blob(['tampered'])); await assert.rejects(d.videoSubmission(job), /Starting still changed/);
    context.chatId = 'other'; assert.equal(d.canStart(job), false); context.chatId = 'original'; generating = true; assert.equal(d.canStart(job), false);
});
