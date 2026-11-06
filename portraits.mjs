import { imageData, localImagePath, MAX_IMAGE_BYTES } from './album-core.mjs';
import { modelOptions } from './models.mjs';

export const PORTRAIT_TOOL = 'VeniceCreateSelfPortrait';
export const USER_PORTRAIT_KEY = '__human_reference__';
export const USER_PORTRAIT_TOOL = 'VeniceCreateUserPortrait';
export const TWO_PERSON_IDENTITY = 'Reference image 1 is the human user. Reference image 2 is the current companion. Create a picture containing both distinct people. Preserve each person’s own facial identity, apparent adult age, eye colour and hair characteristics; do not blend or swap their faces. Follow the requested scene, pose, clothing and expression.\n\n';
export const IDENTITY_PROMPT = 'Use the person in the reference image as the same character in this new picture. Preserve their facial identity, apparent adult age, eye colour and hair characteristics. Follow the requested scene, pose, clothing and expression; do not copy the original background unless requested.\n\n';

// Editing endpoints have no negative_prompt field. Keep these exclusions in the
// positive tail, after the scene; portraitPlan alone supplies the identity prefix.
export const INITIATION_TAIL = 'Pale skin, cool natural colour balance, visible freckles, matte skin. No tan, no cyan, no liner, no gloss.';
export function initiationPortraitArgs(own, key, scene) {
    const ref = own.portraits?.[key];
    const model = own.editModels?.find(m => m.id === ref?.model && !m.offline);
    if (!model || !ref?.url) throw new Error('A saved reference and an available editing model are required.');
    const limit = Math.min(1500, model.constraints.promptCharacterLimit - IDENTITY_PROMPT.length);
    const room = limit - INITIATION_TAIL.length - 2;
    if (!Number.isFinite(room) || room < 32) throw new Error('Model prompt limit cannot hold the reference instructions and fixed exclusions.');
    const text = String(scene || '').trim();
    if (!text) throw new Error('An initiation scene is required.');
    return { prompt: text.slice(0, room).trimEnd() + '\n\n' + INITIATION_TAIL };
}

export function referenceCostUsd(own, key) {
    const ref = own.portraits?.[key];
    const model = own.editModels?.find(m => m.id === ref?.model && !m.offline);
    if (!model) return null;
    const opts = modelOptions(model, ref.options || {}), p = model.pricing || {};
    const base = p.quality?.[opts.resolution]?.[opts.quality]?.usd
        ?? p.resolutions?.[opts.resolution]?.usd ?? p.inpaint?.usd;
    const extra = p.inputImages?.included === 0 ? p.inputImages?.additional?.usd : 0;
    return Number.isFinite(base) && base >= 0 && Number.isFinite(extra) && extra >= 0 ? base + extra : null;
}

export function portraitPlan(own, key, legacy, args) {
    const saved = own.portraits?.[key];
    if (!saved?.url) throw new Error('Save a reference portrait for this character in Venice Image Bridge first.');
    const model = own.editModels?.find(m => m.id === saved.model);
    if (!model) throw new Error('Choose a reference image model for this character. Refresh editing models if needed.');
    if (model.offline) throw new Error('The selected reference image model is offline. Choose another model.');
    if (typeof args?.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 1500) throw new Error('Describe the new portrait in 1–1500 characters.');
    let scene = args.prompt.trim();
    // Initiation args already carry this exact suffix. Keep a single copy.
    if (key !== USER_PORTRAIT_KEY) {
        if (scene.endsWith(INITIATION_TAIL)) scene = scene.slice(0, -INITIATION_TAIL.length).trimEnd();
        const room = model.constraints.promptCharacterLimit - IDENTITY_PROMPT.length - INITIATION_TAIL.length - 2;
        if (!Number.isFinite(room) || room < 32) throw new Error('Model prompt limit cannot hold the reference instructions and fixed exclusions.');
        scene = scene.slice(0, room).trimEnd() + '\n\n' + INITIATION_TAIL;
    }
    const prompt = IDENTITY_PROMPT + scene;
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
    const images = Array.isArray(dataUrl) ? dataUrl : [dataUrl];
    if (images.length !== (plan.urls?.length || 1)) throw new Error('Reference image count does not match the requested picture.');
    images.forEach(imageData); // Only image bytes, never private ST URLs, go to Venice.
    return { ...plan.body, [plan.multi ? 'images' : 'image']: plan.multi ? images : images[0] };
}

export function userPortraitPlan(own, character, legacy, args, together = false) {
    if (!own.portraits?.[USER_PORTRAIT_KEY]?.url) throw new Error('Save your own reference portrait in Venice Image Bridge first.');
    const plan = portraitPlan(own, USER_PORTRAIT_KEY, legacy, args);
    if (!together) return plan;
    const companion = own.portraits?.[character];
    if (!companion?.url) throw new Error('Save a reference portrait for the current companion before making a picture together.');
    const model = own.editModels.find(m => m.id === own.portraits[USER_PORTRAIT_KEY].model);
    if (!supportsTwoReferences(model)) throw new Error('Choose a model supporting two references. Load reference image models again if the catalogue is old.');
    const prompt = TWO_PERSON_IDENTITY + args.prompt.trim();
    if (prompt.length > model.constraints.promptCharacterLimit) throw new Error('Shorten the scene description to fit both identity instructions.');
    const body = { ...plan.body, modelId: model.id, prompt };
    delete body.model;
    return { ...plan, urls: [plan.url, companion.url], multi: true, body, endpoint: 'https://api.venice.ai/api/v1/image/multi-edit' };
}

export function supportsTwoReferences(model) {
    const c = model?.constraints;
    return !!c && c.combineImages !== false && (Number(c.maxInputImages) >= 2 || c.combineImages === true && !c.maxInputImages);
}

export function portraitPrice(model, options, count = 1) {
    const p = model.pricing || {};
    const base = p.quality?.[options.resolution]?.[options.quality]?.usd
        ?? p.resolutions?.[options.resolution]?.usd ?? p.inpaint?.usd;
    const additional = p.inputImages?.additional?.usd ?? p.inputImages?.additional;
    const excess = p.inputImages ? Math.max(0, count - (p.inputImages.included ?? 1)) : 0;
    const extra = excess ? excess * additional : 0;
    if (!Number.isFinite(base) || !Number.isFinite(extra)) return 'Price unavailable for this selection; check Venice pricing before generating.';
    return `Listed price with ${count === 1 ? 'one reference' : 'two references'}: $${Number((base + extra).toFixed(6))} per image (USD).`;
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
