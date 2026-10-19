export type EnhancerDevice = "gpu" | "cpu";
export type EnhancerActivity={stage:"preparing"|"restoring"|"finishing";completedTiles?:number;totalTiles?:number};
export type EnhancerActivityCallback=(activity:EnhancerActivity)=>void;

export type EnhancerSettings = {
  denoise: number;
  detail: number;
  /** Independent output sharpening; absent in older saved/test settings = off. */
  sharpen?: number;
  scale: 1 | 2;
};

export type EnhancerWorkerRequest =
  | { type: "capabilities" }
  | { type: "preview"; jobId: string; bitmap: ImageBitmap; device: EnhancerDevice; settings: EnhancerSettings; width: number; height: number; frameKey?: string }
  | { type: "export"; jobId: string; file: File; device: EnhancerDevice; settings: EnhancerSettings; width: number; height: number; fileHandle?: FileSystemFileHandle }
  | { type: "cancel"; jobId: string };

export type EnhancerWorkerResponse =
  | { type: "capabilities"; gpu: boolean; cpu: boolean; export: boolean }
  | { type: "preview"; jobId: string; bitmap: ImageBitmap; elapsedMs: number }
  | { type: "progress"; jobId: string; fraction: number }
  | { type: "activity"; jobId:string; frame:number; activity:EnhancerActivity }
  | { type: "complete"; jobId: string; buffer?: ArrayBuffer;elapsedMs?:number;frames?:number }
  | { type: "cancelled"; jobId: string }
  | { type: "error"; jobId: string; message: string };
