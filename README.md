# CUT/WEAVE LAB

**Local browser tools for the repetitive prep work before a creative edit.** Find a face or an animated character across a long video, and turn a song's impacts and bass hits into markers your editor can use. Everything runs on your device. Your footage is never uploaded.

**Live app:** https://cutweave-lab.vercel.app

## Tools

| Tool | Route | You add | You get |
|---|---|---|---|
| Face Recognition | [`/lab/face-recognition`](https://cutweave-lab.vercel.app/lab/face-recognition) | One local video and three reference frames you crop yourself | Matched scenes with timecodes you can review, then an MP4 clip ZIP with JSON/CSV cut plans |
| Anime Face Recognition | [`/lab/anime-face-recognition`](https://cutweave-lab.vercel.app/lab/anime-face-recognition) | One local animated video and three character references | Character-matched scenes and a clip ZIP, using an anime-specific local model |
| Music & Bass Markers | [`/lab/bass-markers`](https://cutweave-lab.vercel.app/lab/bass-markers) | One local audio file | Adjustable impact and bass markers on a real waveform, exported as a marker-rich WAV, XMP sidecar, JSON or CSV |

Other pages: the tool library ([`/lab`](https://cutweave-lab.vercel.app/lab)), the privacy boundary ([`/privacy`](https://cutweave-lab.vercel.app/privacy)) and the roadmap ([`/roadmap`](https://cutweave-lab.vercel.app/roadmap)).

## Privacy by architecture

- The app has no media upload route, storage bucket, account or database.
- A selected file opens as a browser object URL. Frames, waveforms, crops and face descriptors are created and used only inside the tab, in dedicated Web Workers.
- Face Recognition is a similarity search within the one video you opened. It never identifies a person and never queries an external database.
- The browser downloads only application code, WASM runtimes and model files from this site. Those requests never contain your media.

Details: [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Automated testing

The live app is tested with [TestSprite](https://www.testsprite.com). The TestSprite GitHub App runs the suite automatically against each pull request's Vercel preview deployment and reports the result on the PR. `main` is protected: a pull request can only be merged once the required **TestSprite V3** check passes, and force pushes to `main` are blocked.

The suite has 70 browser tests in twelve groups. Besides page structure, it drives the real tool flows with files: the runner loads media, adds a reference through the crop dialog, runs a full anime scan to the review step and takes audio markers to the export step.

| Area | Tests | What they check |
|---|---:|---|
| Navigation & shell | 13 | Brand and hero, the header tools menu (open, launch each tool, close with Escape or an outside click, open the tool desk), theme switch, its accessible name and persistence after reload, the How it works, Roadmap and Privacy links, and the right-edge section timeline |
| Home page | 11 | The three hero lines and both calls to action, all four facts, the four workflow steps, three tool cards in order with working routes, illustration captions, footer links and Back to top, and the media boundary section |
| Tool library | 7 | Exactly three tools on tracks 01 to 03 with input and output details, each Start tool link, the heading, the tool desk summary and the privacy link |
| Face Recognition | 7 | Empty source state, the five-step bar, privacy copy, 0 B sent to server, no scan action or results before a video is chosen, the All tools and Privacy links |
| Face Recognition video flow | 3 | Loading a video, adding a reference through the crop dialog and cancelling a crop |
| Anime Face Recognition | 5 | The first-visit notice (dismiss, keep hidden after reload, reopen from the header), the empty source state, 0 B sent to server and the All tools link |
| Anime video flow | 3 | Loading a video, adding a character reference, and a full scan from three references to matched scenes |
| Music & Bass Markers | 4 | Empty state, the five-step bar, 0 B sent to server, no analysis or export before a file is loaded, accepted formats and the privacy link |
| Music & Bass Markers audio flow | 5 | Loading audio, finding markers on the full track, adding a marker, the export options and cancelling an analysis |
| Privacy | 6 | Local processing and 0 B media transfer, no identity lookup or biometric database query, what the browser downloads versus what never leaves the tab, the summary values and both calls to action |
| Roadmap | 2 | Exactly three shipped tools and the link to the tool library |
| Not found | 4 | The custom 404 page for unknown tool and top-level routes, its label and the way back home |

The flow tests use three files prepared only for this suite: a synthetic 120 BPM click track and two short test video clips. They are stored in the TestSprite project and are not part of this repository. Eighteen longer flow tests (multi-reference setups, cancelled and full face scans, crop-error and repeated-click checks) were removed from the cloud plan after the runner repeatedly blocked them, reporting that file uploads were not permitted although the same upload step passed in other tests of the same run. Those flows are covered by manual checks. Assertions check the workflow and its states, never how many scenes a scan finds: match counts and model accuracy depend on the runner's hardware and are covered by the local unit tests and manual checks. The responsive layout is also checked locally: the cloud runner cannot resize its viewport, so a 390px mobile test was removed from the plan after it came back blocked.

Local checks:

```bash
npm run typecheck   # Next.js type generation + TypeScript
npm run lint
npm test            # Vitest unit tests: face matching, clip export, marker analysis and export
npm run build
```

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Chrome or Edge is recommended. Face and anime analysis use WebGPU when available and fall back to WebAssembly.

## Stack

Next.js (App Router), React and strict TypeScript; Tailwind CSS v4 with OKLCH design tokens; @vladmandic/face-api and ONNX Runtime Web for on-device models; Mediabunny and WebCodecs for local decoding and export; Vitest for unit tests.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/DESIGN.md`](docs/DESIGN.md).
