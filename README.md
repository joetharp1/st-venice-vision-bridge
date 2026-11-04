# Venice Image Bridge 0.1.0

For SillyTavern 1.19.0 using a direct Venice Custom OpenAI-compatible connection.

**Status: built and locally tested; not yet validated in a live SillyTavern/Venice session.**

## What this adds

- Generated pictures remain visible as character messages in the current chat.
- On outgoing Venice requests, assistant `image_url` parts move into a separate labelled user-role input. The character's words remain assistant-role text. Saved chat authors and original attachments are not rewritten.
- This covers existing assistant image messages in the active request, including those made by the original `/vimg` command and its message button.
- An optional `VeniceCreateImage` tool lets the selected character write a prompt and invoke image generation during a reply. It uses the original extension's API key, image model, dimensions, negative prompt, watermark and safe-mode settings.
- One tool attempt per user turn, concurrency protection, no automatic retries, a timeout and stop-button cancellation.
- Generated tool images use the same character gallery storage as the original extension. A chat change during the network request prevents posting into the wrong chat.

The original `st-venice-image` extension is required for its settings. Leave it installed. Its slash command and buttons remain available. This package has no replacement `/vimg` command.

## Connection scope

The adapter activates only when `mainApi` is `openai`, the source is `custom`, and the configured endpoint is `https://api.venice.ai/api/v1` (optional trailing slash). It does not activate for another provider, a proxy URL or the Venice website's UI. It is not restricted to one model ID.

The image tool is offered only in a one-to-one character chat explicitly enabled in this extension, with inline media and function calling enabled and the original generator key configured. Group image-tool invocation is intentionally unavailable in this release. The role adapter can still handle outgoing group assistant images.

## Install from SillyTavern

Install using this repository URL:

```text
https://github.com/joetharp1/st-venice-vision-bridge
```

1. In SillyTavern, open **Extensions → Install extension**.
2. Paste this repository’s HTTPS clone URL and install for the current user.
3. Reload SillyTavern and open **Extensions → Venice Image Bridge**.
4. Keep the original [Venice image generator](https://github.com/AnonCollab/st-venice-image) installed and configured.
5. Follow the activation and live acceptance steps below, using a test character first.

The native installer places the extension in the user data directory; Docker deployments should persist that data directory. No terminal commands or npm installation are required for normal use. Native installation does not run the optional Node installer's exact-version check: compatibility is targeted at SillyTavern 1.19.0.

## Optional manual installation for the server operator

The ZIP contains `st-venice-vision-bridge/`. The four runtime files are `manifest.json`, `index.js`, `core.mjs`, and `runtime.mjs`. Install them together in:

`<SillyTavern>/public/scripts/extensions/third-party/st-venice-vision-bridge/`

No npm dependencies, server plugin, new API credential, database migration, or core SillyTavern edit is required.

An included Node installer checks for exactly SillyTavern 1.19.0 before writing. From an extracted package outside the live extension directory:

```sh
node install.mjs --app-root /actual/path/to/SillyTavern --dry-run
node install.mjs --app-root /actual/path/to/SillyTavern
```

Use the actual path inside the container if SillyTavern runs in Docker. The installer does not find containers or change Docker mounts. Confirm that `public/scripts/extensions/third-party` is on persistent storage before relying on survival across container recreation. Existing bridge versions are copied to `data/venice-image-bridge-backups/` before replacement; original Venice extension and chat files are untouched.

Reload every open SillyTavern browser tab after installation. Open Extensions > Venice Image Bridge:

1. Keep **Keep assistant pictures compatible with Venice** on.
2. Open a test character’s one-to-one chat and enable image generation for that character. It is off for every character initially.
3. Keep inline images/media on in Chat Completion settings.
4. Enable function calling in Chat Completion settings. This also makes any other configured tools eligible; check the existing tool list.
5. Keep the original Venice generator configured with the preferred model and size. The new tool always posts its image in the current chat, regardless of the original generator's `send_to_chat` checkbox.

No character-card change is mandatory. A short optional instruction is: “When sharing a picture is appropriate, use VeniceCreateImage. Choose the visual prompt yourself. Only say you have sent a picture after the tool succeeds. Inspect the returned image before describing its actual details.”

## Live acceptance tests still required

Use a separate test conversation first; keep debugging separate from ongoing conversations.

1. Confirm the extension appears and its status says the image-role fix is active. Confirm there are no import errors in the browser console.
2. Send a normal text message and then a fresh user-attached picture. Both must receive replies.
3. Generate an image with `/vimg`, then ask about the result. It must remain visibly attributed to the character, while the outgoing API request contains no assistant `image_url` and does contain the image under user role. No 400 should occur.
4. Repeat using the original message image button.
5. Enable the image tool for the test character and explicitly request one image. Confirm the tool is offered, called, the image posts, and a follow-up reply completes. Inspect the returned image input rather than accepting the model's claim that it can see it.
6. Ask about a visible detail absent from the generation prompt. Follow with another text turn and confirm the image can still be included while within context.
7. Open an old conversation containing the formerly rejected assistant image and confirm the next request is adapted without editing its history.
8. Reload and confirm settings/attachments persist. Only then enable the tool for your chosen character and verify one image exchange.

API image generations use the user's existing Venice credits. Local tests used dummy responses and consumed no Venice credits. No live API call was made by the developer environment.

## Rollback

Turn off **Keep assistant pictures compatible with Venice** and reload, or disable this entire extension in SillyTavern. This restores the original outgoing request behavior; assistant images can then cause the original 400 again if included with inline images on.

The installer can remove only this bridge, copying it to a dated backup first:

```sh
node install.mjs --app-root /actual/path/to/SillyTavern --uninstall
```

The original generator and all stored chats remain intact. A server operator can restore a saved bridge directory from the backup location.

## Verified locally

17 automated tests pass: log-shaped assistant/user image input, multiple attachments, image-only messages, idempotency, provider scoping, text preservation, tool-call/result adjacency, incomplete tool exchanges, generation/save/post/inspect flow with simulated Venice, existing settings preservation, one-attempt limits, concurrent calls, persisted successful-turn guard, chat switching, cancellation, a SillyTavern host-interface harness, and installer dry-run/install/update/backup/removal/version refusal. JavaScript syntax checks pass.

These are local unit and host-interface tests, not a real-browser SillyTavern session or a live Venice roundtrip.

## Limits and design details

- No cross-chat visual memory or automatic photo retrieval. Images must be in the outgoing context to be inspected. Text memories are still text.
- Hidden/excluded messages and images dropped for context size are not restored by this adapter.
- The adapter changes only outgoing assistant image parts. It does not fix malformed tool calls or unrelated request parameters. System/developer image inputs are outside this release's scope.
- If an assistant tool call lacks all its results, the adapter withholds that image rather than inserting a user message into the unfinished tool exchange. It can be included in a later complete request.
- The application-generated label adds a small amount of text after SillyTavern's initial token budgeting. Allow a little context headroom. Normal media-fetching, compression and image-token accounting remain SillyTavern's job.
- The tool's one-attempt limit applies per latest user message and prevents spending loops. On failures a new user message is needed to try again. A browser reload resets the in-memory failed-attempt guard; successful generations remain detected from the stored bridge image marker.
- The generator may still charge for requests that time out or are cancelled. It receives no automatic retry from this bridge.
- The model decides whether to call an offered tool. Offering it is not a guarantee it will act on every request. No scheduled or background generation is added.
- Avoid switching chats during a tool call. The bridge guards its own picture posting; unrelated SillyTavern tool-follow-up behavior remains controlled by SillyTavern.
- The original extension's message and test buttons still bypass its `send_to_chat` checkbox, as in upstream. The adapter handles their outgoing pictures while active.

## Sources reviewed

- Original generator: https://github.com/AnonCollab/st-venice-image/blob/9f04082c92c62af284c7752811fc3c00f66a9921/index.js
- SillyTavern 1.19.0: `public/scripts/openai.js`, `public/script.js`, `public/scripts/tool-calling.js`, `public/scripts/st-context.js`, `public/scripts/events.js`, and built-in stable-diffusion extension.
- The reproduced failure involved assistant-role image content being rejected while user-role image input was accepted.

This is a separately authored companion extension, not an upstream update or an official Venice/SillyTavern release.
