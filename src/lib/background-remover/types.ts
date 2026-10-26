export type RemoverEngine = "gpu" | "cpu";

export type RemoverWorkerRequest = {
  type: "remove";
  jobId: string;
  engine: RemoverEngine;
  pixels: ArrayBuffer;
  width: number;
  height: number;
};

export type RemoverWorkerResponse =
  | { type: "model-progress"; jobId: string; loaded: number; total: number }
  | { type: "processing"; jobId: string }
  | { type: "result"; jobId: string; mask: ArrayBuffer; width: number; height: number; seconds: number }
  | { type: "error"; jobId: string; message: string };
