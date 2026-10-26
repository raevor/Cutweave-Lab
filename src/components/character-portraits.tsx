/*
 * Original illustrated characters used in the tool scenes, the empty source
 * slots and the hero timeline. Each portrait was drawn in code (HTML/CSS for
 * people, SVG line art for the anime cast) and exported once to a transparent
 * image; none depicts a real person or an
 * existing character. They are illustrations of the workflow, never analysis
 * output.
 *
 * Variant 0 is the reference identity a tool searches for (Sera for people,
 * Rowan for anime). It reappears in other scenes with a different outfit and
 * hair, so the illustrations show the same face being found again.
 */

export type CharacterKind = "person" | "character";
export type CharacterVariant = 0 | 1 | 2;

/* Bump when the images are re-exported so browsers do not keep stale copies. */
const PORTRAIT_VERSION = 21;

const PORTRAITS: Record<CharacterKind, readonly string[]> = {
  person: ["sera", "ozan", "maya"],
  character: ["rowan-a", "fenrik", "sylas"],
};

const OUTFITS: Record<CharacterKind, readonly string[]> = {
  person: ["sera-a", "sera-b", "sera-c"],
  character: ["rowan", "rowan-b", "rowan-c"],
};

export const OUTFIT_COUNT = 3;

/*
 * Placement of the 240 x 260 portrait inside the shared 100 x 120 figure box:
 * scaled to the box height, centred, shoulders on the bottom edge.
 */
export const PORTRAIT_BOX = { x: -5.38, y: 0, width: 110.77, height: 120 } as const;

/*
 * Small 192 x 208 copies serve thumbnails (scan frames, timeline clips) so the
 * browser does not rescale the full 480 x 520 image on every repaint.
 */
export function portraitSrc(kind: CharacterKind, variant: CharacterVariant, outfit?: number, small = false) {
  const name = variant === 0 && outfit !== undefined ? OUTFITS[kind][outfit] : PORTRAITS[kind][variant];
  return `/characters/${name}${small ? "-sm" : ""}.webp?v=${PORTRAIT_VERSION}`;
}

/* Alin speaks for Auto Subtitles; she is not part of the face-matching cast. */
export const SUBTITLE_SPEAKER = "alin";

/* Kian is the subject of the Background Remover scenes. */
export const REMOVER_SUBJECT = "kian";

export function namedPortraitSrc(name: string, small = false) {
  return `/characters/${name}${small ? "-sm" : ""}.webp?v=${PORTRAIT_VERSION}`;
}

/* SVG figure in the 100 x 120 box. `name` picks a single portrait outside the cast. */
export function Portrait({ kind, variant, outfit, small = false, name }: { kind: CharacterKind; variant: CharacterVariant; outfit?: number; small?: boolean; name?: string }) {
  return (
    <image
      href={name ? namedPortraitSrc(name, small) : portraitSrc(kind, variant, outfit, small)}
      x={PORTRAIT_BOX.x}
      y={PORTRAIT_BOX.y}
      width={PORTRAIT_BOX.width}
      height={PORTRAIT_BOX.height}
      preserveAspectRatio="xMidYMax meet"
    />
  );
}
