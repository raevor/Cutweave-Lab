import type { MusicAnalysisResult, MusicMarker } from "./types";

const WAVEFORM_BINS = 4800;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function percentile(values: Float32Array, fraction: number) {
  if (!values.length) return 0;
  // Quantile scratch stays bounded even for long tracks.
  const count = Math.min(values.length, 32_768);
  const sorted = Array.from({ length: count }, (_, index) => values[Math.floor(index * values.length / count)]).sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * fraction)] ?? 0;
}

export function makeWaveform(samples: Float32Array, bins = WAVEFORM_BINS) {
  const availableBins = Math.max(1, Math.min(bins, samples.length || 1));
  const waveform = new Float32Array(availableBins * 2);
  for (let bin = 0; bin < availableBins; bin++) {
    const start = Math.floor(bin * samples.length / availableBins);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((bin + 1) * samples.length / availableBins)));
    let minimum = Infinity; let maximum = -Infinity;
    for (let index = start; index < end; index++) {
      minimum = Math.min(minimum, samples[index]);
      maximum = Math.max(maximum, samples[index]);
    }
    waveform[bin * 2] = Number.isFinite(minimum) ? minimum : 0;
    waveform[bin * 2 + 1] = Number.isFinite(maximum) ? maximum : 0;
  }
  return { waveform, waveformBins: availableBins };
}

// Iterative radix-2 FFT. Plans and scratch buffers are reused for every frame.
function fftPlan(size: number) {
  const reverse = new Uint16Array(size);
  const cosine = new Float64Array(size / 2);
  const sine = new Float64Array(size / 2);
  const window = new Float64Array(size);
  for (let index = 0; index < size; index++) {
    let bits = index; let value = 0;
    for (let step = 1; step < size; step *= 2) { value = value * 2 + (bits & 1); bits >>>= 1; }
    reverse[index] = value;
    window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / size);
  }
  for (let index = 0; index < size / 2; index++) {
    cosine[index] = Math.cos(2 * Math.PI * index / size);
    sine[index] = -Math.sin(2 * Math.PI * index / size);
  }
  return { reverse, cosine, sine, window, real: new Float64Array(size), imaginary: new Float64Array(size) };
}

function spectrum(samples: Float32Array, center: number, plan: ReturnType<typeof fftPlan>) {
  const { real, imaginary, reverse, window, cosine, sine } = plan;
  const size = real.length;
  imaginary.fill(0);
  for (let index = 0; index < size; index++) real[reverse[index]] = (samples[center + index - size / 2] ?? 0) * window[index];
  for (let span = 2; span <= size; span *= 2) {
    const half = span / 2; const stride = size / span;
    for (let start = 0; start < size; start += span) {
      for (let index = 0; index < half; index++) {
        const a = start + index; const b = a + half; const angle = index * stride;
        const x = real[b] * cosine[angle] - imaginary[b] * sine[angle];
        const y = real[b] * sine[angle] + imaginary[b] * cosine[angle];
        real[b] = real[a] - x; imaginary[b] = imaginary[a] - y;
        real[a] += x; imaginary[a] += y;
      }
    }
  }
}

function bassEnvelope(samples: Float32Array, sampleRate: number, hop: number, frames: number) {
  const result = new Float32Array(frames);
  // Two cascaded biquads isolate sub/kick energy from vocal formants and cymbals.
  const omega = 2 * Math.PI * 110 / sampleRate;
  const c = Math.cos(omega); const alpha = Math.sin(omega) / Math.SQRT2;
  const b0 = (1 - c) / 2 / (1 + alpha); const b1 = 2 * b0;
  const a1 = -2 * c / (1 + alpha); const a2 = (1 - alpha) / (1 + alpha);
  const dcAlpha = 1 - Math.exp(-2 * Math.PI * 25 / sampleRate);
  let dc = 0; let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  let u1 = 0; let u2 = 0; let v1 = 0; let v2 = 0; let power = 0;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]; dc += dcAlpha * (sample - dc);
    const x = sample - dc;
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const v = b0 * y + b1 * u1 + b0 * u2 - a1 * v1 - a2 * v2;
    u2 = u1; u1 = y; v2 = v1; v1 = v;
    power += v * v;
    if ((index + 1) % hop === 0 || index === samples.length - 1) {
      result[Math.floor(index / hop)] = Math.sqrt(power / hop); power = 0;
    }
  }
  return result;
}

function attackStartFrame(envelope: Float32Array, peakFrame: number, lookback: number) {
  // A rise maximum is evidence for a hit, not its starting time. Trace that
  // same rise to its preceding energy valley instead of applying a fixed delay.
  const energy = (frame: number) => (
    envelope[Math.max(0, frame - 1)] + envelope[frame] + envelope[Math.min(envelope.length - 1, frame + 1)]
  ) / 3;
  const peak = energy(peakFrame);
  const first = Math.max(0, peakFrame - lookback);
  for (let frame = peakFrame - 1; frame >= first; frame--) {
    const value = energy(frame);
    if (value <= energy(Math.max(0, frame - 1)) && value < energy(frame + 1)
      && peak - value >= peak * 0.2) {
      // The minimum is still before the attack. Locate the early rising edge,
      // not that minimum itself (which would put quiet hits before the sound).
      const edge = value + (peak - value) * 0.1;
      for (let next = frame + 1; next <= peakFrame; next++) {
        const after = energy(next);
        if (after < edge) continue;
        const before = energy(next - 1);
        // RMS bins cover [frame, frame + 1): use their center timestamps.
        return Math.min(peakFrame, next - 1 + clamp((edge - before) / Math.max(1e-12, after - before), 0, 1) + 0.5);
      }
    }
  }
  return peakFrame;
}

function leadingTransientTime(samples: Float32Array, sampleRate: number, bassStart: number, peakTime: number, minimumTime: number) {
  // A kick's short click can precede its low-frequency body. Only accept a
  // clear, nearby waveform attack; unrelated low-level fluctuations stay put.
  const step = Math.max(1, Math.round(sampleRate * 0.001));
  const first = Math.max(0, Math.floor(Math.max(minimumTime, bassStart - 0.03) * sampleRate / step));
  const last = Math.min(Math.floor((samples.length - 1) / step), Math.ceil((peakTime + 0.01) * sampleRate / step));
  const power = new Float64Array(Math.max(0, last - first + 1));
  let maximum = 0;
  for (let bin = 0; bin < power.length; bin++) {
    const center = (first + bin) * step;
    let sum = 0;
    for (let index = center - step; index < center + step; index++) sum += (samples[index] ?? 0) ** 2;
    power[bin] = sum / (step * 2);
    maximum = Math.max(maximum, power[bin]);
  }
  let bestTime = bassStart;
  let bestScore = 0;
  for (let bin = 4; bin + 3 < power.length; bin++) {
    const time = (first + bin) * step / sampleRate;
    if (time >= bassStart) break;
    if (time < minimumTime) continue;
    let before = 0; let after = 0;
    for (let offset = 1; offset <= 4; offset++) before += power[bin - offset] / 4;
    for (let offset = 0; offset < 4; offset++) after += power[bin + offset] / 4;
    if (after < before * 2 || after < maximum * 0.03) continue;
    if (after < maximum * 0.35 && after < before * 4) continue;
    const score = (after - before) / Math.max(maximum * 0.05, before);
    if (score > bestScore) { bestScore = score; bestTime = time; }
  }
  return bestTime;
}

function estimateTempo(markers: MusicMarker[]) {
  if (markers.length < 5) return { bpm: null, confidence: 0 };
  const histogram = new Float64Array(141);
  let total = 0;
  for (let index = 0; index < markers.length; index++) {
    for (let next = index + 1; next < Math.min(markers.length, index + 5); next++) {
      const gap = markers[next].time - markers[index].time;
      if (gap < 0.25 || gap > 2) continue;
      let bpm = 60 / gap;
      while (bpm < 60) bpm *= 2;
      while (bpm > 200) bpm /= 2;
      const weight = Math.min(markers[index].confidence, markers[next].confidence) / (next - index);
      const bin = Math.round(bpm) - 60;
      for (let offset = -1; offset <= 1; offset++) {
        if (bin + offset >= 0 && bin + offset < histogram.length) histogram[bin + offset] += weight * (offset ? 0.5 : 1);
      }
      total += weight;
    }
  }
  let best = 0;
  for (let index = 1; index < histogram.length; index++) if (histogram[index] > histogram[best]) best = index;
  const confidence = total ? histogram[best] / total : 0;
  return { bpm: confidence >= 0.12 ? best + 60 : null, confidence };
}

function supportObservedRhythm(markers: MusicMarker[]) {
  const support = new Float32Array(markers.length);
  const votes = new Uint16Array(markers.length);
  const lastTime = markers.at(-1)?.time ?? 0;
  let first = 0;
  for (let start = 0; start <= lastTime; start += 4) {
    while (first < markers.length && markers[first].time < start) first++;
    let end = first;
    while (end < markers.length && markers[end].time < start + 8) end++;
    const anchors = markers.slice(first, end).filter((m) => m.confidence >= 0.78 && (m.bassEnergy ?? 0) >= 0.1 && m.strength >= 0.3);
    if (anchors.length < 6) continue;
    const histogram = new Float64Array(181);
    const weight = (m: MusicMarker) => m.confidence ** 12 * m.strength;
    for (let a = 0; a < anchors.length; a++) {
      for (let b = a + 1; b < anchors.length; b++) {
        const gap = anchors[b].time - anchors[a].time;
        if (gap > 1.2) break;
        if (gap < 0.3) continue;
        const bin = Math.round((gap - 0.3) / 0.005);
        for (let offset = -2; offset <= 2; offset++) {
          if (bin + offset >= 0 && bin + offset < histogram.length) histogram[bin + offset] += Math.min(weight(anchors[a]), weight(anchors[b])) * (1 - Math.abs(offset) * 0.2);
        }
      }
    }
    let best = 0;
    for (let bin = 1; bin < histogram.length; bin++) if (histogram[bin] > histogram[best]) best = bin;
    if (!histogram[best]) continue;
    const period = 0.3 + best * 0.005;
    const distance = (a: number, b: number) => Math.abs(a - b - Math.round((a - b) / period) * period);
    let phase = anchors[0].time; let phaseScore = 0;
    let total = 0;
    for (const marker of anchors) total += weight(marker);
    for (const anchor of anchors) {
      let score = 0;
      for (const marker of anchors) if (distance(marker.time, anchor.time) <= 0.055) score += weight(marker);
      if (score > phaseScore) { phaseScore = score; phase = anchor.time; }
    }
    const observed = anchors.filter((m) => distance(m.time, phase) <= 0.055);
    const occupiedBeats = new Set(observed.map((m) => Math.round((m.time - phase) / period)));
    if (occupiedBeats.size < 5 || phaseScore / Math.max(1e-8, total) < 0.65) continue;
    for (let index = first; index < end; index++) {
      // Support changes confidence only. Never synthesize or move a timestamp.
      support[index] += distance(markers[index].time, phase) <= 0.065 ? 1 : -1;
      votes[index]++;
    }
  }
  for (let index = 0; index < markers.length; index++) {
    if (!votes[index]) continue;
    const marker = markers[index];
    const adjustment = support[index] / votes[index] * 0.12;
    if (adjustment >= 0 || marker.confidence < 0.9) marker.confidence = clamp(marker.confidence + adjustment, 0, 1);
  }
}

export function selectMusicMarkers(candidates: MusicMarker[], sensitivity: number, minimumSpacingSeconds: number) {
  const value = clamp(sensitivity, 0, 1);
  const threshold = value <= 0.68 ? 0.92 - value / 0.68 * 0.12 : 0.8 - (value - 0.68) / 0.32 * 0.56;
  const spacing = Math.max(0.001, minimumSpacingSeconds);
  const occupied = new Map<number, MusicMarker>();
  const selected: MusicMarker[] = [];
  // Rhythm may describe the song, but must not replace real attacks with a grid.
  for (const marker of candidates.filter((m) => m.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence || b.strength - a.strength || a.time - b.time)) {
    const bucket = Math.floor(marker.time / spacing);
    let neighbor = false;
    for (let index = bucket - 1; index <= bucket + 1; index++) {
      const kept = occupied.get(index);
      if (kept && Math.abs(kept.time - marker.time) < spacing) neighbor = true;
    }
    if (!neighbor) { occupied.set(bucket, marker); selected.push(marker); }
  }
  return selected.sort((a, b) => a.time - b.time);
}

export function analyzeMusicPcm(
  samples: Float32Array, sampleRate: number, duration: number,
  onProgress?: (completed: number, total: number) => void,
): MusicAnalysisResult {
  if (!Number.isFinite(sampleRate) || sampleRate < 4_000 || sampleRate > 192_000) throw new Error("The decoded sample rate is not supported.");
  if (!Number.isFinite(duration) || duration < 0) throw new Error("The decoded duration is not supported.");
  const hop = Math.max(1, Math.round(sampleRate * 0.005));
  const size = Math.min(8192, 2 ** Math.ceil(Math.log2(sampleRate * 0.06)));
  const frames = Math.ceil(samples.length / hop);
  const plan = fftPlan(size);
  const bins = size / 2;
  const current = new Float32Array(bins);
  const history = Array.from({ length: 3 }, () => new Float32Array(bins));
  const currentPower = new Float32Array(bins);
  const powerHistory = Array.from({ length: 3 }, () => new Float32Array(bins));
  const lowFlux = new Float32Array(frames);
  const lowLogFlux = new Float32Array(frames);
  const highFlux = new Float32Array(frames);
  const midFlux = new Float32Array(frames);
  const broadbandPower = new Float32Array(frames);
  let peak = 0;
  for (let index = 0; index < samples.length; index++) {
    if (!Number.isFinite(samples[index])) throw new Error("The decoded audio contains invalid samples.");
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  const envelope = bassEnvelope(samples, sampleRate, hop, frames);
  const attacks = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    spectrum(samples, frame * hop, plan);
    let low = 0; let lowLog = 0; let high = 0; let middle = 0; let total = 0;
    const prior = history[(frame + 1) % 3];
    const priorPower = powerHistory[(frame + 1) % 3];
    for (let bin = 1; bin < bins; bin++) {
      const frequency = bin * sampleRate / size;
      const magnitude = Math.hypot(plan.real[bin], plan.imaginary[bin]) / size;
      current[bin] = Math.log1p(magnitude * 100);
      currentPower[bin] = magnitude * magnitude;
      total += magnitude * magnitude;
      // Neighborhood maxima reject small frequency changes in sustained voices/notes.
      const radius = frequency < 95 ? 0 : Math.max(1, Math.round(bin * 0.025));
      let background = prior[bin];
      for (let neighbor = Math.max(1, bin - radius); neighbor <= Math.min(bins - 1, bin + radius); neighbor++) background = Math.max(background, prior[neighbor]);
      const rise = Math.max(0, current[bin] - background);
      if (frequency >= 25 && frequency < 95) {
        lowLog += rise;
        low += Math.max(0, currentPower[bin] - priorPower[bin]);
      }
      else if (frequency < 1800) middle += rise;
      else if (frequency < Math.min(5500, sampleRate * 0.45)) high += rise;
    }
    history[frame % 3].set(current);
    powerHistory[frame % 3].set(currentPower);
    lowFlux[frame] = low;
    lowLogFlux[frame] = lowLog;
    midFlux[frame] = middle;
    highFlux[frame] = high;
    broadbandPower[frame] = total;
    if (frame % 200 === 0) onProgress?.(frame, Math.max(1, frames * 2));
  }
  const lowScale = Math.max(1e-8, percentile(lowFlux, 0.98));
  const lowLogScale = Math.max(1e-8, percentile(lowLogFlux, 0.98));
  const highScale = Math.max(1e-8, percentile(highFlux, 0.98));
  const midScale = Math.max(1e-8, percentile(midFlux, 0.98));
  const powerScale = Math.max(1e-10, percentile(broadbandPower, 0.95));
  for (let frame = 4; frame < frames; frame++) {
    const previous = (envelope[frame - 2] + envelope[frame - 3] + envelope[frame - 4]) / 3;
    attacks[frame] = Math.max(0, envelope[frame] - previous);
  }
  const envelopeScale = Math.max(1e-8, percentile(envelope, 0.95));
  const novelty = new Float32Array(frames);
  const prefix = new Float64Array(frames + 1);
  const squarePrefix = new Float64Array(frames + 1);
  for (let frame = 0; frame < frames; frame++) {
    novelty[frame] = lowFlux[frame] / lowScale * 0.6 + lowLogFlux[frame] / lowLogScale * 0.35 + highFlux[frame] / highScale * 0.035 + midFlux[frame] / midScale * 0.015;
    prefix[frame + 1] = prefix[frame] + novelty[frame];
    squarePrefix[frame + 1] = squarePrefix[frame] + novelty[frame] ** 2;
  }
  const candidates: MusicMarker[] = [];
  const radius = Math.round(0.6 * sampleRate / hop);
  const peakRadius = Math.max(1, Math.round(0.035 * sampleRate / hop));
  for (let frame = 2; frame < frames - 2; frame++) {
    if (frame % 200 === 0) onProgress?.(frames + frame, Math.max(1, frames * 2));
    const value = novelty[frame];
    let maximum = true;
    for (let index = Math.max(0, frame - peakRadius); index <= Math.min(frames - 1, frame + peakRadius); index++) {
      if (novelty[index] > value || (index > frame && novelty[index] === value)) { maximum = false; break; }
    }
    if (!maximum || value < 0.06 || broadbandPower[frame] < 1e-10) continue;
    const start = Math.max(0, frame - radius); const end = Math.min(frames, frame + radius + 1);
    const mean = (prefix[end] - prefix[start]) / (end - start);
    const deviation = Math.sqrt(Math.max(0, (squarePrefix[end] - squarePrefix[start]) / (end - start) - mean * mean));
    const z = (value - mean) / Math.max(0.03, deviation);
    let attackFrame = frame;
    for (let next = Math.max(4, frame - 5); next <= Math.min(frames - 1, frame + 12); next++) {
      if (attacks[next] > attacks[attackFrame]) attackFrame = next;
    }
    const bassActivity = clamp(envelope[attackFrame] / envelopeScale, 0, 1);
    const confidence = clamp((1 / (1 + Math.exp(-(z - 1.2))) * 0.8 + bassActivity * 0.2) * Math.min(1, 0.4 + Math.sqrt(bassActivity) * 1.5), 0, 1);
    const time = clamp(attackFrame * hop / sampleRate, 0, Math.min(duration, samples.length / sampleRate));
    candidates.push({ id: `auto-${frame}`, time, confidence, strength: clamp(value, 0, 1),
      energy: clamp(broadbandPower[frame] / powerScale, 0, 1.5), bassEnergy: bassActivity,
      kind: lowFlux[frame] / lowScale > highFlux[frame] / highScale ? "bass" : "impact", source: "automatic" });
  }
  const events: MusicMarker[] = [];
  for (const marker of candidates.sort((a, b) => a.time - b.time)) {
    const previous = events.at(-1);
    if (previous && marker.time - previous.time < 0.15) {
      const first = Math.max(0, Math.floor(previous.time * sampleRate / hop));
      const last = Math.min(frames - 1, Math.ceil(marker.time * sampleRate / hop));
      let valley = Infinity;
      for (let frame = first + 2; frame < last - 2; frame++) valley = Math.min(valley, envelope[frame]);
      const floor = Math.min(envelope[first], envelope[last]) * 0.4;
      if (valley > floor) {
        previous.confidence = Math.max(previous.confidence, marker.confidence);
        previous.strength = Math.max(previous.strength, marker.strength);
        continue;
      }
    }
    events.push(marker);
  }
  supportObservedRhythm(events);
  // Keep a clear attack front instead of a second, stronger part of the same
  // hit. Retain the later observation for the highest sensitivity/smallest gap.
  for (let index = 1; index < events.length; index++) {
    const previous = events[index - 1]; const current = events[index];
    if (previous.confidence >= 0.76 && current.confidence > previous.confidence
      && current.time - previous.time < 0.12 && previous.strength >= 0.9 && current.strength >= 0.9) {
      previous.confidence = current.confidence;
      current.confidence = Math.min(current.confidence, 0.6);
    }
  }
  const broad = selectMusicMarkers(events, 1, 0.06);
  let previousPeakTime = -1;
  for (const marker of broad) {
    const peakTime = marker.time;
    const peakFrame = Math.round(marker.time * sampleRate / hop);
    const minimumTime = Math.max(0, previousPeakTime + hop / sampleRate);
    const lookback = Math.min(Math.round(sampleRate * 0.08 / hop), Math.max(0, peakFrame - Math.ceil(minimumTime * sampleRate / hop)));
    const bassStart = attackStartFrame(envelope, peakFrame, lookback) * hop / sampleRate;
    marker.time = leadingTransientTime(samples, sampleRate, bassStart, peakTime, minimumTime);
    previousPeakTime = peakTime;
  }
  broad.sort((a, b) => a.time - b.time);
  const tempo = estimateTempo(selectMusicMarkers(broad, 0.68, 0.16));
  onProgress?.(Math.max(1, frames * 2), Math.max(1, frames * 2));
  return { candidates: broad, ...makeWaveform(samples), bpm: tempo.bpm, bpmConfidence: tempo.confidence,
    peakDb: peak ? 20 * Math.log10(peak) : -Infinity };
}

export function analyzeMusicRange(
  samples: Float32Array, sampleRate: number, duration: number, start: number, end: number,
  onProgress?: (completed: number, total: number) => void,
): MusicAnalysisResult {
  const availableDuration = Math.min(duration, samples.length / sampleRate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > availableDuration + 0.01 || end - start < 0.1) {
    throw new Error("Choose an analysis range of at least 0.1 seconds inside the song.");
  }
  const first = Math.max(0, Math.floor(start * sampleRate) - Math.round(sampleRate * 0.25));
  const last = Math.min(samples.length, Math.ceil(end * sampleRate) + Math.round(sampleRate * 0.25));
  const selected = samples.subarray(first, last);
  const result = analyzeMusicPcm(selected, sampleRate, selected.length / sampleRate, onProgress);
  result.candidates = result.candidates.map((m) => ({ ...m, time: m.time + first / sampleRate })).filter((m) => m.time >= start && m.time <= end);
  return first === 0 && last === samples.length ? result : { ...result, ...makeWaveform(samples) };
}
