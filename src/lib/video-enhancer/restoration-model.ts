import * as ort from "onnxruntime-web/webgpu";
import type { EnhancerDevice } from "./types";
import { RestorationGpuProcessor, configureRestorationGpu, requestRestorationGpuDevice } from "./restoration-gpu";
import { RESTORATION_TILE_PAD, restorationInputSize, restorationTileShape } from "./restoration-plan";

// FSRCNN reconstructs luma with a narrow 12-channel body (8,497 parameters).
// Source chroma is carried separately; this is not a full-width RGB GAN.
let session: ort.InferenceSession | null = null;
let provider: EnhancerDevice | null = null;
let loading: Promise<ort.InferenceSession> | null = null;
let cpuRuntime: typeof ort | null = null;
let forcedFull = false;
let sessionShape = "";

async function getSession(device: EnhancerDevice,shape:string,forceFullPrecision=false) {
  if (session && provider === device && forcedFull===forceFullPrecision && sessionShape===shape) return session;
  if (loading) return loading;
  loading = (async () => {
    if (session) { await session.release(); session = null; provider = null; }
    if (device === "cpu") cpuRuntime ??= await import("onnxruntime-web/wasm");
    const runtime = device === "cpu" ? cpuRuntime! : ort;
    runtime.env.wasm.wasmPaths = `${self.location.origin}/wasm/video-enhancer/`;
    runtime.env.wasm.proxy = false;
    runtime.env.wasm.initTimeout = 60_000;
    runtime.env.wasm.numThreads = device === "cpu" && self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 1) : 1;
    const supportsHalf = device === "gpu" && await configureRestorationGpu();
    const half = supportsHalf && !forceFullPrecision;
    const url = `${self.location.origin}/models/video-enhancer/fsrcnn-2x${half ? "-fp16" : ""}.onnx`;
    const [tileWidth,tileHeight]=shape.split(":").map(Number);
    const options: ort.InferenceSession.SessionOptions = device === "gpu"
      ? { executionProviders: [{name:"webgpu", preferredLayout:"NHWC", storageBufferCacheMode:"simple"}], preferredOutputLocation:"gpu-buffer", graphOptimizationLevel:"all", freeDimensionOverrides:{height:tileHeight,width:tileWidth}, extra:{session:{disable_cpu_ep_fallback:"1"}} }
      : { executionProviders:["wasm"], graphOptimizationLevel:"all" };
    session = await runtime.InferenceSession.create(url, options);
    provider = device;
    forcedFull = forceFullPrecision;
    sessionShape = shape;
    return session;
  })();
  try { return await loading; } finally { loading = null; }
}

export class LearnedFrameRestorer {
  readonly sourceCanvas = new OffscreenCanvas(1, 1);
  private sourceContext: OffscreenCanvasRenderingContext2D;
  private gpu: RestorationGpuProcessor | null = null;
  private gpuKey = "";
  private cpuOutput: OffscreenCanvas | null = null;
  private cpuPixels: ImageData | null = null;
  private cpuTensorData: Float32Array | null = null;

  constructor(readonly device: EnhancerDevice, readonly outputWidth: number, readonly outputHeight: number,readonly forceFullPrecision=false) {
    const context = this.sourceCanvas.getContext("2d", {alpha:false, colorSpace:"srgb", willReadFrequently:device === "cpu"});
    if (!context) throw new Error("Local frame capture is unavailable.");
    this.sourceContext = context;
  }

  async render(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, shouldCancel: () => boolean) {
    const size = restorationInputSize(sourceWidth,sourceHeight,this.outputWidth,this.outputHeight);
    if (this.sourceCanvas.width !== size.width || this.sourceCanvas.height !== size.height) {
      this.sourceCanvas.width = size.width; this.sourceCanvas.height = size.height;
    }
    // Capture before await: a media sample may close its backing VideoFrame.
    this.sourceContext.drawImage(source,0,0,size.width,size.height);
    const half=this.device==="gpu"&&!this.forceFullPrecision&&await configureRestorationGpu();
    const tile = restorationTileShape(size.width,size.height,this.device,half);
    // Changing the tile shape releases the previous session's allocation cache;
    // a sequence of different source sizes cannot accumulate inference buffers.
    const model = await getSession(this.device,`${tile.width}:${tile.height}`,this.forceFullPrecision);
    if (shouldCancel()) throw new DOMException("Cancelled","AbortError");
    if (this.device === "gpu") {
      const device = await requestRestorationGpuDevice();
      const key = `${size.width}:${size.height}:${tile.width}:${tile.height}`;
      if (!this.gpu || key !== this.gpuKey) {
        this.gpu?.dispose();
        this.gpu = new RestorationGpuProcessor(device,size.width,size.height,this.outputWidth,this.outputHeight,tile.width,tile.height,RESTORATION_TILE_PAD);
        await this.gpu.initialize(); this.gpuKey = key;
      }
      return this.gpu.render(this.sourceCanvas,model,shouldCancel,1);
    }
    const pad=RESTORATION_TILE_PAD;
    const coreWidth=tile.width-pad*2,coreHeight=tile.height-pad*2,plane=tile.width*tile.height;
    const outWidth=tile.width*2,outHeight=tile.height*2,outPlane=outWidth*outHeight;
    this.cpuOutput ??= new OffscreenCanvas(this.outputWidth,this.outputHeight);
    const outputContext = this.cpuOutput.getContext("2d",{alpha:false,colorSpace:"srgb"});
    if (!outputContext) throw new Error("Local restoration canvas is unavailable.");
    this.cpuPixels ??= outputContext.createImageData(this.outputWidth,this.outputHeight);
    if(this.cpuTensorData?.length!==plane)this.cpuTensorData=new Float32Array(plane);
    const rgba = this.sourceContext.getImageData(0,0,size.width,size.height).data;
    const values = this.cpuTensorData, pixels = this.cpuPixels;
    const steps=Math.max(1,Math.min(2,Math.round(2*size.width/this.outputWidth)));
    for (let y=0;y<size.height;y+=coreHeight) for (let x=0;x<size.width;x+=coreWidth) {
      await new Promise<void>(resolve=>setTimeout(resolve,0));
      if (shouldCancel()) throw new DOMException("Cancelled","AbortError");
      for (let ty=0;ty<tile.height;ty++) {
        const sy = Math.max(0,Math.min(size.height-1,y+ty-pad));
        for (let tx=0;tx<tile.width;tx++) {
          const sx = Math.max(0,Math.min(size.width-1,x+tx-pad)), src = (sy*size.width+sx)*4, dst = ty*tile.width+tx;
          values[dst]=(.299*rgba[src]+.587*rgba[src+1]+.114*rgba[src+2])/255;
        }
      }
      const tensor = new cpuRuntime!.Tensor("float32",values,[1,1,tile.height,tile.width]);
      const result = await model.run({input:tensor}).finally(()=>tensor.dispose());
      try {
        if (shouldCancel()) throw new DOMException("Cancelled","AbortError");
        const restored = result.output?.data;
        if (!(restored instanceof Float32Array) || restored.length !== outPlane) throw new Error("The restoration model returned an unexpected frame shape.");
        const cw=Math.min(coreWidth,size.width-x),ch=Math.min(coreHeight,size.height-y);
        const left=Math.round(x*this.outputWidth/size.width),top=Math.round(y*this.outputHeight/size.height);
        const right=Math.round((x+cw)*this.outputWidth/size.width),bottom=Math.round((y+ch)*this.outputHeight/size.height);
        // Global output coordinates keep interpolation continuous across tile
        // boundaries, including non-integer scale factors at output ceilings.
        for(let oy=top;oy<bottom;oy++)for(let ox=left;ox<right;ox++) {
          const px=((ox+.5)*size.width/this.outputWidth-x+pad)*2-.5;
          const py=((oy+.5)*size.height/this.outputHeight-y+pad)*2-.5;
          const dst=(oy*this.outputWidth+ox)*4;
          let sum=0;
          for(let dy=0;dy<steps;dy++)for(let dx=0;dx<steps;dx++)sum+=sampleTensor(restored,outWidth,outHeight,outPlane,0,px+dx-(steps-1)*.5,py+dy-(steps-1)*.5);
          const modelY=sum/(steps*steps)*255;
          const sourceX=(ox+.5)*size.width/this.outputWidth-.5,sourceY=(oy+.5)*size.height/this.outputHeight-.5;
          const r=sampleRgba(rgba,size.width,size.height,sourceX,sourceY,0);
          const g=sampleRgba(rgba,size.width,size.height,sourceX,sourceY,1);
          const b=sampleRgba(rgba,size.width,size.height,sourceX,sourceY,2);
          const delta=modelY-(.299*r+.587*g+.114*b);
          pixels.data[dst]=r+delta;pixels.data[dst+1]=g+delta;pixels.data[dst+2]=b+delta;
          pixels.data[dst+3]=255;
        }
      } finally {for (const value of Object.values(result)) value.dispose();}
    }
    outputContext.putImageData(pixels,0,0);
    return this.cpuOutput;
  }

  dispose() {
    this.gpu?.dispose(); this.gpu=null;
    this.sourceCanvas.width=1; this.sourceCanvas.height=1;
    if (this.cpuOutput) {this.cpuOutput.width=1;this.cpuOutput.height=1;}
    this.cpuOutput=null;this.cpuPixels=null;this.cpuTensorData=null;
  }
}

function sampleTensor(data:Float32Array,width:number,height:number,plane:number,c:number,x:number,y:number) {
  x=Math.max(0,Math.min(width-1,x));y=Math.max(0,Math.min(height-1,y));
  const left=Math.floor(x),top=Math.floor(y),right=Math.min(width-1,left+1),bottom=Math.min(height-1,top+1),wx=x-left,wy=y-top,offset=c*plane;
  return (data[offset+top*width+left]*(1-wx)+data[offset+top*width+right]*wx)*(1-wy)
    +(data[offset+bottom*width+left]*(1-wx)+data[offset+bottom*width+right]*wx)*wy;
}

function sampleRgba(data:Uint8ClampedArray,width:number,height:number,x:number,y:number,c:number) {
  x=Math.max(0,Math.min(width-1,x));y=Math.max(0,Math.min(height-1,y));
  const left=Math.floor(x),top=Math.floor(y),right=Math.min(width-1,left+1),bottom=Math.min(height-1,top+1),wx=x-left,wy=y-top;
  return (data[(top*width+left)*4+c]*(1-wx)+data[(top*width+right)*4+c]*wx)*(1-wy)
    +(data[(bottom*width+left)*4+c]*(1-wx)+data[(bottom*width+right)*4+c]*wx)*wy;
}
