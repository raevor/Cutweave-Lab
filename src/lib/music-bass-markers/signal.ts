// Ordinary stereo is averaged. Destructively out-of-phase stereo keeps the
// strongest channel instead of erasing the music from the analysis signal.
export function chooseAnalysisChannel(channels: Float32Array[]): number | null {
  if (channels.length <= 1) return null;
  const length = Math.min(...channels.map((channel) => channel.length));
  const stride = Math.max(1, Math.floor(length / 20_000));
  const energy = new Float64Array(channels.length);
  let mixedEnergy = 0;
  for (let index = 0; index < length; index += stride) {
    let mixed = 0;
    for (let channel = 0; channel < channels.length; channel++) {
      const value = channels[channel][index];
      energy[channel] += value * value;
      mixed += value;
    }
    mixedEnergy += (mixed / channels.length) ** 2;
  }
  let strongest = 0;
  for (let channel = 1; channel < channels.length; channel++) if (energy[channel] > energy[strongest]) strongest = channel;
  return energy[strongest] > 1e-10 && mixedEnergy < energy[strongest] * 0.05 ? strongest : null;
}

// Compatibility fallback when native offline resampling is unavailable. A
// cascaded low-pass runs before decimation, with state carried between chunks.
export function createAnalysisResampler(channels: Float32Array[], sourceRate: number, targetRate: number) {
  const selected = chooseAnalysisChannel(channels);
  const ratio = sourceRate / targetRate;
  const alpha = 1 - Math.exp(-2 * Math.PI * Math.min(sourceRate * 0.45, targetRate * 0.32) / sourceRate);
  const stages = new Float64Array(6);
  let cursor = -1; let previous = 0; let current = 0;
  return (output: Float32Array, start: number, end: number) => {
    for (let index = start; index < end; index++) {
      const position = index * ratio;
      const before = Math.floor(position);
      while (cursor <= before) {
        cursor++;
        let mixed = 0;
        if (selected !== null) mixed = channels[selected][cursor] ?? 0;
        else {
          for (const channel of channels) mixed += channel[cursor] ?? 0;
          mixed /= Math.max(1, channels.length);
        }
        let value = mixed;
        if (sourceRate > targetRate) {
          for (let stage = 0; stage < stages.length; stage++) {
            stages[stage] += alpha * (value - stages[stage]); value = stages[stage];
          }
        }
        previous = current; current = value;
      }
      output[index] = previous * (1 - (position - before)) + current * (position - before);
    }
  };
}
