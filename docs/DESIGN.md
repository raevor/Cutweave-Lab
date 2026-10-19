# Design foundation

## Direction

Cutweave combines a professional post-production control surface with an independent editorial identity. It is not a pixel interface, a game room, or a generic rounded SaaS dashboard.

## Tool-first information architecture

The lab opens as a focused tool library, not a miniature NLE. Large interactive tool panels explain the job, input and output of Face Recognition, Anime Face Recognition and Music & Bass Markers. Selecting a tool opens a calm, single-purpose local-media workspace. A combined editing surface is outside the current scope.

Tool panels may visualize UI anatomy and data relationships. They must not use prepared footage, decorative waveforms or fabricated metrics as if they came from analysis.

## Language control

The public product supports English and Turkish. English is the first-visit default. The header shows only the current language as a high-resolution circular flag; activating it opens a compact two-language control. The selector must remain visually subordinate to the product navigation, support keyboard/touch input and respect reduced motion.

## Token roles

- `ink`: the editor workspace and primary text.
- `paper`: the editorial landing surface.
- `signal`: local/available/verified states.
- `rust`: the cut, playhead and decisive action.
- `line`: structural rails and track divisions.
- `muted`: secondary technical information.

Tokens are declared in OKLCH in `src/app/globals.css`. Body copy and controls target WCAG AA contrast. Motion is limited to interactive feedback and disabled through `prefers-reduced-motion`.

## Rejected patterns

- Pixel art, pixel fonts, mascots and game-room composition.
- Purple/blue AI gradients and excessive glow.
- Decorative waveforms, thumbnails or processing logs.
- Repeated rounded cards and arbitrary bento grids.
- Continuous motion that competes with media processing.
