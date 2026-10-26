import type { AudioChunk } from "./types";

/** Whisper reads at most 30 seconds at a time. */
export const MAX_CHUNK_SECONDS = 29.5;
const MIN_CHUNK_SECONDS = 20;
const QUIET_WINDOW_SECONDS = 0.1;
/** RMS below this is treated as no speech, so Whisper never transcribes pure silence. */
const SILENCE_RMS = 0.004;

function rms(samples: Float32Array, start: number, end: number) {
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / Math.max(1, end - start));
}

/**
 * Splits mono audio into Whisper-sized chunks. Each cut is placed in the quietest
 * 100 ms window between 20 and 29.5 seconds, so a cut rarely lands inside a word.
 */
export function planAudioChunks(samples: Float32Array, sampleRate: number): AudioChunk[] {
  const chunks: AudioChunk[] = [];
  const total = samples.length;
  const window = Math.max(1, Math.round(QUIET_WINDOW_SECONDS * sampleRate));
  let start = 0;

  while (start < total) {
    const limit = Math.min(total, start + Math.round(MAX_CHUNK_SECONDS * sampleRate));
    let end = limit;
    if (limit < total) {
      const searchStart = start + Math.round(MIN_CHUNK_SECONDS * sampleRate);
      let quietest = Number.POSITIVE_INFINITY;
      for (let position = searchStart; position + window <= limit; position += window) {
        const level = rms(samples, position, position + window);
        if (level < quietest) {
          quietest = level;
          end = position + Math.floor(window / 2);
        }
      }
    }
    chunks.push({
      start: start / sampleRate,
      end: end / sampleRate,
      silent: rms(samples, start, end) < SILENCE_RMS,
    });
    start = end;
  }

  return chunks;
}
