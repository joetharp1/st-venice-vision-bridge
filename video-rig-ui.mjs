import { createVideoRig, planVideo, quoteUsd, money, DEFAULT_MOTION, RIG_KEY, JOB_TTL, safeError } from './video-rig-core.mjs';
import { createRigHost, dataURL, digest, localFile } from './video-rig-host.mjs';
import { localImagePath, imageData } from './album-core.mjs';

let mounted;
export function mountVideoRig(host) {
    if (mounted) return mounted;
    const root = document.createElement('div'); root.id = 'venice_video_rig';
    root.innerHTML = `
      <hr><h4>Video connection test · 0.1.0</h4>
      <p>Manual tests only. No companion video tool, automatic videos or character changes.</p>
      <p>Use one device for these tests. Jobs are saved to this ST account; browser locks coordinate tabs on this device.</p>
      <button class="menu_button" type="button" data-action="latest">Use latest chat picture</button>
      <label>Or choose the approved still<input type="file" accept="image/png,image/jpeg,image/webp" data-input="still" style="display:block;width:100%;max-width:100%"></label>
      <img data-preview alt="Selected starting still" hidden style="max-width:100%;max-height:240px;object-fit:contain">
      <p data-source>No starting still selected.</p>
      <label class="checkbox_label"><input type="checkbox" data-input="approved"><span>I have checked this still’s face and body appearance.</span></label>
      <label>Audio test<select class="text_pole" data-input="mode"><option value="ambient">Ambient</option><option value="silent">Silent — test API switch</option></select></label>
      <label>Motion only<textarea class="text_pole" data-input="motion" rows="5" maxlength="1500" style="width:100%;box-sizing:border-box"></textarea></label>
      <p>Five seconds, lowest advertised resolution. Still dimensions are retained; ordinary image settings are untouched.</p>
      <button class="menu_button" type="button" data-action="quote">Check connection and quote — no generation</button>
      <p data-price>No API quote yet. Studio audition: 55 credits = US$0.55. One credit = US$0.01.</p>
      <button class="menu_button" type="button" data-action="start" disabled>Start one quoted test</button>
      <p>US$3 maximum per manual test. This rig reuses your selected still and does not generate or charge for a new one. Production target: 6/day, 90/30 days; final spend ceiling includes still costs.</p>
      <p data-status role="status">Ready to check the connection.</p>
      <button class="menu_button" type="button" data-action="resume">Resume checks — never resubmit</button>
      <div data-jobs></div>
      <button class="menu_button" type="button" data-action="copy">Copy test report</button>
      <textarea class="text_pole" data-report readonly rows="6" aria-label="Video test report" style="width:100%;box-sizing:border-box"></textarea>
      <p>Recovery test 1: wait for “Queue confirmed and saved”, then reload mid-render. Test 2: start a separate test, wait for that same status, close the tab and reopen the original chat. Both must retrieve the existing job, with no new paid submission.</p>
      <p>Closing during the submission itself may leave an unknown provider outcome. The rig holds that attempt and never resubmits it automatically.</p>
      <p>Test files are retained for review. Automatic 30-day/storage-cap cleanup belongs to the production version; this rig does not delete saved clips.</p>`;
    document.getElementById('venice_bridge_settings').querySelector('.inline-drawer-content').append(root);
    const $ = selector => root.querySelector(selector);
    $('[data-input="motion"]').value = DEFAULT_MOTION;
    const d = createRigHost(host), engine = createVideoRig(d);
    let selected = null, ticket = null, busy = false, ticking = false, timer;
    const status = text => { $('[data-status]').textContent = text; };
    const invalidate = () => { ticket = null; $('[data-action="start"]').disabled = true; };
    const run = fn => async () => {
        if (busy) return; busy = true;
        root.querySelectorAll('[data-action="quote"], [data-action="latest"]').forEach(b => b.disabled = true);
        try { await fn(); } catch (error) { d.recordCheck('lastError', safeError(error)); status(safeError(error)); }
        finally { busy = false; root.querySelectorAll('[data-action="quote"], [data-action="latest"]').forEach(b => b.disabled = false); render(); }
    };
    async function select(blob) {
        invalidate(); selected = null; $('[data-input="approved"]').checked = false;
        if (blob.size > 8 * 1048576) throw new Error('Choose a still smaller than 8 MB.');
        const image = await dataURL(blob); imageData(image);
        const bitmap = await createImageBitmap(blob);
        const width = bitmap.width, height = bitmap.height; bitmap.close();
        if (width * height > 24000000) throw new Error('Choose a still below 24 megapixels.');
        selected = { image, width, height, hash: await digest(blob), target: d.target() };
        $('[data-preview]').src = image; $('[data-preview]').hidden = false;
        $('[data-source]').textContent = `${width} × ${height} · ${(blob.size / 1048576).toFixed(2)} MB · for ${selected.target.name}`;
        status('Check the still, tick the approval box, then get the quote.');
    }
    $('[data-action="latest"]').onclick = run(async () => {
        const c = host.getContext();
        const media = [...c.chat].reverse().flatMap(m => [...(m.extra?.media || [])].reverse()).find(m => m.type === host.MEDIA_TYPE.IMAGE);
        if (!media) throw new Error('No chat picture found. Choose the saved still from your phone.');
        const path = localImagePath(media.url, location.origin);
        const r = await fetch(path, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error(`Could not read chat picture: HTTP ${r.status}.`);
        await select(await r.blob());
    });
    $('[data-input="still"]').onchange = run(async () => {
        const f = $('[data-input="still"]').files[0]; if (f) await select(f);
    });
    for (const name of ['mode', 'motion', 'approved']) $(`[data-input="${name}"]`).addEventListener('input', invalidate);
    $('[data-action="quote"]').onclick = run(async () => {
        invalidate();
        if (!selected || !$('[data-input="approved"]').checked) throw new Error('Choose and approve the starting still first.');
        const source = selected, mode = $('[data-input="mode"]').value, motion = $('[data-input="motion"]').value;
        d.assertTarget(source.target); status('Checking live model capabilities and API quote…');
        const catalogue = await d.catalogue();
        const plan = planVideo(catalogue, mode, source.width, source.height, motion);
        const usd = quoteUsd(await d.quote(plan.params));
        if (selected !== source || mode !== $('[data-input="mode"]').value || motion !== $('[data-input="motion"]').value || !$('[data-input="approved"]').checked) throw new Error('Inputs changed during quote. Get a fresh quote.');
        d.assertTarget(source.target);
        ticket = { id: crypto.randomUUID(), quotedAt: Date.now(), usd, plan, image: source.image, sourceHash: source.hash, target: source.target };
        $('[data-price]').textContent = `API video quote: ${money(usd)} · ${plan.params.duration} · ${plan.params.resolution} · audio=${plan.params.audio ?? 'provider default'}. 90 videos: ${money(usd * 90)}, plus any newly generated stills.`;
        $('[data-action="start"]').disabled = false;
        status('Connection and quote passed. Press Start once to submit this paid test.');
    });
    $('[data-action="start"]').onclick = run(async () => {
        if (!ticket) throw new Error('Get a quote first.');
        const paid = ticket; invalidate(); status('Submitting once. Keep this tab open until the queue is confirmed and saved…');
        const id = await engine.start(paid);
        status(`Queue confirmed and saved · ${id.slice(0, 8)}. Safe to reload or close the tab for the recovery test. Retrieval will resume on reopen.`);
        schedule();
    });
    $('[data-action="resume"]').onclick = run(async () => { await tick(); status('Recovery check finished. See each job below.'); });
    $('[data-action="copy"]').onclick = async () => {
        try { await navigator.clipboard.writeText(d.report()); status('Test report copied.'); }
        catch { $('[data-report]').focus(); $('[data-report]').select(); status('Select and copy the report below.'); }
    };
    function render() {
        $('[data-report]').value = d.report();
        const jobs = d.cached().jobs;
        const container = $('[data-jobs]');
        // Preserve video elements while polling so playback is never restarted by a UI refresh.
        for (const job of jobs) {
            let row = document.getElementById(`video-rig-${job.id}`);
            if (!row) {
                row = document.createElement('div'); row.id = `video-rig-${job.id}`;
                row.style.cssText = 'border-top:1px solid #888;padding:10px 0;overflow-wrap:anywhere';
                row.append(document.createElement('p')); container.append(row);
            }
            row.querySelector('p').textContent = `${job.target.name} · ${job.id.slice(0, 8)} · ${job.mode} · ${money(job.usd)} · ${job.state}${job.queueId ? ' · queue ID saved' : ''}${job.error ? ' · ' + job.error : ''}${job.cleanupError ? ' · cleanup pending: ' + job.cleanupError : ''}`;
            if (job.saved && !row.querySelector('video')) {
                const video = document.createElement('video'); video.controls = true; video.playsInline = true; video.preload = 'metadata';
                video.style.cssText = 'display:block;width:100%;max-height:360px'; video.src = localFile(job.saved.path); row.append(video);
                video.onloadedmetadata = () => d.setEvidence(job.id, { metadataLoaded: true, duration: video.duration, width: video.videoWidth, height: video.videoHeight }).catch(e => status(safeError(e)));
                video.onplaying = () => d.setEvidence(job.id, { playbackStarted: true }).catch(e => status(safeError(e)));
                video.onerror = () => d.setEvidence(job.id, { playbackError: video.error?.code || 'unknown' }).catch(e => status(safeError(e)));
                const note = document.createElement('p'); note.textContent = `${(job.saved.bytes / 1048576).toFixed(2)} MB · SHA-256 read-back matched · ${job.saved.audioTracks} audio track(s). An audio track can contain silence; listen with sound enabled.`; row.append(note);
                for (const [label, value] of [['I hear no sound', 'silent'], ['I hear ambience', 'ambient'], ['I hear speech or unwanted sound', 'unexpected']]) {
                    const b = document.createElement('button'); b.type = 'button'; b.className = 'menu_button'; b.textContent = label;
                    b.onclick = run(async () => { await d.setEvidence(job.id, { heard: value }); status('Listening result saved.'); }); row.append(b);
                }
                const a = document.createElement('a'); a.textContent = 'Download test MP4'; a.href = localFile(job.saved.path); a.download = job.fileName; row.append(a);
            }
        }
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(tick, 8000); }
    async function tick() {
        if (ticking) return;
        ticking = true;
        try { await engine.tick(); render(); }
        catch (error) { status(safeError(error)); }
        finally {
            ticking = false;
            if (d.cached().jobs.some(j => !['delivered', 'failed', 'abandoned'].includes(j.state) || (j.state === 'delivered' && !j.providerCleaned && Date.now() - j.created < JOB_TTL))) schedule();
        }
    }
    host.eventSource.on(host.event_types.CHAT_CHANGED, () => { invalidate(); selected = null; $('[data-preview]').hidden = true; $('[data-source]').textContent = 'Chat changed. Select a still for this chat.'; tick(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    mounted = { engine, tick, root };
    if (host.extension_settings[RIG_KEY]?.jobs?.length) tick();
    render();
    return mounted;
}
