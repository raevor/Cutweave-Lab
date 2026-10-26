import type { SpeechSegment, SubtitleCue } from "./types";

/** Common broadcast limits: two lines of about 42 characters, at most 6 seconds on screen. */
export const MAX_LINE_CHARACTERS = 42;
export const MAX_CUE_CHARACTERS = MAX_LINE_CHARACTERS * 2;
export const MAX_CUE_SECONDS = 6;
const MIN_CUE_SECONDS = 0.6;
/** A time-based split never leaves a cue shorter than this. */
const MIN_SPLIT_CHARACTERS = 24;

/** Whisper emits these for audio it cannot read; they are not speech. */
const NON_SPEECH = /^\s*[[(]\s*(blank_audio|silence|no speech|inaudible)\s*[\])]\s*$/i;

export function cleanSegmentText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/** Drops empty and non-speech segments and offsets chunk-relative times to source time. */
export function normalizeSegments(segments: SpeechSegment[], offset: number, chunkEnd: number): SpeechSegment[] {
  const result: SpeechSegment[] = [];
  for (const segment of segments) {
    const text = cleanSegmentText(segment.text);
    if (!text || NON_SPEECH.test(text)) continue;
    const start = Math.min(chunkEnd, offset + Math.max(0, segment.start));
    const rawEnd = Number.isFinite(segment.end) ? offset + segment.end : chunkEnd;
    const end = Math.min(chunkEnd, Math.max(start + 0.2, rawEnd));
    result.push({ start, end, text });
  }
  return result;
}

/**
 * Splits a segment's words into pieces that fit one cue. Time is shared out by
 * character count because Whisper gives no per-word timing here.
 */
function splitSegment(segment: SpeechSegment): SpeechSegment[] {
  const words = segment.text.split(" ");
  const duration = segment.end - segment.start;
  const maxPieces = Math.max(1, Math.floor(duration / MIN_CUE_SECONDS));
  const byLength = Math.ceil(segment.text.length / MAX_CUE_CHARACTERS);
  // A short or slowly spoken line stays whole; time only splits text that fills two readable cues.
  const byTime = Math.max(1, Math.min(Math.ceil(duration / MAX_CUE_SECONDS), Math.floor(segment.text.length / MIN_SPLIT_CHARACTERS)));
  const pieces = Math.min(maxPieces, Math.max(byLength, byTime, 1));
  if (pieces === 1) return [segment];

  const target = segment.text.length / pieces;
  const groups: string[][] = [[]];
  let length = 0;
  let used = 0;
  for (const word of words) {
    const current = groups[groups.length - 1];
    // Prefer ending a cue at a sentence end, if the rest still fits the remaining cues.
    const sentenceEnd = /[.!?…]$/.test(current[current.length - 1] ?? "")
      && length >= target * 0.45
      && segment.text.length - used <= (pieces - groups.length) * MAX_CUE_CHARACTERS;
    used += word.length + 1;
    if (current.length && groups.length < pieces && (sentenceEnd || length + word.length > target)) {
      groups.push([word]);
      length = word.length + 1;
    } else {
      current.push(word);
      length += word.length + 1;
    }
  }

  const totalCharacters = groups.reduce((sum, group) => sum + group.join(" ").length, 0);
  let cursor = segment.start;
  return groups.map((group, index) => {
    const text = group.join(" ");
    const end = index === groups.length - 1
      ? segment.end
      : cursor + duration * (text.length / Math.max(1, totalCharacters));
    const piece = { start: cursor, end, text };
    cursor = end;
    return piece;
  });
}

/** Breaks a cue into at most two balanced lines at a word boundary. */
export function wrapCueText(text: string) {
  if (text.length <= MAX_LINE_CHARACTERS) return text;
  const words = text.split(" ");
  let best = text;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const first = words.slice(0, index).join(" ");
    const second = words.slice(index).join(" ");
    const score = Math.abs(first.length - second.length) + (first.length > MAX_LINE_CHARACTERS ? 100 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = `${first}\n${second}`;
    }
  }
  return best;
}

/** Gap up to which an unfinished sentence is joined with the line after it. */
const JOIN_GAP_SECONDS = 1.5;

/**
 * Whisper sometimes ends a segment mid-sentence ("Look, Celia," / "we have to").
 * A line without closing punctuation is joined with a following line that starts
 * in lower case, as long as the result still fits one cue.
 */
export function joinSentenceFragments(segments: SpeechSegment[]): SpeechSegment[] {
  const joined: SpeechSegment[] = [];
  for (const segment of segments) {
    const previous = joined[joined.length - 1];
    if (
      previous
      && !/[.!?…"')\]]$/.test(previous.text)
      && /^[a-z]/.test(segment.text)
      && segment.start - previous.end <= JOIN_GAP_SECONDS
      && previous.text.length + segment.text.length + 1 <= MAX_CUE_CHARACTERS
    ) {
      joined[joined.length - 1] = { start: previous.start, end: Math.max(previous.end, segment.end), text: `${previous.text} ${segment.text}` };
    } else {
      joined.push(segment);
    }
  }
  return joined;
}

export function segmentsToCues(segments: SpeechSegment[]): SubtitleCue[] {
  const ordered = joinSentenceFragments([...segments].sort((a, b) => a.start - b.start));
  const cues: SubtitleCue[] = [];
  for (const segment of ordered) {
    for (const piece of splitSegment(segment)) {
      const previous = cues[cues.length - 1];
      // Subtitle players expect cues that never overlap.
      const start = previous ? Math.max(piece.start, previous.end) : piece.start;
      if (piece.end - start < 0.05) continue;
      // A line that opens a new sentence starts with a capital, even if Whisper wrote "and... action!".
      const opensSentence = !previous || /[.!?…]["')\]]?$/.test(previous.text);
      const text = opensSentence ? piece.text.charAt(0).toUpperCase() + piece.text.slice(1) : piece.text;
      cues.push({ id: `cue-${cues.length + 1}`, start, end: piece.end, text });
    }
  }
  return cues.map((cue, index) => ({ ...cue, end: readableEnd(cue, cues[index + 1]) }));
}

/** Minimum time on screen, reading speed and lingering after the last word, as in common subtitle guidelines. */
export const MIN_CUE_DISPLAY_SECONDS = 1.2;
const READING_CHARACTERS_PER_SECOND = 17;
const LINGER_SECONDS = 0.3;
const GAP_BEFORE_NEXT_SECONDS = 0.04;

/**
 * Word timing ends a line on its last word, which can flash too fast to read.
 * The line stays up for its reading time, but never runs into the next line.
 */
function readableEnd(cue: SubtitleCue, next?: SubtitleCue) {
  const reading = Math.max(MIN_CUE_DISPLAY_SECONDS, cue.text.length / READING_CHARACTERS_PER_SECOND);
  const wanted = Math.max(cue.end + LINGER_SECONDS, cue.start + reading);
  return next ? Math.max(cue.end, Math.min(wanted, next.start - GAP_BEFORE_NEXT_SECONDS)) : wanted;
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

export function formatCueTime(seconds: number, separator: "," | ".") {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(milliseconds, 3)}`;
}

export function exportableCues(cues: SubtitleCue[]) {
  return cues
    .map((cue) => ({ ...cue, text: cleanSegmentText(cue.text) }))
    .filter((cue) => cue.text && cue.end > cue.start)
    .sort((a, b) => a.start - b.start);
}

/** SubRip comes from Windows; CRLF line ends are what every editor and player accepts. */
export function createSrt(cues: SubtitleCue[]) {
  return exportableCues(cues)
    .map((cue, index) => `${index + 1}\n${formatCueTime(cue.start, ",")} --> ${formatCueTime(cue.end, ",")}\n${wrapCueText(cue.text)}\n`)
    .join("\n")
    .replace(/\n/g, "\r\n");
}

export function createVtt(cues: SubtitleCue[]) {
  const body = exportableCues(cues)
    .map((cue) => `${formatCueTime(cue.start, ".")} --> ${formatCueTime(cue.end, ".")}\n${wrapCueText(cue.text)}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

/** One subtitle line per text line, so the transcript is easy to read and copy. */
export function createTranscript(cues: SubtitleCue[]) {
  return `${exportableCues(cues).map((cue) => cue.text).join("\n")}\n`;
}

