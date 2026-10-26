import { zlibSync } from "fflate";
import type { SpeechSegment } from "./types";

/*
 * Whisper invents text over music and noise: endless repeats or loops of one phrase.
 * These guards are adapted from OpenAI's decoder (compression ratio, no-speech and
 * log-probability checks) and calibrated on real footage, so a subtitle line is only
 * kept when the model was actually hearing speech.
 */

/** OpenAI's default: a high zlib ratio means the text is mostly repetition. */
export const MAX_COMPRESSION_RATIO = 2.4;
/*
 * OpenAI skips a window at a no-speech probability above 0.6. Measured on the
 * Tears of Steel open movie, whisper-base.en invents lines over music with only
 * 0.1-0.55 no-speech probability but an average log-probability below -1, while
 * every window of real dialogue stayed above -1.
 */
export const NO_SPEECH_THRESHOLD = 0.1;
export const LOW_LOGPROB = -1;
/** A single line this unsure is dropped even inside a chunk that has real speech. */
export const MIN_SEGMENT_LOGPROB = -1.4;
/** The same line this many times in a row is a decoding loop, not dialogue. */
export const MAX_REPEATS = 2;

export type ScoredSegment = SpeechSegment & { logprob?: number };

export function compressionRatio(text: string) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length < 24) return 1;
  return bytes.length / zlibSync(bytes).length;
}

export function normalizeForCompare(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim();
}

/** Skip a window when the model leans towards "no speech" and is also unsure of the text. */
export function isSilenceWindow(noSpeechProbability: number, averageLogprob: number) {
  return noSpeechProbability > NO_SPEECH_THRESHOLD && averageLogprob < LOW_LOGPROB;
}

/** A window whose text is mostly a repeated phrase. */
export function isRepetitive(text: string) {
  if (compressionRatio(text) > MAX_COMPRESSION_RATIO) return true;
  const words = normalizeForCompare(text).split(" ").filter(Boolean);
  return words.length >= 12 && new Set(words).size / words.length < 0.3;
}

/**
 * Invented loops start with one unsure line that the model then repeats with rising
 * confidence (first lines measured at -1.6 to -1.9). A real repeated call, such as a
 * director shouting "Action!", is confident from the start.
 */
export const LOOP_START_LOGPROB = -1;

type ProbeLine = { key: string; logprob: number };

/** Lines that occur more often than MAX_REPEATS in one window. */
export function loopingKeys(lines: ProbeLine[]) {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line.key, (counts.get(line.key) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > MAX_REPEATS).map(([key]) => key));
}

/** True when the window has no loop, or its loop began with a confident line. */
export function loopStartsConfidently(lines: ProbeLine[]) {
  const looping = loopingKeys(lines);
  const first = lines.find((line) => looping.has(line.key));
  return first ? first.logprob >= LOOP_START_LOGPROB : true;
}

/**
 * Drops unsure and looping lines, keeps at most MAX_REPEATS identical lines in a row,
 * and drops a false start that the next line repeats in full ("I just want to be" /
 * "I just want to be awesome in space.").
 */
export function filterSegments(segments: ScoredSegment[]): SpeechSegment[] {
  const kept: SpeechSegment[] = [];
  let previous = "";
  let run = 0;
  for (const [index, segment] of segments.entries()) {
    if (segment.logprob !== undefined && segment.logprob < MIN_SEGMENT_LOGPROB) continue;
    if (isRepetitive(segment.text)) continue;
    const key = normalizeForCompare(segment.text);
    const next = segments[index + 1];
    if (next && key.length >= 10 && normalizeForCompare(next.text).startsWith(`${key} `)) continue;
    run = key && key === previous ? run + 1 : 1;
    previous = key;
    if (run > MAX_REPEATS) continue;
    kept.push({ start: segment.start, end: segment.end, text: segment.text });
  }
  return kept;
}
