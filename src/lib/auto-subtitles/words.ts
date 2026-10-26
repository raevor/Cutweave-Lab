import { cleanSegmentText } from "./cues";
import type { SpeechSegment } from "./types";

export type TimedWord = { text: string; start: number; end: number };

/** A pause this long between two words starts a new subtitle line. */
export const LINE_BREAK_GAP_SECONDS = 0.8;

function letters(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Hands each decoded line its own words, in order, by matching their letters.
 * Returns null when the two do not line up, so the caller can keep line timing.
 */
export function assignWordsToLines(lineKeys: string[], words: TimedWord[]): TimedWord[][] | null {
  const groups: TimedWord[][] = [];
  let index = 0;
  for (const key of lineKeys) {
    const target = letters(key);
    const group: TimedWord[] = [];
    let collected = "";
    while (index < words.length && collected.length < target.length) {
      collected += letters(words[index].text);
      group.push(words[index]);
      index += 1;
    }
    if (collected !== target) return null;
    groups.push(group);
  }
  return index === words.length ? groups : null;
}

/**
 * Word alignment sometimes stretches a word across the silence next to it, so a
 * line would appear early or stay long after it is said. A word lasts at most about
 * as long as it takes to say: the opening word of a line keeps its end (the silence
 * is usually before it), any other word keeps its start.
 */
export function clampWord(word: TimedWord, opensLine: boolean): TimedWord {
  const longest = 0.4 + letters(word.text).length * 0.09;
  if (word.end - word.start <= longest) return word;
  return opensLine ? { ...word, start: word.end - longest } : { ...word, end: word.start + longest };
}

/**
 * Times a line by its first and last spoken word and splits it where the speaker
 * pauses, so a line never appears before it is said or stays through a long silence.
 */
export function splitAtPauses(words: TimedWord[], offset: number): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let current: TimedWord[] = [];
  let text = "";
  const flush = () => {
    if (current.length) {
      const first = current[0];
      const last = current[current.length - 1];
      segments.push({ start: offset + first.start, end: offset + Math.max(last.end, first.start + 0.2), text: cleanSegmentText(text) });
    }
    current = [];
    text = "";
  };
  for (const timed of words) {
    const word = clampWord(timed, current.length === 0);
    // Punctuation alone ("...") joins the words before it and never times or starts a line.
    if (!/[a-z0-9]/i.test(word.text)) {
      if (current.length) text += word.text.trim();
      else if (segments.length) segments[segments.length - 1].text += word.text.trim();
      continue;
    }
    const previous = current[current.length - 1];
    if (previous && word.start - previous.end > LINE_BREAK_GAP_SECONDS) flush();
    current.push(word);
    text += ` ${word.text.trim()}`;
  }
  flush();
  return segments;
}
