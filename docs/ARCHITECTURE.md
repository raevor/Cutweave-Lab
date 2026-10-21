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
- There is no backend, database, authentication or upload route in this foundation.

## Planned adapter boundaries

Further shared decode/cache work and privacy instrumentation will be introduced behind explicit adapters. Face finding retains its WASM/CPU fallback.

All focused tools will share the same local project and decode cache. Tool-first navigation must not cause the browser to upload media or decode the same source independently for every tool.
