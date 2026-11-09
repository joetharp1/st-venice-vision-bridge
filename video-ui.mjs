import { createCompanionHost } from './video-host.mjs';
import { createCompanionVideo, config, validateConfig, VIDEO_TOOL, round, chargedUSD } from './video-core.mjs';
import { createVideoRig, money, safeError, activeJob } from './video-rig-core.mjs';

let mounted;
export async function mountCompanionVideo(host) {
    if (mounted) return mounted;
    const d = createCompanionHost(host), rig = createVideoRig(d), engine = createCompanionVideo(d, rig);
    const root = document.createElement('div'); root.id = 'venice_companion_video';
    root.innerHTML = `<hr><h4>Companion video · 0.7.2</h4>
      <p>Reference-based five-second clips, delivered after the chat reply. Your reference and companion references are shared with the image bridge.</p>
      <p data-character></p>
      <label class="checkbox_label"><input type="checkbox" data-field="enabled"><span>Enable video for this companion</span></label>
      <p data-availability role="status"></p>
      <label>Audio<select class="text_pole" data-field="audio"><option value="ambient">Ambient · no companion voice</option><option value="silent">Silent · requires a verified API test</option></select></label>
      <label>Resolution<select class="text_pole" data-field="resolution"><option value="">Lowest advertised · audition setting</option><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
      <p>Silent mode unlocks only after a silent connection test finishes and you mark its playback silent. Lip-sync is not part of this version.</p>
      <button class="menu_button" data-action="quote">Check live prices and set initial budget</button>
      <p data-quote>No generation happens when checking prices. Uses this companion’s saved reference model, 9:16 and five seconds.</p>
      <label>Daily submissions<input class="text_pole" type="number" min="1" max="100" data-field="dailyCount"></label>
      <label>Submissions per rolling 30 days<input class="text_pole" type="number" min="1" max="3000" data-field="monthlyCount"></label>
      <label>Complete-job ceiling · USD<input class="text_pole" type="number" min="0.01" max="3" step="0.01" data-field="perJobUSD"></label>
      <label>Daily spending ceiling · USD<input class="text_pole" type="number" min="0.01" step="0.01" data-field="dailyUSD"></label>
      <label>Rolling 30-day spending ceiling · USD<input class="text_pole" type="number" min="0.01" step="0.01" data-field="monthlyUSD"></label>
      <label>Keep generated media for days<input class="text_pole" type="number" min="1" max="30" data-field="retentionDays"></label>
      <label>Generated video storage cap · MB<input class="text_pole" type="number" min="32" max="8192" data-field="storageMB"></label>
      <button class="menu_button" data-action="save">Save video settings</button>
      <button class="menu_button" data-action="resume">Check saved jobs</button>
      <p data-budget></p><p data-status role="status">Loading saved video jobs…</p><p data-background></p>
      <div data-jobs></div>
      <button class="menu_button" data-action="report">Show diagnostic report</button>
      <textarea class="text_pole" data-report readonly rows="5" hidden aria-label="Video diagnostic report"></textarea>
      <p>Two jobs maximum across chats. Use one device: tabs share browser locks; separate devices cannot coordinate submissions. Unresolved jobs expire after two hours without automatic resubmission; possible charges remain counted.</p>
      <p>Generated clips and starting stills expire after the retention period or storage limit, whichever comes first. Download favourites first. Old chat video links may expire. Saved face references are protected. VPS files are not a backup.</p>
      <p>Live API recovery and Android playback must still be checked on your installation. The manual Video connection test remains available below.</p>`;
    root.style.cssText = 'max-width:100%;overflow-wrap:anywhere';
    root.querySelectorAll('input[type="number"],select,textarea').forEach(el => el.style.cssText = 'width:100%;box-sizing:border-box');
    document.getElementById('venice_bridge_settings').querySelector('.inline-drawer-content').append(root);
    const $ = s => root.querySelector(s), status = s => $('[data-status]').textContent = s;
    let formDirty = false, working = false, timer, lastRetention = 0;
    root.querySelectorAll('[data-field]').forEach(el => el.addEventListener('change', () => { formDirty = true; }));
    const fields = ['audio', 'resolution', 'dailyCount', 'monthlyCount', 'perJobUSD', 'dailyUSD', 'monthlyUSD', 'retentionDays', 'storageMB'];
    function current() { try { return d.target(); } catch { return null; } }
    function render(force = false) {
        const db = d.cached(), c = config(db), target = current();
        $('[data-character]').textContent = target ? `Companion: ${target.name}` : 'Open a saved companion chat.';
        $('[data-availability]').textContent = d.availability().reason;
        if (!formDirty || force) {
            fields.forEach(k => $(`[data-field="${k}"]`).value = c[k] ?? '');
            $('[data-field="enabled"]').checked = !!c.characters[target?.avatar];
            formDirty = false;
        }
        $('[data-field="enabled"]').disabled = !target;
        $('[data-budget]').textContent = `Daily: ${c.dailyUSD === null ? 'awaiting live quote' : money(c.dailyUSD)}. Rolling 30 days: ${c.monthlyUSD === null ? 'awaiting live quote' : money(c.monthlyUSD)}. One credit = US$0.01.`;
        if (db.lastVideoQuote) $('[data-quote]').textContent = `Latest five-second quote: still ${money(db.lastVideoQuote.still)}, video ${money(db.lastVideoQuote.video)}, combined ${money(db.lastVideoQuote.total)}. Quotes are checked again before spending.`;
        const jobs = $('[data-jobs]'); jobs.replaceChildren();
        for (const j of db.jobs.filter(j => j.kind === 'companion').slice(-12).reverse()) {
            const box = document.createElement('div'), p = document.createElement('p');
            p.textContent = `${j.target.name} · ${j.state} · ${money(chargedUSD(j))} charged or conservatively held${activeJob(j) ? ` · reserved ${money(j.totalUSD)}` : ''}${j.error ? ` · ${j.error}` : ''}`;
            box.append(p);
            if (j.saved?.path && !j.saved.deletedAt) {
                const a = document.createElement('a'); a.textContent = 'Download clip'; a.href = j.saved.path; a.download = j.fileName; box.append(a);
            }
            if (j.source?.path && !j.source.deletedAt) {
                const a = document.createElement('a'); a.textContent = ' · View starting still'; a.href = j.source.path; a.target = '_blank'; a.rel = 'noopener'; box.append(a);
            }
            jobs.append(box);
        }
    }
    async function tick() {
        clearTimeout(timer);
        try {
            if (working || host.isGenerating()) return;
            const db = await d.read();
            if (db.jobs.some(j => activeJob(j) || j.state === 'ready' || j.state === 'delivered' && !j.providerCleaned)) await engine.tick();
            else if (db.jobs.some(j => j.kind === 'companion' && (j.saved || j.source)) && Date.now() - lastRetention > 3600000) {
                await engine.retention(); lastRetention = Date.now();
            }
            $('[data-background]').textContent = ''; render();
        }
        catch (e) { $('[data-background]').textContent = `Background check: ${safeError(e)}`; }
        finally { timer = setTimeout(tick, d.cached().jobs.some(activeJob) ? 15000 : 60000); }
    }
    function run(fn) { return async () => {
        if (working) return; working = true;
        try { await fn(); render(); } catch (e) { status(safeError(e)); }
        finally { working = false; }
    }; }
    $('[data-action="quote"]').onclick = run(async () => {
        const target = d.target(); d.assertTarget(target);
        const c = config(await d.read());
        c.audio = $('[data-field="audio"]').value; c.resolution = $('[data-field="resolution"]').value;
        if (c.audio === 'silent' && !c.silentVerified) throw new Error('Run and mark a silent API connection test before selecting silent.');
        status('Checking the current catalogue and quote. No generation…');
        const t = await d.prepare({ subject: 'companion', scene: 'A relaxed, fully clothed portrait facing the camera in a softly lit room.',
            motion: 'The person blinks and makes a small natural head movement. The camera remains fixed.', aspect_ratio: '9:16', duration: 5 }, c);
        const total = round(t.still.usd + t.videoUSD);
        if (total > c.perJobUSD) throw new Error('The combined quote exceeds the complete-job ceiling.');
        await d.update(db => {
            const cfg = config(db);
            cfg.dailyUSD ??= Math.ceil(total * cfg.dailyCount * 100) / 100;
            cfg.monthlyUSD ??= Math.ceil(total * cfg.monthlyCount * 100) / 100;
            db.videoConfig = cfg;
            db.lastVideoQuote = { still: t.still.usd, video: t.videoUSD, total, at: Date.now() };
        });
        // A quote must never uncheck an unsaved Enable choice or reset other form edits.
        const draft = Object.fromEntries(fields.map(k => [k, $(`[data-field="${k}"]`).value]));
        const enabled = $('[data-field="enabled"]').checked;
        d.assertTarget(target);
        render(true);
        fields.forEach(k => { if (draft[k] !== '') $(`[data-field="${k}"]`).value = draft[k]; });
        $('[data-field="enabled"]').checked = enabled; formDirty = true;
        status('Prices checked and initial spending limits saved. Your selections are preserved. Press Save video settings to apply them.');
    });
    $('[data-action="save"]').onclick = run(async () => {
        const target = d.target(); d.assertTarget(target);
        const enabled = $('[data-field="enabled"]').checked;
        const values = Object.fromEntries(fields.map(k => [k, ['audio', 'resolution'].includes(k) ? $(`[data-field="${k}"]`).value : $(`[data-field="${k}"]`).value === '' ? null : Number($(`[data-field="${k}"]`).value)]));
        await d.update(db => {
            d.assertTarget(target);
            const c = config(db);
            // Evidence belongs to a completed API test, never to a model-generated claim.
            const verified = db.jobs.some(j => j.mode === 'silent' && j.saved?.verifiedAt && j.evidence?.heard === 'silent');
            const next = validateConfig({ ...c, ...values, silentVerified: c.silentVerified || verified,
                characters: { ...c.characters, [target.avatar]: enabled } });
            if (enabled && (next.dailyUSD === null || next.monthlyUSD === null)) throw new Error('Check live prices first to set the spending limits.');
            db.videoConfig = next;
        });
        render(true); status(`Video settings saved. ${d.availability().reason}`);
    });
    $('[data-action="resume"]').onclick = run(async () => { await engine.tick(); status('Saved jobs checked. Completed clips are delivered when their original chat is open and idle.'); });
    $('[data-action="report"]').onclick = () => { $('[data-report]').hidden = false; $('[data-report]').value = d.report(); };
    host.getContext().registerFunctionTool({
        name: VIDEO_TOOL, displayName: 'Create a companion video',
        description: 'Create one short reference-based video of yourself, the user, or both together. Use only when the user requests a clip or a visual exchange has a clear movement worth showing. Never interrupt a text-only conversation with video. Maximum one video per reply. This tool creates a fresh composed still using saved reference faces, then animates that exact still. Describe the starting scene separately from motion. Motion must involve only things already present, with camera movement and an ending state; introduce no new people or objects. After the tool returns, announce the forthcoming clip in one natural sentence and finish your reply. Rendering starts only after that reply is saved. Do not claim a clip has arrived until it actually appears. No speech or lip-sync; ambience only unless the user configured tested silent mode. Do not call an image tool to prepare this video: its fresh still is built automatically.',
        parameters: { type: 'object', properties: {
            subject: { type: 'string', enum: ['companion', 'user', 'together'] },
            scene: { type: 'string', description: 'Starting composition, clothing, pose and setting; maximum 1200 characters.' },
            motion: { type: 'string', description: 'Motion only: starting state, camera movement, ending state; maximum 1000 characters.' },
            aspect_ratio: { type: 'string', enum: ['9:16', '16:9'] },
            duration: { type: 'integer', enum: [5, 10, 15], description: 'Default 5 seconds; use a longer tier only if requested.' },
        }, required: ['subject', 'scene', 'motion', 'aspect_ratio'], additionalProperties: false },
        shouldRegister: () => d.ready(),
        action: async args => {
            d.recordCheck('lastToolAttempt', { at: new Date().toISOString(), state: 'preflight' });
            try {
            if (!d.ready()) throw new Error(d.availability().reason);
            const result = await engine.request(args, await d.turn());
            if (!result) throw new Error('A video submission is in progress. Reply normally; no extra video started.');
            d.recordCheck('lastToolAttempt', { at: new Date().toISOString(), state: result.state, id: result.id });
            render();
            return JSON.stringify({ ...result, instruction: 'Announce the forthcoming video briefly in your own voice and finish your reply now. It will render after your reply is saved and arrive separately. Do not call another video or image tool for this clip.' });
            } catch (e) {
                d.recordCheck('lastToolAttempt', { at: new Date().toISOString(), state: 'failed-before-job-or-submission', error: safeError(e) });
                status(`Video request: ${safeError(e)}`); throw e;
            }
        }, formatMessage: () => 'Preparing a video request…',
    });
    host.eventSource.on(host.event_types.GENERATION_STOPPED, () => { d.stop().catch(e => status(safeError(e))); });
    host.eventSource.on(host.event_types.CHAT_CHANGED, () => { formDirty = false; render(true); });
    host.eventSource.on(host.event_types.GENERATION_ENDED, () => { clearTimeout(timer); timer = setTimeout(tick, 1000); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(timer); timer = setTimeout(tick, 1000); } });
    await d.read(); render(true); status('Ready. Check live prices before enabling your first companion.');
    mounted = { d, engine, render }; timer = setTimeout(tick, 1500);
    return mounted;
}
