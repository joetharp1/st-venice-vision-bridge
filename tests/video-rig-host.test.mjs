import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as core from '../video-rig-core.mjs';

const box = (type, payload = Buffer.alloc(0)) => { const b = Buffer.alloc(8 + payload.length); b.writeUInt32BE(b.length); b.write(type, 4); payload.copy(b, 8); return b; };
const mp4 = () => new Blob([box('ftyp', Buffer.from('isom0000')), box('moov', box('trak', box('mdia', box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from('vide')])))))], { type: 'video/mp4' });
async function fixture() {
    let server = {}, saveFails = false, wrongBytes = false;
    const files = new Map(), requests = [], memory = new Map(), lockTails = new Map();
    const ext = { 'st-venice-image': { api_key: 'fixture-secret' } };
    let chatId = 'original'; const chats = { original: [], other: [] };
    const context = { name2: 'Ava', characters: [{ avatar: 'Ava.png' }], characterId: 0, chatId,
        chat: chats.original, addOneMessage() {}, async saveChat() { chats[context.chatId] = structuredClone(context.chat); } };
    const response = (body, status = 200, type = 'application/json') => new Response(type === 'application/json' ? JSON.stringify(body) : body, { status, headers: { 'content-type': type } });
    let provider = async (url, op) => response({ quote: .55 });
    const sandbox = vm.createContext({ console, URL, Blob, Uint8Array, DataView, Number, String, Map, Set, Date, JSON, crypto: webcrypto,
        structuredClone, AbortSignal, location: { origin: 'https://st.test' }, document: { hidden: false, getElementById: () => null },
        navigator: { locks: { request: async (key, options, fn) => {
            if (options.ifAvailable && lockTails.has(key)) return fn(null);
            const before = lockTails.get(key) || Promise.resolve(); let done;
            const held = new Promise(r => done = r); lockTails.set(key, held); await before;
            try { return await fn({ name: key }); } finally { done(); if (lockTails.get(key) === held) lockTails.delete(key); }
        } } },
        localStorage: { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,v) },
        FileReader: class { readAsDataURL(blob) { blob.arrayBuffer().then(b => { this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`; this.onload(); }); } },
        fetch: async (url, op = {}) => {
            requests.push([url, op]);
            if (url.startsWith('https://api.venice.ai/')) return provider(url, op);
            const body = op.body ? JSON.parse(op.body) : {};
            if (url === '/api/settings/get') return response({ settings: JSON.stringify({ extension_settings: server }) });
            if (url === '/api/files/upload') { const path = '/user/files/' + body.name; files.set(path, Buffer.from(body.data, 'base64')); return response({ path }); }
            if (url === '/api/files/verify') return response(Object.fromEntries(body.urls.map(u => [u, files.has(u)])));
            if (url === '/api/chats/get') return response([{ chat_metadata: {} }, ...chats[body.file_name]]);
            if (files.has(url)) return response(wrongBytes ? Buffer.from('bad') : files.get(url), 200, 'video/mp4');
            if (url.startsWith('https://delivery.test/')) { assert.equal(op.headers?.Authorization, undefined); return response(await mp4().arrayBuffer(), 200, 'video/mp4'); }
            throw new Error('Unexpected request ' + url);
        },
    });
    const module = new vm.SourceTextModule(await readFile(new URL('../video-rig-host.mjs', import.meta.url), 'utf8'), { context: sandbox });
    await module.link(specifier => {
        const exports = specifier === '../../../user.js' ? { getCurrentUserHandle: () => 'test-profile' } : core;
        return new vm.SyntheticModule(Object.keys(exports), function () { for (const [k,v] of Object.entries(exports)) this.setExport(k,v); }, { context: sandbox });
    }); await module.evaluate();
    const host = { extension_settings: ext, getContext: () => context, isGenerating: () => false, hasPendingFileAttachment: () => false,
        getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'fixture-csrf' }),
        saveSettings: async () => { if (!saveFails) server = structuredClone(ext); },
        getMessageTimeStamp: () => 'fixture', MEDIA_TYPE: { VIDEO: 'video' }, MEDIA_SOURCE: { GENERATED: 'generated' }, MEDIA_DISPLAY: { GALLERY: 'gallery' } };
    const d = module.namespace.createRigHost(host);
    return { d, host, api: module.namespace, requests, files, ext, chats, context,
        get server() { return server; }, failSave: b => saveFails = b, badBytes: b => wrongBytes = b, provider: fn => provider = fn,
        reopen: () => module.namespace.createRigHost({ ...host, extension_settings: structuredClone(server) }) };
}
const job = () => ({ id: 'test-id', model: core.VIDEO_MODEL, queueId: 'test-queue', fileName: 'venice_video_test_test-id.mp4', target: { avatar: 'Ava.png', chatId: 'original', name: 'Ava' } });

test('real host commits server jobs, restores after reopening, and rolls back memory on unconfirmed save', async () => {
    const f = await fixture();
    await f.d.update(db => db.jobs.push({ ...job(), state: 'queued' }));
    assert.equal(f.server[core.RIG_KEY].jobs[0].queueId, 'test-queue');
    assert.equal((await f.reopen().read()).jobs[0].queueId, 'test-queue');
    const before = structuredClone(f.ext[core.RIG_KEY]); f.failSave(true);
    await assert.rejects(f.d.update(db => db.jobs[0].state = 'failed'), /not confirmed/);
    assert.deepEqual(f.ext[core.RIG_KEY], before);
});
test('real file adapter uploads base64, verifies URL-keyed response and hash, and registers disabled media', async () => {
    const f = await fixture(), j = job();
    const saved = await f.d.saveVideo(j, mp4());
    assert.equal(saved.audioTracks, 0); assert.match(saved.sha256, /^[a-f0-9]{64}$/);
    assert.ok(f.server.disabled_attachments.includes(saved.path));
    assert.equal(f.server.attachments[0].venice_video_rig.id, j.id);
    const upload = f.requests.find(r => r[0] === '/api/files/upload');
    assert.equal(upload[1].headers['X-CSRF-Token'], 'fixture-csrf');
    f.badBytes(true); await assert.rejects(f.d.saveVideo(j, mp4()), /bytes do not match/);
});
test('provider auth stays on Venice origin and signed download is fetched without bearer credentials', async () => {
    const f = await fixture();
    f.provider(async (url, op) => {
        assert.equal(op.headers.Authorization, 'Bearer fixture-secret');
        return new Response(JSON.stringify({ status: 'COMPLETED' }), { headers: { 'content-type': 'application/json' } });
    });
    const result = await f.d.retrieve({ ...job(), downloadUrl: 'https://delivery.test/private' });
    assert.ok(result.blob.size > 0);
});
test('real chat adapter waits for original chat, attaches one video and verifies saved marker without duplicate', async () => {
    const f = await fixture(), j = job(); j.saved = await f.d.saveVideo(j, mp4());
    f.context.chatId = 'other'; f.context.chat = f.chats.other;
    assert.equal(await f.d.attach(j), false);
    f.context.chatId = 'original'; f.context.chat = f.chats.original;
    assert.equal(await f.d.attach(j), true); assert.equal(await f.d.attach(j), true);
    assert.equal(f.chats.original.length, 1); assert.equal(f.chats.other.length, 0);
    assert.equal(f.chats.original[0].extra.media[0].type, 'video');
    assert.equal(f.chats.original[0].is_system, true);
});
test('saved MP4 validation rejects HTML and local/download paths reject traversal and private hosts', async () => {
    const f = await fixture();
    await assert.rejects(f.api.inspectMP4(new Blob(['<html>error</html>'])), /other than an MP4/);
    for (const url of ['https://elsewhere.test/user/files/a.mp4','/user/files/../files/a.mp4','/user/files/%2e%2e/files/a.mp4']) assert.throws(() => f.api.localFile(url));
    for (const url of ['http://delivery.test/a','https://127.0.0.1/a','https://172.16.1.1/a','https://host.local/a']) assert.throws(() => f.api.privateDownload(url));
});
test('explicit provider rejection is distinguishable from authentication outage', async () => {
    const f = await fixture();
    f.provider(async () => new Response(JSON.stringify({error:{message:'Access denied fixture-secret'}}), {status:401}));
    await assert.rejects(f.d.quote({}), e => { assert.equal(e.providerFailure, false); assert.ok(!e.message.includes('fixture-secret')); return true; });
    f.provider(async () => new Response(JSON.stringify({error:{message:'Rejected',type:'provider_content_policy',credits_refunded:true}}), {status:422}));
    await assert.rejects(f.d.retrieve(job()), e => e.providerFailure === true && e.refunded === true);
});
