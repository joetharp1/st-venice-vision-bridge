import { createRigHost, dataURL, digest, localFile } from './video-rig-host.mjs';
import { planVideo, quoteUsd, RIG_KEY } from './video-rig-core.mjs';
import { stillPlan, config, findAnnouncement } from './video-core.mjs';
import { attachPortrait, editedImage, USER_PORTRAIT_KEY } from './portraits.mjs';
import { parseModels } from './models.mjs';
import { characterKey, isVeniceConnection } from './core.mjs';

export function createCompanionHost(host) {
    const d = createRigHost(host), stopped = new Set();
    const baseReport = d.report;
    function availability() {
        const c = host.getContext(), s = host.getSettings(), cfg = config(d.cached());
        const enabled = cfg.characters[characterKey(c)] === true;
        const reason = c.groupId || !c.chatId || !characterKey(c) ? 'Open a saved one-to-one companion chat.'
            : !s.enabled ? 'Venice Image Bridge is disabled.'
            : !isVeniceConnection(c) ? 'Select the Venice chat connection.'
            : !enabled ? 'Video is OFF for this companion. Tick Enable video and press Save video settings.'
            : !s.characters?.[characterKey(c)] ? 'Enable the image bridge for this companion so it can prepare video stills.'
            : !c.chatCompletionSettings?.function_calling ? 'Enable function calling in Chat Completion settings.'
            : !c.chatCompletionSettings?.media_inlining ? 'Enable inline images/media in Chat Completion settings.'
            : !host.extension_settings['st-venice-image']?.api_key ? 'Configure the existing Venice image API key.'
            : cfg.dailyUSD === null || cfg.monthlyUSD === null ? 'Check live prices to initialise the video budget.' : null;
        return { ready: reason === null, companionEnabled: enabled, reason: reason || 'Video tool READY — VeniceCreateVideo is available to this companion.' };
    }
    const currentMatches = target => {
        try { const c = d.target(); return c.avatar === target.avatar && c.chatId === target.chatId; } catch { return false; }
    };
    async function prepare(args, c, frozen) {
        if (typeof args.motion !== 'string' || !args.motion.trim() || args.motion.length > 1000) throw new Error('Motion must contain 1–1000 characters.');
        const models = parseModels(await (await d.api('/models?type=inpaint')).json(), 'inpaint');
        const own = structuredClone(frozen || host.getSettings()); own.editModels = models;
        const avatar = args.avatar || characterKey(host.getContext());
        const still = stillPlan(own, avatar, host.extension_settings['st-venice-image'] || {}, args);
        const [w, h] = args.aspect_ratio.split(':').map(Number);
        const duration = args.duration ?? 5;
        const prompt = String(args.motion || '').trim() + '\nPreserve the starting frame identity, clothing and composition. Introduce no new objects or people. No speech, singing or music; environmental ambience only.';
        const catalogue = await d.catalogue();
        const plan = planVideo(catalogue, c.audio, w * 100, h * 100, prompt, duration, c.resolution || null);
        const videoUSD = quoteUsd(await d.quote(plan.params));
        const refs = Object.fromEntries([avatar, USER_PORTRAIT_KEY].filter(k => own.portraits?.[k]).map(k => [k, own.portraits[k]]));
        return { still: { ...still, recipe: { ...args, avatar, duration }, references: { portraits: refs } }, plan, videoUSD };
    }
    return Object.assign(d, {
        prepare,
        refreshQuote: (job, c) => prepare(job.still.recipe, c, job.still.references),
        turn: async () => {
            const c = host.getContext(), target = d.target();
            const userIndex = c.chat.findLastIndex(m => m.is_user);
            if (userIndex < 0) throw new Error('Send a message in this chat before requesting video.');
            const user = c.chat[userIndex];
            const id = await digest(new Blob([JSON.stringify([target.avatar, target.chatId, userIndex, user.send_date, user.mes])]));
            return { id, target, userIndex, created: Date.now() };
        },
        ready: () => availability().ready,
        availability,
        report: () => JSON.stringify({ ...JSON.parse(baseReport()), companionVideo: '0.7.1', availability: availability() }, null, 2),
        announcement: async job => {
            if (stopped.has(job.id)) return 'abort';
            if (host.isGenerating()) return null;
            const remote = await d.savedChat(job);
            if (!Array.isArray(remote)) throw new Error('Could not verify the announcement in the saved chat.');
            const found = findAnnouncement(remote.slice(1), job);
            if (found) return found;
            return Date.now() - job.created > 180000 ? 'abort' : null;
        },
        canStart: job => {
            if (document.hidden || host.isGenerating() || !currentMatches(job.target)) return false;
            if (String(document.getElementById('send_textarea')?.value || '').trim() || host.hasPendingFileAttachment()) return false;
            return config(d.cached()).characters[job.target.avatar] === true && host.getSettings().enabled;
        },
        withStillLock: async fn => {
            if (host.bridge.busy || !host.bridge.initiationStatus().ready) {
                const e = new Error('Waiting for the current image operation.'); e.waitForImage = true; throw e;
            }
            return host.bridge.withVideoStillLock(fn);
        },
        renderStill: async job => {
            if (!currentMatches(job.target) || document.hidden) {
                const e = new Error('Chat changed before the still was submitted.'); e.definiteRejection = true; throw e;
            }
            const plan = job.still;
            const references = await Promise.all((plan.urls || [plan.url]).map(url => host.loadReference(url, AbortSignal.timeout(30000))));
            const body = attachPortrait(plan, references);
            if (!currentMatches(job.target) || document.hidden) { const e = new Error('Chat changed before submission.'); e.definiteRejection = true; throw e; }
            const path = plan.endpoint.replace('https://api.venice.ai/api/v1', '');
            if (!['/image/edit', '/image/multi-edit'].includes(path)) throw new Error('Unexpected still endpoint.');
            const result = await editedImage(await d.api(path, body));
            const mime = result.extension === 'jpg' ? 'image/jpeg' : `image/${result.extension}`;
            const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: mime });
            const bitmap = await createImageBitmap(blob), width = bitmap.width, height = bitmap.height; bitmap.close();
            const [w, h] = plan.ratio.split(':').map(Number);
            if (Math.abs(width / height - w / h) > 0.015) {
                // Preserve the paid still for inspection even when it cannot become a video.
                const saved = await d.saveAsset(job, blob, `venice_video_${job.id}_still.${result.extension}`);
                await d.update(db => Object.assign(db.jobs.find(j => j.id === job.id), { source: { ...saved, width, height, jobId: job.id, turnId: job.turn.id } }));
                const e = new Error('Generated still has the wrong aspect ratio. Still saved; video was not submitted.'); e.stillOnly = true; throw e;
            }
            return { ...await d.saveAsset(job, blob, `venice_video_${job.id}_still.${result.extension}`), width, height, jobId: job.id, turnId: job.turn.id };
        },
        videoSubmission: async job => {
            if (job.source?.jobId !== job.id || job.source?.turnId !== job.turn.id || job.source.deletedAt) throw new Error('Video requires its own new still from this turn.');
            const response = await d.request(localFile(job.source.path), { cache: 'no-store' });
            const blob = await response.blob();
            if (await digest(blob) !== job.source.sha256) throw new Error('Starting still changed; video submission cancelled.');
            const plan = planVideo(await d.catalogue(), job.mode, job.source.width, job.source.height,
                job.plan.prompt, job.still.recipe.duration, job.params.resolution);
            const usd = quoteUsd(await d.quote(plan.params));
            const body = { ...plan.params, prompt: plan.prompt, image_url: await dataURL(blob) };
            // I2V inherits dimensions from the frame; aspect_ratio is a quote field, not an I2V queue override.
            delete body.aspect_ratio;
            return { usd, params: plan.params, body };
        },
        stop: async () => {
            const jobs = d.cached().jobs.filter(j => j.kind === 'companion' && j.state === 'awaiting_reply' && currentMatches(j.target));
            jobs.forEach(j => stopped.add(j.id));
            if (jobs.length) await d.update(db => db.jobs.forEach(j => {
                if (stopped.has(j.id) && j.state === 'awaiting_reply') Object.assign(j, { state: 'failed', error: 'Reply stopped. Video cancelled before spending.' });
            }));
        },
    });
}
