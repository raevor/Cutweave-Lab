// Local-only diagnostic. Reference markers are a comparison, not human ground truth.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const args = process.argv.slice(2);
const ffmpeg = args.shift();
const reportIndex = args.indexOf("--report");
const reportPath = reportIndex < 0 ? null : args.splice(reportIndex, 2)[1];
if (!ffmpeg || !args.length || args.length % 2) {
  throw new Error("Usage: node scripts/compare-music-markers.mjs <ffmpeg> <ours.wav> <reference.mp3> [...] [--report path.json]");
}
if (reportPath && (path.extname(reportPath).toLowerCase() !== ".json" || args.some((input) => path.resolve(input) === path.resolve(reportPath)))) {
  throw new Error("The optional report must be a separate JSON file, not an audio source.");
}
const source = fs.readFileSync("src/lib/music-bass-markers/analysis.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { analyzeMusicPcm, selectMusicMarkers } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
function markers(path) {
  const bytes = fs.readFileSync(path);
  const text = bytes.toString("utf8");
  const rate = Number(text.match(/xmpDM:frameRate(?:="|>)(?:f)(\d+)/)?.[1]);
  const times = [...text.matchAll(/xmpDM:startTime(?:="|>)(\d+)/g)].map((m) => Number(m[1]) / rate);
  if (!rate || !times.length) throw new Error(`No supported XMP markers in ${path}`);
  return times;
}
function decode(path) {
  const result = spawnSync(ffmpeg, ["-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "12000", "pipe:1"], { maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr?.toString() || "Decode failed");
  return new Float32Array(result.stdout.buffer.slice(result.stdout.byteOffset, result.stdout.byteOffset + result.stdout.length));
}
function match(actual, expected, tolerance) {
  let a = 0; let e = 0; const errors = [];
  while (a < actual.length && e < expected.length) {
    const error = actual[a] - expected[e];
    if (Math.abs(error) <= tolerance) { errors.push(error); a++; e++; }
    else if (error < 0) a++;
    else e++;
  }
  const count = errors.length;
  return { matched: count, extra: actual.length - count, missed: expected.length - count,
    agreementF1: Number((2 * count / Math.max(1, actual.length + expected.length)).toFixed(3)),
    medianErrorMs: errors.length ? Math.round([...errors].sort((a, b) => a - b)[Math.floor(errors.length / 2)] * 1000) : null };
}
function audioAlignment(a, b) {
  let best = -Infinity; let shift = 0;
  for (let lag = -1800; lag <= 1800; lag += 6) {
    let product = 0; let aa = 0; let bb = 0;
    for (let i = 2400; i < Math.min(a.length, b.length) - 2400; i += 11) {
      const x = a[i]; const y = b[i + lag]; product += x * y; aa += x * x; bb += y * y;
    }
    const score = product / Math.max(1e-12, Math.sqrt(aa * bb));
    if (score > best) { best = score; shift = lag / 12000; }
  }
  return { referenceAudioOffset: shift, correlation: Number(best.toFixed(3)) };
}
const reports = [];
for (let pair = 0; pair < args.length; pair += 2) {
  const ours = args[pair]; const reference = args[pair + 1];
  const pcm = decode(ours); const other = decode(reference);
  const alignment = audioAlignment(pcm, other);
  const referenceTimes = markers(reference).map((time) => time - alignment.referenceAudioOffset);
  const started = performance.now();
  const analysis = analyzeMusicPcm(pcm, 12000, pcm.length / 12000);
  const current = selectMusicMarkers(analysis.candidates, 0.68, 0.16);
  const exported = markers(ours);
  const entry = { pair: pair / 2 + 1, duration: pcm.length / 12000, ...alignment,
    referenceCount: referenceTimes.length, exportedCount: exported.length, currentCount: current.length,
    analysisMs: Math.round(performance.now() - started),
    exported50ms: match(exported, referenceTimes, 0.05),
    current25ms: match(current.map((m) => m.time), referenceTimes, 0.025),
    current50ms: match(current.map((m) => m.time), referenceTimes, 0.05),
    current100ms: match(current.map((m) => m.time), referenceTimes, 0.1),
    referenceTimes, exportedTimes: exported, currentTimes: current.map((m) => m.time), candidates: analysis.candidates };
  reports.push(entry);
  const { referenceTimes: r, exportedTimes: e, currentTimes: c, candidates: k, ...summary } = entry;
  void r; void e; void c; void k;
  console.log(JSON.stringify(summary));
}
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(reports, null, 2));
