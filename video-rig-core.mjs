// Manual acceptance rig. Never registers a model tool or changes image settings.
export const VIDEO_MODEL = 'wan-2-7-enhanced-image-to-video';
export const JOB_TTL = 2 * 60 * 60 * 1000;
export const MAX_VIDEO_BYTES = 32 * 1024 * 1024;
export const RIG_KEY = 'venice-video-rig-v1';
export const DEFAULT_MOTION = 'Starting from the supplied frame, she blinks naturally, slowly tilts her head a few degrees, and gives a small closed-mouth smile. The camera stays fixed. She finishes looking into the camera. Preserve the existing composition, lighting, clothing and background throughout. Background ambience only; no speech or music.';
export const money = usd => `US$${Number(usd).toFixed(2)} · ${Number((usd * 100).toFixed(2))} credits`;
export const activeJob = j => ['awaiting_reply', 'prepared', 'preparing', 'still_ready', 'submitting', 'uncertain', 'queued', 'saving'].includes(j.state);
export const clone = value => structuredClone(value);

export function planVideo(catalogue, mode, width, height, prompt, duration = 5, chosenResolution = null) {
    const model = catalogue?.data?.find(m => m.id === VIDEO_MODEL);
    if (!model || model.model_spec?.offline || model.offline) throw new Error('Wan 2.7 Enhanced image-to-video is not available in this account catalogue.');
    const spec = model.model_spec || {}, c = spec.constraints || {};
    const durations = c.durations, resolutions = c.resolutions;
    if (![5, 10, 15].includes(duration) || !Array.isArray(durations) || !durations.includes(`${duration}s`) || !Array.isArray(resolutions)) throw new Error('Catalogue did not confirm the requested duration. No paid submission made.');
    const resolution = chosenResolution || [...resolutions].filter(x => /^\d+p$/.test(x)).sort((a, b) => parseInt(a) - parseInt(b))[0];
    if (chosenResolution && !resolutions.includes(chosenResolution)) throw new Error('Selected video resolution is unavailable.');
    if (!resolution) throw new Error('Catalogue did not supply a supported resolution.');
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 256 || height < 256 || width * height > 24000000) throw new Error('Use a still at least 256 pixels on each side, up to 24 megapixels.');
    if (!['silent', 'ambient'].includes(mode)) throw new Error('Select silent-test or ambient mode.');
    // Current docs use this camel-case capability. Unknown means unverified, never true.
    const audioConfig = spec.capabilities?.supportsAudioConfig === true || spec.supportsAudioConfig === true;
    if (mode === 'silent' && !audioConfig) throw new Error('Silent mode unavailable: this catalogue does not advertise supportsAudioConfig. Use ambient; no stripping or silent fallback.');
    const limit = Math.min(1500, Number(c.prompt_character_limit) || 2500);
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > limit) throw new Error(`Motion prompt must contain 1–${limit} characters.`);
    const params = { model: VIDEO_MODEL, duration: `${duration}s`, resolution };
    if (audioConfig) params.audio = mode === 'ambient';
    if (Array.isArray(c.aspect_ratios) && c.aspect_ratios.length) {
        const ratio = c.aspect_ratios.find(s => {
            const [w, h] = String(s).split(':').map(Number);
            return w > 0 && h > 0 && Math.abs(width / height - w / h) < 0.015;
        });
        if (!ratio) throw new Error('Still dimensions do not match an advertised aspect ratio. Generate the still at the intended ratio first.');
        params.aspect_ratio = ratio;
    }
    return { params, prompt: prompt.trim(), mode, width, height, audioConfig };
}

export function quoteUsd(body) {
    if (typeof body?.quote !== 'number' || !Number.isFinite(body.quote) || body.quote < 0) throw new Error('Price unknown: provider returned no numeric USD quote.');
    if (body.quote > 3) throw new Error(`Quote ${money(body.quote)} exceeds the US$3 test ceiling.`);
    return body.quote;
}

export function safeError(error) {
    const name = String(error?.name || 'Error');
    const text = String(error?.message || error || 'Unknown failure')
        .replace(/https?:\/\/\S+/g, '[URL omitted]')
        .replace(/data:[^\s]+/g, '[media omitted]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [omitted]');
    return `${name}${name === 'TypeError' || name === 'TimeoutError' ? ' [network]' : ''}: ${text.slice(0, 800)}`;
}

// deps.update reads latest server state, mutates a copy, saves and verifies its revision.
// Locks are browser-profile-wide Web Locks, never scoped to the active chat.
export function createVideoRig(d) {
    const now = () => d.now();
    const patch = (id, values) => d.update(db => {
        const job = db.jobs.find(j => j.id === id);
        if (!job) throw new Error('Saved job is missing; refusing to invent a replacement.');
        Object.assign(job, values);
    });
    async function start(ticket) {
        return d.lock('submission', async () => {
            if (now() - ticket.quotedAt > 5 * 60000) throw new Error('Quote expired. Get a fresh quote first.');
            quoteUsd({ quote: ticket.usd });
            d.assertTarget(ticket.target);
            const id = d.uuid();
            await d.update(db => {
                if (db.jobs.some(j => j.ticketId === ticket.id)) throw new Error('This quoted test has already been submitted.');
                if (db.jobs.some(j => ['preparing', 'submitting', 'uncertain'].includes(j.state) && now() - j.created < JOB_TTL)) throw new Error('An earlier submission is unresolved. No second ambiguous submission is allowed.');
                if (db.jobs.filter(j => activeJob(j) && now() - j.created < JOB_TTL).length >= 2) throw new Error('Two video jobs are already active across this profile.');
                db.jobs.push({ id, ticketId: ticket.id, target: clone(ticket.target), created: now(),
                    state: 'submitting', model: ticket.plan.params.model, params: clone(ticket.plan.params),
                    mode: ticket.plan.mode, usd: ticket.usd, charge: 'reserved', sourceHash: ticket.sourceHash,
                    width: ticket.plan.width, height: ticket.plan.height, fileName: `venice_video_test_${id}.mp4` });
            });
            // Only this path can submit. Recovery never calls queue, even after an ambiguous error.
            let receipt;
            try {
                d.assertTarget(ticket.target);
            } catch (error) {
                await patch(id, { state: 'failed', charge: 'not-submitted', error: safeError(error) });
                throw error;
            }
            try {
                receipt = await d.queue({ ...ticket.plan.params, prompt: ticket.plan.prompt, image_url: ticket.image });
                if (!receipt || typeof receipt.queue_id !== 'string' || !receipt.queue_id || receipt.model !== ticket.plan.params.model) throw new Error('Queue response did not confirm the expected model and queue ID. Submission may have been charged.');
            } catch (error) {
                const definite = error.definiteRejection === true;
                await patch(id, { state: definite ? 'failed' : 'uncertain', charge: definite ? 'rejected' : 'unknown', error: safeError(error) });
                throw error;
            }
            // Emergency receipt survives a close between HTTP response and server persistence.
            d.backupReceipt(id, receipt);
            await patch(id, { queueId: receipt.queue_id, downloadUrl: receipt.download_url || null,
                state: 'queued', charge: 'submitted', confirmedAt: now(), error: null });
            d.clearReceipt(id);
            return id;
        });
    }

    async function recover() {
        const receipts = d.receipts();
        const db = await d.read();
        for (const job of db.jobs) {
            if (receipts[job.id]?.queue_id === job.queueId) d.clearReceipt(job.id);
            if (receipts[job.id] && !job.queueId) {
                const receipt = receipts[job.id];
                if (receipt.model !== job.model || !receipt.queue_id) continue;
                await patch(job.id, { queueId: receipt.queue_id, downloadUrl: receipt.download_url || null, state: 'queued', charge: 'submitted', recoveredAt: now() });
                d.clearReceipt(job.id);
            }
        }
        await d.update(state => {
            for (const job of state.jobs) {
                if (activeJob(job) && now() - job.created >= JOB_TTL) {
                    job.state = 'abandoned'; job.error = 'Two-hour retrieval deadline reached. Execution slot released; possible charge retained. No resubmission.';
                }
            }
        });
    }

    async function poll(id) {
        return d.lock(`job:${id}`, async () => {
            let job = (await d.read()).jobs.find(j => j.id === id);
            if (!job || ['failed', 'abandoned'].includes(job.state) || (job.state === 'delivered' && (job.providerCleaned || now() - job.created >= JOB_TTL))) return;
            if (job.nextPollAt && now() < job.nextPollAt) return;
            if (activeJob(job) && now() - job.created >= JOB_TTL) {
                await patch(id, { state: 'abandoned', error: 'Two-hour deadline reached. Possible charge retained. No resubmission.' }); return;
            }
            try {
                if (['queued', 'saving'].includes(job.state) && job.queueId) {
                    if (job.nextPollAt && now() < job.nextPollAt) return;
                    const result = await d.retrieve(job);
                    if (result.pending) return; // no writes every tick while the provider is simply processing
                    await patch(id, { state: 'saving' });
                    // Deterministic name + hash verification recovers a completed upload after reload.
                    const saved = await d.saveVideo(job, result.blob);
                    await patch(id, { state: 'ready', saved, error: null });
                    job = { ...job, state: 'ready', saved };
                }
                if (['ready', 'delivered'].includes(job.state)) {
                    // Provider copy is kept until both local bytes AND ST's attachment registry are confirmed.
                    if (!job.providerCleaned) {
                        try {
                            await d.cleanup(job);
                            await patch(id, { providerCleaned: true, cleanupError: null });
                        } catch (error) { await patch(id, { cleanupError: safeError(error), nextPollAt: now() + 30000 }); }
                    }
                    if (job.state === 'ready' && await d.attach(job)) await patch(id, { state: 'delivered', deliveredAt: now(), error: null });
                }
            } catch (error) {
                const terminal = error.providerFailure === true;
                await patch(id, { ...(terminal ? { state: 'failed' } : {}),
                    error: safeError(error), nextPollAt: now() + 30000,
                    ...(error.refunded ? { charge: 'refunded' } : {}) });
            }
        }, true);
    }
    async function tick() {
        await recover();
        const db = await d.read();
        await Promise.all(db.jobs.filter(j => ['queued', 'saving', 'ready'].includes(j.state) || (j.state === 'delivered' && !j.providerCleaned && now() - j.created < JOB_TTL)).map(j => poll(j.id)));
    }
    return { start, recover, poll, tick };
}
