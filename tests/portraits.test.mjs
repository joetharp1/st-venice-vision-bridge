import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../runtime.mjs';
import { parseModels, fetchModels } from '../models.mjs';
import { portraitPlan, attachPortrait, editedImage, portraitPrice, loadPortrait } from '../portraits.mjs';
const png = 'data:image/png;base64,' + btoa('\x89PNG\r\n\x1a\nfixture');
const jpg = 'data:image/jpeg;base64,' + btoa('\xff\xd8\xfffixture');
const catalogue = { data: [
    { id: 'ref-model', type: 'inpaint', model_spec: { name: 'Reference', constraints: { aspectRatios: ['1:1', '2:3'], defaultAspectRatio: '2:3' }, pricing: { inpaint: { usd: 0.03 } } } },
    { id: 'tier-ref', type: 'inpaint', model_spec: { constraints: { aspectRatios: ['1:1'], resolutions: ['1K', '2K'], defaultResolution: '1K', qualities: ['low', 'high'], defaultQuality: 'low' }, pricing: { quality: { '1K': { low: { usd: 0.04 } } }, inputImages: { included: 0, additional: { usd: 0.01 } } } } },
    { id: 'ordinary', type: 'image' },
] };
function setup() {
    const own = { enabled: true, characters: { 'A.png': true, 'B.png': true }, editModels: parseModels(catalogue, 'inpaint'), portraits: {
        'A.png': { url: '/user/images/A/original.png', model: 'ref-model' },
        'B.png': { url: '/user/images/B/original.jpg', model: 'tier-ref' },
    } };
    const makeContext = i => ({ mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://api.venice.ai/api/v1', media_inlining: true, function_calling: true }, characters: [{ avatar: 'A.png' }, { avatar: 'B.png' }], characterId: i, name2: i ? 'B' : 'A', chatId: String(i), chat: [{ is_user: true, mes: 'picture' }] });
    let context = makeContext(0);
    const legacy = { api_key: 'fake', model: 'ordinary', width: 1024, height: 1024, safe_mode: true, negative_prompt: 'blurry' };
    const calls = [], reads = [], saved = [], posted = [];
    const deps = { getContext: () => context, getSettings: () => own, getGeneratorSettings: () => legacy,
        loadReference: async url => { reads.push(url); return url.includes('/A/') ? png : jpg; },
        fetch: async (url, o) => { calls.push({ url, body: JSON.parse(o.body), headers: o.headers }); return { ok: true, blob: async () => new Blob([Uint8Array.from(atob(png.split(',')[1]), c => c.charCodeAt(0))]), json: async () => ({ images: ['ordinary-image'] }) }; },
        saveImage: async (...args) => { saved.push(args); return '/user/images/saved.png'; },
        publishImage: async p => { posted.push(p); p.context.chat.push({ extra: { venice_bridge: { via_tool: !p.manual } } }); },
    };
    return { own, legacy, deps, calls, reads, saved, posted, get c() { return context; }, switch: i => { context = makeContext(i); }, next: () => { context.chat.push({ is_user: true, mes: 'next' }); } };
}

test('editing catalogue is independently fetched; filters out generation and cannot choose arbitrary endpoints', async () => {
    const models = await fetchModels(async (url, o) => {
        assert.equal(url, 'https://api.venice.ai/api/v1/models?type=inpaint'); assert.equal(o.method, 'GET');
        return { ok: true, json: async () => catalogue };
    }, 'fake', 'inpaint');
    assert.equal(models.length, 2);
    await assert.rejects(fetchModels(() => assert.fail(), 'fake', 'evil'), /Unsupported/);
});
test('portrait sends own fixed bytes and strict single-edit body; model arguments cannot swap source, model or safety', async () => {
    const h = setup(), b = createBridge(h.deps);
    await b.portraitTool().action({ prompt: 'By a window', image: jpg, model: 'evil', safe_mode: false });
    const call = h.calls[0];
    assert.equal(call.url, 'https://api.venice.ai/api/v1/image/edit');
    assert.deepEqual(Object.keys(call.body).sort(), ['aspect_ratio', 'image', 'model', 'output_format', 'prompt', 'safe_mode']);
    assert.equal(call.body.image, png); assert.equal(call.body.model, 'ref-model'); assert.equal(call.body.safe_mode, true);
    assert.ok(!JSON.stringify(call.body).includes('/user/'));
    assert.equal(h.saved[0][1], 'A'); assert.equal(h.saved[0][2], 'png'); assert.equal(h.posted[0].portrait, true);
    assert.equal(h.posted[0].prompt, 'By a window');
});
test('different character uses different source and quality multi-edit contract; both keep originals across turns', async () => {
    const h = setup(), b = createBridge(h.deps);
    await b.portraitTool().action({ prompt: 'At a table' }); h.next();
    await b.portraitTool().action({ prompt: 'In a garden' }); h.switch(1);
    await b.portraitTool().action({ prompt: 'At the seaside' });
    assert.deepEqual(h.reads, ['/user/images/A/original.png', '/user/images/A/original.png', '/user/images/B/original.jpg']);
    const call = h.calls[2]; assert.equal(call.url, 'https://api.venice.ai/api/v1/image/multi-edit');
    assert.equal(call.body.modelId, 'tier-ref'); assert.deepEqual(call.body.images, [jpg]); assert.equal(call.body.quality, 'low');
    assert.equal(call.body.resolution, '1K'); assert.ok(!('model' in call.body));
    assert.equal(h.own.portraits['A.png'].url, '/user/images/A/original.png');
});
test('ordinary generation never attaches a portrait; attempts shared across both tools and after reload', async () => {
    const h = setup(), b = createBridge(h.deps);
    await b.generate({ prompt: 'A landscape' }); assert.equal(h.reads.length, 0); assert.equal(h.calls[0].body.image, undefined);
    await assert.rejects(b.portraitTool().action({ prompt: 'Selfie' }), /One image attempt/);
    h.next(); await b.portraitTool().action({ prompt: 'Selfie' });
    await assert.rejects(createBridge(h.deps).generate({ prompt: 'Another' }), /One image attempt/);
});
test('failed provider call never retries or falls back to a different model', async () => {
    const h = setup(); let calls = 0;
    h.deps.fetch = async () => { calls++; return { ok: false, status: 422 }; };
    const b = createBridge(h.deps);
    await assert.rejects(b.portraitTool().action({ prompt: 'Test' }), /HTTP 422/);
    await assert.rejects(b.generate({ prompt: 'Fallback' }), /One image attempt/);
    assert.equal(calls, 1); assert.equal(h.posted.length, 0);
});
test('missing source, invalid bytes, offline/missing models and long prompt stop before paid call', async () => {
    const h = setup(); h.deps.loadReference = async () => { throw new Error('missing portrait'); };
    await assert.rejects(createBridge(h.deps).portraitTool().action({ prompt: 'Test' }), /missing portrait/);
    assert.equal(h.calls.length, 0);
    assert.throws(() => attachPortrait(portraitPlan(h.own, 'A.png', h.legacy, { prompt: 'a' }), 'https://external/image.png'), /PNG/);
    h.own.portraits['A.png'].model = 'missing';
    assert.throws(() => portraitPlan(h.own, 'A.png', h.legacy, { prompt: 'a' }), /Choose a reference/);
    h.own.portraits['A.png'].model = 'ref-model'; h.own.editModels[0].offline = true;
    assert.throws(() => portraitPlan(h.own, 'A.png', h.legacy, { prompt: 'a' }), /offline/);
    h.own.editModels[0].offline = false;
    assert.throws(() => portraitPlan(h.own, 'A.png', h.legacy, { prompt: 'x'.repeat(1490) }), /including/);
});
test('switch or cancel during reference load prevents paid request; concurrent manual call blocked', async () => {
    for (const mode of ['switch', 'cancel']) {
        const h = setup(); let finish;
        h.deps.loadReference = () => new Promise(r => { finish = r; });
        const b = createBridge(h.deps), pending = b.portraitTool().action({ prompt: 'Test' });
        await assert.rejects(b.generatePortraitManual({ prompt: 'double' }), /already/);
        if (mode === 'switch') h.switch(1); else b.cancel();
        finish(png); await assert.rejects(pending, /No image request/); assert.equal(h.calls.length, 0);
    }
});
test('switch during paid editing saves in original gallery and never posts to new chat', async () => {
    const h = setup(); let finish, started;
    const startedPromise = new Promise(r => { started = r; });
    h.deps.fetch = async () => { started(); return new Promise(r => { finish = r; }); };
    const b = createBridge(h.deps), pending = b.portraitTool().action({ prompt: 'Test' });
    await startedPromise; h.switch(1);
    finish({ ok: true, blob: async () => new Blob([Uint8Array.from(atob(png.split(',')[1]), c => c.charCodeAt(0))]) });
    await assert.rejects(pending, /chat changed/); assert.equal(h.saved[0][1], 'A'); assert.equal(h.posted.length, 0);
});
test('portrait tool registration respects configured character, groups and function calling; manual keeps its existing permission', async () => {
    const h = setup(), b = createBridge(h.deps);
    assert.equal(b.portraitReady(), true);
    delete h.own.portraits['A.png']; assert.equal(b.portraitReady(), false);
    h.switch(1); assert.equal(b.portraitReady(), true);
    h.c.groupId = 'group'; assert.equal(b.portraitReady(), false); delete h.c.groupId;
    h.c.chatCompletionSettings.function_calling = false; assert.equal(b.portraitReady(), false);
    await b.generatePortraitManual({ prompt: 'Test' }); assert.equal(h.posted[0].manual, true);
});
test('actual binary format retained; non-image responses rejected; single reference surcharge included', async () => {
    for (const [raw, extension] of [[png, 'png'], [jpg, 'jpg']]) {
        const output = await editedImage({ blob: async () => new Blob([Uint8Array.from(atob(raw.split(',')[1]), c => c.charCodeAt(0))]) });
        assert.equal(output.extension, extension); assert.equal(output.base64, raw.split(',')[1]);
    }
    await assert.rejects(editedImage({ blob: async () => new Blob(['{"error":"bad"}']) }), /unsupported/);
    const h = setup(), model = h.own.editModels.find(m => m.id === 'tier-ref');
    assert.match(portraitPrice(model, { resolution: '1K', quality: 'low' }), /\$0.05/);
});
test('reference loader never fetches external addresses and sends no API key to local media', async () => {
    await assert.rejects(loadPortrait('https://evil.example/pic.png', 'https://st.example', () => assert.fail(), null), /local SillyTavern/);
    await assert.rejects(loadPortrait('/user/images/A/face.png', 'https://st.example', async (url, o) => {
        assert.equal(url, '/user/images/A/face.png'); assert.equal(o.headers, undefined); assert.equal(o.redirect, 'error');
        return { ok: false };
    }, null), /could not be read/);
});

test('personal reference supports user alone and two distinct ordered sources with the user-selected model', async () => {
    const h=setup();
    h.own.portraits.__human_reference__={url:'/user/files/joe.jpg',model:'tier-ref'};
    h.own.editModels.find(m=>m.id==='tier-ref').constraints.combineImages=true;
    const b=createBridge(h.deps);assert.equal(b.userPortraitReady(),true);
    await b.userPortraitTool().action({prompt:'At a table'});
    assert.deepEqual(h.reads,['/user/files/joe.jpg']);assert.deepEqual(h.calls[0].body.images,[jpg]);
    await assert.rejects(b.portraitTool().action({prompt:'Selfie'}),/One image attempt/);
    h.next();await b.userPortraitTool().action({prompt:'Together on a sofa',include_character:true,image:png,model:'ignored'});
    assert.deepEqual(h.reads.slice(1),['/user/files/joe.jpg','/user/images/A/original.png']);
    assert.deepEqual(h.calls[1].body.images,[jpg,png]);assert.equal(h.calls[1].body.modelId,'tier-ref');
    assert.ok(h.calls[1].body.prompt.startsWith('Reference image 1 is the human user. Reference image 2 is the current companion.'));
    assert.equal(h.calls[1].body.safe_mode,true);assert.ok(!JSON.stringify(h.calls[1].body).includes('/user/'));
    assert.equal(h.own.portraits['A.png'].url,'/user/images/A/original.png');
    h.switch(1);await b.generateUserPortraitManual({prompt:'Together in a garden',include_character:true});
    assert.deepEqual(h.reads.slice(-2),['/user/files/joe.jpg','/user/images/B/original.jpg']);
});
test('together validates model capability and both references before charging, never falls back',async()=>{
    const h=setup(),b=createBridge(h.deps);
    assert.equal(b.userPortraitReady(),false);
    await assert.rejects(b.generateUserPortraitManual({prompt:'Test'}),/own reference/);
    h.own.portraits.__human_reference__={url:'/user/files/joe.jpg',model:'ref-model'};
    await assert.rejects(b.generateUserPortraitManual({prompt:'Test',include_character:true}),/supporting two/);
    const m=h.own.editModels.find(m=>m.id==='ref-model');m.constraints.combineImages=false;m.constraints.maxInputImages=6;
    await assert.rejects(b.generateUserPortraitManual({prompt:'Test',include_character:true}),/supporting two/);
    m.constraints.combineImages=true;m.constraints.maxInputImages=1;
    await assert.rejects(b.generateUserPortraitManual({prompt:'Test',include_character:true}),/supporting two/);
    m.constraints.maxInputImages=3;delete h.own.portraits['A.png'].url;
    await assert.rejects(b.generateUserPortraitManual({prompt:'Test',include_character:true}),/current companion/);
    assert.equal(h.calls.length,0);
});
test('switch during second reference read prevents a paid request or publication to the new chat',async()=>{
    const h=setup();h.own.portraits.__human_reference__={url:'/user/files/joe.jpg',model:'tier-ref'};
    h.own.editModels.find(m=>m.id==='tier-ref').constraints.combineImages=true;
    let finish,started;const reading=new Promise(r=>started=r);
    h.deps.loadReference=async url=>url.includes('joe')?jpg:new Promise(r=>{finish=r;started();});
    const b=createBridge(h.deps),pending=b.generateUserPortraitManual({prompt:'Together',include_character:true});
    await reading;h.switch(1);finish(png);await assert.rejects(pending,/No image request/);assert.equal(h.calls.length,0);
});
test('two-reference listed cost includes per-input charges; existing one-reference estimate remains',()=>{
    const model={pricing:{inpaint:{usd:.04},inputImages:{included:0,additional:{usd:.01}}}};
    assert.match(portraitPrice(model,{},2),/\$0.06/);assert.match(portraitPrice(model,{},1),/\$0.05/);
    model.pricing.inputImages.included=1;assert.match(portraitPrice(model,{},2),/\$0.05/);
});
