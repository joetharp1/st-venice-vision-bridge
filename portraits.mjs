import { imageData, localImagePath, MAX_IMAGE_BYTES } from './album-core.mjs';
import { modelOptions } from './models.mjs';

export const PORTRAIT_TOOL = 'VeniceCreateSelfPortrait';
export const IDENTITY_PROMPT = 'Use the person in the reference image as the same character in this new picture. Preserve their facial identity, apparent adult age, eye colour and hair characteristics. Follow the requested scene, pose, clothing and expression; do not copy the original background unless requested.\n\n';

export function portraitPlan(own, key, legacy, args) {
    const saved = own.portraits?.[key];
    if (!saved?.url) throw new Error('Save a reference portrait for this character in Venice Image Bridge first.');
    const model = own.editModels?.find(m => m.id === saved.model);
    if (!model) throw new Error('Choose a reference image model for this character. Refresh editing models if needed.');
    if (model.offline) throw new Error('The selected reference image model is offline. Choose another model.');
    if (typeof args?.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 1500) throw new Error('Describe the new portrait in 1–1500 characters.');
    const prompt = IDENTITY_PROMPT + args.prompt.trim();
    if (prompt.length > model.constraints.promptCharacterLimit) throw new Error(`This model allows ${model.constraints.promptCharacterLimit} characters including the face-preservation instruction. Shorten the scene description.`);
    const options = modelOptions(model, saved.options || {});
    // Multi-edit accepts one reference and exposes quality; single-edit rejects quality.
    const multi = model.constraints.qualities.length > 0;
    const body = { [multi ? 'modelId' : 'model']: model.id, prompt, output_format: 'png', safe_mode: !!legacy.safe_mode };
    for (const [field, values] of [['aspect_ratio', model.constraints.aspectRatios], ['resolution', model.constraints.resolutions], ['quality', multi ? model.constraints.qualities : []]]) {
        if (values.length) body[field] = options[field];
    }
    return { url: saved.url, endpoint: `https://api.venice.ai/api/v1/image/${multi ? 'multi-edit' : 'edit'}`, body, multi };
}

export function attachPortrait(plan, dataUrl) {
    imageData(dataUrl); // Only image bytes, never a private ST URL, go to Venice.
    return { ...plan.body, [plan.multi ? 'images' : 'image']: plan.multi ? [dataUrl] : dataUrl };
}

export function portraitPrice(model, options) {
    const p = model.pricing || {};
    const base = p.quality?.[options.resolution]?.[options.quality]?.usd
        ?? p.resolutions?.[options.resolution]?.usd ?? p.inpaint?.usd;
    const extra = p.inputImages?.included === 0 ? p.inputImages?.additional?.usd : 0;
    if (!Number.isFinite(base) || !Number.isFinite(extra)) return 'Price unavailable for this selection; check Venice pricing before generating.';
    return `Listed price with one reference: $${Number((base + extra).toFixed(6))} per image (USD).`;
}

export const blobDataUrl = blob => new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the picture.')); reader.readAsDataURL(blob);
});

export async function validatePortrait(blob) {
    if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('Choose a PNG, JPEG or WebP portrait smaller than 8 MB.');
    const data = await blobDataUrl(blob); imageData(data);
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap; bitmap.close();
    if (width < 64 || height < 64 || width * height < 65536 || width * height > 24000000) {
        throw new Error('Use a portrait at least 256×256 pixels (or equivalent area), at least 64 pixels on each side, and below 24 megapixels.');
    }
    return data;
}

export async function loadPortrait(url, origin, request, signal) {
    const path = localImagePath(url, origin);
    const response = await request(path, { cache: 'no-store', redirect: 'error', signal });
    if (!response.ok) throw new Error('The saved reference portrait could not be read. Choose it again in Venice Image Bridge.');
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Saved reference portrait exceeds 8 MB.');
    return validatePortrait(await response.blob());
}

export async function editedImage(response) {
    const blob = await response.blob();
    if (!blob.size || blob.size > 32 * 1024 * 1024) throw new Error('Venice returned an empty or oversized edited image. No automatic retry was made.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const start = String.fromCharCode(...bytes.subarray(0, 12));
    const extension = start.startsWith('\x89PNG\r\n\x1a\n') ? 'png' : start.startsWith('\xff\xd8\xff') ? 'jpg'
        : start.startsWith('RIFF') && start.slice(8, 12) === 'WEBP' ? 'webp' : null;
    if (!extension) throw new Error('Venice returned an unsupported image response. No automatic retry was made.');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { base64: btoa(binary), extension };
}
