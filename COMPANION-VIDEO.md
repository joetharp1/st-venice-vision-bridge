# Companion video 0.7.2

This release adds an opt-in `VeniceCreateVideo` tool to the existing Venice Image Bridge. It creates a fresh composed still through the saved reference-image pipeline, then animates that exact still with `wan-2-7-enhanced-image-to-video`. The companion's text reply is saved before either paid stage starts. Ordinary chat can continue while a submitted video renders.

## Install on the phone

1. In ST's extension manager, update **Venice Image Bridge**, then reload. Check **Version 0.7.2**. Use one device and one active ST tab for the first acceptance run.
2. Open Ava's saved chat. In **Venice Image Bridge → Companion video**, press **Check live prices and set initial budget**. This checks catalogues and quotes only; it does not generate anything.
3. Leave audio **Ambient** and resolution **Lowest advertised** for the first clip. Tick **Enable video for this companion**, then press **Save video settings**.
4. Ask for a five-second, fully clothed clip with a small head movement and a fixed camera. Her announcement should arrive first. The tool creates the still and queues the video afterwards. The panel shows its state and any error.
5. Repeat the enable/save step in other companion chats when wanted. Joe's saved reference and each companion's reference come from the existing image bridge. No character-card fields are edited.

The existing Venice Image Generation API key is reused. It is never stored in the job record or repository. No server command, package installation or VPS login is needed.

## Controls and costs

| Control | Default |
| --- | --- |
| Duration | 5 seconds; 10/15 only when requested and confirmed by live catalogue |
| Resolution | Lowest advertised; panel can select 720p or 1080p if available |
| Audio | Ambient; no companion speech or lip-sync |
| Active jobs | 2 across the ST profile, submissions serialized |
| Submissions | 6 per local calendar day; 90 per rolling 30 days |
| Complete job ceiling | US$3 initial default, editable up to US$7 including still and video; unknown price blocks |
| Daily spend | Initial live five-second combined quote × daily count, rounded up to cents |
| Rolling spend | Initial live five-second combined quote × rolling count, rounded up to cents |
| Retention | 30 days or 2,048 MB, whichever is reached first; adjustable |

Venice publishes **100 credits = US$1**. The Studio audition was 55 credits/US$0.55 for video alone. Ninety such videos alone would be US$49.50. The panel includes the separately priced starting still and uses the authenticated API quote, so the resulting budget can exceed US$50. Both USD and credits are displayed. Existing non-null spending ceilings are never silently raised by checking prices again. Submission/spend limits can be edited without rebuilding.

Costs include pending reservations and possible charges from ambiguous network failures. A rejected video releases its video reservation but retains the cost of a completed still. Explicit video refunds do not erase still charges. Manual rig jobs also count in the production budget's usage calculation; the manual rig remains a separately confirmed acceptance tool with its own US$3 test ceiling.

Silent mode is not promised by a catalogue flag alone. Run the manual silent connection test, play the result, and mark **I hear no sound**. A verified saved test with that evidence unlocks the production silent setting when saving. The live catalogue must also advertise `supportsAudioConfig`. There is no stripping/re-encoding pipeline. Lip-sync and ElevenLabs video voice are outside this release. Pregnancy stages are outside scope at Joe's instruction.

## Execution and recovery

- The tool description supplies trigger rules: one clip per reply; visual exchanges with meaningful movement; no unsolicited video in a text-only exchange; announce the forthcoming clip. These are model instructions, not a semantic classifier. Duplicate requests for the same user turn return the existing job. Provider submission is guarded in code.
- The tool freezes references and scene, checks pricing, and saves an `awaiting_reply` record. It returns to ST's normal tool continuation. Only a subsequent saved assistant message following this exact job's tool result satisfies the announcement check. Stopping or failing the continuation cancels before spending. A missing announcement times out after three minutes.
- A local settings copy supplies the video ratio, 9:16 or 16:9, to the existing portrait planning functions. Companion identity/exclusions and Joe's two-reference ordering are retained. The ordinary image settings are never modified. The generated still is saved, hashed and dimension-checked; it carries this job ID and originating turn ID. Video never uses an older chat photo or the reference plate directly.
- Image preparation shares the bridge's image lock. It does not change ST's Send button, generation flag or initiation guards. Text generation remains separate. New paid stages hold when backgrounded, drafting, generating or in another chat. Already queued jobs continue retrieval when the browser can execute.
- Jobs persist in ST `extension_settings['venice-video-rig-v1']`, alongside manual rig jobs, with server read-back verification. Every paid stage is marked before its request. Queue IDs receive an immediate local emergency receipt as well as the server commit. Recovery retrieves the stored ID; it never reissues a render request. A paid still interrupted before confirmation is held as uncertain rather than regenerated.
- The global submission Web Lock covers still preparation through confirmed queue submission. Two accepted jobs can coexist; a second provider submission cannot overlap an ambiguous first one. Per-job locks protect retrieval and delivery. Web Locks coordinate tabs in the same browser profile, not separate devices. ST's settings storage remains last-write-wins across unrelated sessions: use one active tab/device for reliable operation and do not edit settings from competing sessions.
- Closing or suspending the phone pauses browser work. The provider may keep rendering. Reopening resumes the saved queue. Unresolved jobs expire after two hours, release execution capacity, and retain possible charges. Expiry does not claim provider cancellation or a refund.
- MP4 is uploaded to ST user files, verified by file lookup and full SHA-256 read-back, then registered as a disabled Data Bank attachment. Only after that is provider cleanup requested. The captured original chat receives a native video attachment and the short text `Video.`; no extra continuation or TTS event is fired. Wrong-chat and stale-chat checks hold delivery rather than writing elsewhere.
- Retention deletes only files belonging to completed/failed production jobs, removes their disabled Data Bank registrations, and records expiry. A generated still later selected as a saved face reference is protected. Original references are never retention candidates. Download favourites before expiry; old chat links can stop working after cleanup. Manual audition files remain retained for explicit review. VPS storage is not a backup.

## Validation and remaining acceptance

**144 automated tests passed, none skipped**, including the existing image, album, initiation-facing bridge, transport and TTS tests. New tests exercise the real production core and host adapter, frozen references, both-person pricing, scoped aspect ratio, announcement ordering, continuation cancellation, duplicate requests, two global slots, quote changes, rejected/ambiguous submissions, saved receipt recovery, TTL, budget arithmetic, retention ownership, reference protection, and original-chat attachment. Pinned ST 1.19.0 source contracts cover the host exports, file endpoints, settings, chat storage and native MP4 rendering.

Actual Venice authentication/quotes/audio-switch behavior, browser close/reopen recovery against the live server, and Android MP4 playback **are not yet verified**. Chromium could not launch in the development environment because its socket operation was denied; browser playback is not claimed as tested. The Studio audition establishes a promising visual result, not API acceptance.

Live checks after installation:

1. One short ambient clip: announcement first, one starting still, one video, correct face, correct chat, readable status and working Android playback.
2. Start another, wait for `queued` in the panel, hard reload mid-render. Confirm the same job resolves with no second submission.
3. Repeat with closing the tab entirely and reopening the original chat. Compare the diagnostic report's job/queue tag and provider usage.
4. Generate a normal image afterwards and confirm Joe's ordinary aspect ratio.
5. Run the manual silent audition only if silent mode is wanted. Keep Ambient otherwise.

## Implementation map

- `video-core.mjs`: reference-still planning, numeric prices, limits, state machine, announcement matching, retention.
- `video-host.mjs`: live catalogues/quotes, saved-turn identity, reference-byte loading, still upload/hash and video submission validation.
- `video-ui.mjs`: per-companion opt-in, tool registration/trigger discipline, controls, calibration, job status and recovery timer.
- `video-rig-core.mjs`: shared catalogue gates, queue receipt recovery, retrieval, timeout and delivery flow.
- `video-rig-host.mjs`: authenticated requests, server-verified state, safe file paths, native MP4 delivery, disabled registry and owned-file deletion.
- `runtime.mjs`: shared image preparation lock; ordinary image planning remains unchanged.
- `index.js`, `install.mjs`, `manifest.json`: optional feature loading and complete versioned install package.
- `tests/video-production.test.mjs`, `tests/video-production-host.test.mjs`, `tests/video-rig-host.test.mjs`: regression coverage.

Official API references: [video workflow](https://docs.venice.ai/guides/media/video-generation), [model catalogue](https://docs.venice.ai/api-reference/endpoint/models/list), [credit pricing](https://venice.ai/pricing).


## 0.7.1 live setup follow-up

Joe’s API diagnostic confirmed the model, 5/10/15-second durations, 720p/1080p, native audio with `audio_configurable: false`, and a five-second 720p quote of US$0.64. No job was recorded in the supplied report. The panel showed a generic timeout; that evidence does not identify its request or establish whether the video tool was offered. The saved US$4.20/day and US$63/30-day ceilings correspond to a US$0.70 starting baseline including the still.

Code review found that the quote handler reset an unsaved Enable checkbox. Version 0.7.1 preserves it until Save, displays saved tool readiness, records tool invocation/preflight failures, identifies request timeouts by endpoint, and reduces idle server reads. UI-handler regression tests run the actual quote/save handlers with a minimal DOM fixture; browser layout is not claimed as tested. After updating, tick Enable, Save, and confirm **Video tool READY** before requesting a new clip. No API generation or playback has yet been demonstrated by this diagnostic.


## 0.7.2 live upload follow-up

The first live job reached `saving` with an upload timeout at SillyTavern `/api/files/upload`. The provider result had reached the client, but a verified ST copy was not yet recorded. Version 0.7.2 extends media upload/read-back deadlines from 30 to 120 seconds, probes the deterministic video filename in the verified source-still directory, and recovers a completed upload only after exact byte-length/SHA-256 matching. This applies before retrying an upload and after an ambiguous network timeout. A mismatch blocks overwriting. Disabled Data Bank registration and provider cleanup ordering are unchanged.

Recovery uses the existing saved queue; no new generation is necessary. Update/reload, reopen the original chat and use Check saved jobs. Keep the tab visible while the media saves. Live delivery/playback still needs confirmation; the successful regression tests simulate both an upload that landed before timeout and a mismatched existing file.
# Manual video creator · 0.8.0

In **Extensions → Venice Image Bridge → Companion video → Create a video yourself**, choose the current companion, yourself, or both. The form previews the saved reference portraits and accepts separate starting-scene and movement prompts, portrait/landscape framing, and catalogue-supported 5/10/15-second durations. Open another companion chat to use their saved portrait. Reference changes are made in the existing portrait controls.

**Check price for this video** is free. **Generate my video** explicitly reserves the quoted still-and-video job. Quotes expire after five minutes and form edits/chat switches invalidate the form quote. A price rise above the approved total stops further spending; if the still has already been generated, it stays available. Audio and resolution are frozen from the saved settings at quotation time. Manual jobs share all existing video budgets, concurrency limits, receipts, recovery and retention. They do not require the companion video tool to be enabled or a model-generated announcement. The bridge itself must be enabled, its API key configured, and video budgets initialised.

The delivered clip is labelled **Your video** as a system media message in the originating chat, without triggering a reply or TTS. No Telegram media integration is present. Keep the originating chat visible and idle for submission; queued provider jobs recover without resubmission after refresh. The manual connection-test rig remains available for animating an already composed uploaded still.

Validation: automated production/core/host/UI tests plus Chromium with synthetic Venice/ST endpoints cover manual quote/submit, two-reference preparation, approved-price bounds, stale quotes/chat changes, duplicate clicks, recovery, video delivery/playback and mobile layouts. No paid provider generation is needed to run these tests.

## Separate video references · 0.8.1

The video panel now has **Separate video references** controls for the user and current companion. References are persisted under `venice-video-rig-v1.videoReferences`, separately from `st-venice-vision-bridge.portraits`. Video planning overlays only the reference URL/title on a cloned portrait configuration; reference model/options remain the person's existing configured values. Ordinary image generation settings are never changed.

Each upload has a unique `venice_video_reference_` filename, verified bytes and a disabled Data Bank registry entry. It is not a generated-video job and is not removed by job retention. Clearing detaches the video override and preserves its stored image; existing jobs continue using their captured references. Current-chat guards prevent a delayed upload from being assigned to a newly selected character. Both user and companion video entry points share this selection logic.

Validation: 146 automated tests passed (7 existing skips). Chromium synthetic end-to-end coverage includes separate uploads for both people, persistence after reload, use of the two uploaded references in a video, restoration of picture-reference fallback, preservation of picture settings and previously used files, inline video playback and mobile layout. No paid Venice generation was performed.

## Shared video model and 10-second minimum · 0.9.0

A single saved `videoConfig.model` now controls manual and companion-requested production clips. The default remains Wan 2.7 Enhanced; default duration is now 10 seconds. The live catalogue controls model-specific durations and resolutions, including 15-second or longer clips. New requests below 10 seconds are rejected before any paid stage, while already saved short jobs retain their original recipe for recovery. Models without a supported 10–30-second option are omitted from the shared selector.

Starting-image-only compatibility is checked before planning. Native `audio_configurable` and fixed-silent metadata are recognised; fixed-resolution models omit resolution. Quoted jobs freeze model/audio/resolution for every subsequent stage, so changing the shared setting cannot switch an existing job to another provider. Per-job/shared budgets and ambiguous-submission safeguards remain unchanged. Price increases above an explicitly approved manual quote still stop the job.

Checks: 148 automated tests passed (7 existing skips), synthetic Chromium tests cover selecting another model, saving/restoring shared settings, 15-second requests, reference uploads, queueing, recovery, delivery and mobile layout. Planning was validated against all 49 currently compatible active models returned by the account catalogue. No paid model generation was performed. Live endpoint contracts: https://docs.venice.ai/api-reference/endpoint/video/queue and https://docs.venice.ai/api-reference/endpoint/models/list.

## Configurable production quote ceiling · 0.9.1

Production quotes and submission rechecks now use the saved complete-job ceiling, editable up to US$7. The source still remains included in the combined budget. Existing defaults, daily and rolling limits, pending reservations and legacy test-rig limits are preserved. Joe requested a US$7 complete-job ceiling; deployment updates only that saved field, leaving his existing US$7 daily and US$63 rolling limits intact. No paid generation is part of deployment.
