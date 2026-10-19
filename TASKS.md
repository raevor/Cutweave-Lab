# Foundation task gates

## Commit readiness review — 2026-10-19

- [x] Existing local unit suite: 127 tests pass after replacing obsolete color-residual and arbitrary percentage-gain expectations with current bounded-filter contracts, direct learned RGB retention and dark-stroke protection checks. These synthetic tests do not validate neural model quality or GPU throughput.
- [x] Preserve document isolation on navigation into Video Enhancer; correct its tool availability label.
- [x] Ignore new Markdown and local design working files; preserve already tracked Markdown updates. Model distribution notices remain in `public/models/video-enhancer/NOTICE.txt` with upstream licenses.
- [x] Candidate text-file credential-pattern scan reports no findings; no candidate file exceeds GitHub's single-file limit. Private media/cache/local configuration remain ignored.

## Enhancer v16 — native detail / 2x IO

- [x] Respond to user-reported v15 native ~10 s versus 2x ~230 s and weaker native detail; keep those observations distinct from agent benchmarks.
- [x] Strengthen native finishing with bounded fine/wide luma detail in the existing pass; retain local extrema, dark-stroke protection, noise gating and zero-sharpen bypass.
- [x] Remove two application SPAN cast nodes and halve FP16 external IO buffers; retain all author learned nodes/weights, FP32 GPU fallback and bounded/cancellable workers.
- [ ] User compares v16 quality/artifacts and actual source/2x times. No measured speedup or one-minute claim.

> **Read first:** `HACKATHON_RULES_S4.md` (local-only reference, intentionally not distributed) is the current S4 reference, checked 2026-10-19. Existing checkboxes are historical task records, not proof of current hackathon compliance. Do not infer S4 requirements from older guides.

## Gate 0 — Product boundary

- [x] Define the target user, core job and V1 exclusions.
- [x] Keep English as the default public UI, provide the optional Turkish locale, and keep repository documentation in English.
- [x] Keep private strategy guides outside public Git tracking.

## Gate 1 — Design foundation

- [x] Establish OKLCH semantic tokens.
- [x] Keep the visual system around edit points, tracks and timecode without inventing an extra combined workspace.
- [x] Reject pixel, generic AI and decorative analysis patterns.

## Gate 2 — Local product shell

- [x] Build landing, lab and privacy routes.
- [x] Make `/lab` a clickable tool library instead of the default editor workspace.
- [x] Add real local file selection and object URL preview.
- [x] Add browser capability preflight.
- [x] Label unfinished analysis honestly.

## Gate 3 — First vertical slice

- [ ] Add deterministic demo media with a recorded license/source.
- [ ] Decode frames off the main thread.
- [x] Match three selected reference frames to real sampled ranges from the selected source.
- [x] Render those matches in the focused Face Recognition result screen.
- [x] Add cancellation and stale-result protection to the face-analysis job.
- [x] Add a feature-detected local WebM clip ZIP export with JSON and CSV cut plans.
- [x] Replace the saturated descriptor path with self-hosted 128-dimensional face descriptors, Euclidean matching and strict reference agreement.
- [x] Add local reference cropping and preserve reference crops across GPU/CPU changes.
- [x] Anchor clips on a matched opening frame, verify the face through the full duration, and remove reference/near-duplicate scenes.
- [x] Calibrate the identity threshold from the three reference embeddings and search complete clip windows around coarse detections.
- [x] Increase bounded scan density, retain one reference-neighborhood scene and relax only internal clip checkpoints while keeping the opening strict.
- [ ] Verify zero media upload during the complete slice.

## Gate 3B — Remaining primary tools

- [ ] Produce adjustable music and bass markers from real audio.
- [ ] Export marker data in at least one useful editor format.
- [ ] Produce a real Video Enhancer before/after result while preserving the source.
- [ ] Validate the enhancer output and the GPU/WASM or CPU fallback.

## Gate 4 — Verification

- [ ] Add unit and browser tests for the vertical slice.
- [ ] Add privacy network interception tests.
- [ ] Record performance by browser/device tier.
- [ ] Verify a public deployment, generate the TestSprite 3.0 portal suite, connect the GitHub App, and record a genuine automatic PR test/fix/rerun cycle under the announced S4 rules.

## Season 4 submission verification

- [ ] Check later amendments to the supplied official Discord rules and project deadline: October 22, 2026, 23:59 PT / October 23, 09:59 TRT.
- [ ] Verify public source and README with app description, live URL and suite coverage.
- [ ] Verify a passing TestSprite PR comment/status check against the intended deployed revision.
- [ ] Verify X follow, Discord membership/badge, age/region eligibility, one submission only, and all team members listed.
- [ ] Verify the qualifying checked PR was opened October 16–22 and the submitted account generated the suite and connected the GitHub App.
- [ ] Prepare one Discord entry in the actual designated S4 channel using its template: PR link, live URL, matching TestSprite email/name, team list; optional demo. Resolve the inaccessible channel mention in the pasted rules.
- [ ] Verify original/rights-cleared code, model assets and demo media; account for submission marketing permissions.
- [ ] Use only synthetic or explicitly public licensed fixtures for remote tests; preserve local-only private media.
- [ ] Submit before the project deadline and preserve the real submission evidence. The separate October 29 CLI deadline does not extend this deadline.

## Video Enhancer revision — 2026-10-19 handoff

- [x] Replace x4v3 with a native-2× NomosUni Compact network and rebuild reconstruction finishing, tiling, and preview caching.
- [ ] User evaluates actual detail improvement, export time, color, and audio/timing. No automated tests, browser checks, or video benchmarks were run for this revision, as explicitly requested. Do not claim the enhancer is final or apply old passing counts to it.

## Video Enhancer WebSR correction — 2026-10-19

- NomosUni was rejected by user: ~2% progress after 30 seconds. It is not the active GPU engine.
- [x] Use browser-native WebSR small real-life weights on GPU, tiny FSRCNN for explicit CPU enlargement, and a no-inference native-size cleanup path. Remove automatic GPU-error CPU fallback and cache first/display shader pipelines.
- [ ] User validates actual speed and quality; no media benchmark or visual/browser test was run for this revision. Do not claim a measured 20–30-second export.

## Contour restoration revision — 2026-10-19

- User reports earlier WebSR finishes the clip in 20–30 seconds but looks nearly unchanged; now accepts roughly one minute for better quality.
- [x] Add Anime4K Medium repair before Small upscaling, edge-protected cleanup, off-center color anchoring, and bounded source-radius deblur/chroma finishing. Retain 70% cleanup / 100% restoration / 50% Sharpen defaults.
- [ ] User checks actual contour/color improvement and time against their source/Topaz comparison. Only type checking was run; no video/browser benchmark or visual test was performed.

## RGB upscaling and text artifacts — 2026-10-19

- User confirms visible improvement and ~30-second export with Medium repair + Small upscale on their RTX 5070 Ti, but reports white scratches in dark text.
- [x] Upgrade 2x GPU upscaling to Medium RGB below the working-area memory ceiling; retain Small at larger sizes. Add original-source dark-stroke protection after reconstruction and sharpening, mirrored on CPU. Preserve defaults and worker cancellation/cache behavior.
- [ ] User checks scratches, real detail gain, source colors and completion time after a full reload. No browser/video tests or benchmarks requested; do not call the visual fix or one-minute target verified.

## Real-life RGB replacement and border handling — 2026-10-19

- User reports the Medium animation revision still produces white contour scratches and displaced color around frame borders; prior dark limiting did not resolve it.
- [x] Replace the two-model animation chain with unmodified Medium real-life RGB weights and a clamped WebGPU runtime. Use exact-size bounds, fused RGB heads, opaque output and one submission/wait per frame.
- [x] Remove shifted coarse color subtraction, stacked RCAS/high-gain deblur and chroma sharpening. Keep one local-range-bounded luma detail pass and original-source dark protection. Advance worker to `rgb-real-life-clamped-v10` and update current docs/provenance.
- [ ] User checks white scratches, all four borders, color/detail and actual completion time. Target roughly one minute for the comparison clip; not a measured guarantee. Type checking only; no video/browser testing or timing benchmark, as requested.

## Universal SPAN replacement — 2026-10-19

- User rejects WebSR real-life Medium as almost unchanged, then explicitly requires film/live-action and anime support; anime-only deployment was stopped before activation.
- [x] Replace the active model with Philip Hofmann's 2xNomosUni_span_multijpg (SPAN, not the old Compact). Use the same model on explicit GPU and CPU, including native-size output.
- [x] Convert the original safe-tensor checkpoint with upstream attention/normalization and fused inference branches; produce FP32 and FP16 ONNX with model/architecture attribution and licenses.
- [x] GPU RGB preprocessing/postprocessing, persistent I/O and graph capture; padding-aware tiles with 24-pixel margins. Preserve finishing/range guards and defaults. Worker version `universal-span-2x-v11`.
- [ ] User checks real film/anime detail, scratches/borders/color, actual completion duration and audio. Roughly one minute is a target, not a measured guarantee. ONNX structural validation, typecheck and targeted lint only; no media inference or browser/video benchmark performed.

## SPAN v12 integration correction — 2026-10-19

- User reports washed-out/clipped v11 output and `Symbol(gpuBufferMetadata)` errors after processing. Prior structural/type checks did not validate visual correctness.
- [x] Replace custom graph/FP16 conversion with the author's published FP32 ONNX computation; fix only ambiguous output shape labels and preserve serialized computational nodes exactly.
- [x] Disable capture/preferred-output IO binding with external GPU outputs to avoid the implicated ORT handle-lookup path. Keep explicit GPU buffers; tear down sessions before buffers. Bound unchanged 192-channel FP32 concat to 96 MiB. Verify runtime JS asset hashes match installed ORT.
- [x] Advance worker/model URL to v12 so a full reload cannot keep the v11 model asset.
- [ ] User verifies restored brightness/color, runtime stability and timing. FP32 can cost speed. No video/browser inference was run; do not label the image fix or one-minute target verified.

- [x] Complete awaited teardown through the worker: release sessions before destroying external buffers, await preview replacements/export transitions, and close the export processor before success is posted. Preserve the primary failure during cleanup.
- Final v12 code checks: TypeScript and targeted ESLint pass without warnings. Model packaging validates the unchanged computational graph. No video/browser or numerical-inference test was run; image recovery remains unverified.

## Quality-preserving performance revision — v13, 2026-10-19

- User confirms v12 visible improvement; reports similar source/2x speeds and CPU >1 minute at 0%. Prior runtime mixed WebGPU/WASM bundles/configuration and set initial GPU runtime to one thread.
- [x] One configured runtime/thread pool for both explicit devices; fixed CPU model shapes; bounded warm compiled-session handoff (one idle, 30-second expiry).
- [x] Equivalent native-output tail with every learned FP32 node unchanged; adaptive GPU binding budgets, bounded larger CPU tiles, direct-grid RGB copies, reused tensors/bindings/uniforms and batched application GPU submissions.
- [x] Shared CPU RGB coordinate math preserving the scalar arithmetic; real preparation/frame/tile/finishing activity rather than invented percentages.
- [x] Structural ONNX validation and tiny head-identity arithmetic; shared sampler arithmetic equality; conditional planner comparison (1024x576, 8 to 2 tiles at larger allowed budget); TypeScript and targeted lint.
- [ ] User benchmarks actual GPU source/2x and CPU behavior/quality. No video/browser or neural-inference benchmark was run. Source output keeps the same backbone, so twice-as-fast native export is not promised.

- [x] Remove CPU model/reference canvas round trips: keep original/restored/final RGBA in memory through finishing and NV12 encoding. Skip unused final presentation during export, retain normal preview presentation, invalidate stale final pixels on each render/cancellation.
- [x] Preserve sub-1% converter progress with two decimal places and show actual frame/tile stages; idle-model cleanup errors do not block explicit CPU selection.

## Split GPU/CPU performance implementation — v14, 2026-10-19

User reports roughly five-minute GPU exports on RTX 5070 Ti and unusably slow CPU. Prior conditional tile-planning examples did not demonstrate speed gains. Latest explicit request: preserve GPU quality and maximize throughput, provide a lighter learned CPU model, and avoid generating enlarged images for source-size output. User retains video/visual/timing tests.

- [x] Preserve all 127 original learned SPAN FP32 prefix nodes and expose the author prediction head. Fuse clipped subpixel mapping/native reduction into GPU output; no enlarged native intermediate, downsample shortcut or skipped frame.
- [x] GPU replay uses persistent external input with ORT-owned output tensors, retains the first result to pin storage, and avoids the previous external preallocated-output path. Same-GPU ordinary execution retries once if capture fails; never silent CPU fallback.
- [x] Bound captured input area and graph-value memory; no GPU session pooling across external buffers. Matching preview/export dimensions transfer the entire processor and its buffers to avoid rebuilding the same capture. ORT-owned result disposal precedes session teardown and external-buffer destruction.
- [x] Port cleanup/dark-stroke protection, bounded luma sharpening and explicit Rec.709 NV12 packing to WebGPU. Remove learned GPU path's WebGL canvas bridge and synchronous readPixels; use bounded asynchronous GPU staging readback. This is not zero-copy encoding.
- [x] CPU uses official QuickSRNet Medium 2x weights, application uint8 per-channel QLinearConv conversion, byte I/O and native output; FP32 QuickSRNet compatibility if quantized execution fails. Ship official BSD license/notice and exact asset hashes.
- [x] CPU direct grids, shared source luminance, scalar guard interpolation, integer sharpening sampling, cached dimension plans and scheduler/MessageChannel cancellation yields replace repeated channel math/nested timer delays.
- [x] UI discloses GPU/CPU model difference; worker URL `split-restoration-v14`; default settings unchanged. Update README, architecture, current tool guide and model notices; earlier engine entries are historical.
- [x] Typecheck, targeted ESLint, ONNX structural/weight/quantization-range checks, tiny CRD/native/byte-order arithmetic and offline Naga WGSL validation. These do not execute media or neural inference.
- [ ] User validates actual GPU/CPU initialization and replay stability, original vs enhanced detail/color/text/borders, native vs 2x output, audio/timing and elapsed duration. No browser/video/model inference or benchmark was run. No one-minute, fivefold, Topaz-parity or fixed native/2x speed ratio is claimed.

## Separate native engine, author FP16 2x, CPU coordinator — v15

User rejects v14 throughput (still approximately 4–5 minutes), requires genuinely separate native/2x computation, disables CPU-only enhancement, and requests useful CPU support during GPU work. Earlier tile/capture optimizations are not evidence of achieved speed.

- [x] Source size uses TNTwise DeH264 RTMoSR Light 1x, with /4 feature processing, bounded full-frame preference, reflected alignment and large-frame tiling. It no longer runs the SPAN upscale backbone. Port upstream evaluation fusion, RMSNorm, stable Mish, attention and residual correctly; ship licenses/provenance.
- [x] 2x uses the author's published FP16 SPAN ONNX when supported, retaining its computation with FP32 external casts; same-GPU author FP32 compatibility. Native/2x mode is explicit in engine and preview-cache ownership, including output caps.
- [x] CPU selection stays visible but dimmed and aria-disabled, with a soft hover/focus explanation, Escape dismissal and reduced motion. Reject CPU-only preview/export requests and constructor/runtime entry; remove active QuickSRNet/WASM CPU inference.
- [x] CPU coordinator and GPU worker communicate transferable frame ownership with one in-flight picture, latest-preview coalescing and immediate cancellation. Media reading/audio/encoder orchestration/mux/local writes have an independent CPU event loop. No media upload or claimed arithmetic speed multiplier.
- [x] Keep WebGPU finishing/asynchronous NV12 readback; bound captured memory per precision. Actual export seconds and local non-media execution diagnostics distinguish a real execution path from compatibility retries. Both worker URLs use `native-hybrid-v15`.
- [x] TypeScript, targeted lint, ONNX full checker/fixed shape/registered-op validation, tiny synthetic fusion/CRD/Mish algebra and offline Naga WGSL validation. Production build succeeds; existing unrelated face-api dynamic-require warning remains. Initial sandbox EPERM on temporary build output resolved by authorized retry.
- [ ] User checks real GPU native/2x elapsed duration, selected adapter/precision/replay if still slow, and visual restoration/color/text/borders/audio. No actual neural inference, browser/video test or GPU benchmark was run. No one-minute or fixed native/2x ratio is claimed; native quality characteristics differ from SPAN and FP16 is numerically different.
