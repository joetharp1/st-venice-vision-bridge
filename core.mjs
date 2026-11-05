import { catalogueRequest } from './models.mjs';
export const TOOL_NAME = 'VeniceCreateImage';
export const IMAGE_LABEL = 'Image attached to the preceding assistant message, supplied automatically by the chat application for visual inspection. This is not a new message written by the human user.';

// Gate on the actual destination, not the model display name.
export function isVeniceConnection(context) {
    const s = context?.chatCompletionSettings;
    if (context?.mainApi !== 'openai' || s?.chat_completion_source !== 'custom') return false;
    try {
        const url = new URL(s.custom_url);
        return url.protocol === 'https:' && url.hostname === 'api.venice.ai'
            && !url.username && !url.password
            && /^\/api\/v1\/?$/.test(url.pathname);
    } catch { return false; }
}

export function characterKey(context) {
    if (context?.groupId) return null;
    return context?.characters?.[context.characterId]?.avatar || null;
}

// Only the outbound array changes. The stored chat and the displayed authors do not.
// Deferred inserts preserve assistant tool_calls -> all tool results adjacency.
export function adaptAssistantImages(messages) {
    if (!Array.isArray(messages)) throw new TypeError('Expected a message array');
    const output = [];
    const pendingCalls = new Set();
    let deferred = [];
    let imagesMoved = 0;
    for (const message of messages) {
        let current = message;
        let images = [];
        if (message?.role === 'assistant' && Array.isArray(message.content)) {
            images = message.content.filter(part => part?.type === 'image_url');
            if (images.length) {
                const content = message.content.filter(part => part?.type !== 'image_url');
                current = { ...message, content: content.length ? content : '' };
                imagesMoved += images.length;
            }
        }
        // Preserve empty assistant records too: they may carry tool metadata.
        output.push(current);
        if (current?.role === 'assistant' && Array.isArray(current.tool_calls)) {
            for (const call of current.tool_calls) if (call?.id) pendingCalls.add(call.id);
        }
        if (current?.role === 'tool') pendingCalls.delete(current.tool_call_id);
        if (images.length) {
            deferred.push({
                role: 'user',
                content: [{ type: 'text', text: IMAGE_LABEL }, ...images],
            });
        }
        if (!pendingCalls.size && deferred.length) {
            output.push(...deferred);
            deferred = [];
        }
    }
    // Never insert an image into an incomplete tool exchange. ST must finish it first.
    // Keep the image out of the rejected assistant role; it can be sent next request.
    return { messages: output, imagesMoved, imagesDeferred: deferred.reduce((n, m) => n + m.content.length - 1, 0) };
}

export function parseImageArguments(args) {
    if (!args || typeof args.prompt !== 'string' || !args.prompt.trim()) throw new Error('A picture description is required.');
    const prompt = args.prompt.trim();
    if (prompt.length > 1500) throw new Error('Use a picture description of at most 1500 characters.');
    if (args.negative_prompt !== undefined && typeof args.negative_prompt !== 'string') throw new Error('negative_prompt must be text.');
    const negative = (args.negative_prompt || '').trim();
    if (negative.length > 1500) throw new Error('The negative prompt must be at most 1500 characters.');
    return { prompt, negative };
}

export function imageRequestBody(settings, args) {
    const { prompt, negative } = parseImageArguments(args);
    if (settings?.catalogueModel) {
        return catalogueRequest(settings, prompt, [negative, settings.negative_prompt].filter(Boolean).join(', '));
    }
    if (typeof settings?.model !== 'string' || !settings.model) throw new Error('Choose an image model in Venice Image Generation first.');
    const width = Number(settings.width), height = Number(settings.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 4096 || height > 4096) {
        throw new Error('Choose a valid image size in Venice Image Generation first.');
    }
    const body = {
        model: settings.model, prompt, width, height, format: 'png',
        hide_watermark: !!settings.hide_watermark, safe_mode: !!settings.safe_mode, return_binary: false,
    };
    const negatives = [negative, settings.negative_prompt].filter(Boolean).join(', ');
    if (negatives) body.negative_prompt = negatives;
    return body;
}
