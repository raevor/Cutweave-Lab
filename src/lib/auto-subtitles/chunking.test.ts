import { describe, expect, it } from "vitest";
import { MAX_CHUNK_SECONDS, planAudioChunks } from "./chunking";

const RATE = 1_000;

function tone(seconds: number, quietAt: number[] = []) {
  const samples = new Float32Array(seconds * RATE);
  for (let index = 0; index < samples.length; index += 1) samples[index] = 0.2 * Math.sin(index / 3);
  for (const second of quietAt) samples.fill(0, Math.round(second * RATE), Math.round((second + 0.3) * RATE));
  return samples;
}

describe("auto subtitle chunking", () => {
  it("keeps short audio in one chunk", () => {
    expect(planAudioChunks(tone(12), RATE)).toEqual([{ start: 0, end: 12, silent: false }]);
  });

  it("cuts long audio at a quiet point and never exceeds the Whisper window", () => {
    const chunks = planAudioChunks(tone(70, [24, 50]), RATE);
    expect(chunks[0].end).toBeGreaterThanOrEqual(24);
    expect(chunks[0].end).toBeLessThanOrEqual(24.3);
    for (const chunk of chunks) expect(chunk.end - chunk.start).toBeLessThanOrEqual(MAX_CHUNK_SECONDS + 0.001);
    expect(chunks[chunks.length - 1].end).toBe(70);
    chunks.slice(1).forEach((chunk, index) => expect(chunk.start).toBe(chunks[index].end));
  });

  it("marks silent chunks so they are not transcribed", () => {
    const samples = new Float32Array(40 * RATE);
    samples.set(tone(10), 30 * RATE);
    const chunks = planAudioChunks(samples, RATE);
    expect(chunks[0].silent).toBe(true);
    expect(chunks[chunks.length - 1].silent).toBe(false);
  });
});
