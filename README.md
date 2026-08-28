# CUT/WEAVE LAB

Recognize a selected face across a video, place music and bass markers, and enhance video quality—inside your browser.

> Current status: the localhost build includes the product shell, three focused local-file intake screens, browser checks and the initial privacy boundary. The processing engines and export are not connected yet.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Current routes

- `/` — product entry and visual direction.
- `/lab` — clickable local tool library.
- `/lab/face-recognition`, `/lab/bass-markers`, `/lab/clarity-boost` — focused tool intake surfaces.
- `/privacy` — current and planned data boundary.

## Foundation guarantees

- Selecting a video creates a browser object URL for local preview.
- The application has no media upload API route.
- The core flow does not require an account.
- Public product copy and repository documentation are English.
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
npm run build
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DESIGN.md`](docs/DESIGN.md), and [`docs/PRIVACY.md`](docs/PRIVACY.md) for the current foundation decisions.
