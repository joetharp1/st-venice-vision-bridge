# Venice Image Bridge 0.5.0 — Fixed reference portraits, live models and picture albums

A companion extension for **SillyTavern 1.19.0** and a direct Venice Custom OpenAI-compatible connection.

## Ava Initiation integration (0.5.0)

Update this extension through SillyTavern's usual Update button, then reload. [Ava Initiation](https://github.com/joetharp1/ava-initiation) can use the configured fixed reference portrait through a short-lived, one-use allowance. It bypasses both normal user-turn image limits for that initiation only; timer images do not consume the next real user turn. Identity, model prompt limits and the existing Safe Mode setting are preserved. Timer images have no caption. Ava owns the two-photo daily limit and daily credit cap.

Normal user-requested image generation keeps its existing path. No API key or reference portrait needs re-entering.

## What it does

- Keeps assistant pictures visible under their original author, while moving their outgoing `image_url` inputs into labelled user-role messages accepted by Venice. Stored chat authors remain unchanged.
- Offers the optional `VeniceCreateImage` tool using the existing [Venice image generator](https://github.com/AnonCollab/st-venice-image) key and filters. One generation attempt per user turn; no automatic retry.
- Loads Venice's current text-to-image catalogue and offers model-specific aspect ratio, resolution and quality options, or pixel dimensions. Displays supplied generation pricing and privacy tier. The selected model is shared across characters.
- Adds a fixed original reference portrait and separate editing-model selection per character, with the optional `VeniceCreateSelfPortrait` tool and a manual portrait test.
- Adds a manual Generate button using the same model and request builder as the companion tool.
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

**Already installed:** use SillyTavern’s extension manager to update **Venice Image Bridge**, then reload the page. Check that the panel says **Version 0.4.2**. Avoid keeping another old SillyTavern tab open while changing settings.

**First installation:** Extensions → Install extension → paste the URL → install for the current user → reload.

No terminal commands, new server plugin, new credentials or core edits are needed. Back up your SillyTavern user data as usual. Native extension installs and album storage require the Docker user-data directory to be persistent.

## Choose from the live image catalogue

1. Open **Extensions → Venice Image Bridge → Image model catalogue**. Keep Venice Image Generation installed with your API key.
2. The catalogue loads directly from `GET https://api.venice.ai/api/v1/models?type=image` on page load. **Refresh models from Venice** reloads it on demand. Loading the list does not generate an image.
3. Until you choose a model, **Use original setting** retains your existing generator's model and dimensions. Choosing a catalogue model overrides these for the bridge only; it does not overwrite the original extension's configuration.
4. Select a model, then its supported shape/resolution/quality, or width and height for pixel-based models. Advertised defaults are used initially. The listed USD price is shown when supplied by Venice; account access and billing remain controlled by Venice.
5. Ask the enabled companion for a picture, or open **Generate an image yourself**, enter a prompt, and press **Generate one image**. Manual generation requires the bridge and current character enabled on a direct Venice connection with inline media. Function calling is required only for companion tool calls. Each button press requests one charged image, with no automatic retry; the button and tool share a concurrency guard.

The old **Venice Image Generation** dropdown, `/vimg`, and its message buttons keep their original settings and static choices. Use the bridge's new picker and manual button for the expanded catalogue. No duplicate extension installation is needed.

The ordinary image catalogue offers text-to-image models. Reference portraits have a separate editing-model catalogue below. Upscale, video and background-removal operations are outside this update. `bria-bg-remover` is excluded even though Venice lists it under image. Offline models are labelled; a missing/offline selected model fails explicitly rather than silently spending on a replacement.

The last catalogue and selection are cached with extension settings, without copying the API key. A failed refresh retains them. Old API keys restricted to private models may reject anonymized models with HTTP 403; selecting a model does not change those restrictions. Generation failures are never retried automatically. Prompts retain the bridge's existing 1500-character limit.

## Growing album layout (0.4.2)

The bridge now occupies a non-shrinking block in the extension list, with automatic content height even if the host drawer animation leaves a fixed height. Dynamic albums remain above the following extension panels; collapsing still hides the content. A browser regression checks 0, 3 and 12 cards, stale inline height, collapse/reopen and four viewport widths. Run `CHROMIUM_EXECUTABLE=/path/to/chromium node tests/browser/drawer-layout.cjs`.

## Mobile layout fix (0.4.1)

Restores visible file choosers and full-width portrait buttons under SillyTavern’s own CSS. The browser regression test includes the host’s hidden-file-input and minimum-content button rules, and checks readable controls at 320, 393 and 709 pixels. The same file-input fix also applies to album uploads.

## Fixed reference portraits (0.4.0)

1. Open the intended one-to-one character chat with its bridge image-generation permission enabled.
2. Under **My reference portrait**, choose a PNG/JPEG/WebP from your device and tap **Save reference portrait**. Alternatively, use **Use as reference portrait** on a picture in the album below. This saves a separate, private album copy and verifies persistence before pinning it. Original files are retained.
3. Tap **Load reference image models**. This queries Venice's `GET /models?type=inpaint` catalogue without generating an image. Choose a model, shape and any supported resolution/quality. Prices include the single input-image surcharge when reported. Models and options are saved separately for each character. Existing choices are preserved on refresh; no model is silently substituted.
4. Ask the companion: **Use your self-portrait tool to make a picture of yourself in a new setting, keeping your reference face.** Expect **Create a self-portrait** (`VeniceCreateSelfPortrait`), then a new image in the chat. The original portrait is attached automatically; the model supplies only the scene description. A manual test button is also available.
5. Repeat setup for another character. Switch between them and verify each preview is the correct original. A different/reimported avatar filename starts a different reference configuration.

The reference is loaded afresh from local ST storage and sent as image bytes with the new prompt. The original is never replaced by a generated result. The editing model can still vary facial details; visual likeness must be checked on live outputs. Neither a prompt nor a reference guarantees an identical face.

The existing `VeniceCreateImage` tool is for other subjects and text-only generation; its description directs self-pictures to the new tool when available. `/vimg` remains the original text-only command. No character notes/card edits are required to expose the new tool; the conversational model decides whether to call it.

**API behaviour:** single-image `/image/edit` is used normally; models advertising quality choices use `/image/multi-edit` with exactly one reference so the selected quality is honoured. Only documented request fields are sent, with PNG output requested and actual returned PNG/JPEG/WebP format preserved. Safe Mode follows the existing generator setting. Provider content policies and account restrictions still apply. Editing does not accept the generator's separate negative-prompt field: put relevant exclusions in the scene prompt. Prompt enhancement is not enabled.

Both generation tools share one attempted image per user turn, the same busy guard and timeout. Missing/unreadable references, changed chats before upload and invalid model selections stop before a paid request. Provider failures are not retried or silently routed to another model. If the chat changes after a request was sent, its result is saved to the original gallery and never posted to a different character. Manual tests are explicit paid button presses, with the shared concurrency guard.

**Storage:** each reference is copied into the character's existing private album as a disabled attachment, with a settings pointer keyed by avatar filename. Leave these storage attachments disabled and keep the files. Album backups include the image bytes; after importing an album backup, choose the restored portrait as reference again. Server user-data backups also include the reference/model settings. **Stop using this reference** detaches the pointer and stops offering the self-portrait tool; it does not delete any file. Replacements retain the older copies in the album.

Version 0.4.0 passed **46 automated tests**, including per-character reference isolation, strict edit request schemas, single/multi-edit routing, shared attempt limits, failed requests, cancellation, binary formats and input-image pricing. A 393px mobile browser harness checked upload, model/options, independent references, persistence across reloads, failed-save rollback, album-copy selection, switching characters mid-load, detach and layout. Tests used synthetic images/catalogue responses and made no paid Venice requests. Live account access and visual likeness still need a first generation after installation.

Optional browser harness (Playwright and Chromium required): `CHROMIUM_EXECUTABLE=/path/to/chromium node tests/browser/portraits.cjs`. It tests the real portrait UI/runtime with simulated provider/storage responses; it is not a full live ST deployment test.

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

Image generation retains the one-tool-attempt-per-user-turn guard, shared concurrency guard, 120-second timeout, no automatic retries, and current-chat delivery. The optional catalogue selection and manual button were added in 0.3.0. Keep `st-venice-image` installed for the existing key and filter configuration. Album features do not require that generator. Original `/vimg` and message buttons continue to work with their original settings.

## Validation and limits

Run the local unit/host tests:

```sh
npm test
```

Tests cover existing generation and adapter behaviour, persistent album metadata, private/shared scopes, cross-chat retrieval, archive retention, invalid images/URLs, failed saves, missing files, cancellation, chat switching, per-turn limits, pagination and installer upgrades. A local ST 1.19.0 browser test also passed upload, verified settings persistence, reload, new-chat retrieval through the registered tools, real image encoding and the Venice role adapter. The test used a generated geometric fixture and made no Venice API calls. ST’s cleanup report left the saved image protected.

Version 0.3.0 passed all 35 automated tests. A separate 393-pixel mobile browser harness checked catalogue refresh, safe model labels, model-specific controls, price display, saved selection after reload, matching manual/tool request bodies, failed-refresh retention, invalid-dimension rejection, and horizontal overflow. It used synthetic catalogue and image responses; it did not test a paid generation against the live Venice service. After updating, refresh the live catalogue and generate one image to verify account access and provider behaviour.

The code was checked against ST **1.19.0**, commit `7e8663cd9c184a550b37238218bdd32c6efc68e9`.

The 0.1.0 bridge was live-tested by the user with slash-command images and generation/inspection tool loops. The 0.2.0 album still requires the live acceptance steps above on the user's installation. Developer tests do not spend Venice credits or validate model compliance.

The adapter does not restore excluded messages or pictures omitted by context limits. It preserves tool-call/result ordering; images from incomplete tool exchanges are withheld until a complete request. Album titles are labels and notes may be incomplete; the tool instructs the model to inspect actual image input before describing it.

## Rollback

Turn off the character’s **find and open saved pictures** checkbox to stop offering album tools. Keep the bridge enabled for the existing image-role fix. Stored album entries remain intact.

Disabling the entire extension also disables the image-role fix; assistant images may then trigger Venice's original 400 error. Existing saved pictures/chats are not deleted by disabling the extension.

For a server operator, the optional installer copies all twelve runtime files and backs up a prior bridge installation:

```sh
node install.mjs --app-root /actual/path/to/SillyTavern --dry-run
node install.mjs --app-root /actual/path/to/SillyTavern
```

It requires exactly ST 1.19.0, does not find Docker containers, and does not change mounts. Normal users should use the native extension manager instead.

## Sources reviewed

- Original generator: https://github.com/AnonCollab/st-venice-image/blob/9f04082c92c62af284c7752811fc3c00f66a9921/index.js
- Venice model catalogue: https://docs.venice.ai/api-reference/endpoint/models/list
- Venice model-specific sizing and request fields: https://docs.venice.ai/api-reference/endpoint/image/generate
- Venice editing API: https://docs.venice.ai/api-reference/endpoint/image/edit
- Venice multi-image editing API: https://docs.venice.ai/api-reference/endpoint/image/multi-edit
- Venice maintained image-generation reference: https://github.com/veniceai/skills/blob/main/skills/venice-image-generate/SKILL.md
- ST 1.19.0: `public/script.js`, `public/scripts/openai.js`, `public/scripts/st-context.js`, `public/scripts/tool-calling.js`, `public/scripts/chats.js`, `public/scripts/utils.js`, `src/endpoints/files.js`, `src/endpoints/settings.js`, `src/endpoints/data-maid.js`.

Independent companion extension; not an official Venice or SillyTavern release.

## 0.5.1 — phone-photo orientation

Outgoing JPEG attachments with EXIF rotation or mirroring are decoded in the browser and re-encoded upright before Venice receives them. The saved originals and chat display are unchanged. Covers human and assistant image inputs, including existing photos sent again in context. JPEGs already upright, PNGs and WebP files pass through unchanged. No prompts, character settings, image generation or journal behavior change.

Conversion preserves pixel dimensions and uses JPEG quality 0.98; it is not a byte-lossless operation. A bounded in-memory cache avoids repeated conversion. Conversion failures show a warning and send the original. Photos above 48 megapixels use this fallback to avoid excessive canvas memory. No extra network requests or model calls are made.

Update Venice Image Bridge in SillyTavern, reload, and confirm version 0.5.1. Send an original affected photo once to verify the provider-side result.

## 0.6.0 — your own reference, alone or together

The additional **Your own reference portrait** section stores one human-user reference for this ST account, separate from every companion reference. Upload your original photo once, save it, load reference image models and choose your editing model. The copy is saved in the private ST account’s shared image album and excluded from text retrieval. This release contains no user photos or personal data.

Use **Make a picture of you** to select **You alone** or **You and the current companion**. Together uses your selected editing model, your image as reference 1 and the active companion’s saved portrait as reference 2. The catalogue must explicitly support at least two images; refresh older catalogues. The panel displays the listed charge for one or two inputs. Identity preservation is model-dependent; exact likeness is not guaranteed.

Companions with bridge image generation enabled also get `VeniceCreateUserPortrait` once your reference and model are configured. Its `include_character` option selects both people. The existing self-portrait tool, its wording and initiation portrait behavior remain unchanged. All image tools share the existing one-attempt-per-user-turn guard and cancellation/chat-switch protection. No automatic fallbacks or retries.

Verified against Venice’s official `veniceai/skills` image-edit documentation: `combineImages`, `maxInputImages`, ordered `images` arrays, `modelId` for multi-edit and per-input pricing. Both images are loaded locally as bytes; private ST URLs and API keys are not inserted into the prompt. No third-party reference URLs are accepted.

Validation: 62 unit/host tests, mobile browser checks for both reference panels, ordered two-reference requests, missing-reference and unsupported-model guards, shared attempt limits, save rollback, switching companions, and the previous orientation tests. Provider calls are mocked; check one generation after installing.
