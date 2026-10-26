# Architecture foundation

## Runtime boundary

```text
Browser media plane
  local File → object URL preview → sampling coordinator → dedicated worker → local export

Web control plane
  Next.js routes → static application assets → future optional account/preferences
```

The media plane and control plane must remain separate in code, networking and data models.

## Current implementation

- Next.js App Router, React and strict TypeScript.
- Tailwind CSS v4 plus project-owned OKLCH tokens and semantic CSS.
- `/lab` is the server-rendered tool library. Focused client tool routes own browser file handles, object URLs and capability detection while revealing only the controls required for that job.
- Object URLs are revoked when the selected source changes or the component unmounts.
- The focused Face Recognition route accepts videos up to three hours, captures three user-cropped reference frames, and runs a self-hosted Tiny Face Detector, 68-point landmark alignment and 128-dimensional face recognition model in a dedicated worker.
- Reference descriptors remain separate and use the recognition model's Euclidean distance scale. A candidate must pass the calibrated threshold against at least two references while the weakest reference remains inside a guarded margin, preventing one accidental high score from approving a face.
- The working identity threshold is calibrated against the three references instead of assuming one fixed score scale for every person, pose and engine.
- The source is sampled at most every 1.5 seconds within the bounded 2,400-frame budget. Coarse candidates are searched for a complete clip window: the opening instants must contain the selected face and at least 60% of all checkpoints must pass. Candidate and final selections use timeline buckets so one dense sequence cannot monopolize the output. Visually repeated views are suppressed only inside a bounded nearby window, allowing the same location to reappear in a genuinely later scene.
- Which video files open depends on the browser's own decoders. Chrome and Edge play MP4 (H.264); open-source Chromium builds, such as many automation browsers, lack H.264 but play WebM (VP9). A file the browser cannot decode never reaches `loadedmetadata`, so the face tools listen for the media decode error and show "Cannot play this file" with that guidance instead of waiting on an empty player. The source label reads "Loading video" until the duration is known.
- Changing between GPU and CPU recreates the worker and re-encodes the saved local reference crops automatically. The user does not have to select them again.
- GPU mode uses the browser WebGPU backend when available. CPU mode uses self-hosted WebAssembly assets. Model and runtime files are application assets; selected media is never a model request payload.
- Long sources are sampled adaptively with a hard sample-count ceiling. Only one reduced frame is transferred to the worker at a time; the complete source is never converted to an `ArrayBuffer`. Very small or low-quality detected faces are rejected instead of being promoted as confident matches.
- Every analysis owns a job ID. Cancellation and job ownership checks prevent a previous scan from publishing stale results.
- Supported Chromium browsers can render selected ranges as local WebM clips and place them, plus JSON and CSV cut plans, in a ZIP. Export is feature-detected and never presented as available when `captureStream` or `MediaRecorder` is absent.
- Music & Bass Markers decodes one local audio source with the browser's Web Audio implementation, creates a bounded 12 kHz mono analysis signal and transfers it to a dedicated worker. The worker uses adaptive multi-band energy novelty, local thresholds and strongest-first spacing suppression to propose reviewable impact and bass markers.
- Music analysis results include a real min/max waveform envelope and optional tempo estimate. Marker sensitivity and spacing are reapplied without decoding the source again; users can add, remove and reposition markers, and set a non-destructive export range.
- Music export creates a trimmed PCM WAV with unnamed standard RIFF `cue ` points and embedded Adobe Dynamic Media XMP. Omitting marker labels keeps dense timelines readable in editing applications. XMP sidecar, JSON and CSV timing exports remain available as interoperable fallbacks.
- Music export can also create an MP3 of the same range. It is encoded in the tab with `@mediabunny/mp3-encoder` (LAME compiled to WebAssembly, 256 kbps) and carries the same XMP in an ID3v2.3 `PRIV` frame owned by `XMP`, where Premiere Pro and After Effects read it. MP3 decoders play 1105 samples of encoder and decoder delay first (measured with an impulse), so the MP3's markers move later by that amount. Sources with more than two channels are folded into stereo; sample rates MP3 cannot carry keep the WAV export only.
- Auto Subtitles decodes the soundtrack of one local video or audio file straight to 16 kHz mono with Web Audio. The whole source or a chosen start-to-end part is transferred to a dedicated worker; times stay relative to the full source, so exports line up with the original video.
- The worker runs the English-only Whisper base model (`onnx-community/whisper-base.en_timestamped`, pinned revision) through Transformers.js: WebGPU with a full-precision encoder and 4-bit decoder (about 210 MB), or WebAssembly with 8-bit weights (about 80 MB). The weights, tokenizer and configs come from Hugging Face once and are cached by the browser; Transformers.js also reads the repository's current `config.json` to plan the download. The ONNX Runtime WASM files are served by this site.
- The soundtrack is split into Whisper-sized windows of at most 29.5 seconds, cut at the quietest 100 ms between 20 and 29.5 seconds. Silent windows are skipped. When Whisper stops early inside a window, the rest of that window is decoded again from the last word, at most twice. Progress is the number of finished windows; each window's lines appear as soon as it finishes. Cancelling terminates the worker, and every message carries a job ID so a cancelled run cannot publish lines.
- Decoding is a single greedy pass, so the same file always gives the same subtitles. Sampling retries were tried on real footage and invented new lines, so they are not used.
- Whisper invents text over music and noise. A logits processor passed through the pipeline records the "no captions" probability (Whisper's no-speech token, which the model config normally suppresses) and the log-probability of every chosen token, then suppresses the token again so the output is unchanged. A window is skipped when it leans towards no speech and is unsure (no-speech probability above 0.1 and mean log-probability below -1; calibrated on the Tears of Steel open movie, where every window of real dialogue stayed above -1). A loop that starts with an unsure line is treated as invented: its repeated lines are dropped, and the whole window when the loop is most of it. A single line below -1.4, a line whose zlib compression ratio is above 2.4, a third identical line in a row and a false start repeated by the next line are dropped as well.
- Every word gets its own time from Whisper's cross-attention alignment. A line starts on its first spoken word, ends on its last, and splits where the speaker pauses for more than 0.8 seconds; a word stretched across a silence is limited to about the time it takes to say it. Lines become cues of at most two 42-character lines, split at sentence ends when possible, and stay on screen for at least 1.2 seconds or their reading time at 17 characters per second, without running into the next cue.
- Text is editable per line. SRT (CRLF line ends, for Premiere Pro, DaVinci Resolve and Final Cut Pro), WebVTT, a one-line-per-row transcript and an After Effects ExtendScript file are generated in the tab. After Effects cannot import SRT, so the script adds one text layer whose Source Text is keyframed at each cue, into the open composition or a new one sized like the source video.
- Background Remover reads one local PNG, JPEG or WebP image (up to 50 MB) into a bitmap, scaled down to at most 24 megapixels, and transfers its pixels to a dedicated worker.
- The worker runs BiRefNet lite (MIT) through Transformers.js at 1024 × 1024 and scales the matte back to the image's own size. Two pinned Hugging Face builds of the same weights are used: an fp16 export patched for WebGPU (`jiabins0303/birefnet-lite-1024-webgpu`, about 115 MB, used only when the adapter offers `shader-f16`), because the official export exceeds WebGPU's 16 storage buffers per shader, and the official fp32 export (`onnx-community/BiRefNet_lite-ONNX`, about 214 MB) on WebAssembly. The ONNX Runtime WASM files are shared with Auto Subtitles and served by this site.
- The edge slider refines the matte in `alpha.ts` without running the model again; the comparison, backdrop preview and the three PNG exports are drawn in the tab. Cancelling terminates the worker, and every message carries a job ID so a cancelled run cannot publish a matte.
- There is no backend, database, authentication or upload route in this foundation.

## Planned adapter boundaries

Further shared decode/cache work and privacy instrumentation will be introduced behind explicit adapters. Face finding retains its WASM/CPU fallback.

All focused tools will share the same local project and decode cache. Tool-first navigation must not cause the browser to upload media or decode the same source independently for every tool.
