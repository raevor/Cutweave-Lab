import type { EnhancerActivityCallback } from "./types";
import type { GpuRenderRequest, GpuWorkerRequest, GpuWorkerResponse } from "./gpu-worker-protocol";

type Result=Exclude<GpuWorkerResponse,{type:"activity"}|{type:"error"}>;
/** A single in-flight picture. CPU media orchestration has its own event loop
 * and can feed the browser encoder/muxer while the GPU worker dispatches. */
export class GpuWorkerClient{
  private worker:Worker|null=null;
  private pending=new Map<string,{resolve:(result:Result)=>void;reject:(error:Error)=>void;activity?:EnhancerActivityCallback}>();
  private connect(){
    if(this.worker)return this.worker;
    const worker=new Worker(new URL("../../workers/video-enhancer-gpu.worker.ts?isolated=native-detail-v16",import.meta.url),{type:"module"});
    worker.onmessage=(event:MessageEvent<GpuWorkerResponse>)=>{
      const result=event.data,request=this.pending.get(result.id);
      if(!request){if(result.type==="bitmap")result.bitmap.close();if(result.type==="frame")result.frame.close();return;}
      if(result.type==="activity"){request.activity?.(result.activity);return;}
      this.pending.delete(result.id);
      if(result.type==="error")request.reject(new Error(result.message));else request.resolve(result);
    };
    worker.onerror=event=>{
      for(const request of this.pending.values())request.reject(new Error(event.message||"The GPU processor stopped."));
      this.pending.clear();worker.terminate();if(this.worker===worker)this.worker=null;
    };
    this.worker=worker;return worker;
  }
  render(request:Omit<GpuRenderRequest,"id"|"type">,activity?:EnhancerActivityCallback){
    // The coordinator serializes renders; reject accidental overlapping callers
    // rather than retaining an unbounded queue of decoded user frames.
    if(this.pending.size){request.source.close();return Promise.reject(new Error("The GPU processor is busy."));}
    return this.send({type:"render",id:crypto.randomUUID(),...request},[request.source],activity);
  }
  cancel(jobId:string){this.worker?.postMessage({type:"cancel",jobId} satisfies GpuWorkerRequest);}
  async release(){if(this.worker)await this.send({type:"release",id:crypto.randomUUID()});}
  private send(request:Exclude<GpuWorkerRequest,{type:"cancel"}>,transfer:Transferable[]=[],activity?:EnhancerActivityCallback){
    return new Promise<Result>((resolve,reject)=>{
      try{
        const worker=this.connect();this.pending.set(request.id,{resolve,reject,activity});worker.postMessage(request,transfer);
      }catch(error){
        this.pending.delete(request.id);if(request.type==="render")request.source.close();
        reject(error instanceof Error?error:new Error("The GPU processor could not start."));
      }
    });
  }
}
