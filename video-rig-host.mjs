import { getCurrentUserHandle } from '../../../user.js';
import { RIG_KEY, MAX_VIDEO_BYTES, clone, safeError } from './video-rig-core.mjs';

const API = 'https://api.venice.ai/api/v1';
export function localFile(url, origin = location.origin) {
    if (typeof url !== 'string' || /[\\\u0000-\u001f]/.test(url) || decodeURIComponent(url).split(/[/?#]/).some(p => p === '..' || p === '.')) throw new Error('Invalid storage path.');
    const u = new URL(url, origin + '/');
    if (u.origin !== origin || u.username || u.password || u.search || u.hash || !/^\/user\/files\/[^/]+$/.test(u.pathname)) throw new Error('Storage returned an unexpected user-file path.');
    return u.pathname;
}
export function privateDownload(url) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || /^(localhost$|127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(u.hostname) || /\.(local|internal)$/.test(u.hostname)) throw new Error('Provider returned an unsafe download URL.');
    return u.href;
}
export async function digest(blob) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export const dataURL = blob => new Promise((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read file.')); r.readAsDataURL(blob);
});
async function boundedVideo(response) {
    if (Number(response.headers.get('content-length')) > MAX_VIDEO_BYTES) throw new Error('Provider video exceeds the 32 MB test limit.');
    if (!response.body?.getReader) {
        const blob = await response.blob();
        if (blob.size > MAX_VIDEO_BYTES) throw new Error('Provider video exceeds the 32 MB test limit.');
        return blob;
    }
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_VIDEO_BYTES) { await reader.cancel(); throw new Error('Provider video exceeds the 32 MB test limit.'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    return new Blob(chunks, { type: 'video/mp4' });
}
export async function inspectMP4(blob) {
    if (!blob.size || blob.size > MAX_VIDEO_BYTES) throw new Error('Video must be between 1 byte and 32 MB for this test.');
    const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
    const str = (p, n) => String.fromCharCode(...bytes.slice(p, p + n));
    if (bytes.length < 16 || str(4, 4) !== 'ftyp') throw new Error('Provider returned something other than an MP4 file.');
    let audioTracks = 0;
    function boxes(start, end, depth = 0) {
        if (depth > 8) return;
        for (let p = start; p + 8 <= end;) {
            let size = view.getUint32(p), header = 8;
            const type = str(p + 4, 4);
            if (size === 1) { if (p + 16 > end) break; size = Number(view.getBigUint64(p + 8)); header = 16; }
            if (size === 0) size = end - p;
            if (size < header || p + size > end) break;
            if (['moov', 'trak', 'mdia'].includes(type)) boxes(p + header, p + size, depth + 1);
            if (type === 'hdlr' && size >= header + 12 && str(p + header + 8, 4) === 'soun') audioTracks++;
            p += size;
        }
    }
    boxes(0, bytes.length);
    return { bytes: blob.size, sha256: await digest(blob), audioTracks };
}

export function createRigHost(host) {
    const profile = getCurrentUserHandle(), prefix = `${RIG_KEY}:${profile}`;
    const settings = host.extension_settings;
    let cached = clone(settings[RIG_KEY] || { version: 1, jobs: [] });
    const checks = {};
    const emergency = {};
    const lock = (name, action, optional = false) => {
        if (!navigator.locks) throw new Error('This browser does not provide Web Locks. No video will be submitted.');
        return navigator.locks.request(`${prefix}:${name}`, optional ? { ifAvailable: true } : {}, held => held ? action() : undefined);
    };
    const request = async (url, options = {}, timeout = 30000) => {
        const r = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
        if (!r.ok) {
            const text = (await r.text()).slice(0, 2000);
            let body; try { body = JSON.parse(text); } catch { /* plain-text provider failure */ }
            const detail = body?.error?.message || body?.error || body?.message || text;
            let message = `HTTP ${r.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
            const key = settings['st-venice-image']?.api_key;
            if (key) message = message.replaceAll(key, '[key omitted]');
            const error = new Error(message);
            // Only explicit client rejection is definite. Timeouts, 408 and 5xx remain ambiguous.
            error.definiteRejection = [400, 401, 402, 403, 404, 413, 422, 429].includes(r.status);
            error.refunded = body?.error?.credits_refunded === true;
            error.providerFailure = body?.error?.type === 'provider_content_policy';
            throw error;
        }
        return r;
    };
    const post = async (path, body) => request(path, { method: 'POST', headers: host.getRequestHeaders(), body: JSON.stringify(body) });
    const serverSettings = async () => {
        const data = await (await post('/api/settings/get', {})).json();
        if (typeof data.settings !== 'string') throw new Error('Unexpected ST settings response.');
        return JSON.parse(data.settings).extension_settings || {};
    };
    const read = async () => {
        const all = await serverSettings();
        cached = clone(all[RIG_KEY] || { version: 1, jobs: [] });
        if (!Array.isArray(cached.jobs)) throw new Error('Saved rig record is invalid.');
        settings[RIG_KEY] = clone(cached);
        return clone(cached);
    };
    const update = fn => lock('persist', async () => {
        const fresh = await read(), next = clone(fresh);
        fn(next);
        if (JSON.stringify(next) === JSON.stringify(fresh)) return next;
        const previous = settings[RIG_KEY];
        next.revision = crypto.randomUUID(); settings[RIG_KEY] = next;
        try {
            await host.saveSettings();
            const saved = (await serverSettings())[RIG_KEY];
            if (saved?.revision !== next.revision) throw new Error('Server has not confirmed the video job record. Wait for the current chat reply to finish, then Resume checks.');
            cached = clone(saved); return clone(saved);
        } catch (error) { settings[RIG_KEY] = previous; throw error; }
    });
    function api(path, body) {
        const key = settings['st-venice-image']?.api_key;
        if (!key) throw new Error('Configure the existing Venice Image Generation API key first.');
        // Key is used only for this fixed API origin; never sent to download URLs or persisted in jobs.
        return request(API + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, path.startsWith('/image/') ? 120000 : path === '/video/retrieve' ? 60000 : 45000);
    }
    const target = () => {
        const c = host.getContext(), avatar = c.characters?.[c.characterId]?.avatar;
        if (c.groupId || !avatar || !c.chatId) throw new Error('Open a saved one-to-one chat first.');
        return { avatar, chatId: c.chatId, name: c.name2 };
    };
    const assertTarget = captured => {
        const current = target();
        if (current.avatar !== captured.avatar || current.chatId !== captured.chatId) throw new Error('Chat changed. Prepare a new test for the intended chat.');
        if (document.hidden) throw new Error('Keep the app visible while submitting the test.');
        if (host.isGenerating() || String(document.getElementById('send_textarea')?.value || '').trim() || host.hasPendingFileAttachment()) throw new Error('Finish the current reply or draft before submitting the video test.');
    };
    const receipts = () => {
        let saved = {}; try { saved = JSON.parse(localStorage.getItem(prefix + ':receipts') || '{}'); } catch { /* emergency in-memory receipt remains available */ }
        return { ...saved, ...emergency };
    };
    const backupReceipt = (id, receipt) => {
        emergency[id] = receipt;
        try { localStorage.setItem(prefix + ':receipts', JSON.stringify(receipts())); } catch { /* server commit still attempted immediately */ }
    };
    const clearReceipt = id => {
        const saved = receipts(); delete saved[id]; delete emergency[id];
        try { localStorage.setItem(prefix + ':receipts', JSON.stringify(saved)); } catch { /* matching server receipt wins on recovery */ }
    };
    async function registerFile(job, path, bytes) {
        await lock('persist', async () => {
            const oldAttachments = settings.attachments, oldDisabled = settings.disabled_attachments;
            // Merge the latest server registry with this tab's existing records, preserving other extensions.
            const persisted = await serverSettings();
            if (persisted[RIG_KEY]) settings[RIG_KEY] = clone(persisted[RIG_KEY]);
            const merged = new Map([...(persisted.attachments || []), ...(settings.attachments || [])].map(a => [a.url, a]));
            merged.set(path, { url: path, name: path.split('/').pop(), size: bytes, created: Date.now(), venice_video_rig: { id: job.id, avatar: job.target.avatar, chatId: job.target.chatId } });
            settings.attachments = [...merged.values()];
            settings.disabled_attachments = [...new Set([...(persisted.disabled_attachments || []), ...(settings.disabled_attachments || []), path])];
            try {
                await host.saveSettings();
                const checked = await serverSettings();
                if (!checked.attachments?.some(a => a.url === path && a.venice_video_rig?.id === job.id) || !checked.disabled_attachments?.includes(path)) throw new Error('Video registry save not confirmed; provider copy retained.');
            } catch (error) { settings.attachments = oldAttachments; settings.disabled_attachments = oldDisabled; throw error; }
        });
    }
    const savedChat = async job => (await post('/api/chats/get', { avatar_url: job.target.avatar, file_name: job.target.chatId })).json();
    const saveAsset = async (job, blob, fileName) => {
        const sha256 = await digest(blob);
        const uploaded = await (await post('/api/files/upload', { name: fileName, data: (await dataURL(blob)).split(',')[1] })).json();
        const path = localFile(uploaded.path);
        const verified = await (await post('/api/files/verify', { urls: [path] })).json();
        if (verified[path] !== true) throw new Error('Uploaded media was not found by ST file verification.');
        const returned = await (await request(path, { cache: 'no-store' })).blob();
        if (returned.size !== blob.size || await digest(returned) !== sha256) throw new Error('Uploaded media bytes do not match. Provider copy retained.');
        await registerFile(job, path, blob.size);
        return { path, bytes: blob.size, sha256, verifiedAt: Date.now() };
    };
    return {
        profile, lock, read, update, target, assertTarget, now: Date.now, uuid: () => crypto.randomUUID(),
        api, request, savedChat, saveAsset,
        backupReceipt, clearReceipt, receipts, cached: () => clone(cached),
        recordCheck: (key, value) => { checks[key] = value; },
        catalogue: async () => {
            const result = await (await api('/models?type=video')).json();
            const model = result?.data?.find(m => m.id === 'wan-2-7-enhanced-image-to-video');
            checks.catalogue = model ? { id: model.id, capabilities: model.model_spec?.capabilities, constraints: model.model_spec?.constraints, offline: model.model_spec?.offline } : { missing: true };
            return result;
        },
        quote: async params => {
            const result = await (await api('/video/quote', params)).json();
            checks.quote = { params, usd: result.quote }; return result;
        },
        queue: async body => (await api('/video/queue', body)).json(),
        retrieve: async job => {
            const r = await api('/video/retrieve', { model: job.model, queue_id: job.queueId, delete_media_on_completion: false });
            if (r.headers.get('content-type')?.includes('video/mp4')) return { blob: await boundedVideo(r) };
            const result = await r.json();
            if (result.status === 'PROCESSING') return { pending: true };
            if (result.status !== 'COMPLETED') throw new Error(`Unexpected retrieval response: ${JSON.stringify(result).slice(0, 600)}`);
            const url = result.download_url || job.downloadUrl;
            if (!url) throw new Error('Provider marked complete without a download URL. Retaining queue ID for recovery.');
            // Never forward the Venice bearer key to the signed delivery host.
            const media = await request(privateDownload(url), { credentials: 'omit', referrerPolicy: 'no-referrer' }, 60000);
            return { blob: await boundedVideo(media) };
        },
        saveVideo: async (job, blob) => {
            const details = await inspectMP4(blob);
            const response = await post('/api/files/upload', { name: job.fileName, data: (await dataURL(blob)).split(',')[1] });
            const uploaded = await response.json(), path = uploaded.path;
            localFile(path);
            const verified = await (await post('/api/files/verify', { urls: [path] })).json();
            if (verified[path] !== true) throw new Error('Uploaded video was not found by ST file verification.');
            const returned = await (await request(localFile(path), { cache: 'no-store' })).blob();
            if (returned.size !== blob.size || await digest(returned) !== details.sha256) throw new Error('Uploaded video bytes do not match the provider result. Provider copy retained.');
            await registerFile(job, path, blob.size);
            return { path, ...details, verifiedAt: Date.now() };
        },
        cleanup: async job => {
            if (!job.saved?.verifiedAt) throw new Error('Provider cleanup requires a verified saved copy.');
            const r = await api('/video/complete', { model: job.model, queue_id: job.queueId });
            const result = await r.json();
            if (result.success !== true) throw new Error('Provider cleanup was not confirmed.');
        },
        attach: async job => {
            let c = host.getContext();
            const matches = () => {
                const n = host.getContext();
                return n.chat === c.chat && n.chatId === job.target.chatId && n.characters?.[n.characterId]?.avatar === job.target.avatar && !n.groupId;
            };
            if (!matches() || host.isGenerating() || document.hidden) return false;
            const marker = m => m.extra?.venice_video_rig?.id === job.id && m.extra?.media?.some(a => a.url === job.saved.path && a.type === host.MEDIA_TYPE.VIDEO);
            const remote = await savedChat(job);
            if (!Array.isArray(remote)) throw new Error('Cannot verify target chat on the server.');
            if (remote.some(marker)) return true;
            if (!matches() || host.isGenerating()) return false;
            const existing = c.chat.find(marker);
            const localHistory = c.chat.filter(m => !marker(m));
            const remoteHistory = remote.slice(1); // ST's first JSONL item is chat metadata.
            const signature = messages => JSON.stringify(messages.map(m => [m.name, m.is_user, m.is_system, m.mes, m.send_date, m.extra?.media]));
            if (signature(localHistory) !== signature(remoteHistory)) throw new Error('This tab differs from the saved chat. Reload that chat; video is safe in storage.');
            if (!existing) {
                const companion = job.kind === 'companion';
                const message = { name: companion ? job.target.name : 'Video test', is_user: false, is_system: !companion, send_date: host.getMessageTimeStamp(), mes: companion ? 'Video.' : 'Video test.',
                    extra: { media: [{ url: job.saved.path, type: host.MEDIA_TYPE.VIDEO, title: companion ? 'Video' : 'Video test', source: host.MEDIA_SOURCE.GENERATED }], media_display: host.MEDIA_DISPLAY.GALLERY, media_index: 0, venice_video_rig: { id: job.id } } };
                c.chat.push(message); c.addOneMessage(message);
                document.querySelectorAll?.('.mes_video').forEach(video => video.setAttribute('playsinline', ''));
                // No generation/message events: this manual rig must not trigger TTS or companion replies.
            }
            if (!matches()) return false;
            await c.saveChat();
            if (!(await savedChat(job)).some?.(marker)) throw new Error('Chat save not confirmed. Video retained; delivery will retry without resubmission.');
            return true;
        },
        deleteOwnedAsset: async (job, asset) => {
            const path = localFile(asset.path);
            if (!path.split('/').pop().startsWith(`venice_video_${job.id}`)) throw new Error('Retention refused a file outside this video job.');
            const persisted = await serverSettings();
            const refs = Object.values(persisted['st-venice-vision-bridge']?.portraits || {});
            if (refs.some(ref => ref.url === path)) return false;
            // Deletion is idempotent. Never remove a saved reference image.
            const exists = await (await post('/api/files/verify', { urls: [path] })).json();
            if (exists[path] === true) await post('/api/files/delete', { path });
            const checked = await (await post('/api/files/verify', { urls: [path] })).json();
            if (checked[path] !== false) throw new Error('Retention deletion was not confirmed.');
            await lock('persist', async () => {
                const latest = await serverSettings(), old = [settings.attachments, settings.disabled_attachments];
                settings.attachments = (latest.attachments || []).filter(a => a.url !== path);
                settings.disabled_attachments = (latest.disabled_attachments || []).filter(url => url !== path);
                if (latest[RIG_KEY]) settings[RIG_KEY] = clone(latest[RIG_KEY]);
                try {
                    await host.saveSettings();
                    if ((await serverSettings()).attachments?.some(a => a.url === path)) throw new Error('Retention registry update was not confirmed.');
                } catch (e) { [settings.attachments, settings.disabled_attachments] = old; throw e; }
            });
            return true;
        },
        setEvidence: (id, values) => update(db => { const j = db.jobs.find(x => x.id === id); if (j) j.evidence = { ...j.evidence, ...values }; }),
        report: () => JSON.stringify({ rig: '0.1.0', creditUSD: 0.01, checks, jobs: cached.jobs.map(j => ({ id: j.id, kind: j.kind || 'manual-test', state: j.state, stillUSD: j.stillUSD, videoUSD: j.videoUSD, totalUSD: j.totalUSD, stillCharge: j.stillCharge, videoCharge: j.videoCharge, sourceVerified: !!j.source?.verifiedAt, model: j.model, params: j.params, mode: j.mode, usd: j.usd, credits: j.usd * 100, charge: j.charge, created: j.created, queueConfirmed: !!j.queueId, queueTag: j.queueId?.slice(0, 12), confirmedAt: j.confirmedAt, recoveredAt: j.recoveredAt, providerCleaned: j.providerCleaned, saved: j.saved ? { bytes: j.saved.bytes, audioTracks: j.saved.audioTracks, verifiedAt: j.saved.verifiedAt } : null, deliveredAt: j.deliveredAt, error: j.error && safeError(j.error), cleanupError: j.cleanupError && safeError(j.cleanupError), evidence: j.evidence })) }, null, 2),
    };
}
