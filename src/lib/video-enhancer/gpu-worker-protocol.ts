import type { EnhancerActivity, EnhancerSettings } from "./types";

export type GpuRenderRequest={type:"render";id:string;jobId:string;source:ImageBitmap|VideoFrame;
  width:number;height:number;settings:EnhancerSettings;preview:boolean;frameKey?:string;timestamp:number;duration:number};
export type GpuWorkerRequest=GpuRenderRequest|{type:"release";id:string}|{type:"cancel";jobId:string};
export type GpuWorkerResponse=
  |{type:"bitmap";id:string;bitmap:ImageBitmap;elapsedMs:number}
  |{type:"frame";id:string;frame:VideoFrame;elapsedMs:number}
  |{type:"released";id:string}
  |{type:"activity";id:string;activity:EnhancerActivity}
  |{type:"error";id:string;message:string};
