export type MusicMarkerKind = "impact" | "bass" | "manual";

export type MusicMarker = {
  id: string;
  time: number;
  confidence: number;
  strength: number;
  energy?: number;
  bassEnergy?: number;
  kind: MusicMarkerKind;
  source: "automatic" | "manual";
};

export type MusicAnalysisResult = {
  candidates: MusicMarker[];
  waveform: Float32Array;
  waveformBins: number;
  bpm: number | null;
  bpmConfidence: number;
  peakDb: number;
};

export type MusicAnalysisWorkerRequest = {
  type: "analyze";
  jobId: string;
  samples: ArrayBuffer;
  sampleRate: number;
  duration: number;
  analysisStart: number;
  analysisEnd: number;
};

export type MusicAnalysisWorkerResponse =
  | { type: "progress"; jobId: string; completed: number; total: number }
  | ({ type: "result"; jobId: string } & MusicAnalysisResult)
  | { type: "error"; jobId: string; message: string };
