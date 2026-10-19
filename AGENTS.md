<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Required first read — TestSprite Season 4

- Before planning or changing this project, read `HACKATHON_RULES_S4.md` (local-only reference, intentionally not distributed). It is the current S4 rules and delivery reference (checked 2026-10-19).
- For hackathon requirements it supersedes older S2/S3 assumptions and pre-announcement notes in other guides. Current official organizer updates take precedence. The reference includes the full official S4 Discord rules and the separate CLI announcement supplied by the user on 2026-10-19. Apply the Project Track eligibility/account/PR-date/submission requirements; do not substitute CLI bonus rules.
- Read `TASKS.md` and relevant tool documentation next. Keep the project invariants below; a cloud test integration never authorizes sending private user media.

# CUT/WEAVE project invariants

- English is the default public interface language; Turkish is the only optional locale in V1. Repository documentation, commit titles and test descriptions are English.
- Core media stays on the user's device. Never send video bytes, frames, thumbnails, waveforms, subject crops or embeddings to a backend or third party.
- Do not add a media upload route or storage bucket.
- Keep the core judge flow account-optional and installer-free.
- Feature-detect browser media capabilities and provide a core-path fallback before claiming support.
- Heavy analysis belongs in dedicated workers and must support cancellation, bounded memory and stale-result protection.
- Never present sample topology, fake progress, decorative waveforms or prepared thumbnails as real analysis.
- The visual identity uses edit points, tracks and timecode. Keep every tool in its own focused screen until a combined workspace has a proven use. Do not use pixel art, mascots, game-room composition or generic AI gradients.
- The three primary tools are Face Recognition, Anime Face Recognition and Music & Bass Markers. Face recognition means finding the selected face again inside the local video; it never identifies the person through an internet lookup or external database.
- Preserve keyboard access, visible focus and reduced-motion behavior.
