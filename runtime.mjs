import { adaptAssistantImages, characterKey, imageRequestBody, isVeniceConnection, TOOL_NAME } from './core.mjs';
import { selectedGeneratorSettings } from './models.mjs';
import { portraitPlan, attachPortrait, editedImage, PORTRAIT_TOOL, initiationPortraitArgs, referenceCostUsd } from './portraits.mjs';
import { userPortraitPlan, USER_PORTRAIT_KEY, USER_PORTRAIT_TOOL } from './portraits.mjs';

export function createBridge(deps) {
    const { getContext, getSettings, getGeneratorSettings, fetch: request, saveImage, publishImage } = deps;
    let busy = false;
    let controller = null;
    // One attempted tool generation per user turn, including provider errors.
    // Prevents model retries from making repeated charged calls in the same reply.
    const attemptedTurns = new WeakSet();
    let initiation = null;
    let initiationOwner = null;
    const allowances = new WeakSet();

    function validAllowance(token, consume = false) {
        const c = getContext();
        if (!token || token !== initiation || !allowances.has(token) || token.cancelled
            || Date.now() >= token.expiresAt || characterKey(c) !== token.avatar
            || c.chatId !== token.chatId || c.chat !== token.chat || !token.isCurrent()) {
            throw new Error('Initiation image allowance expired, cancelled or belongs to another chat.');
        }
        if (consume) {
            if (token.consumed) throw new Error('This initiation has already attempted its one image.');
            token.consumed = true;
        }
        return token;
    }

    function beginInitiation(options) {
        if (!manualReady() || busy || initiation) throw new Error('Image bridge is not ready for an initiation.');
        if (initiationOwner && (initiationOwner.cancelled || initiationOwner.attemptId !== options.attemptId)) throw new Error('Another or cancelled initiation owns the bridge.');
        const c = getContext();
        if (options.avatar !== characterKey(c) || options.chatId !== c.chatId) throw new Error('Initiation chat changed.');
        const token = { ...options, chat: c.chat, consumed: false, cancelled: false,
            expiresAt: Math.min(Date.now() + 2 * 60000, options.deadline) };
        allowances.add(token); initiation = token;
        try { validAllowance(token); }
        catch (error) { initiation = null; allowances.delete(token); throw error; }
        return token;
    }

    function cancel(attemptId) {
        if (attemptId && initiation?.attemptId !== attemptId && initiationOwner?.attemptId !== attemptId) return;
        if (initiationOwner) {
            if (initiationOwner.cancelled) return;
            initiationOwner.cancelled = true;
        }
        if (initiation) {
            if (initiation.cancelled) return;
            initiation.cancelled = true;
        }
        controller?.abort();
    }

    function manualReady() {
        const c = getContext();
        const key = characterKey(c);
        return !!(getSettings().enabled && key && getSettings().characters?.[key]
            && isVeniceConnection(c) && c.chatCompletionSettings.media_inlining
            && getGeneratorSettings()?.api_key);
    }
    function ready() { return manualReady() && !!getContext().chatCompletionSettings.function_calling; }

    function turnAvailable() {
        const c = getContext(), i = c.chat.findLastIndex(m => m.is_user && !m.is_system);
        return i >= 0 && !attemptedTurns.has(c.chat[i])
            && !c.chat.slice(i + 1).some(m => m.extra?.venice_bridge?.via_tool && m.extra?.venice_bridge?.via !== 'initiation');
    }

    function adapt(event) {
        if (!getSettings().enabled || !isVeniceConnection(getContext())) return;
        const result = adaptAssistantImages(event.chat);
        if (result.imagesMoved) event.chat.splice(0, event.chat.length, ...result.messages);
        deps.onAdapt?.({ ...result, messages: undefined, dryRun: !!event.dryRun });
    }

    async function generate(args, manual = false, portrait = false, allowance = null) {
        if ((initiation || initiationOwner) && !allowance) throw new Error('An initiation owns the image bridge. Wait for it to finish.');
        if (allowance) validAllowance(allowance);
        if (!((manual || allowance) ? manualReady() : ready())) throw new Error('Venice Image Bridge is not enabled for this character, or inline images/function calling is off.');
        if (busy) throw new Error('An image is already being generated. Wait for it to finish.');
        const c = getContext();
        const userIndex = c.chat.findLastIndex(m => m.is_user && !m.is_system);
        const userMessage = c.chat[userIndex];
        if (!manual && !allowance && !userMessage) throw new Error('Wait for a user message before generating a picture.');
        if (!manual && !allowance && (attemptedTurns.has(userMessage) || c.chat.slice(userIndex + 1).some(m => m.extra?.venice_bridge?.via_tool && m.extra?.venice_bridge?.via !== 'initiation'))) {
            throw new Error('One image attempt is allowed per user turn. Reply with the result; wait for another user message before generating again.');
        }
        const legacy = { ...getGeneratorSettings() };
        const settings = portrait ? legacy : selectedGeneratorSettings(legacy, getSettings());
        const human = portrait === 'user' || portrait === 'together';
        const plan = human ? userPortraitPlan(getSettings(), characterKey(c), legacy, args, portrait === 'together')
            : portrait ? portraitPlan(getSettings(), characterKey(c), legacy, args) : null;
        const initiationCost = allowance ? referenceCostUsd(getSettings(), characterKey(c)) : null;
        let body = portrait ? plan.body : imageRequestBody(settings, args);
        const identity = { chat: c.chat, chatId: c.chatId, characterId: c.characterId, key: characterKey(c), name: c.name2 };
        const stillHere = () => {
            const now = getContext();
            return (!allowance || (!allowance.cancelled && Date.now() < allowance.expiresAt && allowance.isCurrent()))
                && now.chat === identity.chat && now.chatId === identity.chatId
                && now.characterId === identity.characterId && characterKey(now) === identity.key;
        };
        if (allowance) validAllowance(allowance, true);
        else if (!manual) attemptedTurns.add(userMessage);
        busy = true;
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 120000);
        try {
            if (portrait) {
                const images = [];
                for (const url of plan.urls || [plan.url]) {
                    images.push(await deps.loadReference(url, controller.signal));
                    if (!stillHere() || controller.signal.aborted) throw new Error('Chat changed or generation stopped before the reference was sent. No image request was made.');
                }
                if (!stillHere() || controller.signal.aborted) throw new Error('Chat changed or generation stopped before the reference was sent. No image request was made.');
                body = attachPortrait(plan, images);
            }
            if (allowance) {
                validAllowance(allowance);
                // Synchronous budget reservation under the caller's Web Lock,
                // immediately before the potentially charged provider request.
                allowance.beforeRequest(initiationCost);
                validAllowance(allowance);
            }
            const response = await request(portrait ? plan.endpoint : 'https://api.venice.ai/api/v1/image/generate', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.api_key}` },
                body: JSON.stringify(body), signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Venice image generation returned HTTP ${response.status}. No automatic retry was made.`);
            const result = portrait ? await editedImage(response) : { base64: (await response.json())?.images?.[0], extension: 'png' };
            const { base64, extension } = result;
            if (typeof base64 !== 'string' || !base64.length) throw new Error('Venice returned no image.');
            const url = await saveImage(base64, identity.name, extension);
            if (!stillHere()) throw new Error(`The chat changed during generation. The image was saved in the original character's gallery; it was not posted into another chat.`);
            if (controller.signal.aborted) throw new Error('Generation was stopped. The returned image was saved to the character gallery.');
            const react = portrait === true && !manual && !allowance && typeof deps.queuePortraitContinuation === 'function';
            const messageId = await publishImage({ suppressCaption: react, url, prompt: portrait ? args.prompt.trim() : body.prompt, context: c, isCurrent: stillHere, manual, portrait,
                via: allowance ? 'initiation' : undefined, attemptId: allowance?.attemptId, onPublished: allowance?.onPublished });
            if (react && stillHere() && !controller.signal.aborted) {
                deps.queuePortraitContinuation({ context: c, messageId, userMessage, isCurrent: stillHere });
            }
            return JSON.stringify({
                status: 'created', image_url: url, message_id: messageId, ...(portrait ? { reference_used: true } : {}),
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
            description: 'Create and share one image in the current chat. Use when the user requests a picture, or when sharing a picture is appropriate to the conversation and their preferences. Write the full visual prompt yourself. For a picture of yourself, use VeniceCreateSelfPortrait when available: it attaches your fixed reference face. Use this tool for other subjects or when no reference portrait is configured. Never claim to have sent an image unless this tool succeeds. Only one image attempt per user turn; after a result or failure, reply in words.',
            parameters: {
                type: 'object', properties: {
                    prompt: { type: 'string', description: 'Complete visual description, up to 1500 characters.' },
                    negative_prompt: { type: 'string', description: 'Optional things to exclude; up to 1500 characters.' },
                }, required: ['prompt'], additionalProperties: false,
            },
            shouldRegister: () => ready() && turnAvailable(), action: args => generate(args),
            formatMessage: () => 'Creating a picture with Venice…',
        };
    }

    function portraitReady() {
        const c = getContext(), s = getSettings(), ref = s.portraits?.[characterKey(c)];
        return ready() && !!(ref?.url && s.editModels?.some(m => m.id === ref.model && !m.offline));
    }
    function portraitTool() {
        return { name: PORTRAIT_TOOL, displayName: 'Create a self-portrait',
            description: 'Create and share a new picture of yourself using your fixed reference portrait, attached automatically. Describe the new scene, clothes, pose and expression; preserve your identity. Use this for pictures of yourself instead of VeniceCreateImage. Only your own configured reference can be used. One image attempt per user turn across both image tools. After success or failure, reply in words. Inspect the returned image before describing its actual details.',
            parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'New scene, pose, clothes and expression, up to 1500 characters. The original face reference is attached automatically.' } }, required: ['prompt'], additionalProperties: false },
            shouldRegister: () => portraitReady() && turnAvailable(), action: args => generate(args, false, true), formatMessage: () => 'Creating a picture using my reference portrait…' };
    }

    function userPortraitReady() {
        const s = getSettings(), ref = s.portraits?.[USER_PORTRAIT_KEY];
        return ready() && !!(ref?.url && s.editModels?.some(m => m.id === ref.model && !m.offline));
    }
    function userPortraitTool() {
        return { name: USER_PORTRAIT_TOOL, displayName: 'Create a picture of the user or both of you',
            description: 'Create a picture of the human user using their saved reference. Set include_character to true for a picture of the user and yourself together, using both saved references. Describe the scene; reference identities are attached automatically. One image attempt per user turn shared with the other image tools. After success or failure, reply in words.',
            parameters: { type: 'object', properties: {
                prompt: { type: 'string', description: 'Scene, pose, clothing and expression, up to 1500 characters.' },
                include_character: { type: 'boolean', description: 'True to include the current companion with the human user; false for the human user alone.' },
            }, required: ['prompt'], additionalProperties: false },
            shouldRegister: () => userPortraitReady() && turnAvailable(),
            action: args => generate(args, false, args?.include_character === true ? 'together' : 'user'),
            formatMessage: () => 'Creating a picture using the saved personal reference…' };
    }

    return { userPortraitReady, userPortraitTool, generateUserPortraitManual: args => generate(args, true, args?.include_character === true ? 'together' : 'user'), portraitReady, portraitTool, generatePortraitManual: args => generate(args, true, true), adapt, generate: args => generate(args), generateManual: args => generate(args, true), tool, ready, manualReady, cancel,
        withVideoStillLock: async action => {
            if (busy || initiation || initiationOwner) throw new Error('An image is already being prepared. Video will wait.');
            busy = true;
            try { return await action(); } finally { busy = false; }
        },
        initiationVersion: 1, beginInitiation,
        claimInitiation: owner => {
            if (busy || initiationOwner) throw new Error('Image bridge already has an owner.');
            initiationOwner = { ...owner, cancelled: false };
        },
        releaseInitiation: id => { if (initiationOwner?.attemptId === id) initiationOwner = null; },
        initiationStatus: () => ({ ready: manualReady() && !busy && !initiation && !initiationOwner,
            costUsd: referenceCostUsd(getSettings(), characterKey(getContext())) }),
        generateInitiation: (token, scene) => generate(initiationPortraitArgs(getSettings(), token.avatar, scene), false, true, token),
        endInitiation: token => { if (token === initiation) { allowances.delete(token); initiation = null; } },
        handleGenerationStopped: () => initiationOwner ? initiationOwner.onStop?.() : initiation ? initiation.onStop?.() : cancel(),
        get busy() { return busy; } };
}
