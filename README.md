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

The suite has 39 browser tests in nine groups:

| Area | Tests | What they check |
|---|---:|---|
| Navigation & shell | 8 | Brand and hero, the header tools menu (open, launch a tool, close with Escape, open the tool desk), theme switch persisting after reload, the How it works and Roadmap links, and the right-edge section timeline |
| Home page | 5 | Exactly three tool cards in order with working routes, the facts strip, footer links and Back to top, hero calls to action and the media boundary section |
| Tool library | 5 | Exactly three tools, each Start tool link opening the right workspace, the tool desk summary and the privacy link |
| Face Recognition | 5 | Empty source state, privacy copy, 0 B sent to server, no scan action before a video is chosen, no results shown before analysis, the All tools link |
| Anime Face Recognition | 4 | The first-visit notice (dismiss, keep hidden after reload, reopen from the header) and the empty source state |
| Music & Bass Markers | 3 | Empty state, no analysis or export before a file is loaded, accepted formats and the privacy link |
| Privacy | 4 | Local processing and 0 B media transfer, no identity lookup or biometric database query, what the browser downloads versus what never leaves the tab, the Open local tools link |
| Roadmap | 2 | Exactly three shipped tools and the link to the tool library |
| Not found | 3 | The custom 404 page for unknown tool and top-level routes and the way back home |

Cloud tests never receive personal media. Real face matching, model accuracy and GPU performance are out of scope for the remote runner; they are covered by the local unit tests and manual checks. The responsive layout is also checked locally: the cloud runner cannot resize its viewport, so a 390px mobile test was removed from the plan after it came back blocked.

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
