import { activeJob, JOB_TTL, safeError, clone } from './video-rig-core.mjs';
import { portraitPlan, userPortraitPlan, USER_PORTRAIT_KEY, INITIATION_TAIL } from './portraits.mjs';
import { modelOptions } from './models.mjs';

export const VIDEO_TOOL = 'VeniceCreateVideo';
export const DAY = 86400000;
export const VIDEO_DEFAULTS = Object.freeze({ characters: {}, dailyCount: 6, monthlyCount: 90,
    perJobUSD: 3, dailyUSD: null, monthlyUSD: null, retentionDays: 30, storageMB: 2048,
    audio: 'ambient', resolution: '', silentVerified: false });
export const config = db => ({ ...VIDEO_DEFAULTS, ...db.videoConfig });
export const round = x => Math.round(x * 1000000) / 1000000;
export function validateConfig(c) {
    for (const [key, min, max] of [['dailyCount', 1, 100], ['monthlyCount', 1, 3000], ['retentionDays', 1, 30], ['storageMB', 32, 8192]]) {
        if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) throw new Error(`${key} must be a whole number from ${min} to ${max}.`);
    }
    for (const key of ['perJobUSD', 'dailyUSD', 'monthlyUSD']) {
        if (c[key] === null && key !== 'perJobUSD') continue;
        if (!Number.isFinite(c[key]) || c[key] <= 0) throw new Error(`${key} must be a positive USD amount.`);
    }
    if (c.perJobUSD > 3) throw new Error('The complete-job ceiling cannot exceed US$3 in this release.');
    if (!['ambient', 'silent'].includes(c.audio) || c.audio === 'silent' && !c.silentVerified) throw new Error('Silent mode requires a successful silent API audition first.');
    if (!['', '720p', '1080p'].includes(c.resolution)) throw new Error('Choose lowest available, 720p or 1080p.');
    return c;
}
export function stillPlan(own, avatar, legacy, args) {
    if (!['companion', 'user', 'together'].includes(args.subject)) throw new Error('Choose companion, user or together.');
    if (!['9:16', '16:9'].includes(args.aspect_ratio)) throw new Error('Choose 9:16 or 16:9.');
    const copy = clone(own), key = args.subject === 'companion' ? avatar : USER_PORTRAIT_KEY;
    const ref = copy.portraits?.[key], model = copy.editModels?.find(m => m.id === ref?.model);
    if (!ref || !model?.constraints.aspectRatios.includes(args.aspect_ratio)) throw new Error('The saved reference model does not advertise this video aspect ratio.');
    // Local copy only: no saved image preferences or global generator fields are changed.
    ref.options = { ...ref.options, aspect_ratio: args.aspect_ratio };
    let scene = String(args.scene || '').trim();
    if (!scene || scene.length > 1200) throw new Error('Starting scene must contain 1–1200 characters.');
    if (args.subject === 'together') scene += `\n\nFor the companion only: ${INITIATION_TAIL}`;
    const plan = args.subject === 'companion' ? portraitPlan(copy, avatar, legacy, { prompt: scene })
        : userPortraitPlan(copy, avatar, legacy, { prompt: scene }, args.subject === 'together');
    const options = modelOptions(model, ref.options), p = model.pricing || {}, count = plan.urls?.length || 1;
    const base = p.quality?.[options.resolution]?.[options.quality]?.usd ?? p.resolutions?.[options.resolution]?.usd ?? p.inpaint?.usd;
    const excess = Math.max(0, count - (p.inputImages?.included ?? 1));
    const additional = p.inputImages?.additional?.usd ?? p.inputImages?.additional;
    const extra = excess ? excess * additional : 0;
    if (!Number.isFinite(base) || base < 0 || !Number.isFinite(extra) || extra < 0) throw new Error('Starting-still price is unknown. No submission made.');
    return { ...plan, usd: round(base + extra), ratio: args.aspect_ratio };
}
export function chargedUSD(job) {
    if (job.kind !== 'companion') return ['not-submitted', 'rejected', 'refunded'].includes(job.charge) ? 0 : Number(job.usd || 0);
    return round((job.stillCharge ? job.stillUSD : 0) + (job.videoCharge && job.charge !== 'refunded' ? job.videoUSD : 0));
}
export function reservedUSD(job) {
    return activeJob(job) ? Math.max(chargedUSD(job), Number(job.totalUSD ?? job.usd ?? 0)) : chargedUSD(job);
}
export function budget(db, at, total, excludeId = null) {
    const c = config(db), jobs = db.jobs.filter(j => j.id !== excludeId);
    const dayStart = new Date(at); dayStart.setHours(0, 0, 0, 0);
    const counted = j => activeJob(j) || j.stillCharge || j.videoCharge || ['submitted', 'unknown'].includes(j.charge);
    const daily = jobs.filter(j => j.created >= +dayStart && counted(j));
    const monthly = jobs.filter(j => j.created >= at - 30 * DAY && counted(j));
    const dailySpend = round(daily.reduce((n, j) => n + reservedUSD(j), 0));
    const monthlySpend = round(monthly.reduce((n, j) => n + reservedUSD(j), 0));
    if (!Number.isFinite(total) || total < 0 || total > c.perJobUSD) throw new Error('Combined still + video quote exceeds the per-job ceiling or is unknown.');
    if (c.dailyUSD === null || c.monthlyUSD === null) throw new Error('Calibrate the budget from a live five-second quote in Companion video first.');
    if (daily.length >= c.dailyCount || monthly.length >= c.monthlyCount) throw new Error('Video submission limit reached. Limits are editable in Companion video.');
    if (dailySpend + total > c.dailyUSD + 1e-6 || monthlySpend + total > c.monthlyUSD + 1e-6) throw new Error('Video spending limit reached. Limits are editable in Companion video.');
    return { dailyCount: daily.length, monthlyCount: monthly.length, dailySpend, monthlySpend };
}

export function createCompanionVideo(d, rig) {
    const patch = (id, values) => d.update(db => Object.assign(db.jobs.find(j => j.id === id), values));
    const fail = (id, e, values = {}) => patch(id, { state: 'failed', error: safeError(e), ...values });
    async function request(args, turn) {
        return d.lock('submission', async () => {
            const db = await d.read(), c = config(db);
            if (!c.characters[turn.target.avatar]) throw new Error('Video is not enabled for this companion.');
            const duplicate = db.jobs.find(j => j.kind === 'companion' && j.turn.id === turn.id);
            if (duplicate) return { id: duplicate.id, duplicate: true, state: duplicate.state };
            if (db.jobs.filter(activeJob).length >= 2) throw new Error('Two video jobs are already active.');
            if (db.jobs.some(j => ['preparing', 'submitting', 'uncertain'].includes(j.state))) throw new Error('Waiting for an earlier submission to be confirmed.');
            const ticket = await d.prepare(args, c);
            const totalUSD = round(ticket.still.usd + ticket.videoUSD);
            budget(db, d.now(), totalUSD);
            const id = d.uuid();
            await d.update(latest => {
                if (latest.jobs.some(j => j.kind === 'companion' && j.turn.id === turn.id)) throw new Error('A video is already reserved for this turn.');
                budget(latest, d.now(), totalUSD);
                latest.jobs.push({ id, kind: 'companion', target: clone(turn.target), turn: clone(turn),
                    created: d.now(), state: 'awaiting_reply', fileName: `venice_video_${id}.mp4`,
                    still: ticket.still, plan: ticket.plan, model: ticket.plan.params.model, params: ticket.plan.params,
                    mode: ticket.plan.mode, quotedAt: d.now(), stillUSD: ticket.still.usd, videoUSD: ticket.videoUSD,
                    totalUSD, usd: ticket.videoUSD, charge: 'reserved', stillCharge: false, videoCharge: false });
            });
            return { id, state: 'awaiting_reply' };
        }, true);
    }
    async function process(id) {
        // One submission transaction across every chat/tab, including the manual rig.
        return d.lock('submission', async () => {
            let job = (await d.read()).jobs.find(j => j.id === id);
            if (!job || !['awaiting_reply', 'prepared', 'still_ready'].includes(job.state)) return;
            if (d.now() - job.created >= JOB_TTL) { await fail(id, 'Two-hour deadline reached; no resubmission.'); return; }
            try {
                if (job.state === 'awaiting_reply') {
                    const announcement = await d.announcement(job);
                    if (announcement === 'abort') { await fail(id, 'Reply did not complete. Video cancelled before spending.'); return; }
                    if (!announcement) return;
                    await patch(id, { state: 'prepared', announcement });
                    job = { ...job, state: 'prepared', announcement };
                }
                if (!d.canStart(job)) return;
                const db = await d.read();
                if (db.jobs.some(j => j.id !== id && ['preparing', 'submitting', 'uncertain'].includes(j.state) && d.now() - j.created < JOB_TTL)) return;
                if (job.state === 'prepared') {
                    // Refresh prices before the first paid stage, including any model availability change.
                    const fresh = await d.refreshQuote(job, config(db));
                    const total = round(fresh.still.usd + fresh.videoUSD);
                    budget(db, d.now(), total, id);
                    await patch(id, { still: fresh.still, plan: fresh.plan, params: fresh.plan.params,
                        stillUSD: fresh.still.usd, videoUSD: fresh.videoUSD, totalUSD: total, usd: fresh.videoUSD, quotedAt: d.now() });
                    job = (await d.read()).jobs.find(j => j.id === id);
                    // The bridge lock is acquired before setting 'preparing'. Lock contention does not consume a slot.
                    await d.withStillLock(async () => {
                        await patch(id, { state: 'preparing', stillCharge: true });
                        let saved;
                        try { saved = await d.renderStill(job); }
                        catch (e) {
                            await patch(id, { state: e.definiteRejection || e.stillOnly ? 'failed' : 'uncertain',
                                stillCharge: !e.definiteRejection, charge: e.definiteRejection ? 'not-submitted' : 'unknown', error: safeError(e) });
                            return;
                        }
                        await patch(id, { state: 'still_ready', source: saved, width: saved.width, height: saved.height, sourceHash: saved.sha256 });
                    });
                    job = (await d.read()).jobs.find(j => j.id === id);
                    if (job.state !== 'still_ready') return;
                }
                if (!d.canStart(job)) return;
                // Verify the generated frame and obtain a fresh video quote before paying for video.
                const submission = await d.videoSubmission(job);
                const total = round(job.stillUSD + submission.usd);
                budget(await d.read(), d.now(), total, id);
                await patch(id, { state: 'submitting', videoCharge: true, videoUSD: submission.usd,
                    usd: submission.usd, totalUSD: total, params: submission.params });
                let receipt;
                try {
                    receipt = await d.queue(submission.body);
                    if (!receipt?.queue_id || typeof receipt.queue_id !== 'string' || receipt.model !== job.model) throw new Error('Queue response missing the expected model/ID. No retry will be submitted.');
                } catch (e) {
                    await patch(id, { state: e.definiteRejection ? 'failed' : 'uncertain', videoCharge: !e.definiteRejection,
                        charge: e.definiteRejection ? 'rejected' : 'unknown', error: safeError(e) });
                    return;
                }
                d.backupReceipt(id, receipt);
                await patch(id, { state: 'queued', queueId: receipt.queue_id, downloadUrl: receipt.download_url || null,
                    charge: 'submitted', confirmedAt: d.now(), error: null });
                d.clearReceipt(id);
            } catch (e) {
                const current = (await d.read()).jobs.find(j => j.id === id);
                if (['preparing', 'submitting'].includes(current.state)) {
                    await patch(id, { state: 'uncertain', error: safeError(e) });
                } else if (e.waitForImage) { await patch(id, { error: safeError(e) }); }
                else await fail(id, e);
            }
        }, true);
    }
    async function retention() {
        return d.lock('retention', async () => {
            const db = await d.read(), c = config(db);
            const jobs = db.jobs.filter(j => j.kind === 'companion' && !activeJob(j)).sort((a, b) => a.created - b.created);
            let bytes = db.jobs.reduce((n, j) => n + ['saved', 'source'].reduce((s, k) => s + (j[k] && !j[k].deletedAt ? j[k].bytes : 0), 0), 0);
            for (const job of jobs) {
                if (d.now() - job.created < c.retentionDays * DAY && bytes <= c.storageMB * 1048576) continue;
                for (const field of ['saved', 'source']) {
                    const asset = job[field]; if (!asset || asset.deletedAt) continue;
                    if (await d.deleteOwnedAsset(job, asset)) {
                        bytes -= asset.bytes;
                        await patch(job.id, { [field]: { ...asset, deletedAt: d.now() }, ...(field === 'saved' ? { state: 'expired' } : {}) });
                    }
                }
            }
        }, true);
    }
    let ticking = false;
    async function tick() {
        if (ticking) return;
        ticking = true;
        try {
            await rig.recover();
            const db = await d.read();
            for (const job of db.jobs.filter(j => j.kind === 'companion' && ['awaiting_reply', 'prepared', 'still_ready'].includes(j.state))) await process(job.id);
            await rig.tick();
            await retention();
        } finally { ticking = false; }
    }
    return { request, tick, process, retention };
}

export function findAnnouncement(messages, job) {
    const toolIndex = messages.findIndex(m => m.extra?.tool_invocations?.some(t => {
        if (t.name !== VIDEO_TOOL || t.error) return false;
        let result = t.result; try { if (typeof result === 'string') result = JSON.parse(result); } catch { return false; }
        return result?.id === job.id;
    }));
    if (toolIndex < 0) return null;
    for (const m of messages.slice(toolIndex + 1)) {
        if (m.is_user) return 'abort';
        if (!m.is_system && typeof m.mes === 'string' && m.mes.trim() && m.mes.trim() !== '...') {
            return { text: m.mes, send_date: m.send_date };
        }
    }
    return null;
}

