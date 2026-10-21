export type FaceEngine = "gpu" | "cpu";
export type FaceScanMode = "coarse" | "verify";
export type FaceScanProfile = "efficient" | "maximum";

export type VisualFingerprint = {
  luma: number[];
  histogram: number[];
  layout: number[];
  hash?: string;
};

export type FaceWorkerRequest =
  | { type: "init"; requestId: number; engine: FaceEngine; origin: string }
  /* `restore` reloads a reference the user already accepted (engine switch, removal, scan start); it skips the same-person gate. */
  | { type: "reference"; requestId: number; slot: number; bitmap: ImageBitmap; restore?: boolean }
  | { type: "scan"; requestId: number; jobId: string; timestamp: number; threshold: number; mode: FaceScanMode; bitmap: ImageBitmap }
  | { type: "cancel"; jobId: string }
  | { type: "clear-references"; requestId: number };

export type FaceWorkerResponse =
  | { type: "ready"; requestId: number; engine: FaceEngine; backend: string }
  | { type: "reference-ready"; requestId: number; slot: number; faceCount: number; box: [number, number, number, number]; agreement: number }
  | { type: "scan-result"; requestId: number; jobId: string; timestamp: number; similarity: number; weakestSimilarity: number; referenceHits: number; faceCount: number; faceQuality: number }
  | { type: "references-cleared"; requestId: number }
  | { type: "cancelled"; jobId: string }
  | { type: "error"; requestId?: number; jobId?: string; message: string };

export type ScanSample = {
  timestamp: number;
  similarity: number;
  weakestSimilarity: number;
  referenceHits: number;
  faceCount: number;
  faceQuality: number;
  visualHash?: string;
  visualFingerprint?: VisualFingerprint;
  visualContext?: VisualFingerprint[];
  narrativeScene?: number;
  verificationCount?: number;
  verificationTotal?: number;
};

export type SceneMatch = {
  id: string;
  start: number;
  end: number;
  center: number;
  similarity: number;
  visualHash?: string;
  verificationCount?: number;
  verificationTotal?: number;
  thumbnailUrl?: string;
};
