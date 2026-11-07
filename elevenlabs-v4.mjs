// Optional TTS provider; no character, chat or image-generation settings are changed.
export const PROVIDER_NAME = 'ElevenLabs';
export const MODELS = ['eleven_v4_turbo', 'eleven_v4'];

export function createV4Provider(Base, { getRequestHeaders, request = (...args) => fetch(...args) }) {
    return class ElevenLabsV4Provider extends Base {
        constructor() {
            super();
            this.defaultSettings = { ...this.defaultSettings, voiceMap: {}, model: 'eleven_v4_turbo', stability: 0.4, similarity_boost: 0.8 };
        }

        get settingsHtml() {
            const html = super.settingsHtml;
            if (!html.includes('id="elevenlabs_tts_model"')) throw new Error('ElevenLabs provider layout changed; v4 support needs an update.');
            return html.replace(/<select id="elevenlabs_tts_model"[^>]*>[\s\S]*?<\/select>/,
                '<select id="elevenlabs_tts_model" class="text_pole"><option value="eleven_v4_turbo">Eleven v4 Turbo</option><option value="eleven_v4">Eleven v4</option></select>')
                .replace(/<label for="elevenlabs_tts_speed">[\s\S]*?<input id="elevenlabs_tts_speed"[^>]*\/>/,
                    '<input id="elevenlabs_tts_speed" type="hidden" value="1" /><small>v4 uses Stability and Similarity. Pacing and expression come from the speech text and audio tags.</small>');
        }

        shouldInvolveExtendedSettings() { return false; }

        async loadSettings(settings) {
            const copy = { ...settings };
            if (!MODELS.includes(copy.model)) copy.model = 'eleven_v4_turbo';
            return super.loadSettings(copy);
        }

        // The built-in history lookup matches only text and voice, so it can replay
        // audio from another model/settings. Always synthesize this explicit request.
        async generateTts(text, voiceId) { return this.fetchTtsGeneration(text, voiceId); }

        async fetchTtsGeneration(text, voiceId) {
            if (!MODELS.includes(this.settings.model)) throw new Error('Choose Eleven v4 Turbo or Eleven v4.');
            if (!voiceId || typeof text !== 'string' || !text.trim()) throw new Error('Select a voice and provide speech text.');
            const stability = Number(this.settings.stability), similarity = Number(this.settings.similarity_boost);
            if (![stability, similarity].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Voice settings must be between 0 and 100%.');
            const response = await request('/api/speech/elevenlabs/synthesize', {
                method: 'POST', headers: getRequestHeaders(),
                body: JSON.stringify({ voiceId, request: { model_id: this.settings.model, text,
                    voice_settings: { stability, similarity_boost: similarity } } }),
            });
            if (!response.ok) throw new Error(`ElevenLabs v4 speech failed (HTTP ${response.status}). Check the ElevenLabs key and model access; server logs contain the provider response.`);
            return response;
        }
    };
}

const patched = new WeakSet();

// Keep ST's existing provider identity so saved mappings load normally at startup.
export function extendNativeProvider(Base, deps) {
    if (patched.has(Base)) return;
    const proto = Base.prototype;
    const html = Object.getOwnPropertyDescriptor(proto, 'settingsHtml');
    const generate = proto.generateTts, fetchGeneration = proto.fetchTtsGeneration;
    const load = proto.loadSettings, change = proto.onSettingsChange, extended = proto.shouldInvolveExtendedSettings;
    if (!html?.get || !generate || !fetchGeneration || !load || !change || !extended) throw new Error('ElevenLabs provider interface changed.');
    const V4 = createV4Provider(Base, deps);
    Object.defineProperty(proto, 'settingsHtml', { ...html, get() {
        return html.get.call(this).replace(/(<select id="elevenlabs_tts_model"[^>]*>)([\s\S]*?)(<\/select>)/, (_, start, options, end) =>
            start + options + MODELS.filter(model => !options.includes(`value="${model}"`)).map(model => `<option value="${model}">${model === 'eleven_v4_turbo' ? 'Eleven v4 Turbo' : 'Eleven v4'}</option>`).join('') + end);
    } });
    proto.generateTts = function (...args) { return (MODELS.includes(this.settings.model) ? V4.prototype.generateTts : generate).apply(this, args); };
    proto.fetchTtsGeneration = function (...args) { return (MODELS.includes(this.settings.model) ? V4.prototype.fetchTtsGeneration : fetchGeneration).apply(this, args); };
    proto.shouldInvolveExtendedSettings = function () { return MODELS.includes(this.settings.model) ? false : extended.call(this); };
    proto.loadSettings = async function (...args) { const result = await load.apply(this, args); deps.updateControls?.(this.settings.model); return result; };
    proto.onSettingsChange = function (...args) { const result = change.apply(this, args); deps.updateControls?.(this.settings.model); return result; };
    patched.add(Base);
}

export async function installV4Provider() {
    const [{ ElevenLabsTtsProvider }, { getRequestHeaders }, { extension_settings }] = await Promise.all([
        import('/scripts/extensions/tts/elevenlabs.js'),
        import('/script.js'),
        import('/scripts/extensions.js'),
    ]);
    const updateControls = model => {
        const isV4 = MODELS.includes(model);
        for (const el of document.querySelectorAll('label[for="elevenlabs_tts_speed"], #elevenlabs_tts_speed')) el.hidden = isV4;
    };
    extendNativeProvider(ElevenLabsTtsProvider, { getRequestHeaders, updateControls });
    // The TTS panel may already be rendered. Add options and restore its saved
    // selection without dispatching change or rewriting any user's settings.
    const select = document.getElementById('elevenlabs_tts_model');
    if (select) {
        for (const model of MODELS) {
            if (![...select.options].some(option => option.value === model)) select.add(new Option(model === 'eleven_v4_turbo' ? 'Eleven v4 Turbo' : 'Eleven v4', model));
        }
        const saved = extension_settings.tts?.ElevenLabs?.model;
        if (saved && [...select.options].some(option => option.value === saved)) select.value = saved;
        updateControls(select.value);
    }
}
