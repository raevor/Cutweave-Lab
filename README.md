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

The live app is tested with [TestSprite](https://www.testsprite.com). The TestSprite GitHub App runs the suite automatically against each pull request's Vercel preview deployment and reports the result on the PR.

Suite coverage is documented once the suite is generated and stable.

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
