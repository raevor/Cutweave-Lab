/// <reference lib="webworker" />

import {
  env,
  LogitsProcessor,
  LogitsProcessorList,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
  type Tensor,
} from "@huggingface/transformers";
import { planAudioChunks } from "@/lib/auto-subtitles/chunking";
import { assignWordsToLines, splitAtPauses, type TimedWord } from "@/lib/auto-subtitles/words";
import { normalizeSegments } from "@/lib/auto-subtitles/cues";
import {
  filterSegments,
  isSilenceWindow,
  LOW_LOGPROB,
  loopingKeys,
  loopStartsConfidently,
  normalizeForCompare,
  type ScoredSegment,
} from "@/lib/auto-subtitles/quality";
import type { SubtitleEngine, SubtitleWorkerRequest, SubtitleWorkerResponse } from "@/lib/auto-subtitles/types";

const workerScope = self as DedicatedWorkerGlobalScope;

/**
 * English-only Whisper base, exported with cross-attention outputs so every word
 * gets its own time. The revision is pinned so every visitor gets the same weights.
 */
const MODEL_ID = "onnx-community/whisper-base.en_timestamped";
const MODEL_REVISION = "fa239a41836c3305f6beec180e5940f3823ff5b8";
/** Special tokens of the English-only Whisper vocabulary. */
const NO_CAPTIONS_TOKEN = 50361;
const END_OF_TEXT_TOKEN = 50256;
const FIRST_TIMESTAMP_TOKEN = 50363;

// Only model files come from Hugging Face. The runtime is served by this site.
env.allowLocalModels = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL("/wasm/auto-subtitles/ort-wasm-simd-threaded.asyncify.mjs", workerScope.location.origin).href,
    wasm: new URL("/wasm/auto-subtitles/ort-wasm-simd-threaded.asyncify.wasm", workerScope.location.origin).href,
  };
}

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let loadedEngine: SubtitleEngine | null = null;
let suppressTokens: number[] = [];

function post(response: SubtitleWorkerResponse) {
  workerScope.postMessage(response);
}

function logSoftmax(logits: Float32Array) {
  let max = Number.NEGATIVE_INFINITY;
  for (const value of logits) if (value > max) max = value;
  let sum = 0;
  for (const value of logits) sum += Math.exp(value - max);
  const offset = max + Math.log(sum);
  const result = new Float32Array(logits.length);
  for (let index = 0; index < logits.length; index += 1) result[index] = logits[index] - offset;
  return result;
}

/**
 * Records how sure Whisper is while it decodes: the probability of "no speech" at
 * the first step, and the log-probability of every token it then chooses. The
 * transformers.js pipeline returns only text, so this is the only way to see it.
 */
class ConfidenceProbe extends LogitsProcessor {
  noSpeech = 0;
  tokens: number[] = [];
  logprobs: number[] = [];
  private initLength: number | null = null;
  private previous: Float32Array | null = null;

  _call(inputIds: bigint[][], logits: Tensor) {
    const ids = inputIds[0];
    const data = (logits as unknown as Tensor[])[0].data as Float32Array;
    const logprobs = logSoftmax(data);
    this.initLength ??= ids.length;
    if (ids.length <= this.initLength) {
      // A new decoding pass starts; only the first one decides whether the window is silent.
      if (!this.tokens.length) this.noSpeech = Math.exp(logprobs[NO_CAPTIONS_TOKEN]);
    } else if (this.previous) {
      const token = Number(ids[ids.length - 1]);
      this.tokens.push(token);
      this.logprobs.push(this.previous[token]);
    }
    this.previous = logprobs;
    // The token is only measured, never chosen: this keeps the model's normal output.
    data[NO_CAPTIONS_TOKEN] = Number.NEGATIVE_INFINITY;
    return logits;
  }

  /** Average log-probability of the text tokens, overall and per timestamped line. */
  summary(decode: (tokens: number[]) => string) {
    const lines: Array<{ key: string; logprob: number }> = [];
    let group: number[] = [];
    let groupLogprob = 0;
    let textCount = 0;
    let textSum = 0;
    const flush = () => {
      if (group.length) lines.push({ key: normalizeForCompare(decode(group)), logprob: groupLogprob / group.length });
      group = [];
      groupLogprob = 0;
    };
    this.tokens.forEach((token, index) => {
      if (token >= FIRST_TIMESTAMP_TOKEN) flush();
      else if (token < END_OF_TEXT_TOKEN) {
        group.push(token);
        groupLogprob += this.logprobs[index];
        textSum += this.logprobs[index];
        textCount += 1;
      }
    });
    flush();
    return { noSpeech: this.noSpeech, logprob: textCount ? textSum / textCount : 0, lines };
  }
}

async function loadTranscriber(engine: SubtitleEngine, jobId: string) {
  if (transcriber && loadedEngine === engine) return transcriber;
  await transcriber?.dispose();
  transcriber = null;

  const files = new Map<string, { loaded: number; total: number }>();
  let lastProgressAt = 0;
  const onProgress = (info: ProgressInfo) => {
    if (info.status !== "progress") return;
    files.set(info.file, { loaded: info.loaded, total: info.total });
    const now = performance.now();
    if (now - lastProgressAt < 120) return;
    lastProgressAt = now;
    let loaded = 0;
    let total = 0;
    files.forEach((file) => { loaded += file.loaded; total += file.total; });
    post({ type: "model-progress", jobId, loaded, total });
  };

  transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
    revision: MODEL_REVISION,
    device: engine === "gpu" ? "webgpu" : "wasm",
    // The GPU path keeps the encoder at full precision, as the WebGPU Whisper reference does.
    dtype: engine === "gpu"
      ? { encoder_model: "fp32", decoder_model_merged: "q4" }
      : { encoder_model: "q8", decoder_model_merged: "q8" },
    progress_callback: onProgress,
  }) as AutomaticSpeechRecognitionPipeline;
  const config = (transcriber.model as unknown as { generation_config?: { suppress_tokens?: number[] } }).generation_config;
  // "No captions" stays measurable; the probe suppresses it after reading it.
  suppressTokens = (config?.suppress_tokens ?? []).filter((token) => token !== NO_CAPTIONS_TOKEN);
  loadedEngine = engine;
  post({ type: "model-ready", jobId, engine });
  return transcriber;
}

async function decodeWindow(model: AutomaticSpeechRecognitionPipeline, audio: Float32Array) {
  const probe = new ConfidenceProbe();
  const processors = new LogitsProcessorList();
  processors.push(probe);
  const output = await model(audio, {
    return_timestamps: "word",
    // Both reach Whisper's generate() through the pipeline's options.
    ...({ logits_processor: processors, suppress_tokens: suppressTokens } as object),
  });
  const result = Array.isArray(output) ? output[0] : output;
  const chunks: Array<{ timestamp: [number, number | null]; text: string }> = result.chunks ?? [];
  const words: TimedWord[] = chunks.map((chunk) => ({ text: chunk.text, start: chunk.timestamp[0], end: chunk.timestamp[1] ?? chunk.timestamp[0] }));
  const decode = (tokens: number[]) => model.tokenizer.decode(tokens, { skip_special_tokens: true });
  return { words, confidence: probe.summary(decode) };
}

/*
 * One greedy pass per window keeps the result deterministic: the same file always
 * gives the same subtitles. Sampling retries were tried and invented new lines.
 */
/** Whisper can stop after a few words of a window; the rest is listened to again from there. */
const RESUME_AFTER_SECONDS = 2;
const MAX_RESUMES = 2;

async function transcribeWindow(model: AutomaticSpeechRecognitionPipeline, audio: Float32Array, sampleRate: number, start: number, end: number, resumes = 0): Promise<ScoredSegment[]> {
  const scored = await scoreWindow(model, audio, start, end);
  const { lastWordEnd } = scored;
  // A resumed tail is often music after the last line, so only confident lines count there.
  const segments = resumes ? scored.segments.filter((segment) => segment.logprob === undefined || segment.logprob >= LOW_LOGPROB) : scored.segments;
  const duration = audio.length / sampleRate;
  if (!scored.segments.length || resumes >= MAX_RESUMES || duration - lastWordEnd <= RESUME_AFTER_SECONDS) return segments;
  const rest = audio.subarray(Math.ceil(lastWordEnd * sampleRate));
  return [...segments, ...await transcribeWindow(model, rest, sampleRate, start + lastWordEnd, end, resumes + 1)];
}

async function scoreWindow(model: AutomaticSpeechRecognitionPipeline, audio: Float32Array, start: number, end: number): Promise<{ segments: ScoredSegment[]; lastWordEnd: number }> {
  const { words, confidence } = await decodeWindow(model, audio);
  const lastWordEnd = words.reduce((latest, word) => Math.max(latest, word.end), 0);
  const none = { segments: [], lastWordEnd };
  if (isSilenceWindow(confidence.noSpeech, confidence.logprob)) return none;
  const { lines } = confidence;
  const groups = assignWordsToLines(lines.map((line) => line.key), words);
  // If the words cannot be matched to lines, time the whole window by its words with its average confidence.
  if (!groups) {
    if (!loopStartsConfidently(lines)) return none;
    return { segments: normalizeSegments(splitAtPauses(words, 0), start, end).map((segment) => ({ ...segment, logprob: confidence.logprob })), lastWordEnd };
  }

  // A loop that began unsure was invented: drop it and judge the rest of the window strictly.
  const invented = loopStartsConfidently(lines) ? new Set<string>() : loopingKeys(lines);
  // When the invented loop is most of the window, its leftovers ("I'm going to") are invented too.
  if (invented.size && lines.filter((line) => invented.has(line.key)).length * 2 >= lines.length) return none;
  const scored: ScoredSegment[] = [];
  lines.forEach((line, index) => {
    if (invented.has(line.key) || (invented.size && line.logprob < LOW_LOGPROB)) return;
    // Each line starts on its first spoken word and splits where the speaker pauses.
    for (const segment of normalizeSegments(splitAtPauses(groups[index], 0), start, end)) scored.push({ ...segment, logprob: line.logprob });
  });
  return { segments: scored, lastWordEnd };
}

async function transcribe(request: Extract<SubtitleWorkerRequest, { type: "transcribe" }>) {
  const samples = new Float32Array(request.samples);
  const model = await loadTranscriber(request.engine, request.jobId);
  const chunks = planAudioChunks(samples, request.sampleRate);
  const scored: ScoredSegment[] = [];
  post({ type: "progress", jobId: request.jobId, completed: 0, total: chunks.length, segments: [] });

  for (const [index, chunk] of chunks.entries()) {
    let found: ScoredSegment[] = [];
    if (!chunk.silent) {
      const audio = samples.subarray(Math.round(chunk.start * request.sampleRate), Math.round(chunk.end * request.sampleRate));
      found = await transcribeWindow(model, audio, request.sampleRate, request.offset + chunk.start, request.offset + chunk.end);
      scored.push(...found);
    }
    post({ type: "progress", jobId: request.jobId, completed: index + 1, total: chunks.length, segments: filterSegments(found) });
  }

  post({ type: "result", jobId: request.jobId, segments: filterSegments(scored) });
}

workerScope.onmessage = (event: MessageEvent<SubtitleWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "transcribe") return;
  transcribe(request).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    post({
      type: "error",
      jobId: request.jobId,
      message: /fetch|network|load/i.test(message)
        ? "The speech model could not be downloaded. Check the connection and try again; your file was not sent anywhere."
        : `Transcription stopped: ${message}`,
    });
  });
};

export {};
