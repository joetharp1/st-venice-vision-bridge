// Opt-in, memory-only observer. It never changes a request or consumes ST's response.
const PATH = '/api/backends/chat-completions/generate';
const LIMIT = 65536;
const numeric = ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'max_tokens'];
const safeName = value => typeof value === 'string' && /^[\w./:-]{1,100}$/.test(value) ? value : '[other]';

export function describeRequest(data, bytes) {
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const pending = new Set(), issues = [], rows = [];
    let images = 0;
    for (let index = 0; index < messages.length; index++) {
        const m = messages[index] || {}, parts = Array.isArray(m.content) ? m.content : [];
        const imageCount = parts.filter(p => p?.type === 'image_url').length;
        const textChars = typeof m.content === 'string' ? m.content.length : parts.reduce((n, p) => n + (typeof p?.text === 'string' ? p.text.length : 0), 0);
        const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
        if (pending.size && m.role !== 'tool') issues.push({ index, issue: 'message before all tool results' });
        if (m.role === 'tool') {
            if (!pending.delete(m.tool_call_id)) issues.push({ index, issue: 'unmatched tool result' });
        }
        for (const call of calls) if (call?.id) pending.add(call.id);
        const emptyContent = m.content == null || (typeof m.content === 'string' ? !m.content.trim()
            : Array.isArray(m.content) && parts.every(p => p?.type === 'text' && typeof p.text === 'string' && !p.text.trim()));
        if (emptyContent && !calls.length && !m.function_call) issues.push({ index, issue: 'empty content without a tool call' });
        if (m.role === 'assistant' && imageCount) issues.push({ index, issue: 'assistant image part' });
        images += imageCount;
        rows.push({ index, role: safeName(m.role), textChars, images: imageCount, toolCalls: calls.length, contentType: Array.isArray(m.content) ? 'array' : m.content === null ? 'null' : typeof m.content });
    }
    if (pending.size) issues.push({ issue: 'tool calls missing results', count: pending.size });
    const sampling = {};
    for (const key of numeric) if (typeof data[key] === 'number' && Number.isFinite(data[key])) sampling[key] = data[key];
    return { model: safeName(data.model), stream: data.stream === true, bytes, sampling,
        tools: Array.isArray(data.tools) ? data.tools.length : 0,
        toolChoice: typeof data.tool_choice === 'string' ? safeName(data.tool_choice) : typeof data.tool_choice,
        jsonSchema: !!data.json_schema, responseFormat: safeName(data.response_format?.type),
        customIncludeBodyPresent: !!data.custom_include_body, customExcludeBodyPresent: !!data.custom_exclude_body,
        messageCount: messages.length, images, lastMessages: rows.slice(-30), structuralWarnings: issues.slice(-30) };
}

// Remove known request strings (including fragments), data URLs, credentials and URLs
// from error text. Never copy arbitrary error object fields, input values or choices.
function errorSanitizer(data) {
    const literals = [];
    function collect(value, depth = 0) {
        if (depth > 12) return;
        if (typeof value === 'string' && value.length >= 4) literals.push(value);
        else if (Array.isArray(value)) value.forEach(v => collect(v, depth + 1));
        else if (value && typeof value === 'object') Object.values(value).forEach(v => collect(v, depth + 1));
    }
    collect(data.messages); collect(data.tools);
    for (const [key, value] of Object.entries(data)) if (/key|token|password|authorization|custom_include_body/i.test(key)) collect(value);
    return value => {
        if (typeof value !== 'string') return undefined;
        // Standard complete status strings contain no user content. Keep them
        // readable even when a common word also occurs in the conversation.
        if (['Bad Request', 'Invalid request parameters', 'Unauthorized', 'Forbidden', 'Request Entity Too Large', 'Payload Too Large', 'Internal Server Error'].includes(value)) return value;
        let text = value;
        text = text.replace(/data:[^\s"'<>]+/gi, '[image omitted]').replace(/https?:\/\/[^\s"'<>]+/gi, '[URL omitted]')
            .replace(/Bearer\s+[^\s"']+/gi, '[credential omitted]').replace(/\bsk-[\w-]+/g, '[credential omitted]');
        for (const literal of literals) {
            if (literal.length <= 2048) text = text.split(literal).join('[request text omitted]');
        }
        // An upstream validator can echo only a fragment of a long message.
        text = text.replace(/[^\s"'<>]{4,}/g, word => literals.some(s => s.includes(word)) ? '[request fragment omitted]' : word);
        return text.slice(0, 1800);
    };
}

function pickError(value, clean, depth = 0) {
    if (depth > 6) return '[nested detail omitted]';
    if (typeof value === 'string') return clean(value);
    if (Array.isArray(value)) return value.slice(0, 8).map(v => pickError(v, clean, depth + 1));
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const key of ['message', 'detail', 'details', 'error', 'errors', 'issues', 'type', 'code', 'param', 'path', 'loc', 'msg', 'request_id']) {
        if (Object.hasOwn(value, key)) out[key] = pickError(value[key], clean, depth + 1);
    }
    return out;
}

async function observeResponse(response, record, clean, update, { maxBytes, timeoutMs }) {
    let reader, timer;
    try {
        const copy = response.clone();
        reader = copy.body?.getReader();
        if (!reader) { record.outcome = 'Response had no readable body'; return; }
        const decoder = new TextDecoder();
        const sse = (response.headers.get('content-type') || '').includes('text/event-stream');
        let bytes = 0, buffer = '', finished = false;
        const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs); });
        function parse(text) {
            if (text.trim() === '[DONE]') { finished = true; return; }
            try {
                const body = JSON.parse(text);
                if (body?.error || body?.detail || body?.message || body?.errors) {
                    record.error = pickError(body, clean);
                    record.outcome = 'Error returned to browser'; finished = true;
                } else if (body?.choices) record.outcome = 'Completion data received';
            } catch { /* The bounded raw body is never included in the report. */ }
        }
        while (!finished) {
            const result = await Promise.race([reader.read(), timeout]);
            if (result.timedOut) { record.observation = 'Observation timed out; request was not cancelled'; break; }
            if (result.done) { if (!sse) parse(buffer); break; }
            bytes += result.value.byteLength;
            if (bytes > maxBytes) { record.observation = 'Response observation size limit reached'; break; }
            buffer += decoder.decode(result.value, { stream: true });
            if (sse) {
                const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop();
                for (const event of events) {
                    const payload = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
                    if (payload) parse(payload);
                    if (finished) break;
                }
            }
        }
        if (record.outcome === 'Response headers received') record.outcome = response.ok ? 'No structured error captured' : 'HTTP failure; no structured detail exposed';
    } catch {
        record.observation = 'Could not inspect the response copy';
    } finally {
        clearTimeout(timer);
        // Cancels only the observer's tee branch, never the original response.
        try { reader?.cancel().catch(() => {}); } catch { /* observer only */ }
        update();
    }
}

export function createRequestDiagnostics({ fetch: originalFetch, origin, enabled, onUpdate = () => {}, now = Date.now, maxBytes = LIMIT, timeoutMs = 20000 }) {
    let remaining = 0, until = 0, records = [], epoch = 0;
    const notify = () => { try { onUpdate(); } catch { /* diagnostics cannot stop chat */ } };
    function eligible(input, init) {
        if (!remaining || now() > until || !enabled()) return false;
        try {
            const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, origin);
            return url.origin === origin && url.pathname === PATH && (init?.method || input?.method || 'GET').toUpperCase() === 'POST' && typeof init?.body === 'string';
        } catch { return false; }
    }
    const api = {
        arm() { epoch++; records = []; remaining = 3; until = now() + 300000; notify(); },
        clear() { epoch++; records = []; remaining = 0; notify(); },
        report() { return JSON.stringify({ bridge: '0.6.5', captureRemaining: now() <= until ? remaining : 0, requests: records }, null, 2); },
        async fetch(input, init) {
            let record, clean, captureEpoch;
            try {
                if (eligible(input, init)) {
                    const data = JSON.parse(init.body);
                    const target = new URL(data.custom_url);
                    if (data.chat_completion_source === 'custom' && target.protocol === 'https:' && target.hostname === 'api.venice.ai' && !target.username && !target.password) {
                        record = { started: new Date(now()).toISOString(), request: describeRequest(data, new TextEncoder().encode(init.body).length), outcome: 'Request started' };
                        clean = errorSanitizer(data); captureEpoch = epoch;
                        records.push(record); remaining--; notify();
                    }
                }
            } catch { /* Unknown request shapes pass through unchanged. */ }
            let response;
            try { response = await originalFetch(input, init); }
            catch (error) {
                if (record && captureEpoch === epoch) { record.outcome = error?.name === 'AbortError' ? 'Request aborted' : 'Fetch rejected before a response'; notify(); }
                throw error;
            }
            if (record && captureEpoch === epoch) {
                record.httpStatus = response.status;
                record.outcome = 'Response headers received'; notify();
                void observeResponse(response, record, clean, () => { if (captureEpoch === epoch) notify(); }, { maxBytes, timeoutMs });
            }
            return response;
        },
    };
    return api;
}
