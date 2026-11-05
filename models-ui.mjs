import { fetchModels, modelOptions, priceLabel } from './models.mjs';

export function mountModels({ getSettings, getGeneratorSettings, save, request, bridge, document: doc = document }) {
    const root = doc.getElementById('venice_bridge_models');
    if (!root) return;
    root.innerHTML = `
        <hr><b>Image model catalogue</b>
        <p>Choose the model used by the companions’ image tool and the Generate button below. This choice applies across characters.</p>
        <button type="button" class="menu_button" data-control="refresh">Refresh models from Venice</button>
        <p data-control="status" role="status" aria-live="polite"></p>
        <label>Image model<select class="text_pole" data-control="model"></select></label>
        <div data-control="options"></div>
        <p data-control="price"></p>
        <p><small>Your API key and filter settings come from Venice Image Generation. Its original model menu and /vimg command keep their original settings.</small></p>
        <details><summary>Generate an image yourself</summary>
            <textarea class="text_pole" data-control="prompt" rows="3" maxlength="1500" placeholder="Describe the picture you want" aria-label="Picture description"></textarea>
            <button type="button" class="menu_button" data-control="generate">Generate one image · uses Venice credits</button>
            <p data-control="generation-status" role="status" aria-live="polite"></p>
        </details>`;
    const el = name => root.querySelector(`[data-control="${name}"]`);
    const option = (value, label) => { const node = doc.createElement('option'); node.value = value; node.textContent = label; return node; };
    const status = message => { el('status').textContent = message; };
    let loading = false;

    function drawOptions() {
        const own = getSettings(), legacy = getGeneratorSettings() || {};
        const model = own.imageModels?.find(m => m.id === own.imageModel);
        el('options').replaceChildren(); el('price').textContent = '';
        if (!own.imageModel) { el('price').textContent = `Using original generator settings: ${legacy.model || 'no model selected'}.`; return; }
        if (!model) { el('price').textContent = 'Selected model is missing. Refresh the catalogue or choose another model.'; return; }
        const values = modelOptions(model, own.imageOptions?.[model.id], legacy);
        const updatePrice = () => { el('price').textContent = `${priceLabel(model, values)}${model.privacy ? ` Privacy: ${model.privacy}.` : ''}${model.offline ? ' Currently offline.' : ''}`; };
        const change = (field, value) => {
            values[field] = value;
            (own.imageOptions ||= {})[model.id] = { ...values };
            save(); updatePrice();
        };
        for (const [field, title, choices] of [
            ['aspect_ratio', 'Shape', model.constraints.aspectRatios],
            ['resolution', 'Resolution', model.constraints.resolutions],
            ['quality', 'Quality', model.constraints.qualities],
        ]) {
            if (!choices.length) continue;
            const label = doc.createElement('label'); label.textContent = title;
            const select = doc.createElement('select'); select.className = 'text_pole'; select.dataset.field = field;
            choices.forEach(value => select.append(option(value, value)));
            select.value = values[field]; select.addEventListener('change', () => change(field, select.value));
            label.append(select); el('options').append(label);
        }
        if (!model.constraints.aspectRatios.length) {
            for (const field of ['width', 'height']) {
                const label = doc.createElement('label'); label.textContent = `${field === 'width' ? 'Width' : 'Height'} (pixels)`;
                const input = doc.createElement('input'); input.className = 'text_pole'; input.type = 'number'; input.min = '64'; input.max = '1280';
                input.step = String(model.constraints.widthHeightDivisor); input.value = String(values[field]); input.dataset.field = field;
                input.addEventListener('change', () => change(field, Number(input.value)));
                label.append(input); el('options').append(label);
            }
        }
        updatePrice();
    }

    function draw() {
        const own = getSettings(), select = el('model');
        select.replaceChildren(option('', `Use original setting (${getGeneratorSettings()?.model || 'not set'})`));
        const models = own.imageModels || [];
        for (const model of models) {
            const node = option(model.id, `${model.name} (${model.id})${model.offline ? ' — offline' : ''}`);
            node.disabled = model.offline; select.append(node);
        }
        if (own.imageModel && !models.some(m => m.id === own.imageModel)) {
            select.append(option(own.imageModel, `${own.imageModel} — missing from catalogue`));
        }
        select.value = own.imageModel || '';
        drawOptions();
    }
    async function refreshModels() {
        if (loading) return;
        loading = true; el('refresh').disabled = true; status('Loading image models from Venice…');
        const key = getGeneratorSettings()?.api_key;
        try {
            const models = await fetchModels(request, key);
            if (key !== getGeneratorSettings()?.api_key) throw new Error('API key changed while loading. Refresh models again.');
            const own = getSettings(); own.imageModels = models; own.imageModelsUpdated = new Date().toISOString();
            save(); draw(); status(`${models.length} image models loaded. Current selection kept.`);
        } catch (e) { status(e.message || 'Unable to load image models.'); }
        finally { loading = false; el('refresh').disabled = false; }
    }
    el('refresh').addEventListener('click', refreshModels);
    el('model').addEventListener('change', () => { getSettings().imageModel = el('model').value; save(); drawOptions(); });
    el('generate').addEventListener('click', async () => {
        const button = el('generate'); button.disabled = true;
        el('generation-status').textContent = 'Generating one image…';
        try {
            await bridge.generateManual({ prompt: el('prompt').value });
            el('generation-status').textContent = 'Image posted in the current chat.';
        } catch (e) { el('generation-status').textContent = e.message || 'Image generation failed.'; }
        finally { button.disabled = false; }
    });
    draw();
    status(getSettings().imageModelsUpdated ? `Saved catalogue from ${getSettings().imageModelsUpdated}.` : 'Load the catalogue to see Venice’s available image models.');
    if (getGeneratorSettings()?.api_key) void refreshModels();
    return { refreshModels, draw };
}
