import { RestorationProcessor } from "../src/lib/video-enhancer/restoration-processor";
import { DEFAULT_ENHANCER_SETTINGS } from "../src/lib/video-enhancer/filter";
import type {EnhancerSettings} from "../src/lib/video-enhancer/types";

const scope = self as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<{frame: VideoFrame; id: string; settings?:EnhancerSettings}>) => {
  const {frame,id,settings=DEFAULT_ENHANCER_SETTINGS} = event.data;
  const width=frame.displayWidth,height=frame.displayHeight;
  const baseline=new OffscreenCanvas(width,height),context=baseline.getContext("2d",{alpha:false,colorSpace:"srgb"})!;
  context.drawImage(frame,0,0,width,height);
  const original=context.getImageData(0,0,width,height).data;
  const read=new OffscreenCanvas(width,height),reader=read.getContext("2d",{alpha:false,colorSpace:"srgb",willReadFrequently:true})!;
  const processor=new RestorationProcessor("gpu",width,height);
  const compare=(surface: OffscreenCanvas) => {
    reader.drawImage(surface,0,0);
    const data=reader.getImageData(0,0,width,height).data;
    let delta=0,square=0,shadowDelta=0,shadowN=0,crushed=0,max=0;
    const channels=[0,0,0];
    for(let i=0;i<data.length;i++) if(i%4<3){
      const error=data[i]-original[i];delta+=error;square+=error*error;max=Math.max(max,Math.abs(error));channels[i%4]+=error;
      if(original[i]>0&&original[i]<32){shadowDelta+=error;shadowN++;if(data[i]===0)crushed++;}
    }
    const n=width*height*3;
    return {meanDelta:delta/n,meanChannelDelta:channels.map(x=>x/(width*height)),rmse:Math.sqrt(square/n),maxError:max,shadowDelta:shadowDelta/shadowN,crushedShadowPercent:crushed/shadowN*100};
  };
  try {
    const off={...DEFAULT_ENHANCER_SETTINGS,denoise:0,detail:0};
    const direct=await processor.render(frame,width,height,off);
    const directStats=compare(direct);
    const normalized=await processor.render(baseline,width,height,off);
    const normalizedStats=compare(normalized);
    const processed=await processor.render(baseline,width,height,settings);
    const processedStats=compare(processed);
    const after=await createImageBitmap(processed), before=await createImageBitmap(baseline);
    scope.postMessage({id,type:"result",colorSpace:frame.colorSpace.toJSON(),directStats,normalizedStats,processedStats,before,after},[before,after]);
  } catch(error) {scope.postMessage({id,type:"error",message:String(error)});}
  finally {frame.close();processor.dispose();}
};
