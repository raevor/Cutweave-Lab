import * as ort from "onnxruntime-web/webgpu";
import { configureRestorationGpu, requestRestorationGpuDevice, restorationGpuPixelBudget } from "./restoration-gpu";
import { RgbRestorationGpuProcessor } from "./rgb-restoration-gpu";
import { restorationInputSize, restorationTileShape } from "./restoration-plan";
import { acquireRestorationSession, configureRestorationRuntime, type RestorationLease } from "./restoration-runtime";
import type { EnhancerActivityCallback } from "./types";

export type RestoredFrame={kind:"gpu";processor:RgbRestorationGpuProcessor};

/** True native restoration and 2x reconstruction use independent learned engines. */
export class UniversalFrameRestorer{
  readonly sourceCanvas=new OffscreenCanvas(2,2);
  private context:OffscreenCanvasRenderingContext2D;
  private processor:RgbRestorationGpuProcessor|null=null;
  private session:ort.InferenceSession|null=null;
  private lease:RestorationLease|null=null;
  private key="";
  private disposed=false;
  private captureDisabled=false;
  private halfDisabled=false;
  constructor(readonly device:"gpu"|"cpu",readonly outputWidth:number,readonly outputHeight:number){
    if(device!=="gpu")throw new Error("CPU-only enhancement is disabled. A compatible GPU is required.");
    const context=this.sourceCanvas.getContext("2d",{alpha:false,colorSpace:"srgb"});
    if(!context)throw new Error("Local frame capture is unavailable.");this.context=context;
  }
  async render(source:CanvasImageSource,width:number,height:number,shouldCancel:()=>boolean,onActivity?:EnhancerActivityCallback,scale:1|2=2):Promise<RestoredFrame>{
    const size=restorationInputSize(width,height,this.outputWidth,this.outputHeight);
    if(this.sourceCanvas.width!==size.width||this.sourceCanvas.height!==size.height){this.sourceCanvas.width=size.width;this.sourceCanvas.height=size.height;}
    this.context.drawImage(source,0,0,size.width,size.height);this.check(shouldCancel);
    configureRestorationRuntime();const supportsHalf=await configureRestorationGpu();this.check(shouldCancel);
    const half=scale===2&&supportsHalf&&!this.halfDisabled;
    const budget=restorationGpuPixelBudget(!this.captureDisabled,half,scale===1);
    const align=(n:number)=>Math.ceil(n/8)*8;
    const fullNative=scale===1&&align(size.width)*align(size.height)<=budget;
    // Native processes /4 feature maps; one full frame is preferred because
    // its channel-attention pooling uses spatial context. Large frames tile.
    const pad=scale===1 ? fullNative ? 0 : 96 : 24;
    const tile=fullNative ? {width:align(size.width),height:align(size.height)}
      : restorationTileShape(size.width,size.height,"gpu",half,pad,budget);
    const key=`${size.width}:${size.height}:${tile.width}:${tile.height}:${scale}:${half}:${this.captureDisabled}`;
    if(key!==this.key){
      onActivity?.({stage:"preparing"});await this.release();
      try{
        this.lease=await acquireRestorationSession("gpu",tile.width,tile.height,scale,!this.captureDisabled,half);
        this.session=this.lease.session;this.check(shouldCancel);
        if((!this.lease.capture&&!this.captureDisabled)||(half&&!this.lease.half)){
          if(!this.lease.capture)this.captureDisabled=true;
          if(half&&!this.lease.half)this.halfDisabled=true;
          await this.release();return this.render(this.sourceCanvas,size.width,size.height,shouldCancel,onActivity,scale);
        }
        const gpu=await requestRestorationGpuDevice();this.check(shouldCancel);
        this.processor=new RgbRestorationGpuProcessor(gpu,size.width,size.height,this.outputWidth,this.outputHeight,tile.width,tile.height,pad,scale,scale===1,this.lease.half);
        await this.processor.initialize();this.check(shouldCancel);this.key=key;
        // Local, non-media diagnostics distinguish actual execution from a
        // compatibility retry; no frame pixels or file names are recorded.
        console.info("CUT/WEAVE GPU execution",{revision:"v16",mode:scale===1?"native-rtmosr":"2x-span",
          precision:this.lease.half?"fp16":"fp32",replay:this.lease.capture,
          inputWidth:size.width,inputHeight:size.height,tileWidth:tile.width,tileHeight:tile.height});
      }catch(error){await this.release();throw error;}
    }
    try{
      await this.processor!.render(this.sourceCanvas,this.session!,()=>this.disposed||shouldCancel(),1,onActivity);
      this.check(shouldCancel);return {kind:"gpu",processor:this.processor!};
    }catch(error){
      if(!this.disposed&&!shouldCancel()&&(this.lease?.capture||this.lease?.half)){
        if(this.lease.capture)this.captureDisabled=true;else this.halfDisabled=true;
        await this.release();return this.render(this.sourceCanvas,size.width,size.height,shouldCancel,onActivity,scale);
      }
      throw error;
    }
  }
  private check(cancel:()=>boolean){if(this.disposed||cancel())throw new DOMException("Cancelled","AbortError");}
  private async release(){
    const processor=this.processor;this.processor=null;
    const lease=this.lease;this.lease=null;this.session=null;this.key="";
    processor?.releaseOutput();try{await lease?.release();}finally{processor?.dispose();}
  }
  async dispose(){this.disposed=true;try{await this.release();}finally{this.sourceCanvas.width=2;this.sourceCanvas.height=2;}}
}
