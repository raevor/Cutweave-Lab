import type { EnhancerDevice, EnhancerSettings, EnhancerActivityCallback } from "./types";
import { FrameProcessor } from "./frame-processor";
import type { UniversalFrameRestorer, RestoredFrame } from "./universal-restoration";
import type { RgbRestorationGpuProcessor } from "./rgb-restoration-gpu";

/** GPU-only native restoration / 2x reconstruction. Paused-frame results are
 * reused for finish settings; export reconstructs every source frame. */
export class RestorationProcessor {
  private model:UniversalFrameRestorer|null=null;
  private modelLoading:Promise<void>|null=null;
  private disposed=false;
  private fallback:FrameProcessor|null=null;
  private activeGpu:RgbRestorationGpuProcessor|null=null;
  private cancel:()=>boolean=()=>false;
  private get finish(){return this.fallback??=new FrameProcessor(this.device,this.width,this.height);}
  private cachedFrameKey:string|null=null;
  private cachedRestored:RestoredFrame|null=null;
  constructor(private device:EnhancerDevice,private width:number,private height:number,_forceFullPrecision=false) {
    if(device!=="gpu")throw new Error("CPU-only enhancement is disabled. A compatible GPU is required.");
    // Retain the legacy call signature; mode and hardware select the GPU asset.
    void _forceFullPrecision;
  }
  async render(source:CanvasImageSource,sourceWidth:number,sourceHeight:number,settings:EnhancerSettings,shouldCancel:()=>boolean=()=>false,frameKey?:string,onActivity?:EnhancerActivityCallback,present=true) {
    this.activeGpu=null;this.cancel=shouldCancel;
    if(settings.detail===0)return this.finish.render(source,sourceWidth,sourceHeight,settings,shouldCancel);
    if(!this.model) {
      onActivity?.({stage:"preparing"});
      const capture=new OffscreenCanvas(sourceWidth,sourceHeight);
      const context=capture.getContext("2d",{alpha:false});
      if(!context)throw new Error("Local frame capture is unavailable.");
      context.drawImage(source,0,0);source=capture;
      this.modelLoading??=import("./universal-restoration").then(({UniversalFrameRestorer})=>{
        if(!this.disposed)this.model=new UniversalFrameRestorer(this.device,this.width,this.height);
      }).catch(error=>{this.modelLoading=null;throw error;});
      await this.modelLoading;
      if(this.disposed||shouldCancel())throw new DOMException("Cancelled","AbortError");
    }
    const model=this.model!;
    // Export omits frameKey and always reconstructs the current decoded frame.
    // Cancellation can partially overwrite the model canvas: invalidate first.
    const key=frameKey ? `${frameKey}:${sourceWidth}:${sourceHeight}:${settings.scale}` : null;
    let restored=this.cachedRestored;
    if(!key||key!==this.cachedFrameKey||!restored) {
      this.cachedFrameKey=null;this.cachedRestored=null;
      restored=await model.render(source,sourceWidth,sourceHeight,shouldCancel,onActivity,settings.scale);
      if(shouldCancel())throw new DOMException("Cancelled","AbortError");
      this.cachedFrameKey=key;this.cachedRestored=key ? restored : null;
    }
    onActivity?.({stage:"finishing"});
    this.activeGpu=restored.processor;
    return restored.processor.finish(settings,shouldCancel,present);
  }
  toVideoFrame(timestamp:number,duration:number){return this.activeGpu
    ? this.activeGpu.toVideoFrame(timestamp,duration,()=>this.disposed||this.cancel())
    : this.finish.toVideoFrame(timestamp,duration);}
  async dispose(){
    this.disposed=true;this.cachedFrameKey=null;this.cachedRestored=null;
    const model=this.model;this.model=null;
    this.activeGpu=null;
    try{await model?.dispose();}finally{this.fallback?.dispose();this.fallback=null;}
  }
}
