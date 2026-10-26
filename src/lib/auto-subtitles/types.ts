export type SubtitleEngine = "gpu" | "cpu";

/** One timed line of speech, in seconds from the start of the source. */
export type SpeechSegment = {
  start: number;
  end: number;
  text: string;
};

export type SubtitleCue = SpeechSegment & {
  id: string;
};

export type AudioChunk = {
  start: number;
  end: number;
  silent: boolean;
};

export type SubtitleWorkerRequest =
  | {
    type: "transcribe";
    jobId: string;
    engine: SubtitleEngine;
    samples: ArrayBuffer;
    sampleRate: number;
    /** Source time of the first sample, when only part of the source is transcribed. */
    offset: number;
  };

export type SubtitleWorkerResponse =
  | { type: "model-progress"; jobId: string; loaded: number; total: number }
  | { type: "model-ready"; jobId: string; engine: SubtitleEngine }
  | { type: "progress"; jobId: string; completed: number; total: number; segments: SpeechSegment[] }
  | { type: "result"; jobId: string; segments: SpeechSegment[] }
  | { type: "error"; jobId: string; message: string };
