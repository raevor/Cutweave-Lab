import { describe, expect, it } from "vitest";
import { createMarkerCsv, createMarkerJson, createMarkerRichWav, createMarkerXmp, snapTimeToFrame } from "./exports";
import type { MusicMarker } from "./types";

const markers: MusicMarker[] = [
  { id: "a", time: 0.5, confidence: 0.91, strength: 0.9, kind: "bass", source: "automatic" },
  { id: "b", time: 1.25, confidence: 1, strength: 1, kind: "manual", source: "manual" },
];

describe("music marker exports", () => {
  it("serializes stable JSON, CSV and Adobe Dynamic Media XMP", () => {
    expect(createMarkerCsv(markers)).toContain("BASS 001,0.500000,00:00:00.500,bass,automatic,0.9100");
    expect(JSON.parse(createMarkerJson(markers, "song.mp3", 0, 2)).markers).toHaveLength(2);
    const xmp = createMarkerXmp(markers, 48_000);
    expect(xmp).toContain("<xmpDM:trackType>Cue</xmpDM:trackType>");
    expect(xmp).toContain("<xmpDM:startTime>24000</xmpDM:startTime>");
    expect(xmp).not.toContain("<xmpDM:name>");
    expect(xmp).not.toContain("<xmpDM:comment>");
  });

  it("writes a valid PCM WAV with RIFF cue labels and embedded XMP", async () => {
    const samples = new Float32Array(96_000);
    const audio = {
      numberOfChannels: 1,
      sampleRate: 48_000,
      length: samples.length,
      getChannelData: () => samples,
    };
    const blob = createMarkerRichWav(audio, markers, 0, 2);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const view = new DataView(bytes.buffer);

    expect(text.slice(0, 4)).toBe("RIFF");
    expect(text.slice(8, 12)).toBe("WAVE");
    expect(view.getUint32(4, true) + 8).toBe(bytes.byteLength);
    expect(text).toContain("cue ");
    expect(text).not.toContain("LIST");
    expect(text).toContain("_PMX");
    expect(text).toContain("Cutweave Markers");
  });

  it("writes only markers inside the trimmed export range and makes their time relative", async () => {
    const samples = new Float32Array(96_000);
    const audio = {
      numberOfChannels: 1,
      sampleRate: 48_000,
      length: samples.length,
      getChannelData: () => samples,
    };
    const blob = createMarkerRichWav(audio, markers, 1, 2);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const cueOffset = text.indexOf("cue ");
    const view = new DataView(bytes.buffer);

    expect(cueOffset).toBeGreaterThan(0);
    expect(view.getUint32(cueOffset + 8, true)).toBe(1);
    expect(view.getUint32(cueOffset + 32, true)).toBe(12_000);
    expect(text).toContain("<xmpDM:startTime>12000</xmpDM:startTime>");
    expect(createMarkerCsv(markers, 1, 2)).toContain("MANUAL 001,0.250000,00:00:00.250");
  });

  it("snaps exported markers to exact composition frames", async () => {
    const frameRate = { numerator: 24, denominator: 1 };
    const offFrameMarkers: MusicMarker[] = [
      { id: "off-frame", time: 0.51, confidence: 0.9, strength: 0.8, kind: "bass", source: "automatic" },
    ];
    const samples = new Float32Array(48_000);
    const audio = {
      numberOfChannels: 1,
      sampleRate: 48_000,
      length: samples.length,
      getChannelData: () => samples,
    };
    const blob = createMarkerRichWav(audio, offFrameMarkers, 0, 1, frameRate);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const cueOffset = text.indexOf("cue ");
    const view = new DataView(bytes.buffer);

    expect(snapTimeToFrame(0.51, frameRate)).toBe(0.5);
    expect(view.getUint32(cueOffset + 32, true)).toBe(24_000);
    expect(text).toContain("<xmpDM:frameRate>f24</xmpDM:frameRate>");
    expect(text).toContain("<xmpDM:startTime>12</xmpDM:startTime>");
    expect(createMarkerCsv(offFrameMarkers, 0, 1, frameRate)).toContain("0.500000,00:00:00.500");
    expect(JSON.parse(createMarkerJson(offFrameMarkers, "song.wav", 0, 1, frameRate)).markers[0].time).toBe(0.5);
  });

  it("uses Adobe's rational frame-rate notation for NTSC timelines", () => {
    const xmp = createMarkerXmp(markers, 48_000, 0, 2, { numerator: 30_000, denominator: 1_001 });
    expect(xmp).toContain("<xmpDM:frameRate>f30000s1001</xmpDM:frameRate>");
    expect(xmp).toContain("<xmpDM:startTime>15</xmpDM:startTime>");
  });

  it("keeps 30 fps marker export on the nearest frame without a systematic forward shift", () => {
    const rate = { numerator: 30, denominator: 1 };
    for (const time of [0.558, 1.238, 1.916, 2.618, 3.278]) {
      expect(Math.abs(snapTimeToFrame(time, rate) - time)).toBeLessThanOrEqual(1 / 60);
    }
    expect(snapTimeToFrame(0.558, rate)).toBe(17 / 30);
    expect(snapTimeToFrame(1.238, rate)).toBe(37 / 30);
    expect(createMarkerXmp(markers, 48_000, 0, 2, rate)).toContain("<xmpDM:frameRate>f30</xmpDM:frameRate>");
  });
});
