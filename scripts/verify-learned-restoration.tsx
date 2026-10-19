"use client";
import {useState} from "react";
export default function LearnedCheck(){
 const [status,setStatus]=useState("Choose local clip"),[results,setResults]=useState<unknown[]>([]);
 async function run(file:File){
  setResults([]);document.getElementById("frames")?.replaceChildren();
  const {Input,ALL_FORMATS,BlobSource,CanvasSink}=await import("mediabunny");
  const input=new Input({formats:ALL_FORMATS,source:new BlobSource(file)});
  const worker=new Worker(new URL("./verify-learned-restoration.worker.ts",import.meta.url),{type:"module"});
  try{
   const track=await input.getPrimaryVideoTrack();if(!track)throw new Error("No video");
   const cpu=new URLSearchParams(window.location.search).has("cpu");
   const fp32=new URLSearchParams(window.location.search).has("fp32");
   const sink=new CanvasSink(track,{poolSize:1,...(cpu ? {width:128,height:72,fit:"fill" as const} : {})});
   for(const time of cpu ? [12] : [0,5,12]){
    setStatus(`Processing frame ${time}`);
    const sample=await sink.getCanvas(time);if(!sample)continue;
    const original=await createImageBitmap(sample.canvas);
    const result=await new Promise<{bitmap:ImageBitmap;ms:number}>((resolve,reject)=>{worker.onmessage=event=>event.data.error ? reject(new Error(event.data.error)) : resolve(event.data);worker.postMessage({bitmap:original,cpu,fp32},[original]);});
    setResults(previous=>[...previous,{time,ms:result.ms}]);
    const canvas=document.createElement("canvas");canvas.width=result.bitmap.width;canvas.height=result.bitmap.height;canvas.style.width="90vw";
    canvas.getContext("2d")!.drawImage(result.bitmap,0,0);result.bitmap.close();
    const a=document.createElement("a");a.download=`restoration-balanced-${time}.png`;a.href=canvas.toDataURL("image/png");a.textContent=`Save frame ${time}`;
    document.getElementById("frames")!.append(a,canvas);
   }setStatus("DONE");
  }catch(error){setStatus(String(error));}finally{worker.terminate();input.dispose();}
 }
 return <main><h1>Local restoration benchmark</h1><input aria-label="Local video" type="file" accept="video/*" onChange={event=>{const file=event.target.files?.[0];if(file)void run(file);}}/><p role="status">{status}</p><pre>{JSON.stringify(results,null,2)}</pre><div id="frames"/></main>;
}
