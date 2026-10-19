import * as ort from "onnxruntime-web/webgpu";
import type { EnhancerDevice } from "./types";

let configured=false;
export function configureRestorationRuntime(){
  if(configured)return;
  ort.env.wasm.wasmPaths=`${self.location.origin}/wasm/video-enhancer/`;
  ort.env.wasm.proxy=false;
  // GPU model work stays on WebGPU. Demux/audio/encode/mux live in a separate
  // CPU coordinator worker, rather than an unused WASM inference thread pool.
  ort.env.wasm.numThreads=1;ort.env.wasm.initTimeout=60_000;configured=true;
}

export async function acquireRestorationSession(device:EnhancerDevice,width:number,height:number,scale:1|2,capture=true,half=false){
  if(device!=="gpu")throw new Error("CPU-only enhancement is disabled. A compatible GPU is required.");
  configureRestorationRuntime();
  const candidates=half&&scale===2 ? [[half,capture],[true,false],[false,false]] : [[false,capture],[false,false]];
  let failure:unknown;
  for(const [useHalf,useCapture] of candidates){
    const name=scale===1 ? "deh264-rtmosr-light-native-fp32-v15.onnx"
      : useHalf ? "nomosuni-span-head-author-fp16-io-v16.onnx" : "nomosuni-span-head-fp32-v14.onnx";
    try{
      const session=await ort.InferenceSession.create(`${self.location.origin}/models/video-enhancer/${name}`,{
        executionProviders:[{name:"webgpu",preferredLayout:"NHWC",storageBufferCacheMode:"bucket"}],
        enableGraphCapture:useCapture,preferredOutputLocation:"gpu-buffer",graphOptimizationLevel:"all",
        freeDimensionOverrides:{batch_size:1,height,width},
        extra:{session:{disable_cpu_ep_fallback:"1"}},
      });
      let released=false;
      return {session,capture:useCapture,half:useHalf,async release(){
        if(released)return;released=true;await session.release();
      }};
    }catch(error){failure=error;}
  }
  throw failure;
}
export type RestorationLease=Awaited<ReturnType<typeof acquireRestorationSession>>;
