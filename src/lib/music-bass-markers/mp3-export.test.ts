import { describe, expect, it } from "vitest";
import { createId3XmpTag, createMarkerMp3, MP3_DECODER_OFFSET_SAMPLES } from "./mp3-export";
import type { MusicMarker } from "./types";

const markers: MusicMarker[] = [
  { id: "a", time: 0.5, confidence: 0.91, strength: 0.9, kind: "bass", source: "automatic" },
  { id: "b", time: 1.25, confidence: 1, strength: 1, kind: "manual", source: "manual" },
];

function readSyncsafe(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 21) | (bytes[offset + 1] << 14) | (bytes[offset + 2] << 7) | bytes[offset + 3];
}

describe("MP3 marker export", () => {
  it("stores XMP in an ID3v2.3 PRIV frame owned by XMP", () => {
    const tag = createId3XmpTag("<x:xmpmeta/>");
    expect(new TextDecoder().decode(tag.subarray(0, 3))).toBe("ID3");
    expect(tag[3]).toBe(3);
    expect(readSyncsafe(tag, 6)).toBe(tag.byteLength - 10);
    expect(new TextDecoder().decode(tag.subarray(10, 14))).toBe("PRIV");
    expect(new DataView(tag.buffer).getUint32(14)).toBe(tag.byteLength - 20);
    expect(new TextDecoder().decode(tag.subarray(20))).toBe("XMP\0<x:xmpmeta/>");
  });

  it("encodes the range as MP3 and moves markers by the decoder offset", async () => {
    const samples = new Float32Array(96_000);
    const audio = { numberOfChannels: 1, sampleRate: 48_000, length: samples.length, getChannelData: () => samples };
    const bytes = new Uint8Array(await (await createMarkerMp3(audio, markers, 0, 2)).arrayBuffer());
    const tagSize = readSyncsafe(bytes, 6) + 10;
    /* An MPEG audio frame sync follows the tag. */
    expect(bytes[tagSize]).toBe(0xff);
    expect(bytes[tagSize + 1] & 0xe0).toBe(0xe0);
    const xmp = new TextDecoder().decode(bytes.subarray(0, tagSize));
    expect(xmp).toContain(`<xmpDM:startTime>${24_000 + MP3_DECODER_OFFSET_SAMPLES}</xmpDM:startTime>`);
    expect(xmp).toContain(`<xmpDM:startTime>${60_000 + MP3_DECODER_OFFSET_SAMPLES}</xmpDM:startTime>`);
  });

  it("keeps frame-snapped markers on whole frames", async () => {
    const samples = new Float32Array(96_000);
    const audio = { numberOfChannels: 2, sampleRate: 48_000, length: samples.length, getChannelData: () => samples };
    const bytes = new Uint8Array(await (await createMarkerMp3(audio, markers, 0, 2, { numerator: 30, denominator: 1 })).arrayBuffer());
    const xmp = new TextDecoder().decode(bytes.subarray(0, readSyncsafe(bytes, 6) + 10));
    expect(xmp).toContain("<xmpDM:frameRate>f30</xmpDM:frameRate>");
    /* 0.5 s + 23 ms is frame 15.7, which snaps to frame 16. */
    expect(xmp).toContain("<xmpDM:startTime>16</xmpDM:startTime>");
  });
});
