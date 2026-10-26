# Design foundation

## Direction

Cutweave combines a professional post-production control surface with an independent editorial identity. It is not a pixel interface, a game room, or a generic rounded SaaS dashboard.

## Tool-first information architecture

The lab opens as a focused tool library, not a miniature NLE. Large interactive tool panels explain the job, input and output of Face Recognition, Anime Face Recognition, Music & Bass Markers and Auto Subtitles. Selecting a tool opens a calm, single-purpose local-media workspace. A combined editing surface is outside the current scope.

Tool panels may visualize UI anatomy and data relationships. They must not use prepared footage, decorative waveforms or fabricated metrics as if they came from analysis.

## Language

The public interface is English, and every label, status and tool screen ships in English only. Turkish is the planned optional locale. If it is added, the language control must stay visually subordinate to the product navigation, support keyboard and touch input and respect reduced motion.

## Illustrations

Home, `/lab` and `/roadmap` explain each tool with an animated illustration. The cast is original and drawn in code: people as HTML/CSS portraits, the anime cast as SVG line art with layered hair. Each portrait is exported once to a transparent WebP. No character depicts a real person or an existing character. The reference identity reappears in other outfits, so a scene can show the same face being found again.

Auto Subtitles has its own speaker, Alin, who is not part of the face-matching cast. The subtitle illustration shows her on a video frame with the current line as a caption, the lines being written into a list as a playhead crosses a speech strip, and "4 lines written". She is also the faint portrait in the tool's empty source slot, above two dashed caption placeholders and a waiting cursor. The tool uses its own blue signal on the shared workspace layout.

The home hero timeline has one lane per tool: Face, Anime, Bass and Subs. The Subs lane shows caption blocks with Alin's round avatar, the line and its speech. Ahead of the playhead a block waits in grey; as the playhead crosses it, the speech lights up and the line is typed with a cursor.

Illustrations carry an `Illustration:` accessible label and stay out of the tool workspaces. A workspace only ever shows results from a real local analysis.

## Background marks

Long sections carry slowly drifting editing marks (markers, crop corners, clips, keyframes). They move a little slower than the page when it scrolls, as a background layer, and are redrawn on every scrolled frame so they never lag behind the content.

## Not found

The 404 page uses the same frame as the public pages and the same visual language as the tool illustrations. The requested address is framed like a reference, the lab's four real tools are the frames, and a scan line checks each one and marks it as no match. The scene ends with "0 tools matched". With reduced motion, it shows the finished result.

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
