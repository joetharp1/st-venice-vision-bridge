// Album records are managed, disabled ST attachments. Their bytes are sent as
// vision inputs only when opened, never as text-RAG documents.
export const ALBUM_TAG = 'venice_image_album';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_ALBUM_ITEMS = 500;

export function imageData(dataUrl) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '');
    if (!match || match[2].length % 4) throw new Error('Use a PNG, JPEG or WebP image.');
    const bytes = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    if (bytes > MAX_IMAGE_BYTES) throw new Error('Choose a picture smaller than 8 MB.');
    const head = atob(match[2].slice(0, 32));
    const valid = match[1] === 'png' ? head.startsWith('\x89PNG\r\n\x1a\n')
        : match[1] === 'jpeg' ? head.startsWith('\xff\xd8\xff')
        : head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
    if (!valid) throw new Error('The image contents do not match its file type.');
    return { base64: match[2], extension: match[1] === 'jpeg' ? 'jpg' : match[1], bytes };
}

export function localImagePath(value, origin) {
    if (typeof value !== 'string' || /[\\\u0000-\u001f]/.test(value)) throw new Error('Invalid saved image address.');
    const decoded = decodeURIComponent(value);
    if (decoded.split(/[/?#]/).some(x => x === '..' || x === '.')) throw new Error('Invalid saved image path.');
    const url = new URL(value, origin + '/');
    if (url.origin !== origin || url.username || url.password || url.search || url.hash
        || !/^\/user\/(images|files)\/.+\.(png|jpe?g|webp)$/i.test(url.pathname)) {
        throw new Error('Save a local SillyTavern PNG, JPEG or WebP picture, or upload it from your phone.');
    }
    return url.pathname;
}

export function details(title, notes = '') {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) throw new Error('Give the picture a name of 1–120 characters.');
    if (typeof notes !== 'string' || notes.length > 1200) throw new Error('Keep picture notes within 1,200 characters.');
    return { title: title.trim(), notes: notes.trim() };
}

export function allRecords(settings) {
    const records = [];
    for (const attachment of settings.attachments || []) {
        if (attachment?.[ALBUM_TAG]?.version === 1) records.push({ ...attachment, owner: null });
    }
    for (const [owner, attachments] of Object.entries(settings.character_attachments || {})) {
        if (!Array.isArray(attachments)) continue;
        for (const attachment of attachments) {
            if (attachment?.[ALBUM_TAG]?.version === 1) records.push({ ...attachment, owner });
        }
    }
    return records;
}

export function visibleRecords(settings, key, includeArchived = false) {
    if (!key) return [];
    return allRecords(settings).filter(x => (includeArchived || !x[ALBUM_TAG].archived) && (x.owner === null || x.owner === key));
}

export function searchRecords(settings, key, query = '', offset = 0, includeArchived = false) {
    if (typeof query !== 'string' || query.length > 300) throw new Error('Use a search phrase of up to 300 characters.');
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid result offset.');
    const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const ranked = visibleRecords(settings, key, includeArchived).map(record => {
        const meta = record[ALBUM_TAG];
        const title = meta.title.toLocaleLowerCase(), text = `${title} ${meta.notes} ${meta.created}`.toLocaleLowerCase();
        const score = terms.reduce((sum, word) => sum + (title.includes(word) ? 3 : text.includes(word) ? 1 : 0), 0);
        return { record, score };
    }).filter(x => !terms.length || x.score > 0)
        .sort((a, b) => b.score - a.score || b.record[ALBUM_TAG].created.localeCompare(a.record[ALBUM_TAG].created));
    return { total: ranked.length, next_offset: offset + 12 < ranked.length ? offset + 12 : null,
        pictures: ranked.slice(offset, offset + 12).map(({ record: r }) => ({
            id: r[ALBUM_TAG].id, title: r[ALBUM_TAG].title, notes: r[ALBUM_TAG].notes,
            saved_at: r[ALBUM_TAG].created, album: r.owner === null ? 'shared' : 'character', archived: !!r[ALBUM_TAG].archived,
        })) };
}

export function chatPictures(chat) {
    const result = [];
    for (let index = chat.length - 1; index >= 0; index--) {
        const message = chat[index];
        const media = Array.isArray(message.extra?.media) ? message.extra.media : [];
        const urls = media.filter(m => m.type === 'image').map(m => ({ url: m.url, title: m.title }));
        if (message.extra?.image && !urls.some(x => x.url === message.extra.image)) urls.push({ url: message.extra.image });
        for (const { url, title } of urls) {
            if (typeof url === 'string') result.push({ url, index, label: `Message ${index + 1} · ${message.name || (message.is_user ? 'You' : 'Character')} · ${(title || message.mes || 'Picture').slice(0, 65)}` });
        }
    }
    return result;
}
