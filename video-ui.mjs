import { createCompanionHost } from './video-host.mjs';
import { createCompanionVideo, config, validateConfig, VIDEO_TOOL, round, chargedUSD } from './video-core.mjs';
import { createVideoRig, money, safeError, activeJob, videoDurations } from './video-rig-core.mjs';

let mounted;
export async function mountCompanionVideo(host) {
    if (mounted) return mounted;
    const d = createCompanionHost(host), rig = createVideoRig(d), engine = createCompanionVideo(d, rig);
    const root = document.createElement('div'); root.id = 'venice_companion_video';
    root.innerHTML = `<hr><h4>Companion video · 0.9.0</h4>
      <p>Reference-based clips for you and your companions.</p>
      <h4>Shared video model</h4>
      <p>Applies to your manual videos and every enabled companion. Saved and queued clips keep their original model.</p>
      <button class="menu_button" data-action="models">Refresh available video models</button>
      <label>Video model<select class="text_pole" data-field="model"></select></label>
      <label>Default clip length<select class="text_pole" data-field="duration"></select></label>
      <label>Resolution<select class="text_pole" data-field="resolution"></select></label>
      <button class="menu_button" data-action="save-model">Save video model</button>
      <p data-model-status role="status"></p>
      <details><summary><b>Separate video references</b></summary>
      <p>Save a different image for videos without changing your picture references. Your video reference is shared across chats; each companion has their own.</p>
      <label>Reference for<select class="text_pole" data-vref="subject"><option value="companion">Current companion</option><option value="user">Me</option></select></label>
      <div data-video-reference-preview style="margin:12px 0"></div>
      <label>Choose video reference<input type="file" data-vref="file" accept="image/png,image/jpeg,image/webp" style="max-width:100%"></label>
      <button class="menu_button" data-vref="save">Save video reference</button>
      <button class="menu_button" data-vref="clear">Use picture reference instead</button>
      <p data-vref-status role="status"></p>
      <p>PNG, JPEG or WebP, up to 8 MB. Uses the reference image model already configured for this person. Both manual and companion-requested videos use these video references. Existing video jobs keep the references they started with.</p>
      </details>
      <details open><summary><b>Create a video yourself</b></summary>
      <p>Use your saved video references to create a new scene, then animate it. Open the companion’s chat to choose them. When no separate video reference is saved, the picture reference is used.</p>
      <label>Who appears?<select class="text_pole" data-manual="subject"><option value="companion">Current companion</option><option value="user">Me</option><option value="together">Me and current companion</option></select></label>
      <div data-references style="display:flex;gap:12px;flex-wrap:wrap;margin:12px 0"></div>
      <p>Change these images under Separate video references above.</p>
      <label>Starting scene<textarea class="text_pole" data-manual="scene" rows="3" maxlength="1200" placeholder="Clothing, pose, setting and lighting…"></textarea></label>
      <label>Movement<textarea class="text_pole" data-manual="motion" rows="3" maxlength="1000" placeholder="What moves, how the camera moves, and how the clip ends…"></textarea></label>
      <label>Shape<select class="text_pole" data-manual="aspect_ratio"><option value="9:16">Portrait · 9:16</option><option value="16:9">Landscape · 16:9</option></select></label>
      <label>Length<select class="text_pole" data-manual="duration"><option value="10">10 seconds</option><option value="15">15 seconds</option></select></label>
      <p>Uses the saved audio, resolution and shared spending limits below. Longer clips depend on the live model catalogue. Checking a price does not generate anything.</p>
      <button class="menu_button" data-action="manual-quote">Check price for this video</button>
      <p data-manual-status role="status">Choose your subject and describe the scene and movement.</p>
      <button class="menu_button" data-action="manual-start" disabled>Generate my video</button>
      <p>The clip appears in this chat and the download list below. Keep this chat open until submission completes. No media is sent to Telegram.</p>
      </details><hr>
      <p data-character></p>
      <label class="checkbox_label"><input type="checkbox" data-field="enabled"><span>Enable video for this companion</span></label>
      <p data-availability role="status"></p>
      <label>Audio<select class="text_pole" data-field="audio"><option value="ambient">Model audio where supported · no companion voice</option><option value="silent">Silent · requires a verified API test</option></select></label>
      <p>Silent mode unlocks only after a silent connection test finishes and you mark its playback silent. Lip-sync is not part of this version.</p>
      <button class="menu_button" data-action="quote">Check live prices and set initial budget</button>
      <p data-quote>No generation happens when checking prices. Uses this companion’s reference model, 9:16 and the selected default clip length.</p>
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
    let manualQuote = null, manualRevision = 0;
    let modelCatalogue = d.cached().videoModels || [];
    function options(selector, items, selected) {
        const el = $(selector); el.replaceChildren();
        for (const [value, label, disabled] of items) {
            const o = document.createElement('option'); o.value = String(value); o.textContent = label; o.disabled = !!disabled; el.append(o);
        }
        el.value = String(selected);
    }
    function modelOptions(reset = false) {
        const model = modelCatalogue.find(m => m.id === $('[data-field="model"]').value);
        const durations = model ? videoDurations(model).filter(n=>n>=10) : [10,15];
        const resolutions = model?.model_spec.constraints.resolutions || ['720p','1080p'];
        const c = config(d.cached());
        const oldDuration = Number($('[data-field="duration"]').value || c.duration);
        const duration = reset || !durations.includes(oldDuration) ? (durations.includes(10) ? 10 : durations[0]) : oldDuration;
        const resolution = reset ? '' : $('[data-field="resolution"]').value;
        const resItems = [['',resolutions.length ? 'Lowest available' : 'Model default (fixed)'], ...resolutions.map(v => [v,v])];
        if (resolution && !resolutions.includes(resolution) && !reset) resItems.push([resolution,`${resolution} · unavailable; choose another`]);
        options('[data-field="duration"]', durations.map(v => [v,`${v} seconds`]), duration);
        options('[data-field="resolution"]', resItems, resolution);
        const manual = Number($('[data-manual="duration"]').value);
        options('[data-manual="duration"]', durations.map(v => [v,`${v} seconds`]), reset || !durations.includes(manual) ? duration : manual);
    }
    function modelMenu() {
        const c = config(d.cached()), selected = formDirty ? $('[data-field="model"]').value || c.model : c.model;
        const choices = modelCatalogue.map(m => [m.id,`${m.model_spec.name} · ${m.id}${m.model_spec.offline ? ' · offline' : ''}`,m.model_spec.offline]);
        if (!choices.some(x=>x[0]===selected)) choices.push([selected,`${selected} · refresh catalogue`]);
        options('[data-field="model"]', choices, selected); modelOptions();
    }
    function selectedModelSettings() {
        const model = $('[data-field="model"]').value, duration = Number($('[data-field="duration"]').value), resolution = $('[data-field="resolution"]').value;
        const m = modelCatalogue.find(m=>m.id===model);
        if (!m || m.model_spec.offline) throw new Error('Refresh the catalogue and choose an available video model.');
        if (duration < 10 || !videoDurations(m).includes(duration) || resolution && !m.model_spec.constraints.resolutions?.includes(resolution)) throw new Error('Choose a duration and resolution supported by this model.');
        return {model,duration,resolution};
    }
    const manualFields = ['subject', 'scene', 'motion', 'aspect_ratio', 'duration'];
    function manualArgs() {
        return Object.fromEntries(manualFields.map(k => [k, k === 'duration' ? Number($(`[data-manual="${k}"]`).value) : $(`[data-manual="${k}"]`).value]));
    }
    function invalidateManual() {
        manualRevision++; manualQuote = null;
        $('[data-action="manual-start"]').disabled = true;
        $('[data-action="manual-start"]').textContent = 'Generate my video';
        $('[data-manual-status]').textContent = 'Check the price for your current choices.';
    }
    function showReferences(box, subject) {
        box.replaceChildren();
        for (const ref of d.referencePreview(subject)) {
            const item = document.createElement('div'), label = document.createElement('div');
            label.textContent = `${ref.label} · ${ref.url ? ref.videoOnly ? 'video reference' : 'picture reference' : 'no reference saved'}`;
            if (ref.url) {
                const img = document.createElement('img'); img.src = ref.url; img.alt = `${ref.label} reference`;
                img.style.cssText = 'width:76px;height:76px;object-fit:cover;border-radius:8px'; item.append(img);
            }
            item.append(label); box.append(item);
        }
    }
    function renderReferences() {
        showReferences($('[data-references]'), $('[data-manual="subject"]').value);
        showReferences($('[data-video-reference-preview]'), $('[data-vref="subject"]').value);
    }
    $('[data-vref="subject"]').addEventListener('change', () => {
        $('[data-vref="file"]').value = ''; $('[data-vref-status]').textContent = ''; renderReferences();
    });
    function runReference(action) { return async () => {
        if (working) return; working = true; invalidateManual();
        for (const k of ['subject', 'file', 'save', 'clear']) $(`[data-vref="${k}"]`).disabled = true;
        try { await action(); render(); }
        catch (e) { $('[data-vref-status]').textContent = safeError(e); }
        finally { working = false; for (const k of ['subject', 'file', 'save', 'clear']) $(`[data-vref="${k}"]`).disabled = false; }
    }; }
    $('[data-vref="save"]').onclick = runReference(async () => {
        const subject = $('[data-vref="subject"]').value, file = $('[data-vref="file"]').files?.[0];
        $('[data-vref-status]').textContent = 'Saving and verifying your separate video reference…';
        await d.saveVideoReference(subject, file);
        $('[data-vref="file"]').value = '';
        $('[data-vref-status]').textContent = 'Video reference saved. Your picture reference is unchanged.';
    });
    $('[data-vref="clear"]').onclick = runReference(async () => {
        await d.clearVideoReference($('[data-vref="subject"]').value);
        $('[data-vref-status]').textContent = 'Videos will use the picture reference again. The uploaded file is kept.';
    });
    manualFields.forEach(k => $(`[data-manual="${k}"]`).addEventListener('input', () => { invalidateManual(); renderReferences(); }));
    root.querySelectorAll('[data-field]').forEach(el => el.addEventListener('change', () => { formDirty = true; }));
    for (const key of ['resolution','duration']) $(`[data-field="${key}"]`).addEventListener('change', () => { formDirty = true; invalidateManual(); $('[data-model-status]').textContent = 'Press Save video model to apply these options.'; });
    const fields = ['audio', 'resolution', 'dailyCount', 'monthlyCount', 'perJobUSD', 'dailyUSD', 'monthlyUSD', 'retentionDays', 'storageMB'];
    fields.push('model', 'duration');
    $('[data-field="model"]').addEventListener('change', () => { formDirty = true; modelOptions(true); invalidateManual(); $('[data-model-status]').textContent = 'Press Save video model to apply this choice to new clips.'; });
    function current() { try { return d.target(); } catch { return null; } }
    function render(force = false) {
        const db = d.cached(), c = config(db), target = current();
        $('[data-character]').textContent = target ? `Companion: ${target.name}` : 'Open a saved companion chat.';
        $('[data-availability]').textContent = d.availability().reason;
        renderReferences();
        modelMenu();
        if (!formDirty || force) {
            fields.forEach(k => $(`[data-field="${k}"]`).value = c[k] ?? '');
            $('[data-field="enabled"]').checked = !!c.characters[target?.avatar];
            formDirty = false;
        }
        $('[data-field="enabled"]').disabled = !target;
        $('[data-budget]').textContent = `Daily: ${c.dailyUSD === null ? 'awaiting live quote' : money(c.dailyUSD)}. Rolling 30 days: ${c.monthlyUSD === null ? 'awaiting live quote' : money(c.monthlyUSD)}. One credit = US$0.01.`;
        if (db.lastVideoQuote) $('[data-quote]').textContent = `Latest quote (${db.lastVideoQuote.model || 'previous model'}, ${db.lastVideoQuote.duration || 5}s): still ${money(db.lastVideoQuote.still)}, video ${money(db.lastVideoQuote.video)}, combined ${money(db.lastVideoQuote.total)}. Quotes are checked again before spending.`;
        const jobs = $('[data-jobs]'); jobs.replaceChildren();
        for (const j of db.jobs.filter(j => j.kind === 'companion').slice(-12).reverse()) {
            const box = document.createElement('div'), p = document.createElement('p');
            p.textContent = `${j.requestedBy === 'user' ? 'Your video · ' : ''}${j.target.name} · ${j.state} · ${money(chargedUSD(j))} charged or conservatively held${activeJob(j) ? ` · reserved ${money(j.totalUSD)}` : ''}${j.error ? ` · ${j.error}` : ''}`;
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
    function run(fn, errorTarget = '[data-status]') { return async () => {
        if (working) return; working = true;
        try { await fn(); render(); } catch (e) { $(errorTarget).textContent = safeError(e); }
        finally { working = false; }
    }; }
    $('[data-action="models"]').onclick = run(async () => {
        $('[data-model-status]').textContent = 'Loading Venice’s available image-to-video models…';
        const models = await d.loadVideoModels();
        if (!models.length) throw new Error('No compatible image-to-video models returned.');
        modelCatalogue = models;
        await d.update(db => { db.videoModels = models; });
        modelMenu();
        $('[data-model-status]').textContent = `${models.length} image-to-video models loaded. Prices are checked for your chosen clip before generation. Existing budgets stay in place.`;
    }, '[data-model-status]');
    $('[data-action="save-model"]').onclick = run(async () => {
        const values = selectedModelSettings();
        const other = fields.filter(k => !['model','duration','resolution'].includes(k));
        const draft = Object.fromEntries(other.map(k => [k,$(`[data-field="${k}"]`).value]));
        const enabled = $('[data-field="enabled"]').checked;
        await d.update(db => { db.videoConfig = validateConfig({ ...config(db), ...values }); });
        invalidateManual(); formDirty = false; render(true);
        for (const key of other) $(`[data-field="${key}"]`).value = draft[key];
        $('[data-field="enabled"]').checked = enabled; formDirty = true;
        $('[data-manual="duration"]').value = String(values.duration);
        $('[data-model-status]').textContent = `Saved ${values.model} · ${values.duration}s · ${values.resolution || 'model default/lowest'}. Applies to your videos and enabled companions.`;
    }, '[data-model-status]');
    function runManual(fn) { return async () => {
        if (working) return; working = true;
        $('[data-action="manual-quote"]').disabled = true;
        $('[data-action="manual-start"]').disabled = true;
        try { await fn(); render(); }
        catch (e) { manualQuote = null; $('[data-manual-status]').textContent = safeError(e); }
        finally {
            working = false; $('[data-action="manual-quote"]').disabled = false;
            $('[data-action="manual-start"]').disabled = !manualQuote;
        }
    }; }
    $('[data-action="manual-quote"]').onclick = runManual(async () => {
        const saved = config(d.cached());
        if ($('[data-field="model"]').value !== saved.model || Number($('[data-field="duration"]').value) !== saved.duration || $('[data-field="resolution"]').value !== saved.resolution) throw new Error('Press Save video model before checking your clip price.');
        invalidateManual(); const revision = manualRevision;
        $('[data-manual-status]').textContent = 'Checking the reference models and live price…';
        const quote = await engine.quoteManual(manualArgs());
        if (revision !== manualRevision) return;
        manualQuote = quote;
        $('[data-manual-status]').textContent = `Starting still ${money(quote.ticket.still.usd)} + video ${money(quote.ticket.videoUSD)} = ${money(quote.totalUSD)} total (USD). Quote valid for five minutes. Generate authorises this amount; a higher price stops the job.`;
        $('[data-action="manual-start"]').textContent = `Generate my video · ${money(quote.totalUSD)}`;
    });
    $('[data-action="manual-start"]').onclick = runManual(async () => {
        if (!manualQuote) throw new Error('Check the price first.');
        const quote = manualQuote; manualQuote = null;
        const result = await engine.requestManual(quote);
        if (!result) throw new Error('Another video submission is busy. Check the price again in a moment.');
        $('[data-manual-status]').textContent = 'Request saved. Preparing your scene and video when this chat is visible and idle. Follow its progress in the jobs list below.';
        render();
        clearTimeout(timer); timer = setTimeout(tick, 100);
    });
    $('[data-action="quote"]').onclick = run(async () => {
        const target = d.target(); d.assertTarget(target);
        const c = config(await d.read());
        c.audio = $('[data-field="audio"]').value; c.resolution = $('[data-field="resolution"]').value; c.model = $('[data-field="model"]').value; c.duration = Number($('[data-field="duration"]').value);
        if (c.audio === 'silent' && !c.silentVerified) throw new Error('Run and mark a silent API connection test before selecting silent.');
        status('Checking the current catalogue and quote. No generation…');
        const t = await d.prepare({ subject: 'companion', scene: 'A relaxed, fully clothed portrait facing the camera in a softly lit room.',
            motion: 'The person blinks and makes a small natural head movement. The camera remains fixed.', aspect_ratio: '9:16', duration: c.duration }, c);
        const total = round(t.still.usd + t.videoUSD);
        if (total > c.perJobUSD) throw new Error('The combined quote exceeds the complete-job ceiling.');
        await d.update(db => {
            const cfg = config(db);
            cfg.dailyUSD ??= Math.ceil(total * cfg.dailyCount * 100) / 100;
            cfg.monthlyUSD ??= Math.ceil(total * cfg.monthlyCount * 100) / 100;
            db.videoConfig = cfg;
            db.lastVideoQuote = { still: t.still.usd, video: t.videoUSD, total, model: c.model, duration: c.duration, at: Date.now() };
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
        const values = Object.fromEntries(fields.map(k => [k, ['audio', 'resolution', 'model'].includes(k) ? $(`[data-field="${k}"]`).value : $(`[data-field="${k}"]`).value === '' ? null : Number($(`[data-field="${k}"]`).value)]));
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
        invalidateManual();
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
            duration: { type: 'integer', minimum: 10, maximum: 30, description: 'Omit to use the user’s saved default duration (at least 10 seconds). Supply a different duration only if requested; the selected model must support it.' },
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
    host.eventSource.on(host.event_types.CHAT_CHANGED, () => { formDirty = false; invalidateManual(); $('[data-vref="file"]').value = ''; $('[data-vref-status]').textContent = ''; render(true); });
    host.eventSource.on(host.event_types.GENERATION_ENDED, () => { clearTimeout(timer); timer = setTimeout(tick, 1000); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(timer); timer = setTimeout(tick, 1000); } });
    await d.read(); $('[data-manual="duration"]').value = String(config(d.cached()).duration); render(true); status('Ready. Check live prices before enabling your first companion.');
    mounted = { d, engine, render }; timer = setTimeout(tick, 1500);
    if (!modelCatalogue.length) void $('[data-action="models"]').onclick();
    return mounted;
}
