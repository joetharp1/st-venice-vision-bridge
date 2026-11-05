# Venice Image Bridge 0.2.0 — Picture albums

A companion extension for **SillyTavern 1.19.0** and a direct Venice Custom OpenAI-compatible connection.

## What it does

- Keeps assistant pictures visible under their original author, while moving their outgoing `image_url` inputs into labelled user-role messages accepted by Venice. Stored chat authors remain unchanged.
- Offers the optional `VeniceCreateImage` tool using the existing [Venice image generator](https://github.com/AnonCollab/st-venice-image) settings. One generation attempt per user turn; no automatic retry.
- Adds **character albums that follow the same character across chats**, plus an explicitly selected shared album.
- Lets you upload a picture or save an independent copy of an image already in the current chat, with a name and optional searchable notes.
- Offers **VeniceFindPictures** and **VeniceOpenPicture**. Search returns catalogue text; opening attaches the actual saved image to the current chat for vision. No image-generation charge is incurred by opening an existing picture; normal chat/image-input usage still applies.
- Includes renaming, notes, archiving, and a portable backup download/import containing only pictures and their notes.

No character-card, personality, memory-summary, model, sampler, web-search or API-key settings are rewritten. Album tool access starts **off** for every character, independently of the existing image-generation toggle.

## Install or update on a phone

Repository URL:

```text
https://github.com/joetharp1/st-venice-vision-bridge
```

**Already installed:** use SillyTavern’s extension manager to update **Venice Image Bridge**, then reload the page. Check that the panel says **Version 0.2.0**. Avoid keeping another old SillyTavern tab open while changing album settings.

**First installation:** Extensions → Install extension → paste the URL → install for the current user → reload.

No terminal commands, new server plugin, new credentials or core edits are needed. Back up your SillyTavern user data as usual. Native extension installs and album storage require the Docker user-data directory to be persistent.

## First album test

1. Open a one-to-one test chat. Open **Extensions → Venice Image Bridge → Picture albums**.
2. Give a picture a name such as **Original portrait**, and optional notes such as **dark hair, study, reference face**.
3. Leave **Save into** on the character’s album. Choose a PNG, JPEG or WebP from your phone and tap **Save uploaded picture**. Alternatively select an image from the chat and tap **Save chat picture**.
4. Wait for **Picture saved to the album**. The extension verifies the saved settings on the server before confirming success.
5. Reload, return to that character, and confirm the album entry remains.
6. Open a new chat with the same character. The entry should still be available. Open a different character: the private entry must not appear. Shared entries are intentionally visible to both.
7. Turn on **Let [character] find and open saved pictures**. Keep the bridge, **inline images/media**, and **function calling** enabled on your direct Venice connection. The image-generation toggle and generator API key are not needed for album lookup/opening.
8. Ask: **Find “Original portrait” in your picture album, open it, and describe one visible detail that isn’t in its name or notes.**
9. Expect a **Find saved pictures** tool call, followed by **Look at a saved picture**, an image posted in the chat, and a reply. Confirm the outgoing Venice request includes a user-role image input rather than trusting a model’s statement that it can see.
10. If the model does not call the tools, use **Open in chat** beside the album entry, then send a normal question about it. A manual open itself does not trigger a paid model reply.

Keep names descriptive. Search matches words in names and notes, not image contents or embeddings. Blank searches browse recent entries; tools can paginate. Characters can search/open albums, but this version leaves saving, sharing, renaming and archiving under your manual control.

## Storage and backup

The extension copies each saved picture to a uniquely named file in the current ST account’s `user/files/` storage using the built-in file API. The catalogue uses ST’s character/global attachment registry, tagged `venice_image_album`. These storage attachments are **disabled for text RAG**: images are sent through vision only when opened.

In Data Bank you may see disabled entries named **Image Album — …**. Leave them disabled and retain them. They are storage records, not text reference documents. The registry keeps ST 1.19.0’s unused-file cleanup from treating the album files as loose files. This is why the extension does not simply leave unreferenced copies in the image gallery.

- Character entries are keyed by the character’s avatar filename, matching ST’s own character attachment scope. They survive new chats and browser reloads under the same ST user account.
- A new/reimported card with a different avatar filename does not automatically inherit the old album. Export/import the album to transfer it. Character-card export alone does not contain these files.
- Shared entries are scoped to the ST user account, not other logged-in accounts. This is model retrieval separation, not access control against someone who can administer the same ST account.
- Deleting the original chat does not remove the independent album copy. Archiving hides an entry from album retrieval but retains its file and registry record, preserving images already opened into chats. Archived records still count toward the storage limit. Tick **Show archived pictures too**, then **Restore** to bring one back.
- Removing files/records manually through Data Bank, restoring older settings, deleting the ST user or losing the server data volume can remove album data. Keep server backups.
- **Download these albums as a backup** exports the selected character’s active entries plus shared entries, including actual image data. It contains no API settings, keys, chats or character cards. Limit: 32 MB of image bytes per download.
- **Import backup** adds copies to the album you select; it never overwrites existing entries. Importing twice makes duplicates. Limit: 48 MB JSON / 500 pictures per import. Imported copies receive the current save date; original dates remain in the backup file. Partial imports are reported if interrupted.
- File limit: 8 MB, 24 megapixels, PNG/JPEG/WebP. Catalogue limit: 500 records per ST account including archived records. Gallery pages show 12 entries. Only selected pictures are added to model context; the whole bank is never injected.

Use one active tab for album edits. Like other ST settings, simultaneous changes from different browser sessions can overwrite each other. Exporting is a backup operation, not automatic synchronisation.

## Connection and tool behaviour

The role adapter and album tools activate only for Custom OpenAI Chat Completions with `https://api.venice.ai/api/v1` (optional trailing slash). Other providers, proxy URLs and the Venice website are outside this release. A vision-capable model is required for inspection. Tools additionally need a selected one-to-one character with the appropriate opt-in, inline media and function calling. Group album tools are not supported.

Opening a saved picture posts an assistant message labelled as a retrieved reference, using ST’s normal image attachment format. ST fetches and encodes the image; the existing bridge adapts its outgoing role. It can therefore remain in context on subsequent turns, subject to ST’s normal context and media limits. Nothing is permanently inserted into the character prompt. A search result or catalogue note alone is not evidence that the model has inspected the picture.

The album tool opens at most **two different pictures per user turn**, and repeat opening of the same picture in that turn is idempotent. Chat switching and generation cancellation prevent pending opens from posting into a different conversation. Missing images produce an error instead of a success claim. The model still decides whether to use an offered tool.

Image generation retains the 0.1.0 behaviour: original generator configuration, one attempt per user turn, concurrency guard, 120-second timeout, no automatic retries, and generated results posted into the current chat. Keep `st-venice-image` installed for generation. Album features do not require that generator. Original `/vimg` and message buttons continue to work.

## Validation and limits

Run the local unit/host tests:

```sh
npm test
```

Tests cover existing generation and adapter behaviour, persistent album metadata, private/shared scopes, cross-chat retrieval, archive retention, invalid images/URLs, failed saves, missing files, cancellation, chat switching, per-turn limits, pagination and installer upgrades. A local ST 1.19.0 browser test also passed upload, verified settings persistence, reload, new-chat retrieval through the registered tools, real image encoding and the Venice role adapter. The test used a generated geometric fixture and made no Venice API calls. ST’s cleanup report left the saved image protected.

The code was checked against ST **1.19.0**, commit `7e8663cd9c184a550b37238218bdd32c6efc68e9`.

The 0.1.0 bridge was live-tested by the user with slash-command images and generation/inspection tool loops. The 0.2.0 album still requires the live acceptance steps above on the user's installation. Developer tests do not spend Venice credits or validate model compliance.

The adapter does not restore excluded messages or pictures omitted by context limits. It preserves tool-call/result ordering; images from incomplete tool exchanges are withheld until a complete request. Album titles are labels and notes may be incomplete; the tool instructs the model to inspect actual image input before describing it.

## Rollback

Turn off the character’s **find and open saved pictures** checkbox to stop offering album tools. Keep the bridge enabled for the existing image-role fix. Stored album entries remain intact.

Disabling the entire extension also disables the image-role fix; assistant images may then trigger Venice's original 400 error. Existing saved pictures/chats are not deleted by disabling the extension.

For a server operator, the optional installer copies all eight runtime files and backs up a prior bridge installation:

```sh
node install.mjs --app-root /actual/path/to/SillyTavern --dry-run
node install.mjs --app-root /actual/path/to/SillyTavern
```

It requires exactly ST 1.19.0, does not find Docker containers, and does not change mounts. Normal users should use the native extension manager instead.

## Sources reviewed

- Original generator: https://github.com/AnonCollab/st-venice-image/blob/9f04082c92c62af284c7752811fc3c00f66a9921/index.js
- ST 1.19.0: `public/script.js`, `public/scripts/openai.js`, `public/scripts/st-context.js`, `public/scripts/tool-calling.js`, `public/scripts/chats.js`, `public/scripts/utils.js`, `src/endpoints/files.js`, `src/endpoints/settings.js`, `src/endpoints/data-maid.js`.

Independent companion extension; not an official Venice or SillyTavern release.
