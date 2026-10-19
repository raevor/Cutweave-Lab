import { describe, expect, it } from "vitest";
import { chooseAnalysisChannel, createAnalysisResampler } from "./signal";

function sine(rate: number, frequency: number) {
  return Float32Array.from({ length: rate }, (_, index) => Math.sin(index * 2 * Math.PI * frequency / rate));
}

function rms(samples: Float32Array) {
  const tail = samples.subarray(1000);
  return Math.sqrt(tail.reduce((sum, value) => sum + value * value, 0) / tail.length);
}

describe("music analysis signal preparation", () => {
  it("does not erase an inverted stereo track", () => {
    const left = sine(48_000, 70);
    const right = left.map((value) => -value);
    expect(chooseAnalysisChannel([left, right])).toBe(0);
    expect(chooseAnalysisChannel([left, left])).toBeNull();
    expect(chooseAnalysisChannel([new Float32Array(10), new Float32Array(10)])).toBeNull();
    const output = new Float32Array(12_000);
    createAnalysisResampler([left, right], 48_000, 12_000)(output, 0, output.length);
    expect(rms(output)).toBeGreaterThan(0.6);
  });

  it("rejects a high-frequency tone before it aliases into the bass band", () => {
    const output = new Float32Array(12_000);
    createAnalysisResampler([sine(48_000, 11_930)], 48_000, 12_000)(output, 0, output.length);
    expect(rms(output)).toBeLessThan(0.01);
  });

  it("keeps identical output across processing chunk boundaries", () => {
    const track = sine(44_100, 80);
    const whole = new Float32Array(12_000);
    const chunks = new Float32Array(12_000);
    createAnalysisResampler([track], 44_100, 12_000)(whole, 0, whole.length);
    const resample = createAnalysisResampler([track], 44_100, 12_000);
    for (let first = 0; first < chunks.length; first += 511) resample(chunks, first, Math.min(chunks.length, first + 511));
    expect(chunks).toEqual(whole);
  });
});
