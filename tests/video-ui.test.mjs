import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as core from '../video-core.mjs';
import * as rig from '../video-rig-core.mjs';

// Minimal DOM contract: executes the actual panel handlers without claiming browser layout coverage.
class Element {
    constructor() { this.style = {}; this.nodes = new Map(); this.listeners = {}; this.children = []; this.checked = false; this._value = ''; }
    set value(v) { this._value = String(v); } get value() { return this._value; }
    set innerHTML(s) {
        for (const match of s.matchAll(/\b(data-[\w-]+)(?:="([^"]*)")?/g)) {
            const key = `[${match[1]}${match[2] === undefined ? '' : `="${match[2]}"`}]`;
            this.nodes.set(key, new Element());
        }
    }
    querySelector(s) { assert.ok(this.nodes.has(s), `Missing fixture element ${s}`); return this.nodes.get(s); }
    querySelectorAll(s) { return [...this.nodes].filter(([k]) => s.includes('data-field') ? k.startsWith('[data-field=') : k.startsWith('[data-field=') || k === '[data-report]').map(([,v]) => v); }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
}
async function fixture() {
    let db = { jobs: [], videoModels: [{id:rig.VIDEO_MODEL,model_spec:{name:'Wan',constraints:{durations:['5s','10s','15s'],resolutions:['720p','1080p']}}},{id:'other-image-to-video',model_spec:{name:'Other',constraints:{durations:['10s','15s'],resolutions:[]}}}], videoConfig: structuredClone(core.VIDEO_DEFAULTS) }, calls = 0, readFails = false;
    const container = new Element(), timers = new Map(), events = new Map(), checks = {}, tools = [];
    const target = { avatar: 'Ava.png', chatId: 'chat', name: 'Ava' };
    const d = {
        cached: () => structuredClone(db), read: async () => { if (readFails) throw Object.assign(new Error('SillyTavern /api/settings/get: signal timed out'), { name: 'TimeoutError' }); return structuredClone(db); },
        update: async fn => { const next = structuredClone(db); fn(next); db = next; }, target: () => target, assertTarget: () => {},
        prepare: async () => ({ still: { usd: .06 }, videoUSD: .64 }),
        availability: () => ({ ready: !!db.videoConfig.characters['Ava.png'], companionEnabled: !!db.videoConfig.characters['Ava.png'], reason: db.videoConfig.characters['Ava.png'] ? 'Video tool READY' : 'Video is OFF' }),
        ready: () => !!db.videoConfig.characters['Ava.png'], report: () => JSON.stringify({ checks, availability: d.availability(), jobs: db.jobs }),
        referencePreview: () => [{ label: 'Ava', url: '/user/files/ava.png' }],
        recordCheck: (k,v) => checks[k] = v, turn: async () => ({ id: 'turn' }), stop: async () => {},
    };
    const engine = { tick: async () => { calls++; }, retention: async () => {}, request: async () => { calls++; return { id: 'job', state: 'awaiting_reply' }; } };
    const sandbox = vm.createContext({ console, Date, document: { createElement: () => new Element(), getElementById: () => ({ querySelector: () => container }), addEventListener: (k,fn) => events.set(k,fn) },
        setTimeout: (fn, delay) => { const id = timers.size + 1; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) });
    const module = new vm.SourceTextModule(await readFile(new URL('../video-ui.mjs', import.meta.url), 'utf8'), { context: sandbox });
    const imports = { './video-host.mjs': { createCompanionHost: () => d }, './video-core.mjs': { ...core, createCompanionVideo: () => engine }, './video-rig-core.mjs': { ...rig, createVideoRig: () => ({}) } };
    await module.link(path => {
        const values = imports[path]; assert.ok(values, path);
        return new vm.SyntheticModule(Object.keys(values), function () { Object.entries(values).forEach(([k,v]) => this.setExport(k,v)); }, { context: sandbox });
    }); await module.evaluate();
    await module.namespace.mountCompanionVideo({ isGenerating: () => false, getContext: () => ({ registerFunctionTool: t => tools.push(t) }), eventSource: { on: (k,fn) => events.set(k,fn) }, event_types: { GENERATION_STOPPED: 'stopped', CHAT_CHANGED: 'chat', GENERATION_ENDED: 'ended' } });
    const root = container.children[0], $ = s => root.querySelector(s);
    return { $, tools, timers, checks, engine, events, get db() { return db; }, get calls() { return calls; }, failReads: () => readFails = true };
}
test('manual form requires a matching quote, invalidates on edits/chat switches and reserves only on explicit start', async () => {
    const f = await fixture(); let submitted = 0, received;
    f.engine.quoteManual = async args => { received = args; return { id: 'manual', totalUSD: .7, ticket: { still: { usd: .06 }, videoUSD: .64 } }; };
    f.engine.requestManual = async q => { assert.equal(q.id, 'manual'); submitted++; return { id: q.id, state: 'prepared' }; };
    for (const [k,v] of Object.entries({ subject: 'together', scene: 'A room.', motion: 'Wave.', aspect_ratio: '16:9', duration: 10 })) f.$(`[data-manual="${k}"]`).value = v;
    await f.$('[data-action="manual-quote"]').onclick();
    assert.equal(received.subject, 'together'); assert.equal(received.duration, 10); assert.equal(submitted, 0);
    assert.equal(f.$('[data-action="manual-start"]').disabled, false);
    f.$('[data-manual="scene"]').listeners.input(); assert.equal(f.$('[data-action="manual-start"]').disabled, true);
    await f.$('[data-action="manual-quote"]').onclick(); f.events.get('chat')();
    assert.equal(f.$('[data-action="manual-start"]').disabled, true);
    await f.$('[data-action="manual-quote"]').onclick();
    await f.$('[data-action="manual-start"]').onclick();
    assert.equal(submitted, 1); assert.equal(f.$('[data-action="manual-start"]').disabled, true);
    await f.$('[data-action="manual-start"]').onclick(); assert.equal(submitted, 1);
});
test('editing while a live quote is pending cannot authorise stale form content', async () => {
    const f = await fixture(); let release;
    f.engine.quoteManual = () => new Promise(r => release = r);
    const pending = f.$('[data-action="manual-quote"]').onclick();
    f.$('[data-manual="subject"]').listeners.input();
    release({ totalUSD: .7, ticket: { still: { usd: .06 }, videoUSD: .64 } }); await pending;
    assert.equal(f.$('[data-action="manual-start"]').disabled, true);
});
test('actual quote handler preserves checked Enable and audio/resolution edits without enabling until Save', async () => {
    const f = await fixture();
    f.$('[data-field="enabled"]').checked = true; f.$('[data-field="enabled"]').listeners.change();
    f.$('[data-field="resolution"]').value = '1080p';
    await f.$('[data-action="quote"]').onclick();
    assert.equal(f.$('[data-field="enabled"]').checked, true);
    assert.equal(f.$('[data-field="resolution"]').value, '1080p');
    assert.equal(f.db.videoConfig.characters['Ava.png'], undefined);
    assert.equal(f.$('[data-field="dailyUSD"]').value, '4.2'); assert.equal(f.$('[data-field="monthlyUSD"]').value, '63');
    assert.equal(f.calls, 0);
    await f.$('[data-action="save"]').onclick();
    assert.equal(f.db.videoConfig.characters['Ava.png'], true); assert.equal(f.tools[0].shouldRegister(), true);
    assert.match(f.$('[data-availability]').textContent, /READY/);
});
test('idle panel does not invoke full job recovery and keeps background timeouts separate from saved status', async () => {
    const f = await fixture();
    const timer = [...f.timers.values()][0]; await timer.fn(); assert.equal(f.calls, 0);
    assert.equal([...f.timers.values()].at(-1).delay, 60000);
    const status = f.$('[data-status]').textContent; f.failReads();
    await [...f.timers.values()].at(-1).fn();
    assert.equal(f.$('[data-status]').textContent, status); assert.match(f.$('[data-background]').textContent, /SillyTavern \/api\/settings\/get/);
});
test('tool diagnostics distinguish unavailability from a successful reservation without exposing arguments', async () => {
    const f = await fixture(); await assert.rejects(f.tools[0].action({ scene: 'private' }), /OFF/);
    assert.equal(f.checks.lastToolAttempt.state, 'failed-before-job-or-submission'); assert.equal(f.calls, 0);
    f.$('[data-field="enabled"]').checked = true; await f.$('[data-action="quote"]').onclick(); await f.$('[data-action="save"]').onclick();
    await f.tools[0].action({ scene: 'private' });
    assert.equal(f.checks.lastToolAttempt.state, 'awaiting_reply'); assert.equal(JSON.stringify(f.checks).includes('private'), false);
});

test('shared video model save applies duration and fixed resolution without enabling companion tools or raising budgets', async () => {
    const f = await fixture();
    f.$('[data-field="model"]').value = 'other-image-to-video'; f.$('[data-field="model"]').listeners.change();
    f.$('[data-field="duration"]').value = '15';
    await f.$('[data-action="save-model"]').onclick();
    assert.equal(f.db.videoConfig.model,'other-image-to-video'); assert.equal(f.db.videoConfig.duration,15);
    assert.equal(f.db.videoConfig.resolution,''); assert.equal(f.db.videoConfig.dailyUSD,null);
    assert.equal(f.db.videoConfig.characters['Ava.png'],undefined);
    assert.equal(f.tools[0].parameters.properties.duration.minimum,10);
    assert.match(f.$('[data-model-status]').textContent,/Saved other-image-to-video/);
});
