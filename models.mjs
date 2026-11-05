// Venice GET /models?type=image supplies constraints and prices; never a fixed model menu.
export const MODELS_URL = 'https://api.venice.ai/api/v1/models?type=image';
const strings = value => Array.isArray(value) ? [...new Set(value.filter(v => typeof v === 'string' && v.length < 100))] : [];

export function parseModels(data, type = 'image') {
    if (!['image', 'inpaint'].includes(type)) throw new Error('Unsupported model catalogue type.');
    if (!Array.isArray(data?.data)) throw new Error('Venice returned an invalid model catalogue. Your saved selection is unchanged.');
    const models = data.data.filter(m => m?.type === type && typeof m.id === 'string'
        && m.id.length < 200 && m.id !== 'bria-bg-remover').map(m => {
        const s = m.model_spec || {}, c = s.constraints || {};
        return { id: m.id, name: typeof s.name === 'string' ? s.name : m.id,
            offline: s.offline === true, privacy: typeof s.privacy === 'string' ? s.privacy : '',
            constraints: { aspectRatios: strings(c.aspectRatios), resolutions: strings(c.resolutions), qualities: strings(c.qualities),
                defaultAspectRatio: c.defaultAspectRatio, defaultResolution: c.defaultResolution, defaultQuality: c.defaultQuality,
                widthHeightDivisor: Number(c.widthHeightDivisor) || 8, promptCharacterLimit: Number(c.promptCharacterLimit) || 1500 },
            pricing: s.pricing || {} };
    });
    if (!models.length) throw new Error(`Venice returned no ${type === 'image' ? 'text-to-image' : 'editing'} models. Your saved selection is unchanged.`);
    return [...new Map(models.map(m => [m.id, m])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchModels(request, key, type = 'image') {
    if (!['image', 'inpaint'].includes(type)) throw new Error('Unsupported model catalogue type.');
    if (!key) throw new Error('Add your API key in Venice Image Generation first.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await request(type === 'image' ? MODELS_URL : 'https://api.venice.ai/api/v1/models?type=inpaint', { method: 'GET', cache: 'no-store',
            headers: { Authorization: `Bearer ${key}` }, signal: controller.signal });
        if (!response.ok) throw new Error(`Could not load Venice models (HTTP ${response.status}). Your saved selection is unchanged.`);
        return parseModels(await response.json(), type);
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('Loading Venice models timed out. Your saved selection is unchanged.');
        throw e;
    } finally { clearTimeout(timeout); }
}

const choose = (values, saved, fallback) => values.includes(saved) ? saved : values.includes(fallback) ? fallback : values[0];
export function modelOptions(model, saved = {}, legacy = {}) {
    const c = model.constraints;
    return { aspect_ratio: choose(c.aspectRatios, saved.aspect_ratio, c.defaultAspectRatio),
        resolution: choose(c.resolutions, saved.resolution, c.defaultResolution),
        quality: choose(c.qualities, saved.quality, c.defaultQuality),
        width: saved.width ?? ((Number(legacy.width) <= 1280 ? Number(legacy.width) : 1024) || 1024),
        height: saved.height ?? ((Number(legacy.height) <= 1280 ? Number(legacy.height) : 1024) || 1024) };
}

export function selectedGeneratorSettings(legacy, own) {
    if (!own.imageModel) return legacy;
    const model = own.imageModels?.find(m => m.id === own.imageModel);
    if (!model) throw new Error('The selected image model is missing from the catalogue. Refresh models or choose another model.');
    return { ...legacy, model: model.id, catalogueModel: model,
        imageOptions: modelOptions(model, own.imageOptions?.[model.id], legacy) };
}

export function catalogueRequest(settings, prompt, negative) {
    const model = settings.catalogueModel, c = model.constraints, o = settings.imageOptions;
    if (model.offline) throw new Error('This image model is currently offline. Refresh models or choose another model.');
    if (prompt.length > c.promptCharacterLimit || negative.length > c.promptCharacterLimit) {
        throw new Error(`This model accepts prompts of at most ${c.promptCharacterLimit} characters.`);
    }
    const body = { model: model.id, prompt, format: 'png', return_binary: false,
        hide_watermark: !!settings.hide_watermark, safe_mode: !!settings.safe_mode };
    for (const [field, values] of [['aspect_ratio', c.aspectRatios], ['resolution', c.resolutions], ['quality', c.qualities]]) {
        if (!values.length) continue;
        if (!values.includes(o[field])) throw new Error(`Choose a supported ${field} in Venice Image Bridge.`);
        body[field] = o[field];
    }
    if (!c.aspectRatios.length) {
        for (const field of ['width', 'height']) {
            const value = Number(o[field]);
            if (!Number.isInteger(value) || value < 64 || value > 1280 || value % c.widthHeightDivisor) {
                throw new Error(`Image ${field} must be 64–1280 pixels and a multiple of ${c.widthHeightDivisor}.`);
            }
            body[field] = value;
        }
    }
    if (negative) body.negative_prompt = negative;
    return body;
}

export function priceLabel(model, options) {
    const p = model.pricing;
    const usd = p.quality?.[options.resolution]?.[options.quality]?.usd
        ?? p.resolutions?.[options.resolution]?.usd ?? p.generation?.usd;
    return typeof usd === 'number' && Number.isFinite(usd)
        ? `Listed generation price: $${usd} per image (USD).` : 'Price not supplied for this selection; check Venice pricing.';
}
