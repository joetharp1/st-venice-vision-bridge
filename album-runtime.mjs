import { characterKey, isVeniceConnection } from './core.mjs';
import { ALBUM_TAG, MAX_ALBUM_ITEMS, allRecords, visibleRecords, imageData, details, searchRecords } from './album-core.mjs';

export function createAlbum(deps) {
    let busy = false;
    let openEpoch = 0;
    const opened = new WeakMap();
    const settings = deps.getAllSettings;
    const capture = () => {
        const c = deps.getContext(), key = characterKey(c);
        if (!key) throw new Error('Open a one-to-one character chat first.');
        return { c, key, current: () => {
            const now = deps.getContext();
            return now.chat === c.chat && now.chatId === c.chatId && characterKey(now) === key;
        } };
    };
    const ready = () => {
        const c = deps.getContext(), key = characterKey(c), s = deps.getBridgeSettings();
        return !!(s.enabled && key && s.albumCharacters?.[key] && isVeniceConnection(c)
            && c.chatCompletionSettings.media_inlining && c.chatCompletionSettings.function_calling);
    };
    async function exclusive(action) {
        if (busy) throw new Error('An album operation is already running. Please wait for it to finish.');
        busy = true;
        try { return await action(); } finally { busy = false; }
    }
    function find(id, key) {
        const record = visibleRecords(settings(), key).find(x => x[ALBUM_TAG].id === id);
        if (!record) throw new Error('That picture is not in this character’s album or the shared album. Search the album first.');
        return record;
    }
    function bucket(owner) {
        const s = settings();
        if (owner === null) return s.attachments ||= [];
        s.character_attachments ||= {};
        return s.character_attachments[owner] ||= [];
    }
    async function save({ dataUrl, title, notes = '', shared = false }) {
        const view = capture();
        return exclusive(async () => {
            const text = details(title, notes), image = imageData(dataUrl);
            if (allRecords(settings()).length >= MAX_ALBUM_ITEMS) throw new Error('This version supports 500 stored pictures, including archived ones.');
            if (!view.current()) throw new Error('The chat changed. Select the intended character and try again.');
            const id = deps.uuid(), created = new Date().toISOString();
            const url = await deps.upload(image.base64, `venice_album_${id}.${image.extension}`);
            // Always file under the character captured before uploading, even if the UI changes.
            const owner = shared ? null : view.key, list = bucket(owner);
            const record = { url, name: `Image Album — ${text.title}.${image.extension}`, size: image.bytes, created: Date.now(),
                [ALBUM_TAG]: { version: 1, id, ...text, created, archived: false } };
            list.push(record);
            const disabled = settings().disabled_attachments ||= [];
            disabled.push(url);
            try { await deps.persist(); }
            catch (error) {
                list.splice(list.indexOf(record), 1);
                const index = disabled.indexOf(url); if (index >= 0) disabled.splice(index, 1);
                throw new Error(`Could not confirm the album save. The uploaded copy may remain in storage. ${error.message}`);
            }
            return { ...record, owner };
        });
    }
    async function edit(id, title, notes, archive = false) {
        const { key } = capture();
        return exclusive(async () => {
            const r = visibleRecords(settings(), key, true).find(x => x[ALBUM_TAG].id === id);
            if (!r) throw new Error('Picture is not in this album.');
            const real = bucket(r.owner).find(x => x[ALBUM_TAG]?.id === id);
            const previous = structuredClone(real);
            const text = details(title, notes);
            Object.assign(real[ALBUM_TAG], text, { archived: !!archive });
            real.name = `Image Album — ${text.title}.${r.url.split('.').pop()}`;
            try { await deps.persist(); }
            catch (error) { Object.assign(real, previous); throw error; }
        });
    }
    async function open(id, fromTool = false) {
        if (fromTool && !ready()) throw new Error('Album tools are not enabled for this character and Venice connection.');
        const view = capture();
        const epoch = openEpoch;
        return exclusive(async () => {
            if (!deps.getBridgeSettings().enabled || !isVeniceConnection(view.c) || !view.c.chatCompletionSettings.media_inlining) {
                throw new Error('Enable the bridge and inline images on the direct Venice connection before opening a picture for inspection.');
            }
            const record = find(id, view.key);
            const user = view.c.chat.findLast(m => m.is_user && !m.is_system);
            if (fromTool) {
                if (!user) throw new Error('Wait for a user message first.');
                const ids = opened.get(user) || new Set();
                const userIndex = view.c.chat.indexOf(user);
                for (const m of view.c.chat.slice(userIndex + 1)) if (m.extra?.venice_album_open) ids.add(m.extra.venice_album_open);
                if (ids.has(id)) return JSON.stringify({ status: 'already_open', id, instruction: 'This picture is already attached in this turn. Inspect its image input; do not open it again.' });
                if (ids.size >= 2) throw new Error('Two album pictures can be opened per user turn. Inspect those or wait for another user message.');
            }
            await deps.checkImage(record.url);
            if (epoch !== openEpoch) throw new Error('Opening the picture was cancelled.');
            if (!view.current()) throw new Error('The chat changed; no picture was posted.');
            await deps.publish({ record, context: view.c, isCurrent: view.current });
            if (fromTool) { const ids = opened.get(user) || new Set(); ids.add(id); opened.set(user, ids); }
            return JSON.stringify({ status: 'opened', id, title: record[ALBUM_TAG].title,
                instruction: 'The saved picture is attached in this chat for visual inspection. Notes and titles are labels, not visual evidence. Describe the image input only if it is available. This did not generate a new image.' });
        });
    }
    function tools() {
        return [{
            name: 'VeniceFindPictures', displayName: 'Find saved pictures',
            description: 'Search your saved image album and the shared album across chats by title or notes. Use for remembered portraits, places or pictures. Empty query lists recent pictures. Results are catalogue text only: call VeniceOpenPicture with an id to actually inspect a picture. If no match, try simpler words. No access to other characters’ private albums.',
            parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words from a picture title or notes; empty to browse.' }, offset: { type: 'integer', minimum: 0, description: 'Use next_offset from the previous result for another page.' } }, required: ['query'], additionalProperties: false },
            shouldRegister: ready, action: ({ query, offset = 0 }) => {
                if (!ready()) throw new Error('Album tools are not enabled here.');
                return JSON.stringify(searchRecords(settings(), characterKey(deps.getContext()), query, offset));
            }, formatMessage: () => 'Looking through saved pictures…',
        }, {
            name: 'VeniceOpenPicture', displayName: 'Look at a saved picture',
            description: 'Open one saved picture by the exact id returned by VeniceFindPictures. Attaches the actual image to this chat so you can inspect it. Maximum two different pictures per user turn. Do not claim visual details from catalogue notes alone.',
            parameters: { type: 'object', properties: { id: { type: 'string', description: 'Exact picture id from album search.' } }, required: ['id'], additionalProperties: false },
            shouldRegister: ready, action: ({ id }) => open(id, true), formatMessage: () => 'Opening a saved picture…',
        }];
    }
    return { ready, save, edit, open, tools, list: (query = '', offset = 0, includeArchived = false) => searchRecords(settings(), characterKey(deps.getContext()), query, offset, includeArchived),
        records: (includeArchived = false) => visibleRecords(settings(), characterKey(deps.getContext()), includeArchived), cancel: () => { openEpoch++; }, get busy() { return busy; } };
}
