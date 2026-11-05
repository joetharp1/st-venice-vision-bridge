import { adaptAssistantImages, characterKey, imageRequestBody, isVeniceConnection, TOOL_NAME } from './core.mjs';
import { selectedGeneratorSettings } from './models.mjs';

export function createBridge(deps) {
    const { getContext, getSettings, getGeneratorSettings, fetch: request, saveImage, publishImage } = deps;
    let busy = false;
    let controller = null;
    // One attempted tool generation per user turn, including provider errors.
    // Prevents model retries from making repeated charged calls in the same reply.
    const attemptedTurns = new WeakSet();

    function manualReady() {
        const c = getContext();
        const key = characterKey(c);
        return !!(getSettings().enabled && key && getSettings().characters?.[key]
            && isVeniceConnection(c) && c.chatCompletionSettings.media_inlining
            && getGeneratorSettings()?.api_key);
    }
    function ready() { return manualReady() && !!getContext().chatCompletionSettings.function_calling; }

    function adapt(event) {
        if (!getSettings().enabled || !isVeniceConnection(getContext())) return;
        const result = adaptAssistantImages(event.chat);
        if (result.imagesMoved) event.chat.splice(0, event.chat.length, ...result.messages);
        deps.onAdapt?.({ ...result, messages: undefined, dryRun: !!event.dryRun });
    }

    async function generate(args, manual = false) {
        if (!(manual ? manualReady() : ready())) throw new Error('Venice Image Bridge is not enabled for this character, or inline images/function calling is off.');
        if (busy) throw new Error('An image is already being generated. Wait for it to finish.');
        const c = getContext();
        const userIndex = c.chat.findLastIndex(m => m.is_user && !m.is_system);
        const userMessage = c.chat[userIndex];
        if (!manual && !userMessage) throw new Error('Wait for a user message before generating a picture.');
        if (!manual && (attemptedTurns.has(userMessage) || c.chat.slice(userIndex + 1).some(m => m.extra?.venice_bridge?.via_tool))) {
            throw new Error('One image attempt is allowed per user turn. Reply with the result; wait for another user message before generating again.');
        }
        const settings = selectedGeneratorSettings({ ...getGeneratorSettings() }, getSettings());
        const body = imageRequestBody(settings, args);
        const identity = { chat: c.chat, chatId: c.chatId, characterId: c.characterId, key: characterKey(c), name: c.name2 };
        const stillHere = () => {
            const now = getContext();
            return now.chat === identity.chat && now.chatId === identity.chatId
                && now.characterId === identity.characterId && characterKey(now) === identity.key;
        };
        if (!manual) attemptedTurns.add(userMessage);
        busy = true;
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 120000);
        try {
            const response = await request('https://api.venice.ai/api/v1/image/generate', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.api_key}` },
                body: JSON.stringify(body), signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Venice image generation returned HTTP ${response.status}. No automatic retry was made.`);
            const data = await response.json();
            const base64 = data?.images?.[0];
            if (typeof base64 !== 'string' || !base64.length) throw new Error('Venice returned no image.');
            const url = await saveImage(base64, identity.name);
            if (!stillHere()) throw new Error(`The chat changed during generation. The image was saved in the original character's gallery; it was not posted into another chat.`);
            if (controller.signal.aborted) throw new Error('Generation was stopped. The returned image was saved to the character gallery.');
            await publishImage({ url, prompt: body.prompt, context: c, isCurrent: stillHere, manual });
            return JSON.stringify({
                status: 'created', image_url: url,
                instruction: 'The image has been posted in this chat. Inspect the accompanying image input before describing its actual details. Do not call this tool again until the user sends another message.',
            });
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('Image generation stopped or timed out. The provider may still have processed it; no automatic retry was made.');
            throw error;
        } finally {
            clearTimeout(timeout);
            controller = null;
            busy = false;
        }
    }

    function tool() {
        return {
            name: TOOL_NAME, displayName: 'Create a Venice image',
            description: 'Create and share one image in the current chat. Use when the user requests a picture, or when sharing a picture is appropriate to the conversation and their preferences. Write the full visual prompt yourself. Include established appearance details for portraits. Never claim to have sent an image unless this tool succeeds. Only one image attempt per user turn; after a result or failure, reply in words.',
            parameters: {
                type: 'object', properties: {
                    prompt: { type: 'string', description: 'Complete visual description, up to 1500 characters.' },
                    negative_prompt: { type: 'string', description: 'Optional things to exclude; up to 1500 characters.' },
                }, required: ['prompt'], additionalProperties: false,
            },
            shouldRegister: ready, action: args => generate(args),
            formatMessage: () => 'Creating a picture with Venice…',
        };
    }

    return { adapt, generate: args => generate(args), generateManual: args => generate(args, true), tool, ready, manualReady, cancel: () => controller?.abort(), get busy() { return busy; } };
}
