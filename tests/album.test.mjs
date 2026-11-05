import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlbum } from '../album-runtime.mjs';
import { ALBUM_TAG, imageData, localImagePath, visibleRecords, searchRecords, chatPictures } from '../album-core.mjs';
import { adaptAssistantImages } from '../core.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture() {
    let serial = 0, disk, writes = 0, published = [];
    const state = { attachments: [], character_attachments: {}, disabled_attachments: [],
        bridge: { enabled: true, albumCharacters: { 'A.png': true, 'B.png': true } } };
    let context = { mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://api.venice.ai/api/v1', media_inlining: true, function_calling: true },
        characters: [{ avatar: 'A.png' }, { avatar: 'B.png' }], characterId: 0, name2: 'A', chatId: 'one', chat: [{ is_user: true, mes: 'Hello' }] };
    const deps = { getContext: () => context, getBridgeSettings: () => state.bridge, getAllSettings: () => state,
        uuid: () => `id-${++serial}`, persist: async () => { disk = structuredClone(state); },
        upload: async (_, name) => { writes++; return `user/files/${name}`; }, checkImage: async () => {},
        publish: async ({ record, context: c, isCurrent }) => {
            assert.ok(isCurrent());
            c.chat.push({ is_user: false, extra: { venice_album_open: record[ALBUM_TAG].id, media: [{ url: record.url, type: 'image' }] } }); published.push(record);
        } };
    return { state, deps, album: createAlbum(deps), get disk() { return disk; }, get writes() { return writes; }, get published() { return published; },
        get context() { return context; }, set context(value) { context = value; } };
}

test('saves independent file copy and durable disabled attachment; original settings preserved', async () => {
    const f = fixture(); f.state.existing = 'keep';
    const record = await f.album.save({ dataUrl: png, title: 'Portrait', notes: 'Green eyes' });
    assert.equal(f.writes, 1); assert.equal(f.state.existing, 'keep');
    assert.equal(record.owner, 'A.png'); assert.equal(f.disk.character_attachments['A.png'][0][ALBUM_TAG].title, 'Portrait');
    assert.ok(f.disk.disabled_attachments.includes(record.url));
    // Mirrors 1.19.0 DataMaid #collectFiles: registered files are retained even disabled.
    const retained = Object.values(f.disk.character_attachments).flat().map(x => x.url).concat(f.disk.attachments.map(x => x.url));
    assert.ok(retained.includes(record.url));
});

test('private and shared scope survive new chats and settings reload; no cross-character access', async () => {
    const f = fixture(); const privateRecord = await f.album.save({ dataUrl: png, title: 'My portrait' });
    const shared = await f.album.save({ dataUrl: png, title: 'Kitchen', shared: true });
    f.context = { ...f.context, chatId: 'new', chat: [{ is_user: true, mes: 'Remember?' }] };
    const restored = createAlbum({ ...f.deps, getAllSettings: () => f.disk });
    assert.equal(restored.list().total, 2);
    await restored.open(privateRecord[ALBUM_TAG].id, true);
    f.context = { ...f.context, characterId: 1, name2: 'B', chat: [{ is_user: true, mes: 'Hi' }] };
    assert.equal(restored.list().total, 1);
    await assert.rejects(restored.open(privateRecord[ALBUM_TAG].id, true), /not in this character/);
    await restored.open(shared[ALBUM_TAG].id, true);
});

test('tool open posts real media; existing bridge adapts it after tool results', async () => {
    const f = fixture(); const r = await f.album.save({ dataUrl: png, title: 'Window' });
    const tools = f.album.tools();
    const found = JSON.parse(tools[0].action({ query: 'window' })); assert.equal(found.pictures[0].id, r[ALBUM_TAG].id);
    await tools[1].action({ id: r[ALBUM_TAG].id });
    assert.equal(f.published[0].url, r.url);
    const input = [{ role: 'assistant', tool_calls: [{ id: 'call' }], content: [{ type: 'image_url', image_url: { url: r.url } }] }, { role: 'tool', tool_call_id: 'call', content: 'opened' }];
    const result = adaptAssistantImages(input);
    assert.equal(result.messages[1].role, 'tool'); assert.equal(result.messages[2].role, 'user');
    assert.equal(result.messages[2].content[1].image_url.url, r.url);
});

test('guards: function calling, inline images, connection, per-character toggle and group', () => {
    const f = fixture(); assert.equal(f.album.ready(), true);
    for (const key of ['function_calling', 'media_inlining']) { f.context.chatCompletionSettings[key] = false; assert.equal(f.album.ready(), false); f.context.chatCompletionSettings[key] = true; }
    f.state.bridge.albumCharacters['A.png'] = false; assert.equal(f.album.ready(), false); f.state.bridge.albumCharacters['A.png'] = true;
    f.context.groupId = 'group'; assert.equal(f.album.ready(), false); delete f.context.groupId;
    f.context.chatCompletionSettings.custom_url = 'https://other.example/api/v1'; assert.equal(f.album.ready(), false);
});

test('failed persistence rolls back catalogue and pins; never claims successful save', async () => {
    const f = fixture(); f.deps.persist = async () => { throw new Error('offline'); };
    await assert.rejects(f.album.save({ dataUrl: png, title: 'Portrait' }), /Could not confirm/);
    assert.equal(f.album.list().total, 0); assert.deepEqual(f.state.disabled_attachments, []);
});

test('chat switch or cancellation while loading never posts to a different chat', async () => {
    for (const mode of ['switch', 'cancel']) {
        const f = fixture(); const r = await f.album.save({ dataUrl: png, title: 'Portrait' }); let release;
        f.deps.checkImage = () => new Promise(resolve => { release = resolve; });
        const pending = f.album.open(r[ALBUM_TAG].id, true);
        if (mode === 'switch') f.context = { ...f.context, chatId: 'elsewhere', chat: [] }; else f.album.cancel();
        release(); await assert.rejects(pending, /changed|cancelled/); assert.equal(f.published.length, 0);
    }
});

test('missing image does not post and concurrent operations are refused', async () => {
    const f = fixture(); const r = await f.album.save({ dataUrl: png, title: 'Portrait' });
    f.deps.checkImage = async () => { throw new Error('404'); };
    await assert.rejects(f.album.open(r[ALBUM_TAG].id, true), /404/); assert.equal(f.published.length, 0);
    let release; f.deps.checkImage = () => new Promise(resolve => { release = resolve; });
    const pending = f.album.open(r[ALBUM_TAG].id, true);
    await assert.rejects(f.album.open(r[ALBUM_TAG].id, true), /already running/);
    release(); await pending;
});

test('two-picture turn limit, idempotent reopen, reload guard and new turn', async () => {
    const f = fixture(); const pictures = [];
    for (let i = 0; i < 3; i++) pictures.push(await f.album.save({ dataUrl: png, title: `Picture ${i}` }));
    const ids = pictures.map(x => x[ALBUM_TAG].id);
    await f.album.open(ids[0], true); await f.album.open(ids[1], true);
    assert.equal(JSON.parse(await f.album.open(ids[0], true)).status, 'already_open');
    const restored = createAlbum(f.deps);
    await assert.rejects(restored.open(ids[2], true), /Two album/);
    f.context.chat.push({ is_user: true, mes: 'Another please' }); await restored.open(ids[2], true);
    assert.equal(f.published.length, 3);
});

test('archive hides search record but retains storage and disabled pin; edit rollback', async () => {
    const f = fixture(); const r = await f.album.save({ dataUrl: png, title: 'Original', notes: 'Old note' });
    await f.album.edit(r[ALBUM_TAG].id, 'Revised', 'New note'); assert.equal(f.album.list('revised').total, 1);
    f.deps.persist = async () => { throw new Error('offline'); };
    await assert.rejects(f.album.edit(r[ALBUM_TAG].id, 'Lost', ''), /offline/);
    assert.equal(f.album.list('revised').total, 1);
    f.deps.persist = async () => {};
    await f.album.edit(r[ALBUM_TAG].id, 'Revised', 'New note', true);
    assert.equal(f.album.list().total, 0); assert.ok(f.state.disabled_attachments.includes(r.url));
    assert.equal(f.state.character_attachments['A.png'].length, 1);
    await f.album.edit(r[ALBUM_TAG].id, 'Revised', 'New note', false);
    assert.equal(f.album.list().total, 1);
});

test('safe local paths and content types reject external requests, traversal and fake images', () => {
    const origin = 'https://chat.example';
    assert.equal(localImagePath('user/files/picture.png', origin), '/user/files/picture.png');
    for (const value of ['https://evil.example/a.png', '//evil.example/a.png', '/api/a.png', 'user/images/../files/a.png', 'user/images/%2e%2e/a.png', 'user/images/a.svg', 'user/images/a.png?token=secret', 'user/images/a\\b.png']) assert.throws(() => localImagePath(value, origin));
    assert.ok(imageData(png).bytes > 0);
    assert.throws(() => imageData('data:image/svg+xml;base64,AAAA'));
    assert.throws(() => imageData('data:image/png;base64,aGVsbG8='));
});

test('search pages, title ranking, notes and legacy/new chat attachments', async () => {
    const f = fixture(); for (let i = 0; i < 15; i++) await f.album.save({ dataUrl: png, title: `Portrait ${i}`, notes: i === 2 ? 'garden' : '' });
    assert.equal(f.album.list().next_offset, 12); assert.equal(f.album.list('', 12).pictures.length, 3);
    assert.equal(f.album.list('garden').pictures.length, 1);
    assert.equal(visibleRecords(f.state, null).length, 0);
    assert.throws(() => searchRecords(f.state, 'A.png', '', -1));
    const pictures = chatPictures([{ name: 'User', extra: { image: 'user/images/old.png' } }, { name: 'A', extra: { media: [{ type: 'image', url: 'user/images/new.png' }, { type: 'video', url: 'video.mp4' }] } }]);
    assert.equal(pictures.length, 2); assert.equal(pictures[0].index, 1);
});
