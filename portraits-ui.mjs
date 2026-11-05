import { characterKey } from './core.mjs';
import { localImagePath } from './album-core.mjs';
import { fetchModels, modelOptions } from './models.mjs';
import { validatePortrait, portraitPrice } from './portraits.mjs';

export function mountPortraits(host) {
    const { getContext, getSettings, getGeneratorSettings, request, bridge } = host;
    const doc = host.document || document, origin = host.origin || location.origin;
    const root = doc.getElementById('venice_bridge_portraits');
    root.innerHTML = `
      <hr><h4>My reference portrait · <span data-ref="name"></span></h4>
      <p>Save one original face for this character. Their self-portrait tool will attach it automatically to each new picture. The reference stays fixed until you replace it here.</p>
      <img data-ref="preview" alt="Saved reference portrait" hidden style="max-width:140px;max-height:180px;object-fit:contain">
      <p data-ref="title"></p>
      <label>Choose a portrait from your device<input type="file" data-ref="file" accept="image/png,image/jpeg,image/webp" style="max-width:100%"></label>
      <button type="button" class="menu_button" data-ref="upload">Save reference portrait</button>
      <button type="button" class="menu_button" data-ref="clear">Stop using this reference</button>
      <p><small>You can also choose “Use as reference portrait” on a saved picture in the album below. PNG, JPEG or WebP, up to 8 MB. A separate copy is kept in this character’s picture album.</small></p>
      <button type="button" class="menu_button" data-ref="refresh">Load reference image models</button>
      <label>Reference image model<select class="text_pole" data-ref="model"></select></label>
      <div data-ref="options"></div><p data-ref="price"></p>
      <p><small>Reference pictures use an editing model and Venice credits. Provider content rules still apply. Safe Mode follows Venice Image Generation. Its negative-prompt box applies to ordinary generation; the editing API has no separate negative-prompt field. Describe exclusions in the scene if needed.</small></p>
      <details><summary>Test a self-portrait</summary>
        <textarea class="text_pole" data-ref="prompt" maxlength="1500" rows="3" placeholder="Describe a new scene, outfit or expression" aria-label="Self-portrait description"></textarea>
        <button type="button" class="menu_button" data-ref="generate">Generate self-portrait · uses credits</button>
      </details>
      <p data-ref="status" role="status" aria-live="polite"></p>`;
    const el = name => root.querySelector(`[data-ref="${name}"]`);
    const status = text => { el('status').textContent = text; };
    const option = (value, text) => { const o = doc.createElement('option'); o.value = value; o.textContent = text; return o; };
    let busy = false, shownKey;
    const capture = () => {
        const key = characterKey(getContext());
        if (!key) throw new Error('Open a one-to-one character chat first.');
        return key;
    };
    const same = key => { if (characterKey(getContext()) !== key) throw new Error('Character changed. Select the intended character and try again.'); };
    const ref = key => getSettings().portraits?.[key] || {};
    async function saveRef(key, value) {
        same(key);
        const own = getSettings(), old = own.portraits?.[key];
        (own.portraits ||= {})[key] = value;
        try { await host.persist(); }
        catch (e) { if (old === undefined) delete own.portraits[key]; else own.portraits[key] = old; throw e; }
    }
    async function run(action) {
        if (busy) return;
        busy = true; refresh();
        try { await action(); }
        catch (e) { status(e.message || 'Reference portrait operation failed.'); }
        finally { busy = false; refresh(); }
    }
    function refresh() {
        const c = getContext(), key = characterKey(c), saved = ref(key), models = getSettings().editModels || [];
        if (shownKey !== key) { el('file').value = ''; el('prompt').value = ''; status(''); shownKey = key; }
        el('name').textContent = key ? c.name2 : 'Select a character';
        const img = el('preview'); img.hidden = true; img.removeAttribute('src');
        if (saved.url) { try { img.src = localImagePath(saved.url, origin); img.hidden = false; } catch { status('Saved portrait address is invalid. Choose the portrait again.'); } }
        el('title').textContent = saved.url ? `Reference: ${saved.title || 'Original portrait'}` : 'No reference saved for this character.';
        const select = el('model'); select.replaceChildren(option('', 'Choose a reference image model'));
        for (const model of models) { const o = option(model.id, `${model.name} (${model.id})${model.offline ? ' — offline' : ''}`); o.disabled = model.offline; select.append(o); }
        if (saved.model && !models.some(m => m.id === saved.model)) select.append(option(saved.model, `${saved.model} — missing from catalogue`));
        select.value = saved.model || '';
        el('options').replaceChildren(); el('price').textContent = '';
        const model = models.find(m => m.id === saved.model);
        if (model) {
            const values = modelOptions(model, saved.options || {});
            for (const [field, label, choices] of [['aspect_ratio', 'Shape', model.constraints.aspectRatios], ['resolution', 'Resolution', model.constraints.resolutions], ['quality', 'Quality', model.constraints.qualities]]) {
                if (!choices.length) continue;
                const wrapper = doc.createElement('label'); wrapper.textContent = label;
                const input = doc.createElement('select'); input.className = 'text_pole'; input.dataset.field = field;
                choices.forEach(v => input.append(option(v, v))); input.value = values[field];
                input.addEventListener('change', () => {
                    const value = input.value;
                    void run(async () => { await saveRef(key, { ...ref(key), options: { ...values, [field]: value } }); status('Reference model options saved.'); });
                });
                wrapper.append(input); el('options').append(wrapper);
            }
            el('price').textContent = `${portraitPrice(model, values)}${model.privacy ? ` Privacy: ${model.privacy}.` : ''}`;
        }
        root.querySelectorAll('button,select,input,textarea').forEach(node => { node.disabled = busy || !key; });
        el('clear').disabled = busy || !key || !saved.url;
        el('generate').disabled = busy || !key || !saved.url || !model || model.offline;
    }
    async function saveCopy(dataUrl, title, key) {
        same(key);
        const url = await host.saveReference(dataUrl, String(title || 'Original portrait').slice(0, 120), key);
        localImagePath(url, origin); same(key);
        await saveRef(key, { ...ref(key), url, title: String(title || 'Original portrait').slice(0, 120) });
        status('Reference portrait saved. Choose a reference image model below if one is not selected.');
    }
    el('upload').addEventListener('click', () => {
        const file = el('file').files[0], key = characterKey(getContext());
        void run(async () => {
            if (!file) throw new Error('Choose a portrait file first.');
            status('Saving reference portrait…');
            await saveCopy(await validatePortrait(file), file.name, key);
        });
    });
    el('clear').addEventListener('click', () => {
        const key = characterKey(getContext());
        void run(async () => { const saved = { ...ref(key) }; delete saved.url; delete saved.title; await saveRef(key, saved); status('Reference detached. The saved image file was kept.'); });
    });
    el('model').addEventListener('change', () => {
        const key = characterKey(getContext()), model = el('model').value;
        void run(async () => { await saveRef(key, { ...ref(key), model, options: {} }); status('Reference image model saved for this character.'); });
    });
    el('refresh').addEventListener('click', () => run(async () => {
        status('Loading editing models…'); const key = getGeneratorSettings()?.api_key;
        const models = await fetchModels(request, key, 'inpaint');
        if (key !== getGeneratorSettings()?.api_key) throw new Error('API key changed. Load models again.');
        const own = getSettings(), old = own.editModels;
        own.editModels = models;
        try { await host.persist(); } catch (e) { own.editModels = old; throw e; }
        status(`${models.length} reference image models loaded. Choose one for this character.`);
    }));
    el('generate').addEventListener('click', () => {
        const prompt = el('prompt').value;
        void run(async () => { status('Creating a self-portrait…'); await bridge.generatePortraitManual({ prompt }); status('Self-portrait posted in the original chat.'); });
    });
    host.eventSource.on(host.event_types.CHAT_CHANGED, refresh);
    refresh();
    return { refresh, useAlbumPortrait: async (url, title, key) => {
        if (busy) throw new Error('Wait for the reference portrait operation to finish.');
        await run(async () => {
            same(key); capture(); status('Saving a separate reference copy…');
            const data = await host.loadReference(url, AbortSignal.timeout(25000));
            await saveCopy(data, title, key);
        });
        root.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    } };
}
