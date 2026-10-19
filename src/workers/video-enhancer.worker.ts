import type { EnhancerWorkerRequest, EnhancerWorkerResponse } from "@/lib/video-enhancer/types";
import { GpuWorkerClient } from "@/lib/video-enhancer/gpu-worker-client";
import { SDR_VIDEO_COLOR_SPACE } from "@/lib/video-enhancer/color";
import { yieldToWorker } from "@/lib/video-enhancer/worker-yield";

const scope = self as DedicatedWorkerGlobalScope;
let activePreview: string | null = null;
let exportJob: string | null = null;
let cancelExport: (() => void) | null = null;
let cancelled = false;
let queue = Promise.resolve();
const gpuProcessor=new GpuWorkerClient();
type PreviewRequest=Extract<EnhancerWorkerRequest,{type:"preview"}>;
let pendingPreview:PreviewRequest|null=null;
let previewDrainScheduled=false;
function post(message: EnhancerWorkerResponse, transfer: Transferable[] = []) { scope.postMessage(message, transfer); }

async function drainPreviews() {
  try {
    while(pendingPreview) {
      const request=pendingPreview;pendingPreview=null;
      try {
        if(activePreview!==request.jobId||exportJob)continue;
        const started=performance.now();
        const result=await gpuProcessor.render({jobId:request.jobId,source:request.bitmap,width:request.width,height:request.height,
          settings:request.settings,preview:true,frameKey:request.frameKey,timestamp:0,duration:0});
        if(result.type!=="bitmap")throw new Error("The GPU preview did not return a picture.");
        const bitmap=result.bitmap;
        if(activePreview!==request.jobId){bitmap.close();continue;}
        post({type:"preview",jobId:request.jobId,bitmap,elapsedMs:performance.now()-started},[bitmap]);
      } catch(error) {
        if(activePreview===request.jobId)post({type:"error",jobId:request.jobId,message:error instanceof Error ? error.message : "Preview failed."});
      } finally {request.bitmap.close();}
    }
  } finally {previewDrainScheduled=false;}
}

async function exportVideo(request: Extract<EnhancerWorkerRequest, {type: "export"}>) {
  const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, ConversionCanceledError, Input, Mp4OutputFormat, Output, Quality, StreamTarget } = await import("mediabunny");
  const input = new Input({formats: ALL_FORMATS, source: new BlobSource(request.file)});
  let writable: FileSystemWritableFileStream | null = null;
  let output: InstanceType<typeof Output> | null = null;
  let releasedGpu=false;
  try {
    if (cancelled) throw new DOMException("Cancelled", "AbortError");
    writable = request.fileHandle ? await request.fileHandle.createWritable() : null;
    const writer = writable;
    const target = writer ? new StreamTarget(new WritableStream({
      write: (chunk) => writer.write({type: "write", position: chunk.position, data: chunk.data}),
      close: () => writer.close(), abort: () => writer.abort(),
    })) : new BufferTarget();
    output = new Output({format: new Mp4OutputFormat({fastStart: writer ? false : "in-memory"}), target});
    const started=performance.now();
    let frame=0,lastActivity=0,lastStage="";
    post({type:"activity",jobId:request.jobId,frame:0,activity:{stage:"preparing"}});
    const conversion = await Conversion.init({
      input, output, tracks: "primary",
      video: {
        codec: "avc", fit: "fill", processedWidth: request.width, processedHeight: request.height,
        quality: new Quality("high"), hardwareAcceleration: request.device === "gpu" ? "prefer-hardware" : "no-preference",
        process: async (sample) => {
          await yieldToWorker();
          if (cancelled) throw new DOMException("Cancelled", "AbortError");
          frame++;
          const result=await gpuProcessor.render({jobId:request.jobId,source:sample.toVideoFrame(),width:request.width,height:request.height,
            settings:request.settings,preview:false,timestamp:sample.timestamp,duration:sample.duration},activity=>{
            if(cancelled)return;
            const now=performance.now();
            if(activity.stage!==lastStage||now-lastActivity>=150||(activity.totalTiles!==undefined&&activity.completedTiles===activity.totalTiles)){
              lastActivity=now;lastStage=activity.stage;
              post({type:"activity",jobId:request.jobId,frame,activity});
            }
          });
          if(result.type!=="frame")throw new Error("The GPU processor did not return a video frame.");
          return result.frame;
        },
      },
      audio: {codec: "aac"}, showWarnings: false,
    });
    if (!conversion.isValid || conversion.discardedTracks.some((track) => ["unknown_source_codec", "undecodable_source_codec", "no_encodable_target_codec"].includes(track.reason))) {
      throw new Error("This browser cannot export the picture or audio track. Try Chrome or Edge with an MP4 source.");
    }
    cancelExport = () => { void conversion.cancel(); };
    conversion.onProgress = (fraction) => { if (!cancelled) post({type: "progress", jobId: request.jobId, fraction}); };
    if (cancelled) throw new DOMException("Cancelled", "AbortError");
    await conversion.execute();
    if (cancelled) throw new DOMException("Cancelled", "AbortError");
    // Finish session/buffer teardown before announcing completion or allowing
    // the queued post-export preview to initialize another GPU session.
    await gpuProcessor.release();
    releasedGpu=true;
    if (cancelled) throw new DOMException("Cancelled", "AbortError");
    const buffer = target instanceof BufferTarget ? target.buffer ?? undefined : undefined;
    post({type: "complete", jobId: request.jobId, buffer,elapsedMs:performance.now()-started,frames:frame}, buffer ? [buffer] : []);
  } catch (error) {
    await output?.cancel().catch(() => undefined);
    if (writable) await writable.abort().catch(() => undefined);
    if (cancelled || error instanceof ConversionCanceledError || error instanceof DOMException && error.name === "AbortError") post({type: "cancelled", jobId: request.jobId});
    else post({type: "error", jobId: request.jobId, message: error instanceof Error ? error.message : "Export failed."});
  } finally {
    try{if(!releasedGpu)await gpuProcessor.release();}catch{/* Preserve the primary export outcome. */}
    input.dispose(); exportJob = null; cancelExport = null; cancelled = false;
  }
}

scope.onmessage = (event: MessageEvent<EnhancerWorkerRequest>) => {
  const request = event.data;
  if (request.type === "capabilities") {
    let gpu = false;const cpu=false;
    try{gpu=!!new OffscreenCanvas(2,2).getContext("webgpu");}catch{/* Original preview remains available. */}
    let videoExport=typeof VideoDecoder!=="undefined"&&typeof VideoEncoder!=="undefined"&&typeof VideoFrame!=="undefined";
    if(videoExport) {
      try {
        const frame=new VideoFrame(new Uint8Array([16,16,16,16,128,128]),{format:"NV12",codedWidth:2,codedHeight:2,timestamp:0,colorSpace:SDR_VIDEO_COLOR_SPACE});
        frame.close();
      } catch {videoExport=false;}
    }
    void (async()=>{
      try {const adapter=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});gpu=gpu&&!!adapter&&!adapter.isFallbackAdapter;}catch{gpu=false;}
      post({type:"capabilities",gpu,cpu,export:videoExport});
    })();
    return;
  }
  if((request.type==="preview"||request.type==="export")&&request.device!=="gpu"){
    if(request.type==="preview")request.bitmap.close();
    post({type:"error",jobId:request.jobId,message:"CPU-only enhancement is disabled. A compatible GPU is required."});return;
  }
  if (request.type === "cancel") {
    gpuProcessor.cancel(request.jobId);
    if (activePreview === request.jobId) activePreview = null;
    if(pendingPreview?.jobId===request.jobId){pendingPreview.bitmap.close();pendingPreview=null;}
    if (exportJob === request.jobId) { cancelled = true; cancelExport?.(); }
    return;
  }
  if (request.type === "export") {
    if (exportJob) { post({type: "error", jobId: request.jobId, message: "An export is already running."}); return; }
    if(activePreview)gpuProcessor.cancel(activePreview);
    exportJob = request.jobId; activePreview = null; cancelled = false;
    pendingPreview?.bitmap.close();pendingPreview=null;
    queue = queue.then(() => exportVideo(request)).catch((error: unknown) => {
      exportJob = null; cancelExport = null; cancelled = false;
      post({type: "error", jobId: request.jobId, message: error instanceof Error ? error.message : "Export failed."});
    });
    return;
  }
  if(exportJob){request.bitmap.close();return;}
  if(activePreview&&activePreview!==request.jobId)gpuProcessor.cancel(activePreview);
  activePreview = request.jobId;
  // Keep one queued bitmap, including during a cold model download. A long
  // slider/seek burst cannot build a promise chain retaining hundreds of frames.
  pendingPreview?.bitmap.close();pendingPreview=request;
  if(!previewDrainScheduled){previewDrainScheduled=true;queue=queue.then(drainPreviews);}
};
