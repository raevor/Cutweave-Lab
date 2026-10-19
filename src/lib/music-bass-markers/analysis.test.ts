import { describe, expect, it } from "vitest";
import { analyzeMusicPcm, analyzeMusicRange, selectMusicMarkers } from "./analysis";
import type { MusicMarker } from "./types";

function makePulseTrack(sampleRate: number, duration: number, pulseTimes: number[]) {
  const samples = new Float32Array(Math.round(sampleRate * duration));
  for (const pulseTime of pulseTimes) {
    const start = Math.round(pulseTime * sampleRate);
    const length = Math.round(sampleRate * 0.12);
    for (let offset = 0; offset < length && start + offset < samples.length; offset += 1) {
      const envelope = Math.exp((-offset / sampleRate) * 32);
      samples[start + offset] += Math.sin((2 * Math.PI * 92 * offset) / sampleRate) * envelope * 0.9;
      if (offset < 22) samples[start + offset] += (1 - offset / 22) * 0.55;
    }
  }
  return samples;
}

describe("music and bass analysis", () => {
  it("finds separated impacts without duplicating one hit", () => {
    const sampleRate = 12_000;
    const pulseTimes = [0.6, 1.2, 1.8, 2.4, 3, 3.6];
    const result = analyzeMusicPcm(makePulseTrack(sampleRate, 4.2, pulseTimes), sampleRate, 4.2);
    const selected = selectMusicMarkers(result.candidates, 0.75, 0.3);

    for (const expectedTime of pulseTimes) {
      expect(selected.some((marker) => Math.abs(marker.time - expectedTime) < 0.08)).toBe(true);
    }
    for (let index = 1; index < selected.length; index += 1) {
      expect(selected[index].time - selected[index - 1].time).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("does not invent markers in silence", () => {
    const result = analyzeMusicPcm(new Float32Array(48_000), 12_000, 4);
    expect(result.candidates).toEqual([]);
    expect(result.bpm).toBeNull();
  });

  it("keeps the actual low drum phase beneath stronger halfway vocal-like accents", () => {
    const rate = 12_000;
    const hits = Array.from({ length: 24 }, (_, index) => 1 + index * 0.68);
    const track = makePulseTrack(rate, 18, hits);
    for (const hit of hits) {
      const start = Math.round((hit + 0.34) * rate);
      for (let offset = 0; offset < rate * 0.18 && start + offset < track.length; offset++) {
        const envelope = Math.exp(-offset / rate * 16) * 0.9;
        track[start + offset] += envelope * (Math.sin(2 * Math.PI * 320 * offset / rate) + Math.sin(2 * Math.PI * 640 * offset / rate));
      }
    }
    const selected = selectMusicMarkers(analyzeMusicPcm(track, rate, 18).candidates, 0.68, 0.16);
    expect(hits.filter((time) => selected.some((m) => Math.abs(time - m.time) < 0.04)).length).toBeGreaterThanOrEqual(22);
    expect(selected.filter((m) => hits.some((time) => Math.abs(time + 0.34 - m.time) < 0.08)).length).toBeLessThanOrEqual(2);
  });

  it("does not fill a missing beat with an invented marker", () => {
    const rate = 12_000;
    const hits = Array.from({ length: 24 }, (_, index) => 1 + index * 0.6).filter((_, index) => index !== 12);
    const result = analyzeMusicPcm(makePulseTrack(rate, 16, hits), rate, 16);
    expect(result.candidates.some((m) => Math.abs(m.time - 8.2) < 0.15)).toBe(false);
  });

  it("keeps separate attacks at a small user-selected gap", () => {
    const rate = 12_000;
    const result = analyzeMusicPcm(makePulseTrack(rate, 3, [0.6, 0.72, 1.5, 1.62]), rate, 3);
    const selected = selectMusicMarkers(result.candidates, 1, 0.08);
    for (const time of [0.6, 0.72, 1.5, 1.62]) expect(selected.some((m) => Math.abs(m.time - time) < 0.04)).toBe(true);
  });

  it("is insensitive to an overall gain change", () => {
    const rate = 12_000;
    const source = makePulseTrack(rate, 6, [0.4, 1.1, 1.8, 2.5, 3.2, 3.9, 4.6, 5.3]);
    const normal = selectMusicMarkers(analyzeMusicPcm(source, rate, 6).candidates, 0.68, 0.16);
    const quiet = selectMusicMarkers(analyzeMusicPcm(source.map((value) => value * 0.15), rate, 6).candidates, 0.68, 0.16);
    expect(quiet.length).toBe(normal.length);
    for (let index = 0; index < normal.length; index++) expect(Math.abs(quiet[index].time - normal[index].time)).toBeLessThan(0.025);
  });

  it("rejects invalid decoded metadata", () => {
    for (const rate of [0, NaN, Infinity, 200_000]) expect(() => analyzeMusicPcm(new Float32Array(10), rate, 1)).toThrow();
    expect(() => analyzeMusicPcm(new Float32Array(10), 12_000, NaN)).toThrow();
    expect(() => analyzeMusicPcm(new Float32Array([0, NaN]), 12_000, 1)).toThrow(/samples/);
  });

  it("does not turn a sustained bass note into repeated drum hits", () => {
    const rate = 12_000;
    const track = new Float32Array(rate * 12);
    for (let index = rate / 2; index < track.length - rate / 2; index++) track[index] = Math.sin(2 * Math.PI * 70 * index / rate) * 0.35;
    const selected = selectMusicMarkers(analyzeMusicPcm(track, rate, 12).candidates, 0.68, 0.16);
    expect(selected.filter((m) => m.time > 1 && m.time < 10).length).toBe(0);
  });

  it.each([42, 68, 115, 170])("recognizes real attacks across bass pitches at %i Hz", (frequency) => {
    const rate = 12_000;
    const track = new Float32Array(rate * 8);
    const hits = [0.5, 1.3, 2.1, 2.9, 3.7, 4.5, 5.3, 6.1, 6.9];
    for (const hit of hits) {
      const start = Math.round(hit * rate);
      for (let offset = 0; offset < rate * 0.12; offset++) track[start + offset] += Math.sin(offset * 2 * Math.PI * frequency / rate) * Math.exp(-offset / rate * 32) * 0.8;
    }
    const selected = selectMusicMarkers(analyzeMusicPcm(track, rate, 8).candidates, 0.68, 0.16);
    expect(hits.filter((time) => selected.some((m) => Math.abs(m.time - time) < 0.04)).length).toBeGreaterThanOrEqual(8);
  });

  it.each([42, 68, 92, 115, 170])("places %i Hz hits at their attack front, not the later rise maximum", (frequency) => {
    const rate = 12_000;
    // Off-hop starts expose timestamp bias that a loose ±40 ms test misses.
    const hits = [0.507, 1.313, 2.119, 2.925, 3.731, 4.537];
    const track = new Float32Array(rate * 5);
    for (const hit of hits) {
      const start = Math.round(hit * rate);
      for (let offset = 0; offset < rate * 0.12; offset++) {
        track[start + offset] += Math.sin(offset * 2 * Math.PI * frequency / rate) * Math.exp(-offset / rate * 32) * 0.8;
      }
    }
    const selected = selectMusicMarkers(analyzeMusicPcm(track, rate, 5).candidates, 0.68, 0.16);
    expect(selected).toHaveLength(hits.length);
    for (let index = 0; index < hits.length; index++) {
      expect(Math.abs(selected[index].time - hits[index])).toBeLessThan(0.008);
    }
  });

  it.each([0, 0.008, 0.02])("backtracks a %s-second attack without jumping into a sustained bass background", (ramp) => {
    const rate = 12_000;
    const hits = [0.507, 1.313, 2.119, 2.925, 3.731, 4.537];
    const track = Float32Array.from({ length: rate * 5 }, (_, index) => Math.sin(index * 2 * Math.PI * 70 / rate) * 0.06);
    for (const hit of hits) {
      const start = Math.round(hit * rate);
      for (let offset = 0; offset < rate * 0.18; offset++) {
        const attack = ramp ? Math.min(1, offset / rate / ramp) : 1;
        track[start + offset] += Math.sin(offset * 2 * Math.PI * 68 / rate) * Math.exp(-offset / rate * 25) * 0.8 * attack;
      }
    }
    const selected = selectMusicMarkers(analyzeMusicPcm(track, rate, 5).candidates, 0.68, 0.16);
    expect(selected).toHaveLength(hits.length);
    for (let index = 0; index < hits.length; index++) {
      expect(Math.abs(selected[index].time - hits[index])).toBeLessThan(0.01);
    }
  });

  it.each([0.01, 0.02, 0.025])("keeps a kick's leading click when its bass body arrives %s seconds later", (delay) => {
    const rate = 12_000;
    const hits = [0.507, 1.313, 2.119, 2.925, 3.731, 4.537];
    const track = new Float32Array(rate * 5);
    for (const hit of hits) {
      const bodyStart = Math.round((hit + delay) * rate);
      for (let offset = 0; offset < rate * 0.18; offset++) {
        track[bodyStart + offset] += Math.sin(offset * 2 * Math.PI * 68 / rate) * Math.exp(-offset / rate * 25) * 0.8;
      }
      const clickStart = Math.round(hit * rate);
      for (let offset = 0; offset < rate * 0.006; offset++) {
        track[clickStart + offset] += Math.sin(offset * 2 * Math.PI * 2200 / rate) * Math.exp(-offset / rate * 650) * 0.8;
      }
    }
    const selected = selectMusicMarkers(analyzeMusicPcm(track, rate, 5).candidates, 0.68, 0.16);
    expect(selected).toHaveLength(hits.length);
    for (let index = 0; index < hits.length; index++) {
      expect(Math.abs(selected[index].time - hits[index])).toBeLessThan(0.005);
    }
  });

  it("analyzes only the chosen interval but keeps absolute marker times and the whole-song waveform", () => {
    const sampleRate = 12_000;
    const track = makePulseTrack(sampleRate, 4.2, [0.6, 1.2, 1.8, 2.4, 3]);
    const result = analyzeMusicRange(track, sampleRate, 4.2, 1.5, 2.7);
    const selected = selectMusicMarkers(result.candidates, 0.75, 0.24);
    expect(selected.every((marker) => marker.time >= 1.5 && marker.time <= 2.7)).toBe(true);
    expect(selected.some((marker) => Math.abs(marker.time - 1.8) < 0.08)).toBe(true);
    expect(selected.some((marker) => Math.abs(marker.time - 2.4) < 0.08)).toBe(true);
    expect(result.waveformBins).toBe(4800);
    expect(() => analyzeMusicRange(track, sampleRate, 4.2, 2, 2.05)).toThrow(/range/);
  });

  it("keeps a sustained beat and removes weaker halfway duplicates", () => {
    const candidates: MusicMarker[] = [];
    for (let beat = 0; beat < 16; beat += 1) {
      const time = 4 + beat * 0.6;
      candidates.push({ id: `beat-${beat}`, time, confidence: 0.85, strength: 0.8, bassEnergy: 1, kind: "bass", source: "automatic" });
      candidates.push({ id: `extra-${beat}`, time: time + 0.3, confidence: 0.7, strength: 0.25, bassEnergy: 0.5, kind: "impact", source: "automatic" });
    }
    const selected = selectMusicMarkers(candidates, 0.68, 0.24);
    expect(selected.filter((marker) => marker.id.startsWith("beat-")).length).toBe(16);
    expect(selected.some((marker) => marker.id.startsWith("extra-"))).toBe(false);
  });

  it("tracks separate rhythmic sections when the tempo changes", () => {
    const candidates: MusicMarker[] = [];
    for (const [section, start, period] of [[0, 2, 0.6], [1, 20, 0.5]] as const) {
      for (let beat = 0; beat < 16; beat += 1) {
        candidates.push({ id: `${section}-beat-${beat}`, time: start + beat * period, confidence: 0.86, strength: 0.8, bassEnergy: 1, kind: "bass", source: "automatic" });
        candidates.push({ id: `${section}-extra-${beat}`, time: start + (beat + 0.5) * period, confidence: 0.7, strength: 0.25, bassEnergy: 0.45, kind: "impact", source: "automatic" });
      }
    }
    const selected = selectMusicMarkers(candidates, 0.68, 0.2);
    expect(selected.filter((marker) => marker.id.includes("-beat-")).length).toBe(32);
    expect(selected.some((marker) => marker.id.includes("-extra-"))).toBe(false);
  });

  it("keeps the strongest marker when two candidates are too close", () => {
    const markers: MusicMarker[] = [
      { id: "a", time: 1, confidence: 0.55, strength: 0.5, kind: "impact", source: "automatic" },
      { id: "b", time: 1.12, confidence: 0.91, strength: 0.9, kind: "bass", source: "automatic" },
      { id: "c", time: 2, confidence: 0.8, strength: 0.8, kind: "impact", source: "automatic" },
    ];
    expect(selectMusicMarkers(markers, 1, 0.25).map((marker) => marker.id)).toEqual(["b", "c"]);
  });

  it("only adds candidates as sensitivity rises", () => {
    const markers: MusicMarker[] = [
      { id: "quiet", time: 1, confidence: 0.3, strength: 0.2, kind: "impact", source: "automatic" },
      { id: "medium", time: 2, confidence: 0.6, strength: 0.6, kind: "bass", source: "automatic" },
      { id: "strong", time: 3, confidence: 0.92, strength: 0.95, kind: "impact", source: "automatic" },
    ];
    const strict = selectMusicMarkers(markers, 0, 0.25);
    const broad = selectMusicMarkers(markers, 1, 0.25);

    expect(strict.map((marker) => marker.id)).toEqual(["strong"]);
    expect(broad.map((marker) => marker.id)).toEqual(["quiet", "medium", "strong"]);
  });

  it("reports real frame progress and completes at the exact total", () => {
    const progress: Array<[number, number]> = [];
    analyzeMusicPcm(new Float32Array(24_000), 12_000, 2, (completed, total) => progress.push([completed, total]));

    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toEqual([progress.at(-1)?.[1], progress.at(-1)?.[1]]);
  });
});
