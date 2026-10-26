import { describe, expect, it } from "vitest";
import { downmixAndResample } from "./audio";

describe("auto subtitle audio preparation", () => {
  it("averages channels and resamples to the target rate", () => {
    const left = new Float32Array(48).fill(1);
    const right = new Float32Array(48).fill(0);
    const output = downmixAndResample([left, right], 48, 16);
    expect(output).toHaveLength(16);
    for (const sample of output) expect(sample).toBeCloseTo(0.5);
  });

  it("interpolates between source samples", () => {
    const ramp = Float32Array.from({ length: 8 }, (_, index) => index);
    const output = downmixAndResample([ramp], 8, 16);
    expect(output).toHaveLength(16);
    expect(output[1]).toBeCloseTo(0.5);
    expect(output[15]).toBe(7);
  });
});
