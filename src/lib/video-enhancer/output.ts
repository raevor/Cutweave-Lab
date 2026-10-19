import type { EnhancerDevice } from "./types";

export function enhancedOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  scale: 1 | 2,
  device: EnhancerDevice,
  memoryOnly = false,
) {
  const landscape = sourceWidth >= sourceHeight;
  const longEdge = memoryOnly ? 1280 : device === "gpu" ? 3840 : 1920;
  const shortEdge = memoryOnly ? 720 : device === "gpu" ? 2160 : 1080;
  const maxWidth = landscape ? longEdge : shortEdge;
  const maxHeight = landscape ? shortEdge : longEdge;
  const ratio = Math.min(1, maxWidth / (sourceWidth * scale), maxHeight / (sourceHeight * scale));
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return { width: even(sourceWidth * scale * ratio), height: even(sourceHeight * scale * ratio) };
}
