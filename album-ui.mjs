import { ALBUM_TAG, MAX_IMAGE_BYTES, chatPictures, imageData, localImagePath } from './album-core.mjs';
import { characterKey } from './core.mjs';
import { createAlbum } from './album-runtime.mjs';

// All dynamic labels use textContent/value. No user/model text is interpolated as HTML.
export function mountAlbum(host) {
    const { getContext, getSettings, extension_settings: settings, eventSource, event_types } = host;
    getSettings().albumCharacters ??= {};
    const origin = location.origin;
    const request = async (url, options = {}) => {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25000) });
        if (!response.ok) throw new Error(`SillyTavern returned HTTP ${response.status}. Check the connection and try again.`);
        return response;
    };
    const post = (url, body) => request(url, { method: 'POST', headers: host.getRequestHeaders(), body: JSON.stringify(body) });
    const readBlob = blob => new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read the picture.')); reader.readAsDataURL(blob);
    });
    const validate = async blob => {
        if (blob.size > MAX_IMAGE_BYTES) throw new Error('Choose a picture smaller than 8 MB.');
        const dataUrl = await readBlob(blob);
        imageData(dataUrl);
        const bitmap = await createImageBitmap(blob);
        const pixels = bitmap.width * bitmap.height; bitmap.close();
        if (pixels > 24000000) throw new Error('Choose a picture smaller than 24 megapixels.');
        return dataUrl;
    };
    const loadPicture = async url => {
        const path = localImagePath(url, origin);
        const response = await request(path, { cache: 'no-cache' });
        const length = Number(response.headers.get('content-length'));
        if (length > MAX_IMAGE_BYTES) throw new Error('That saved picture is larger than 8 MB.');
        return validate(await response.blob());
    };
    const persist = async () => {
        // ST's saveSettings catches errors internally. Read back a unique revision
        // so "saved" is not displayed for a failed or deferred settings write.
        const revision = crypto.randomUUID();
        getSettings().albumRevision = revision;
        await host.saveSettings();
        const response = await post('/api/settings/get', {});
        const envelope = await response.json();
        const saved = JSON.parse(envelope.settings);
        if (saved.extension_settings?.['st-venice-vision-bridge']?.albumRevision !== revision) {
            throw new Error('The server has not confirmed the album settings. Wait for any reply to finish and try again.');
        }
    };
    const album = createAlbum({
        getContext, getBridgeSettings: getSettings, getAllSettings: () => settings,
        uuid: () => crypto.randomUUID(), persist,
        upload: async (base64, name) => {
            const response = await post('/api/files/upload', { name, data: base64 });
            const result = await response.json();
            localImagePath(result.path, origin);
            return result.path;
        },
        checkImage: loadPicture,
        publish: async ({ record, context, isCurrent }) => {
            const meta = record[ALBUM_TAG];
            const message = {
                name: context.name2, is_user: false, is_system: false,
                send_date: host.getMessageTimeStamp(),
                mes: `Saved album picture: ${meta.title}. Saved on ${meta.created.slice(0, 10)}. This is a retrieved reference, not a newly generated image.`,
                extra: { media: [{ url: record.url, type: host.MEDIA_TYPE.IMAGE, title: meta.title, source: host.MEDIA_SOURCE.UPLOAD }],
                    media_display: host.MEDIA_DISPLAY.GALLERY, media_index: 0, inline_image: false,
                    venice_album_open: meta.id,
                },
            };
            if (!isCurrent()) throw new Error('Chat changed before the picture could be opened.');
            context.chat.push(message);
            context.addOneMessage(message);
            const id = context.chat.length - 1;
            await eventSource.emit(event_types.MESSAGE_RECEIVED, id, 'extension');
            await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, id, 'extension');
            if (isCurrent()) await context.saveChat();
        },
    });

    const root = document.createElement('div');
    root.id = 'venice_album';
    root.innerHTML = `
      <hr><h4>Picture albums</h4>
      <label class="checkbox_label"><input id="vab_enable" type="checkbox"><span>Let <span id="vab_name"></span> find and open saved pictures</span></label>
      <p id="vab_status" role="status"></p>
      <p>Albums follow the character across chats. Shared pictures are available to every character with album tools enabled.</p>
      <label for="vab_scope">Save into</label>
      <select id="vab_scope" class="text_pole"><option value="character">This character’s album</option><option value="shared">Shared album</option></select>
      <label for="vab_title">Picture name</label><input id="vab_title" class="text_pole" maxlength="120" placeholder="e.g. Original portrait">
      <label for="vab_notes">Notes / search words (optional)</label><textarea id="vab_notes" class="text_pole" maxlength="1200" rows="2" placeholder="Names, places, date, why you kept it"></textarea>
      <label for="vab_file">Upload from phone or computer</label><input id="vab_file" type="file" accept="image/png,image/jpeg,image/webp">
      <button id="vab_upload" class="menu_button" type="button">Save uploaded picture</button>
      <label for="vab_chat">Or choose a picture in this chat</label><select id="vab_chat" class="text_pole"></select>
      <div class="vab_actions"><button id="vab_save_chat" class="menu_button" type="button">Save chat picture</button><button id="vab_refresh" class="menu_button" type="button">Refresh pictures</button></div>
      <p>PNG, JPEG or WebP, up to 8 MB. Saving makes an independent copy. Names and notes help find pictures; opening supplies the actual image.</p>
      <label for="vab_search">Find in this character’s and shared albums</label><input id="vab_search" class="text_pole" maxlength="300" placeholder="Search names and notes">
      <label class="checkbox_label"><input id="vab_archived" type="checkbox"><span>Show archived pictures too</span></label>
      <div id="vab_results"></div><div class="vab_actions"><button id="vab_prev" class="menu_button" type="button">Previous</button><button id="vab_next" class="menu_button" type="button">Next</button></div>
      <button id="vab_export" class="menu_button" type="button">Download these albums as a backup</button>
      <label for="vab_import_file">Restore an album backup (adds copies to the selected album)</label><input id="vab_import_file" type="file" accept="application/json,.json">
      <button id="vab_import" class="menu_button" type="button">Import backup</button>
      <small>Album storage appears as disabled “Image Album” attachments in Data Bank. Leave those disabled and keep them. Backups contain pictures and notes, not API keys.</small>
    `;
    document.querySelector('#venice_bridge_settings .inline-drawer-content').append(root);
    const el = id => root.querySelector(`#${id}`);
    let offset = 0, uiBusy = false, shownKey;
    const notify = (message, error = false) => { el('vab_status').textContent = message; el('vab_status').classList.toggle('vab_error', error); };
    const sameChat = () => {
        const c = getContext(), key = characterKey(c), chat = c.chat;
        return () => { if (characterKey(getContext()) !== key || getContext().chat !== chat) throw new Error('You switched chats. Choose the intended album and try again.'); };
    };
    const fields = () => ({ title: el('vab_title').value, notes: el('vab_notes').value, shared: el('vab_scope').value === 'shared' });
    const button = (text, action) => {
        const node = document.createElement('button'); node.type = 'button'; node.className = 'menu_button'; node.textContent = text; node.addEventListener('click', () => run(action)); return node;
    };
    async function run(action) {
        if (uiBusy || album.busy) { notify('Please wait for the current album operation.'); return; }
        uiBusy = true; root.classList.add('vab_busy');
        try { await action(); }
        catch (error) { notify(error.message || 'Album operation failed.', true); }
        finally { uiBusy = false; root.classList.remove('vab_busy'); }
    }
    function render() {
        const key = characterKey(getContext()), page = album.list(el('vab_search').value, offset, el('vab_archived').checked);
        el('vab_results').replaceChildren();
        const count = document.createElement('p'); count.textContent = `${page.total} picture${page.total === 1 ? '' : 's'} found`; el('vab_results').append(count);
        for (const item of page.pictures) {
            const record = album.records(true).find(x => x[ALBUM_TAG].id === item.id);
            const card = document.createElement('div'); card.className = 'vab_card';
            try {
                const img = document.createElement('img'); img.src = localImagePath(record.url, origin); img.loading = 'lazy'; img.alt = item.title;
                img.addEventListener('error', () => { img.alt = 'Picture file unavailable — restore from backup'; }); card.append(img);
            } catch { /* Do not load untrusted URLs in damaged/imported settings. */ }
            const title = document.createElement('strong'); title.textContent = item.title; card.append(title);
            const notes = document.createElement('p'); notes.textContent = item.notes; card.append(notes);
            const date = document.createElement('small'); date.textContent = `${item.album === 'shared' ? 'Shared' : 'Character'} · ${item.saved_at.slice(0, 10)}${item.archived ? ' · Archived' : ''}`; card.append(date);
            const actions = document.createElement('div'); actions.className = 'vab_actions';
            if (!item.archived) actions.append(button('Open in chat', async () => { if (characterKey(getContext()) !== key) throw new Error('Character changed; refresh the album.'); await album.open(item.id); notify('Picture opened in this chat. Ask about it in your next message.'); }));
            if (!item.archived && host.onReference) actions.append(button('Use as reference portrait', async () => {
                if (characterKey(getContext()) !== key) throw new Error('Character changed; refresh the album.');
                await host.onReference(record.url, item.title, key);
            }));
            actions.append(button('Edit name / notes', async () => {
                const titleInput = document.createElement('input'); titleInput.className = 'text_pole'; titleInput.maxLength = 120; titleInput.value = item.title; titleInput.setAttribute('aria-label', 'Edit picture name');
                const notesInput = document.createElement('textarea'); notesInput.className = 'text_pole'; notesInput.maxLength = 1200; notesInput.value = item.notes; notesInput.setAttribute('aria-label', 'Edit picture notes');
                const save = button('Save changes', async () => { if (characterKey(getContext()) !== key) throw new Error('Character changed; refresh the album.'); await album.edit(item.id, titleInput.value, notesInput.value, item.archived); render(); notify('Picture details saved.'); });
                actions.replaceChildren(titleInput, notesInput, save, button('Cancel', async () => render()));
            }));
            actions.append(button(item.archived ? 'Restore' : 'Archive', async () => {
                if (!item.archived && !confirm(`Archive “${item.title}” from ${item.album === 'shared' ? 'the shared album for all characters' : 'this album'}? Its stored file and existing chat pictures will be kept.`)) return;
                if (characterKey(getContext()) !== key) throw new Error('Character changed; refresh the album.');
                await album.edit(item.id, item.title, item.notes, !item.archived); render(); notify(item.archived ? 'Picture restored to the album.' : 'Archived. Tick Show archived pictures to restore it.');
            }));
            card.append(actions); el('vab_results').append(card);
        }
        el('vab_prev').disabled = offset === 0; el('vab_next').disabled = page.next_offset === null;
    }
    function refresh() {
        const c = getContext(), key = characterKey(c);
        if (shownKey !== key) { offset = 0; el('vab_search').value = ''; el('vab_title').value = ''; el('vab_notes').value = ''; el('vab_file').value = ''; el('vab_scope').value = 'character'; }
        shownKey = key;
        el('vab_name').textContent = key ? c.name2 : 'this character';
        el('vab_enable').disabled = !key; el('vab_enable').checked = !!(key && getSettings().albumCharacters[key]);
        const select = el('vab_chat'), previous = select.value; select.replaceChildren();
        for (const picture of chatPictures(c.chat || [])) {
            try { localImagePath(picture.url, origin); } catch { continue; }
            const option = document.createElement('option'); option.value = picture.url; option.textContent = picture.label; select.append(option);
        }
        if ([...select.options].some(x => x.value === previous)) select.value = previous;
        el('vab_save_chat').disabled = !key || !select.options.length; el('vab_upload').disabled = !key;
        el('vab_export').disabled = !key; el('vab_import').disabled = !key;
        render();
        notify(!key ? 'Select a character in a one-to-one chat.' : album.ready() ? 'Album search and opening tools are available for this character.' : 'You can save pictures here. Enable this character above, the bridge, inline images and function calling on your Venice connection to offer album tools.');
    }
    el('vab_enable').addEventListener('change', () => run(async () => {
        const key = characterKey(getContext()); if (!key) return;
        const old = getSettings().albumCharacters[key]; getSettings().albumCharacters[key] = el('vab_enable').checked;
        try { await persist(); } catch (error) { getSettings().albumCharacters[key] = old; el('vab_enable').checked = !!old; throw error; }
        refresh();
    }));
    el('vab_upload').addEventListener('click', () => run(async () => {
        const stillHere = sameChat(), values = fields(), file = el('vab_file').files[0];
        if (!file) throw new Error('Choose a picture from your phone or computer first.');
        notify('Saving picture…'); const dataUrl = await validate(file); stillHere();
        await album.save({ ...values, dataUrl }); refresh(); notify('Picture saved to the album.');
    }));
    el('vab_save_chat').addEventListener('click', () => run(async () => {
        const stillHere = sameChat(), values = fields(), url = el('vab_chat').value;
        if (!url) throw new Error('No local picture was found in this chat.');
        notify('Saving a separate album copy…'); const dataUrl = await loadPicture(url); stillHere();
        await album.save({ ...values, dataUrl }); refresh(); notify('Picture saved to the album.');
    }));
    el('vab_refresh').addEventListener('click', refresh);
    el('vab_search').addEventListener('input', () => { offset = 0; render(); });
    el('vab_archived').addEventListener('change', () => { offset = 0; render(); });
    el('vab_prev').addEventListener('click', () => { offset = Math.max(0, offset - 12); render(); });
    el('vab_next').addEventListener('click', () => { offset += 12; render(); });
    el('vab_export').addEventListener('click', () => run(async () => {
        const records = album.records(), pictures = []; let bytes = 0;
        for (const r of records) {
            bytes += r.size;
            if (bytes > 32 * 1024 * 1024) throw new Error('This download is limited to 32 MB of pictures. Use your server backup for larger albums.');
            notify(`Preparing backup: ${pictures.length + 1}/${records.length}…`);
            pictures.push({ title: r[ALBUM_TAG].title, notes: r[ALBUM_TAG].notes, saved_at: r[ALBUM_TAG].created, album: r.owner === null ? 'shared' : 'character', dataUrl: await loadPicture(r.url) });
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'venice-image-album', version: 1, pictures })], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'picture-album-backup.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        notify('Backup download prepared. Check your browser downloads.');
    }));
    el('vab_import').addEventListener('click', () => run(async () => {
        const stillHere = sameChat(), file = el('vab_import_file').files[0], shared = fields().shared;
        if (!file || file.size > 48 * 1024 * 1024) throw new Error('Choose an album JSON backup smaller than 48 MB.');
        const backup = JSON.parse(await file.text());
        if (backup.format !== 'venice-image-album' || backup.version !== 1 || !Array.isArray(backup.pictures) || backup.pictures.length > 500) throw new Error('This is not a supported album backup (maximum 500 pictures per import).');
        for (const p of backup.pictures) {
            const { base64, extension } = imageData(p.dataUrl);
            await validate(new Blob([Uint8Array.from(atob(base64), x => x.charCodeAt(0))], { type: `image/${extension === 'jpg' ? 'jpeg' : extension}` }));
            if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 120 || typeof p.notes !== 'string' || p.notes.length > 1200) throw new Error('Invalid picture details in backup.');
        }
        stillHere();
        if (!confirm(`Add ${backup.pictures.length} pictures to ${shared ? 'the shared album' : 'this character’s album'}? This adds copies and does not replace existing pictures.`)) return;
        let done = 0;
        try {
            for (const p of backup.pictures) { stillHere(); await album.save({ dataUrl: p.dataUrl, title: p.title, notes: p.notes, shared }); done++; notify(`Imported ${done}/${backup.pictures.length} pictures…`); }
        } catch (error) { refresh(); throw new Error(`${done} pictures imported before stopping. ${error.message}`); }
        refresh(); notify(`Imported ${done} pictures. Original saved dates remain in the backup; these copies have today’s save date.`);
    }));
    for (const tool of album.tools()) getContext().registerFunctionTool(tool);
    eventSource.on(event_types.CHAT_CHANGED, refresh);
    eventSource.on(event_types.GENERATION_STOPPED, () => album.cancel());
    eventSource.on(event_types.MESSAGE_RECEIVED, () => { if (!uiBusy) refresh(); });
    refresh();
    return Object.assign(album, { refreshUI: refresh });
}
