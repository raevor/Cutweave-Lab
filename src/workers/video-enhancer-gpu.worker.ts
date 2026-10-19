import { RestorationProcessor } from "@/lib/video-enhancer/restoration-processor";
import type { GpuWorkerRequest, GpuWorkerResponse, GpuRenderRequest } from "@/lib/video-enhancer/gpu-worker-protocol";

const scope=self as DedicatedWorkerGlobalScope;
let processor:RestorationProcessor|null=null;
let key="";
let activeJob:string|null=null;
let cancelled=false;
let queue=Promise.resolve();
function post(message:GpuWorkerResponse,transfer:Transferable[]=[]){scope.postMessage(message,transfer);}

async function render(request:GpuRenderRequest){
  activeJob=request.jobId;cancelled=false;
  const started=performance.now(),cancel=()=>cancelled;
  try{
    if(cancel())throw new DOMException("Cancelled","AbortError");
    const next=`${request.width}:${request.height}`;
    if(!processor||key!==next){await processor?.dispose();processor=new RestorationProcessor("gpu",request.width,request.height);key=next;}
    const sourceWidth=typeof VideoFrame!=="undefined"&&request.source instanceof VideoFrame?request.source.displayWidth:(request.source as ImageBitmap).width;
    const sourceHeight=typeof VideoFrame!=="undefined"&&request.source instanceof VideoFrame?request.source.displayHeight:(request.source as ImageBitmap).height;
    const canvas=await processor.render(request.source,sourceWidth,sourceHeight,request.settings,cancel,request.frameKey,
      activity=>{if(!cancel())post({type:"activity",id:request.id,activity});},request.preview);
    if(cancel())throw new DOMException("Cancelled","AbortError");
    if(request.preview){
      const bitmap=await createImageBitmap(canvas);
      if(cancel()){bitmap.close();throw new DOMException("Cancelled","AbortError");}
      post({type:"bitmap",id:request.id,bitmap,elapsedMs:performance.now()-started},[bitmap]);
    }else{
      const frame=await processor.toVideoFrame(request.timestamp,request.duration);
      if(cancel()){frame.close();throw new DOMException("Cancelled","AbortError");}
      post({type:"frame",id:request.id,frame,elapsedMs:performance.now()-started},[frame]);
    }
  }catch(error){
    post({type:"error",id:request.id,message:error instanceof Error?error.message:"GPU restoration failed."});
  }finally{request.source.close();activeJob=null;}
}
scope.onmessage=(event:MessageEvent<GpuWorkerRequest>)=>{
  const request=event.data;
  if(request.type==="cancel"){if(activeJob===request.jobId)cancelled=true;return;}
  queue=queue.then(async()=>{
    if(request.type==="render"){await render(request);return;}
    const old=processor;processor=null;key="";activeJob=null;cancelled=false;
    try{await old?.dispose();post({type:"released",id:request.id});}
    catch(error){post({type:"error",id:request.id,message:error instanceof Error?error.message:"GPU cleanup failed."});}
  }).catch(()=>{/* Each request reports its own result; preserve the queue. */});
};
