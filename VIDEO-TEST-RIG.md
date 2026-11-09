# Video connection test 0.1.0 — shipped with Image Bridge 0.6.6

This document describes the manual acceptance rig. The production companion feature added in 0.7.0 has its own panel and documentation. It adds no model tools, trigger instructions, character edits, speech, lip-sync, scheduler or budget controls. It leaves image prompts, references, ratios, models and ordinary image generation unchanged. The test panel loads on request; saved jobs cause it to load again on startup for recovery.

## Phone acceptance sequence

1. Update Venice Image Bridge through ST's extension manager, reload and check Version 0.7.0 or later. Use one device and one active ST tab for these tests.
2. Open the intended saved one-to-one chat. In Image Bridge press **Open manual video connection test**.
3. Choose **Use latest chat picture** or select the approved still from the phone. The rig intentionally allows an existing audition still; production's same-turn-only source rule is not a model tool in this rig. Inspect the preview and tick the face/body approval box.
4. Select **Silent — test API switch**. Press **Check connection and quote — no generation**. It reads the live video catalogue, requires the exact Wan 2.7 Enhanced I2V model and five-second support, chooses the lowest advertised resolution, and checks `supportsAudioConfig`. A missing capability means silent is unavailable; no paid request is sent. Switch to Ambient if needed. There is no audio stripping or re-encode.
5. Read the quote in USD and credits. The test reuses the selected still; its price covers video only. Unknown prices and quotes above US$3 block submission. There are no automatic paid retries.
6. Press **Start one quoted test** once. Wait for **Queue confirmed and saved**. Then reload while it renders. The saved queue ID must resume; no second `/video/queue` request is permitted.
7. On completion, check the panel player and the inline Video test message in the original chat. Press Play on Android, test seeking and unmute. Record what you hear using the panel buttons. Audio-track presence alone does not prove audible sound or silence.
8. Make a second explicit quoted test. Wait for **Queue confirmed and saved**, close the tab entirely and reopen the original chat. It must recover the same job. Opening a different chat must hold delivery until the original chat is reopened.
9. Press **Copy test report** and send that report for review. It includes the selected model constraints, pricing inputs, USD/credit quote, job/queue tags, file byte/hash verification outcome, playback observations and redacted errors. It excludes API keys, prompts, reference bytes and private download links.

Closing during the HTTP submission, before its queue ID is confirmed and saved, has an irreducible uncertainty window without provider idempotency or job discovery. The rig persists a submitting record before paying. An ambiguous result blocks further submissions until its two-hour deadline and is never automatically resubmitted. A received queue ID is immediately backed up locally and committed to ST with a read-back check. That local receipt is a fallback, not the primary job store.

## Persistence and delivery

- Job records are stored in ST `extension_settings['venice-video-rig-v1']` and verified by `/api/settings/get` after `saveSettings`. They include captured avatar/chat ID, quote, parameters, queue ID, optional private delivery link and saved-file metadata. No API key is copied into them.
- The existing `st-venice-image` API key is used only for `https://api.venice.ai/api/v1`. No key is forwarded to signed media-delivery URLs. Missing key or browser CORS failure is reported; no proxy is invented.
- Maximum two active provider jobs across the ST profile. A profile-wide Web Lock serializes submissions until the queue ID is confirmed and persisted. Separate job locks prevent duplicate retrieval/delivery from tabs on the same browser. Web Locks cannot coordinate different devices; this rig requires one device. Persistent settings remain subject to ST's normal cross-session last-write-wins behavior.
- Jobs poll about every eight seconds while the browser can execute; failures back off. Closing/suspending the app pauses local retrieval, not necessarily provider rendering. Reload/reopen resumes retrieval. A two-hour unresolved deadline releases the execution slot and retains possible charges. It does not claim a provider cancellation or refund.
- MP4 uploads use a deterministic UUID filename through `/api/files/upload`. `/api/files/verify` and a full read-back SHA-256 comparison precede disabled Data Bank registration and provider cleanup. Returned storage paths are used; no invented folder is required. Only MP4 up to 32 MB is accepted.
- Files are registered as disabled attachments, outside automatic text retrieval. A normal ST video attachment is posted as a **system test message**, not a companion response. No TTS, generation or character-message events are fired by the rig. The original avatar/chat is checked before posting and the saved chat is read back before marking delivered. Stale local chats are held instead of overwriting different saved history.
- Failed uploads retain the queue ID/provider copy; a failed chat save retains the verified local MP4. Recovery retries retrieval/upload/delivery, never generation. Provider-copy cleanup starts only after verified local storage and registry persistence.
- Test clips are retained for review. The agreed production retention is 30 days or the adjustable total-storage cap, whichever is first. Automatic retention deletion is deliberately outside this manual rig's scope. Test files can be downloaded and removed manually through ST Data Bank.

## Budget baseline, not enabled caps

Venice's published conversion is 100 credits = US$1. Joe's Studio audition cost 55 credits = US$0.55. Ninety such video-only clips are 4,950 credits = US$49.50; six are 330 credits = US$3.30. Starting stills add to these figures, and the authenticated API quote may differ from Studio. The eventual production settings target six submissions/day, ninety per rolling thirty days, two active jobs and a US$3 combined still+video job ceiling. The final spend ceilings must accommodate still costs and the measured API quote, rather than silently treating US$50 as enough for ninety complete jobs. No rolling-budget controls are implemented here.

## Current feature scope

The companion tool is now available separately in [COMPANION-VIDEO.md](COMPANION-VIDEO.md). This document describes the manual test panel. The stage-3 requirement has been removed at Joe’s instruction.

## Validation

**119 automated tests passed, with zero skipped.** Node tests exercise the actual rig core and host adapter, including server persistence/read-back, failed saves, both recovery paths, no resubmission, two-job admission, ambiguous submission hold, expiry, wrong-chat delivery, hash mismatch, disabled attachment registration, signed-download auth separation and audio parameter construction. Source-contract assertions read the pinned ST 1.19.0 implementation for imports, file routes, settings and chat responses and native video markup. Existing bridge tests are retained.

`tests/browser/video-rig.cjs` is a real Chromium harness with synthetic Venice/ST endpoints and generated media. In the development environment Chromium could not launch because its required socket operation was denied, so browser-layout/playback checks are **not claimed as passed**. Actual Venice quote/auth/audio behavior, Android playback and Hostinger request-size limits remain the purpose of the live acceptance sequence above.

## Sources checked 2026-11-09

- https://venice.ai/pricing — credit conversion.
- https://docs.venice.ai/guides/media/video-generation — queue, quote, retrieval, audio capability and cleanup flow.
- https://docs.venice.ai/api-reference/endpoint/video/quote — numeric USD quote.
- https://docs.venice.ai/api-reference/endpoint/models/list — live model capability catalogue.
- ST 1.19.0 source commit `7e8663cd9c184a550b37238218bdd32c6efc68e9` — host contract.
