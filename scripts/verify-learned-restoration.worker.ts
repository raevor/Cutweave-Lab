import { RestorationProcessor } from "../src/lib/video-enhancer/restoration-processor";
import {DEFAULT_ENHANCER_SETTINGS} from "../src/lib/video-enhancer/filter";
self.onmessage=async(event:MessageEvent<{bitmap:ImageBitmap;cpu?:boolean;fp32?:boolean}>)=>{
 const {bitmap,cpu,fp32}=event.data;
 const processor=new RestorationProcessor(cpu ? "cpu" : "gpu",bitmap.width*2,bitmap.height*2,fp32);
 try {
  const start=performance.now();
  const canvas=await processor.render(bitmap,bitmap.width,bitmap.height,DEFAULT_ENHANCER_SETTINGS);
  const result=await createImageBitmap(canvas);
  self.postMessage({bitmap:result,ms:performance.now()-start},[result]);
 }catch(error){self.postMessage({error:String(error)});}finally{bitmap.close();processor.dispose();}
};
