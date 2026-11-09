import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = process.env.ST_ROOT || '/workspace/scratch/d5e75b8f0021/research/st-1.19.0';
test('pinned ST source contracts: user scope, verified settings, file routes, chat JSONL and inline video', async t => {
    let files;
    try { files = await readFile(root + '/src/endpoints/files.js', 'utf8'); }
    catch (e) { if (e.code === 'ENOENT' && !process.env.ST_ROOT) return t.skip('Set ST_ROOT to SillyTavern 1.19.0 source.'); throw e; }
    assert.match(files, /router\.post\('\/upload'/);
    assert.match(files, /writeFileSyncAtomic\(pathToUpload, request\.body\.data, 'base64'\)/);
    assert.match(files, /response\.send\(\{ path: url \}\)/);
    assert.match(files, /Array\.isArray\(request\.body\.urls\)/);
    assert.match(files, /verified\[url\] = fileExists/);
    const user = await readFile(root + '/public/scripts/user.js', 'utf8');
    assert.match(user, /export function getCurrentUserHandle\(/);
    const script = await readFile(root + '/public/script.js', 'utf8');
    for (const name of ['saveSettings', 'getRequestHeaders', 'isGenerating']) assert.match(script, new RegExp(`export (?:async )?(?:function|let|const) ${name}\\b`));
    assert.match(script, /case MEDIA_TYPE\.VIDEO:/);
    assert.match(script, /video\.attr\('src', attachment\.url\)/);
    const chat = await readFile(root + '/src/endpoints/chats.js', 'utf8');
    assert.match(chat, /router\.post\('\/get', validateAvatarUrlMiddleware/);
    assert.match(chat, /response\.send\(getChatData\(chatFilePath\)\)/);
    const constants = await readFile(root + '/public/scripts/constants.js', 'utf8');
    assert.match(constants, /VIDEO: 'video'/);
    const html = await readFile(root + '/public/index.html', 'utf8');
    assert.match(html, /<video class="mes_video" controls preload="metadata"><\/video>/);
});
test('rig is isolated: no model registration, no generation, no image aspect override or card write', async () => {
    for (const file of ['video-rig-core.mjs', 'video-rig-host.mjs', 'video-rig-ui.mjs']) {
        const text = await readFile(new URL('../' + file, import.meta.url), 'utf8');
        assert.doesNotMatch(text, /registerFunctionTool|host\.Generate|\.generatePortrait\(|\/api\/characters\/edit/);
        assert.doesNotMatch(text, /portraits\[.*\]\s*=|options\.aspect_ratio\s*=/);
    }
});
