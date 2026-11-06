// Normalize only JPEGs carrying a non-default EXIF orientation. Browser decoding
// supplies the same orientation as the chat preview; do not rotate it a second time.
export function jpegOrientation(url) {
    if (typeof url !== 'string' || !/^data:image\/jpe?g;base64,/i.test(url)) return 1;
    try {
        const start = url.indexOf(',') + 1;
        // Bounded metadata scan, before any compressed pixel data.
        const binary = atob(url.slice(start, start + 524288));
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const v = new DataView(bytes.buffer);
        if (v.getUint16(0) !== 0xffd8) return 1;
        let p = 2;
        while (p + 4 <= v.byteLength && v.getUint8(p) === 0xff) {
            const marker = v.getUint8(p + 1);
            if (marker === 0xda || marker === 0xd9) break;
            const size = v.getUint16(p + 2);
            const end = p + 2 + size;
            if (size < 2 || end > v.byteLength) break;
            if (marker === 0xe1 && size >= 16 && v.getUint32(p + 4) === 0x45786966
                && v.getUint16(p + 8) === 0) {
                const t = p + 10;
                const order = v.getUint16(t);
                if (order !== 0x4949 && order !== 0x4d4d) return 1;
                const little = order === 0x4949;
                if (v.getUint16(t + 2, little) !== 42) return 1;
                const ifd = t + v.getUint32(t + 4, little);
                if (ifd < t + 8 || ifd + 2 > end) return 1;
                const count = v.getUint16(ifd, little);
                for (let i = 0; i < count; i++) {
                    const e = ifd + 2 + i * 12;
                    if (e + 12 > end) return 1;
                    if (v.getUint16(e, little) === 0x0112
                        && v.getUint16(e + 2, little) === 3
                        && v.getUint32(e + 4, little) === 1) {
                        const orientation = v.getUint16(e + 8, little);
                        return orientation >= 1 && orientation <= 8 ? orientation : 1;
                    }
                }
            }
            p = end;
        }
    } catch { /* Missing/malformed metadata does not change an image. */ }
    return 1;
}

export function renderUpright(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        let finished = false;
        const finish = (error, result) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            img.onload = img.onerror = null;
            img.src = '';
            if (error) reject(error); else resolve(result);
        };
        const timer = setTimeout(() => finish(new Error('Photo orientation conversion timed out.')), 15000);
        img.onerror = () => finish(new Error('Photo could not be decoded for orientation correction.'));
        img.onload = () => {
            let canvas;
            try {
                const width = img.naturalWidth, height = img.naturalHeight;
                if (!width || !height || width * height > 48000000) {
                    throw new Error('Photo is too large for orientation correction on this device.');
                }
                canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('Photo orientation canvas is unavailable.');
                context.drawImage(img, 0, 0);
                // Retain pixel dimensions and high quality; canvas output has no rotation tag.
                const result = canvas.toDataURL('image/jpeg', 0.98);
                if (!result.startsWith('data:image/jpeg;base64,')) throw new Error('Photo orientation conversion failed.');
                finish(null, result);
            } catch (error) { finish(error); }
            finally { if (canvas) { canvas.width = 0; canvas.height = 0; } }
        };
        img.src = url;
    });
}

export function createOrientationNormalizer({ render = renderUpright, onError = () => {}, maxCacheChars = 16000000 } = {}) {
    const cache = new Map();
    let cacheChars = 0;
    async function normalize(url) {
        if (jpegOrientation(url) === 1) return url;
        if (cache.has(url)) return cache.get(url);
        try {
            const result = await render(url);
            const size = url.length + result.length;
            if (size <= maxCacheChars) {
                while (cacheChars + size > maxCacheChars && cache.size) {
                    const [key, value] = cache.entries().next().value;
                    cache.delete(key); cacheChars -= key.length + value.length;
                }
                cache.set(url, result); cacheChars += size;
            }
            return result;
        } catch (error) {
            onError(error);
            return url;
        }
    }
    return async messages => {
        const result = [];
        // Process sequentially to avoid decoding multiple large phone photos at once.
        for (const message of messages) {
            if (!Array.isArray(message?.content)) { result.push(message); continue; }
            let changed = false;
            const content = [];
            for (const part of message.content) {
                if (part?.type !== 'image_url') { content.push(part); continue; }
                const url = part.image_url?.url;
                const upright = await normalize(url);
                changed ||= upright !== url;
                content.push(upright === url ? part : { ...part, image_url: { ...part.image_url, url: upright } });
            }
            result.push(changed ? { ...message, content } : message);
        }
        return result;
    };
}
