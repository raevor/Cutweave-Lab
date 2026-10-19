# CUT/WEAVE LAB

Recognize a selected face or animated character across a video and place music and bass markers—inside your browser.

> Current status: Face Recognition, Anime Face Recognition and Music & Bass Markers run locally in the browser.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Current routes

- `/` — product entry and visual direction.
- `/lab` — clickable local tool library.
- `/lab/face-recognition`, `/lab/anime-face-recognition` — local face and animated-character scene finding.
- `/lab/bass-markers` — local audio analysis, marker editing, trimming and marker-rich WAV/XMP/data export.
- `/privacy` — current and planned data boundary.

## Foundation guarantees

- Selecting local video or audio creates a browser object URL for local preview.
- The application has no media upload API route.
- The core flow does not require an account.
- Public product copy and repository documentation are English.
- Heavy analysis runs in dedicated browser workers with cancellation and stale-result protection.
- Unsupported or unfinished behavior is labelled instead of simulated.

## Languages

- English is the default language on a first visit.
- Turkish is available from the compact flag control in the header.
- The explicit choice is stored locally and restored on the next visit.
- UI messages live in `src/i18n/messages`; public repository documentation remains English.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DESIGN.md`](docs/DESIGN.md), and [`docs/PRIVACY.md`](docs/PRIVACY.md) for the current foundation decisions.
