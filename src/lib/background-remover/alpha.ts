/**
 * Turns the model's soft matte into the alpha channel. `edge` (0-1) sets how hard
 * the edge is: 0 keeps the model's soft matte (hair, motion blur), 1 cuts it hard.
 * Weak matte values near zero are always cleared so no faint halo of the old
 * background survives.
 */
export function refineAlpha(matte: number, edge: number) {
  const low = 8 + edge * 100;
  const high = 255 - edge * 100;
  if (matte <= low) return 0;
  if (matte >= high) return 255;
  return Math.round(((matte - low) / (high - low)) * 255);
}

/** Writes the refined matte into a copy of the RGBA pixels as their alpha channel. */
export function applyMatte(rgba: Uint8ClampedArray, matte: Uint8Array | Uint8ClampedArray, edge: number) {
  if (matte.length * 4 !== rgba.length) throw new Error("The mask does not match the image size.");
  const lookup = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value += 1) lookup[value] = refineAlpha(value, edge);
  const output = new Uint8ClampedArray(rgba);
  for (let index = 0; index < matte.length; index += 1) output[index * 4 + 3] = lookup[matte[index]];
  return output;
}

/** Share of the image the model kept as subject, from 0 to 1. */
export function subjectCoverage(matte: Uint8Array | Uint8ClampedArray) {
  let kept = 0;
  for (const value of matte) if (value >= 128) kept += 1;
  return matte.length ? kept / matte.length : 0;
}

/** Fits an image inside a pixel budget, keeping its aspect ratio. */
export function fitToPixels(width: number, height: number, maxPixels: number) {
  const scale = Math.min(1, Math.sqrt(maxPixels / Math.max(1, width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scaled: scale < 1 };
}
