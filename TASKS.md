# Foundation task gates

## Commit readiness review — 2026-10-19

- [ ] Re-run the local unit suite, lint, typecheck and production build after the tool-scope change.
- [x] Ignore new Markdown and local design working files; preserve already tracked Markdown updates.
- [x] Candidate text-file credential-pattern scan reports no findings; no candidate file exceeds GitHub's single-file limit. Private media/cache/local configuration remain ignored.

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

- [x] Produce adjustable music and bass markers from real audio.
- [x] Export marker data in at least one useful editor format.

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
