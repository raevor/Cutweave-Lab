import { describe, expect, it } from "vitest";
import { assignWordsToLines, clampWord, splitAtPauses } from "./words";

const word = (text: string, start: number, end: number) => ({ text, start, end });

describe("auto subtitle word timing", () => {
  it("hands each line its own words", () => {
    const words = [word(" We", 4.2, 4.4), word(" have", 4.4, 4.6), word(" lift-off.", 4.6, 5.2), word(" 4,", 7, 7.3), word(" 3.", 7.4, 7.7)];
    const groups = assignWordsToLines(["we have lift off", "4 3"], words);
    expect(groups?.map((group) => group.length)).toEqual([3, 2]);
  });

  it("gives up when lines and words do not line up", () => {
    expect(assignWordsToLines(["we have"], [word(" We", 0, 1)])).toBeNull();
    expect(assignWordsToLines(["we"], [word(" We", 0, 1), word(" go", 1, 2)])).toBeNull();
  });

  it("times a line by its words and splits it at long pauses", () => {
    const segments = splitAtPauses([
      word(" 4,", 7, 7.4), word(" 3,", 7.9, 8.3), word(" 2,", 8.8, 9.2), word(" 1.", 9.7, 10),
      word(" Yeah.", 23.1, 23.5), word(" You're", 23.6, 23.8), word(" a", 23.8, 23.9), word(" jerk,", 23.9, 24.2), word(" Tom.", 24.2, 24.6),
    ], 0);
    expect(segments).toEqual([
      { start: 7, end: 10, text: "4, 3, 2, 1." },
      { start: 23.1, end: 24.6, text: "Yeah. You're a jerk, Tom." },
    ]);
  });

  it("keeps punctuation after a pause with the words before it", () => {
    const segments = splitAtPauses([word(" but", 35, 35.3), word(" it's", 35.3, 35.6), word("...", 36.8, 37), word(" All", 37.7, 37.9), word(" right.", 37.9, 38.2)], 0);
    expect(segments.map((segment) => segment.text)).toEqual(["but it's...", "All right."]);
  });

  it("stops a word from stretching across the silence beside it", () => {
    expect(clampWord(word(" There", 2, 8), true)).toEqual(word(" There", 7.15, 8));
    expect(clampWord(word(" know,", 10, 21), false).end).toBeCloseTo(10.76);
    expect(clampWord(word(" Run!", 1, 1.4), false)).toEqual(word(" Run!", 1, 1.4));
  });

  it("adds the window offset", () => {
    expect(splitAtPauses([word(" Run!", 1, 1.4)], 420)).toEqual([{ start: 421, end: 421.4, text: "Run!" }]);
  });
});
