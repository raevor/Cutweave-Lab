/** Whisper expects 16 kHz mono samples. */
export const WHISPER_SAMPLE_RATE = 16_000;

/** Averages all channels into one, then linearly resamples to the target rate. */
export function downmixAndResample(channels: Float32Array[], sourceRate: number, targetRate = WHISPER_SAMPLE_RATE) {
  const length = channels[0]?.length ?? 0;
  const outputLength = Math.max(1, Math.round((length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  const channelCount = Math.max(1, channels.length);

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(length - 1, Math.floor(position));
    const right = Math.min(length - 1, left + 1);
    const weight = position - left;
    let sum = 0;
    for (const channel of channels) sum += channel[left] * (1 - weight) + channel[right] * weight;
    output[index] = sum / channelCount;
  }
  return output;
}

/**
 * Decodes the audio track of a local audio or video file into 16 kHz mono samples.
 * Decoding straight at 16 kHz keeps a 30-minute source near 230 MB instead of 700 MB.
 */
export async function decodeSpeechAudio(file: File, shouldContinue: () => boolean) {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) throw new Error("This browser does not provide the Web Audio decoder needed to read the soundtrack.");

  let context: AudioContext;
  try {
    context = new AudioContextClass({ sampleRate: WHISPER_SAMPLE_RATE });
  } catch {
    context = new AudioContextClass();
  }

  let decoded: AudioBuffer;
  try {
    const bytes = await file.arrayBuffer();
    if (!shouldContinue()) throw new DOMException("Transcription cancelled", "AbortError");
    decoded = await context.decodeAudioData(bytes);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("This browser could not read a soundtrack from the file. Try MP4, WebM, MP3 or WAV, and check that the video has audio.");
  } finally {
    void context.close();
  }

  const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel));
  const samples = decoded.numberOfChannels === 1 && decoded.sampleRate === WHISPER_SAMPLE_RATE
    ? new Float32Array(channels[0])
    : downmixAndResample(channels, decoded.sampleRate);
  return { samples, duration: decoded.duration };
}
