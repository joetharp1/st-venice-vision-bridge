// Limits on disposable viewing copies, not gallery files or image-generation refs.
// This is a conservative local transport budget, not a claimed Venice API limit.
export const REQUEST_BUDGET = 4 * 1024 * 1024;
export const IMAGE_BUDGET = 512 * 1024;
const INLINE_IMAGE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\r\n]+$/i;
const embeddedChars = value => value.length + (value.match(/[\r\n]/g)?.length || 0);
const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;

export function renderViewingCopy(url, maxChars) {
    return new Promise((resolve, reject) => {
        const img = new Image(); let finished = false;
        const timer = setTimeout(() => finish(new Error('Preparing an image for Venice timed out.')), 20000);
        function finish(error, result) {
            if (finished) return; finished = true; clearTimeout(timer);
            img.onload = img.onerror = null; img.src = '';
            error ? reject(error) : resolve(result);
        }
        img.onerror = () => finish(new Error('An image could not be decoded for Venice.'));
        img.onload = () => {
            let canvas;
            try {
                const w = img.naturalWidth, h = img.naturalHeight;
                if (!w || !h || w * h > 48000000) throw new Error('An image exceeds the 48-megapixel viewing-copy limit.');
                canvas = document.createElement('canvas');
                const longest = Math.max(w, h);
                // Preserve the complete frame and orientation. Never upscale.
                for (const side of [2048, 1536, 1024, 768, 512]) {
                    const scale = Math.min(1, side / longest);
                    canvas.width = Math.max(1, Math.round(w * scale));
                    canvas.height = Math.max(1, Math.round(h * scale));
                    const ctx = canvas.getContext('2d');
                    if (!ctx) throw new Error('Image canvas unavailable.');
                    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    for (const quality of [0.90, 0.82, 0.74]) {
                        const result = canvas.toDataURL('image/jpeg', quality);
                        if (result.startsWith('data:image/jpeg;base64,') && result.length <= maxChars) {
                            finish(null, result); return;
                        }
                    }
                    if (longest <= side && side === 512) break;
                }
                throw new Error('The images cannot fit this request without reducing viewing detail further.');
            } catch (error) { finish(error); }
            finally { if (canvas) { canvas.width = 0; canvas.height = 0; } }
        };
        img.src = url;
    });
}

export function createImageTransport({ render = renderViewingCopy, maxBytes = REQUEST_BUDGET,
    maxImageChars = IMAGE_BUDGET, maxCacheChars = 32000000, onStats = () => {} } = {}) {
    const cache = new Map(); let cacheChars = 0;
    async function copy(url, cap) {
        if (url.length <= cap) return url;
        const cached = cache.get(url);
        if (cached?.length <= cap) return cached;
        const result = await render(url, cap);
        if (typeof result !== 'string' || !INLINE_IMAGE.test(result) || result.length > cap) {
            throw new Error('Image conversion did not meet the outgoing size limit.');
        }
        if (url.length + result.length <= maxCacheChars) {
            if (cached) { cache.delete(url); cacheChars -= url.length + cached.length; }
            while (cache.size && cacheChars + url.length + result.length > maxCacheChars) {
                const [key, value] = cache.entries().next().value;
                cache.delete(key); cacheChars -= key.length + value.length;
            }
            cache.set(url, result); cacheChars += url.length + result.length;
        }
        return result;
    }
    return async (data, { isCurrent = () => true } = {}) => {
        const deadline = Date.now() + 60000;
        const check = () => {
            if (!isCurrent()) throw new Error('Image request was stopped or the chat changed.');
            if (Date.now() > deadline) throw new Error('Preparing the image request took too long.');
        };
        if (!Array.isArray(data?.messages)) return data;
        const refs = [];
        // Count JSON overhead with the large base64 strings removed, avoiding
        // another full-size serialized copy in phone memory.
        const messages = data.messages.map(message => {
            if (!Array.isArray(message?.content)) return message;
            const content = message.content.map(part => {
                const url = part?.type === 'image_url' && part.image_url?.url;
                if (typeof url !== 'string' || !INLINE_IMAGE.test(url)) return part;
                const view = { ...part, image_url: { ...part.image_url, url: '' } };
                refs.push({ url, view }); return view;
            });
            return { ...message, content };
        });
        if (!refs.length) return data;
        const candidate = { ...data, messages }, overhead = jsonBytes(candidate);
        const before = overhead + refs.reduce((n, r) => n + embeddedChars(r.url), 0);
        const available = maxBytes - overhead - 16384; // Reserve space for later small settings changes.
        if (available <= 0) throw new Error('The text and tool data already exceed the outgoing request budget.');
        const desired = refs.reduce((n, r) => n + Math.min(r.url.length, maxImageChars), 0);
        const ratio = Math.min(1, available / desired);
        let changed = 0;
        for (const ref of refs) {
            const cap = Math.floor(Math.min(ref.url.length, maxImageChars) * ratio);
            // Decode one image at a time. Do not omit older images or edit chat records.
            check();
            const result = await copy(ref.url, cap);
            check();
            ref.view.image_url.url = result;
            if (result !== ref.url) changed++;
        }
        const after = overhead + refs.reduce((n, r) => n + embeddedChars(r.view.image_url.url), 0);
        if (after > maxBytes) throw new Error('The outgoing image request is still too large.');
        onStats({ images: refs.length, resized: changed, beforeBytes: before, afterBytes: after });
        return changed ? candidate : data;
    };
}
