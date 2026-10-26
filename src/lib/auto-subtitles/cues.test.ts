import { describe, expect, it } from "vitest";
import {
  MAX_CUE_CHARACTERS,
  MAX_LINE_CHARACTERS,
  createSrt,
  createTranscript,
  createVtt,
  formatCueTime,
  joinSentenceFragments,
  normalizeSegments,
  segmentsToCues,
  wrapCueText,
} from "./cues";

describe("auto subtitle cues", () => {
  it("formats SRT and VTT timestamps", () => {
    expect(formatCueTime(3725.0456, ",")).toBe("01:02:05,046");
    expect(formatCueTime(0.5, ".")).toBe("00:00:00.500");
    expect(formatCueTime(-1, ",")).toBe("00:00:00,000");
  });

  it("offsets chunk times and drops non-speech markers", () => {
    const segments = normalizeSegments([
      { start: 0, end: 2, text: "  Hello   there. " },
      { start: 2, end: 3, text: "[BLANK_AUDIO]" },
      { start: 3, end: Number.NaN, text: "Open end" },
    ], 30, 40);
    expect(segments).toEqual([
      { start: 30, end: 32, text: "Hello there." },
      { start: 33, end: 40, text: "Open end" },
    ]);
  });

  it("splits long segments into readable cues without overlap", () => {
    const text = "This is a deliberately long sentence that keeps going so it cannot fit inside a single subtitle cue on screen at all.";
    const cues = segmentsToCues([{ start: 0, end: 12, text }, { start: 11.5, end: 13, text: "Next." }]);
    expect(cues.length).toBeGreaterThan(2);
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(MAX_CUE_CHARACTERS + 12);
      expect(cue.end).toBeGreaterThan(cue.start);
    }
    cues.slice(1).forEach((cue, index) => expect(cue.start).toBeGreaterThanOrEqual(cues[index].end));
    expect(cues.map((cue) => cue.text).join(" ")).toBe(`${text} Next.`);
  });

  it("splits a long segment at a sentence end when it can", () => {
    const cues = segmentsToCues([{ start: 25, end: 30, text: "We have to follow our passions. You have your robotics and I just want to be awesome in space." }]);
    expect(cues.map((cue) => cue.text)).toEqual(["We have to follow our passions.", "You have your robotics and I just want to be awesome in space."]);
    expect(cues[0].end).toBeCloseTo(cues[1].start);
  });

  it("keeps a quick line on screen long enough to read, without touching the next line", () => {
    const cues = segmentsToCues([
      { start: 38.8, end: 39.3, text: "I'm freaked out." },
      { start: 39.5, end: 41.6, text: "I'm having nightmares." },
      { start: 50, end: 50.4, text: "We're done." },
    ]);
    expect(cues[0].end).toBeCloseTo(39.46);
    expect(cues[1].end).toBeCloseTo(41.9);
    expect(cues[2].end).toBeCloseTo(51.2);
  });

  it("keeps a short line whole even when Whisper gives it a long span", () => {
    const cues = segmentsToCues([{ start: 0, end: 7, text: "We have main engine start." }]);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("We have main engine start.");
  });

  it("joins a sentence that Whisper split across segments", () => {
    const joined = joinSentenceFragments([
      { start: 10, end: 11, text: "Look, Celia," },
      { start: 11, end: 12, text: "we have to" },
      { start: 12, end: 14, text: "follow our passions." },
      { start: 14, end: 15, text: "Awesome in space." },
      { start: 20, end: 21, text: "you are late" },
    ]);
    expect(joined.map((segment) => segment.text)).toEqual(["Look, Celia, we have to follow our passions.", "Awesome in space.", "you are late"]);
    expect(joined[0]).toMatchObject({ start: 10, end: 14 });
  });

  it("keeps a slowly spoken sentence as one cue", () => {
    const cues = segmentsToCues([
      { start: 10, end: 14.9, text: "Look, Celia," },
      { start: 14.8, end: 18.8, text: "we have to" },
      { start: 18.9, end: 27, text: "follow our passions." },
    ]);
    expect(cues.map((cue) => cue.text)).toEqual(["Look, Celia, we have to follow our passions."]);
  });

  it("capitalizes a line that opens a sentence", () => {
    const cues = segmentsToCues([{ start: 0, end: 1, text: "Ready." }, { start: 2, end: 3, text: "and... action!" }]);
    expect(cues[1].text).toBe("And... action!");
  });

  it("wraps a cue into two balanced lines", () => {
    const wrapped = wrapCueText("The quick brown fox jumps over the lazy dog near the river bank");
    const lines = wrapped.split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(MAX_LINE_CHARACTERS);
  });

  it("writes valid SRT, VTT and plain transcript files", () => {
    const cues = [
      { id: "b", start: 2, end: 3.5, text: "Second" },
      { id: "a", start: 0.25, end: 1.5, text: "First" },
      { id: "c", start: 4, end: 5, text: "   " },
    ];
    expect(createSrt(cues)).toBe("1\r\n00:00:00,250 --> 00:00:01,500\r\nFirst\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,500\r\nSecond\r\n");
    expect(createVtt(cues)).toBe("WEBVTT\n\n00:00:00.250 --> 00:00:01.500\nFirst\n\n00:00:02.000 --> 00:00:03.500\nSecond\n");
    expect(createTranscript(cues)).toBe("First\nSecond\n");
  });
});
