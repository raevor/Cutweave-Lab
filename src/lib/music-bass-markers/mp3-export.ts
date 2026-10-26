import { createMarkerXmp, type MarkerFrameRate, type PcmAudioSource } from "./exports";
import type { MusicMarker } from "./types";

/*
 * LAME starts every MP3 with 576 samples of encoder delay, and MP3 decoders add
 * 529 more. Premiere Pro and After Effects play those 1105 samples, so the
 * markers move later by the same amount to stay on the hits they belong to.
 * Measured with an impulse: it decodes exactly 1105 samples late.
 */
export const MP3_DECODER_OFFSET_SAMPLES = 1105;
export const MP3_BITRATE = 256_000;
const MP3_SAMPLE_RATES = [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];

function syncsafe(value: number) {
  return [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}

/*
 * An ID3v2.3 tag holding the XMP packet in a PRIV frame owned by "XMP", which is
 * where Adobe applications read and write XMP in MP3 files.
 */
export function createId3XmpTag(xmp: string) {
  const owner = new TextEncoder().encode("XMP\0");
  const packet = new TextEncoder().encode(xmp);
  const frameSize = owner.byteLength + packet.byteLength;
  const tagSize = 10 + frameSize;
  if (tagSize >= 2 ** 28) throw new Error("Too many markers to fit in an MP3 tag.");
  const tag = new Uint8Array(10 + tagSize);
  tag.set([0x49, 0x44, 0x33, 3, 0, 0, ...syncsafe(tagSize)], 0);
  tag.set([0x50, 0x52, 0x49, 0x56], 10);
  new DataView(tag.buffer).setUint32(14, frameSize);
  tag.set(owner, 20);
  tag.set(packet, 20 + owner.byteLength);
  return tag;
}

export function canEncodeMp3(sampleRate: number) {
  return MP3_SAMPLE_RATES.includes(sampleRate);
}

/* The selected range as an MP3 with the markers in its XMP, ready for Premiere Pro and After Effects. */
export async function createMarkerMp3(
  audio: PcmAudioSource,
  markers: MusicMarker[],
  trimStart: number,
  trimEnd: number,
  frameRate?: MarkerFrameRate,
) {
  if (!canEncodeMp3(audio.sampleRate)) throw new Error("MP3 cannot use this sample rate. Download the WAV instead.");
  const [{ Output, Mp3OutputFormat, BufferTarget, AudioSampleSource, AudioSample }, { registerMp3Encoder }] = await Promise.all([
    import("mediabunny"),
    import("@mediabunny/mp3-encoder"),
  ]);
  registerMp3Encoder();

  const sampleRate = audio.sampleRate;
  const channelCount = Math.min(2, Math.max(1, audio.numberOfChannels));
  const startFrame = Math.min(audio.length, Math.max(0, Math.floor(trimStart * sampleRate)));
  const endFrame = Math.min(audio.length, Math.max(startFrame, Math.ceil(trimEnd * sampleRate)));
  const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));

  const output = new Output({ format: new Mp3OutputFormat(), target: new BufferTarget() });
  const source = new AudioSampleSource({ codec: "mp3", bitrate: MP3_BITRATE });
  output.addAudioTrack(source);
  await output.start();
  const chunkFrames = sampleRate;
  for (let chunkStart = startFrame; chunkStart < endFrame; chunkStart += chunkFrames) {
    const frames = Math.min(chunkFrames, endFrame - chunkStart);
    const data = new Float32Array(frames * channelCount);
    for (let channel = 0; channel < channelCount; channel += 1) {
      /* More than two channels fold into stereo: odd channels left, even channels right. */
      const sources = channels.filter((_, index) => index % channelCount === channel);
      const gain = 1 / sources.length;
      const plane = data.subarray(channel * frames, (channel + 1) * frames);
      for (const samples of sources) {
        for (let frame = 0; frame < frames; frame += 1) plane[frame] += (samples[chunkStart + frame] ?? 0) * gain;
      }
    }
    const sample = new AudioSample({
      data,
      format: "f32-planar",
      numberOfChannels: channelCount,
      sampleRate,
      timestamp: (chunkStart - startFrame) / sampleRate,
    });
    /* Close each chunk once it is queued so its memory is released right away. */
    try {
      await source.add(sample);
    } finally {
      sample.close();
    }
  }
  await output.finalize();
  const encoded = output.target.buffer;
  if (!encoded) throw new Error("The MP3 could not be created.");

  /* Shift the range start earlier by the decoder offset so every marker lands that much later. */
  const offset = MP3_DECODER_OFFSET_SAMPLES / sampleRate;
  const included = markers.filter((marker) => marker.time >= trimStart && marker.time <= trimEnd);
  const xmp = createMarkerXmp(included, sampleRate, trimStart - offset, trimEnd + offset, frameRate);
  return new Blob([createId3XmpTag(xmp), encoded], { type: "audio/mpeg" });
}
