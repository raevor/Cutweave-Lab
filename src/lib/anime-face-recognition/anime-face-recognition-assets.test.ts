import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runtimeFiles = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
];

const identityFiles = [
  "anime-ccip-24-pruned-feature-fp16.onnx",
  "anime-ccip-24-pruned-feature-fp16.part1.data",
  "anime-ccip-24-pruned-feature-fp32.onnx",
  "anime-ccip-24-pruned-feature-fp32.part1.data",
  "anime-ccip-24-pruned-feature-fp32.part2.data",
];

describe("anime face recognition assets", () => {
  it.each(runtimeFiles)("ships the %s runtime asset", (fileName) => {
    const path = resolve("public", "wasm", "anime-face-recognition", fileName);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(0);
  });

  it("ships only the runtime used by the WebGPU bundle and its WASM fallback", () => {
    const directory = resolve("public", "wasm", "anime-face-recognition");
    expect(readdirSync(directory).sort()).toEqual([...runtimeFiles].sort());
  });

  it("keeps each model below the GitHub single-file limit", () => {
    const modelFiles = [
      resolve("public", "models", "anime-face-recognition", "detector", "anime-head-detector.onnx"),
      resolve("public", "models", "anime-face-recognition", "identity", "anime-ccip-24-pruned-feature-fp16.onnx"),
      resolve("public", "models", "anime-face-recognition", "identity", "anime-ccip-24-pruned-feature-fp16.part1.data"),
      resolve("public", "models", "anime-face-recognition", "identity", "anime-ccip-24-pruned-feature-fp32.onnx"),
      resolve("public", "models", "anime-face-recognition", "identity", "anime-ccip-24-pruned-feature-fp32.part1.data"),
      resolve("public", "models", "anime-face-recognition", "identity", "anime-ccip-24-pruned-feature-fp32.part2.data"),
    ];

    for (const path of modelFiles) {
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBeLessThan(100_000_000);
    }
  });

  it("ships only the selected 24-pruned identity assets", () => {
    const directory = resolve("public", "models", "anime-face-recognition", "identity");
    expect(readdirSync(directory).sort()).toEqual([...identityFiles].sort());
  });
});
