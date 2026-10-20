/*
 * Original illustrated characters used in the tool scenes, the empty source
 * slots and the hero timeline. Each portrait was drawn with HTML and CSS and
 * exported once to a transparent image; none depicts a real person or an
 * existing character. They are illustrations of the workflow, never analysis
 * output.
 *
 * Variant 0 is the reference identity a tool searches for (Sera for people,
 * Kaien for anime). It reappears in other scenes with a different outfit and
 * hair, so the illustrations show the same face being found again.
 */

export type CharacterKind = "person" | "character";
export type CharacterVariant = 0 | 1 | 2;

/* Bump when the images are re-exported so browsers do not keep stale copies. */
const PORTRAIT_VERSION = 13;

const PORTRAITS: Record<CharacterKind, readonly string[]> = {
  person: ["sera", "ozan", "maya"],
  character: ["kaien", "seraphine", "akio"],
};

const OUTFITS: Record<CharacterKind, readonly string[]> = {
  person: ["sera-a", "sera-b", "sera-c"],
  character: ["kaien-a", "kaien-b", "kaien-c"],
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

/* SVG figure in the 100 x 120 box. */
export function Portrait({ kind, variant, outfit, small = false }: { kind: CharacterKind; variant: CharacterVariant; outfit?: number; small?: boolean }) {
  return (
    <image
      href={portraitSrc(kind, variant, outfit, small)}
      x={PORTRAIT_BOX.x}
      y={PORTRAIT_BOX.y}
      width={PORTRAIT_BOX.width}
      height={PORTRAIT_BOX.height}
      preserveAspectRatio="xMidYMax meet"
    />
  );
}
