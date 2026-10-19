/// <reference lib="webworker" />

import { analyzeMusicRange } from "@/lib/music-bass-markers/analysis";
import type { MusicAnalysisWorkerRequest, MusicAnalysisWorkerResponse } from "@/lib/music-bass-markers/types";

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<MusicAnalysisWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "analyze") return;

  try {
    let lastProgressAt = 0;
    const samples = new Float32Array(request.samples);
    const result = analyzeMusicRange(
      samples,
      request.sampleRate,
      request.duration,
      request.analysisStart,
      request.analysisEnd,
      (completed, total) => {
        const now = performance.now();
        if (completed < total && now - lastProgressAt < 80) return;
        lastProgressAt = now;
        const response: MusicAnalysisWorkerResponse = { type: "progress", jobId: request.jobId, completed, total };
        workerScope.postMessage(response);
      },
    );
    const response: MusicAnalysisWorkerResponse = { type: "result", jobId: request.jobId, ...result };
    workerScope.postMessage(response, [result.waveform.buffer]);
  } catch (error) {
    const response: MusicAnalysisWorkerResponse = {
      type: "error",
      jobId: request.jobId,
      message: error instanceof Error ? error.message : "Audio analysis failed.",
    };
    workerScope.postMessage(response);
  }
};

export {};
