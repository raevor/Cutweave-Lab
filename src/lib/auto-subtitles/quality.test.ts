import { describe, expect, it } from "vitest";
import { compressionRatio, filterSegments, isRepetitive, isSilenceWindow, loopingKeys, loopStartsConfidently } from "./quality";

const line = (start: number, text: string, logprob?: number) => ({ start, end: start + 1, text, logprob });

describe("auto subtitle quality guards", () => {
  it("measures repetition with the zlib compression ratio", () => {
    expect(compressionRatio("Look, Celia, we have to follow our passions.")).toBeLessThan(2.4);
    expect(compressionRatio("I'm not going to be a ".repeat(20))).toBeGreaterThan(2.4);
  });

  it("flags looping text but not ordinary dialogue", () => {
    expect(isRepetitive("Why don't you just admit that you're freaked out by my robot hand?")).toBe(false);
    expect(isRepetitive("I'm I'm I'm I'm I'm I'm I'm I'm I'm I'm I'm I'm I'm")).toBe(true);
  });

  it("skips a window only when no speech is likely and the text is unsure", () => {
    expect(isSilenceWindow(0.25, -1.49)).toBe(true);
    expect(isSilenceWindow(0.64, -0.25)).toBe(false);
    expect(isSilenceWindow(0.38, -0.97)).toBe(false);
    expect(isSilenceWindow(0.03, -1.2)).toBe(false);
  });

  it("keeps two identical lines in a row and drops the rest of a loop", () => {
    const kept = filterSegments([
      line(0, "Run!"), line(1, "Run!"),
      line(2, "Action!"), line(3, "Action!"), line(4, "action"), line(5, "Action!"),
      line(6, "Too big."),
    ]);
    expect(kept.map((segment) => segment.text)).toEqual(["Run!", "Run!", "Action!", "Action!", "Too big."]);
  });

  it("tells a confident repeated call from an invented loop", () => {
    const loop = (first: number) => [{ key: "and", logprob: -1.25 }, ...[first, -0.6, -0.3, -0.1].map((logprob) => ({ key: "action", logprob }))];
    expect(loopStartsConfidently(loop(-0.64))).toBe(true);
    expect(loopStartsConfidently(loop(-1.85))).toBe(false);
    expect(loopStartsConfidently([{ key: "run", logprob: -1.3 }, { key: "run", logprob: -1 }])).toBe(true);
  });

  it("finds every phrase that loops in a window", () => {
    const lines = ["i'm", "going to", "i'm", "going to", "i'm", "going to", "you"].map((key) => ({ key, logprob: -0.2 }));
    expect([...loopingKeys(lines)].sort()).toEqual(["going to", "i'm"]);
  });

  it("drops a false start that the next line repeats in full", () => {
    const kept = filterSegments([
      line(0, "You have your robotics and I just want to be"),
      line(2, "You have your robotics, and I just want to be awesome in space."),
      line(5, "Go"),
      line(6, "Go, guys!"),
    ]);
    expect(kept.map((segment) => segment.text)).toEqual(["You have your robotics, and I just want to be awesome in space.", "Go", "Go, guys!"]);
  });

  it("drops lines the model was very unsure about", () => {
    const kept = filterSegments([line(0, "Captain, we have to abort.", -0.3), line(1, "I'm going to be a good guy.", -2.1)]);
    expect(kept.map((segment) => segment.text)).toEqual(["Captain, we have to abort."]);
    expect(kept[0]).not.toHaveProperty("logprob");
  });
});
