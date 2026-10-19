"use client";
import { useState } from "react";
import type { EnhancerWorkerResponse } from "@/lib/video-enhancer/types";
import { DEFAULT_ENHANCER_SETTINGS } from "@/lib/video-enhancer/filter";

export default function ColorCheck() {
  const [status,setStatus]=useState("Choose the local source video"),[results,setResults]=useState<unknown[]>([]);
  const [download,setDownload]=useState("");
  const [downloadName,setDownloadName]=useState("cutweave-restored.mp4");
  const run=async(file: File, existing?: File) => {
    const maximum=new URLSearchParams(window.location.search).has("maximum");
    const settings=maximum ? {denoise:1,detail:1,scale:2 as const} : DEFAULT_ENHANCER_SETTINGS;
    setResults([]);setStatus("Reading source metadata");
    document.getElementById("frames")?.replaceChildren();
    const {Input,ALL_FORMATS,BlobSource,VideoSampleSink,CanvasSink}=await import("mediabunny");
    const input=new Input({formats:ALL_FORMATS,source:new BlobSource(file)});
    const worker=new Worker(new URL("./verify-video-enhancer-color.worker.ts",import.meta.url),{type:"module"});
    const report=(value: unknown)=>setResults(previous=>[...previous,value]);
    const wait=(frame: VideoFrame,id: string)=>new Promise<void>((resolve,reject)=>{
      worker.onmessage=event=>{
        const message=event.data;if(message.id!==id)return;
        if(message.type==="error"){reject(new Error(message.message));return;}
        const {before,after,...stats}=message;report(stats);
        const row=document.createElement("div");row.style.display="flex";row.style.gap="10px";
        for(const [name,bitmap] of [["Original",before],["Enhanced",after]] as const) {
          const box=document.createElement("figure"),caption=document.createElement("figcaption"),canvas=document.createElement("canvas");
          caption.textContent=`${name} · ${id} s`;canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.style.width="45vw";
          canvas.getContext("2d")!.drawImage(bitmap,0,0);bitmap.close();box.append(caption,canvas);row.append(box);
        }
        document.getElementById("frames")?.append(row);resolve();
      };
      worker.postMessage({frame,id,settings},[frame]);
    });
    try {
      const track=await input.getPrimaryVideoTrack();if(!track)throw new Error("No video");
      const duration=await input.computeDuration();
      const width=await track.getDisplayWidth(),height=await track.getDisplayHeight();
      report({file:file.name,settings,duration,width:await track.getDisplayWidth(),height:await track.getDisplayHeight(),decoder:await track.getDecoderConfig()});
      const sink=new VideoSampleSink(track);
      for(const time of [0,2,5,8,Math.min(duration-.1,12)]) {
        setStatus(`Comparing decoded frame at ${time}s`);
        const sample=await sink.getSample(time);if(!sample)continue;
        const frame=sample.toVideoFrame();sample.close();await wait(frame,String(time));
      }
      if(new URLSearchParams(window.location.search).has("framesOnly")){setStatus("FRAME CHECK COMPLETE");return;}
      setStatus(existing ? "Checking the supplied enhanced MP4" : "Exporting a repaired MP4");
      if(!existing) {
      const exportStarted=performance.now();
      const exporter=new Worker(new URL("../src/workers/video-enhancer.worker.ts",import.meta.url),{type:"module"});
      const exported=await new Promise<ArrayBuffer>((resolve,reject)=>{
        exporter.onmessage=(event: MessageEvent<EnhancerWorkerResponse>)=>{
          if(event.data.type==="complete")resolve(event.data.buffer!);
          if(event.data.type==="error")reject(new Error(event.data.message));
        };
        exporter.postMessage({type:"export",jobId:"color-export",file,device:"gpu",settings:{...settings,scale:2},width:width*2,height:height*2});
      }).finally(()=>exporter.terminate());
      report({test:"full clip export timing",elapsedMs:performance.now()-exportStarted,bytes:exported.byteLength});
      existing=new File([exported],`${file.name.replace(/\.[^.]+$/,"")}-cutweave-restoration-final${maximum ? "-maximum" : ""}.mp4`,{type:"video/mp4"});
      setDownloadName(existing.name);
      setDownload(URL.createObjectURL(existing));
      }
      const output=new Input({formats:ALL_FORMATS,source:new BlobSource(existing)});
      try {
        const outTrack=await output.getPrimaryVideoTrack();if(!outTrack)throw new Error("No output video");
        report({outputFile:existing.name,width:await outTrack.getDisplayWidth(),height:await outTrack.getDisplayHeight(),duration:await output.computeDuration(),decoder:await outTrack.getDecoderConfig()});
        const before=new CanvasSink(track,{poolSize:1}),after=new CanvasSink(outTrack,{poolSize:1,width,height,fit:"fill"});
        for(const time of [0,2,5,8,Math.min(duration-.1,12)]) {
          const a=await before.getCanvas(time),b=await after.getCanvas(time);if(!a||!b)continue;
          const ac=a.canvas.getContext("2d") as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D;
          const bc=b.canvas.getContext("2d") as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D;
          const src=ac.getImageData(0,0,a.canvas.width,a.canvas.height).data, dst=bc.getImageData(0,0,b.canvas.width,b.canvas.height).data;
          let delta=0,shadow=0,n=0;
          for(let i=0;i<src.length;i++)if(i%4<3){delta+=dst[i]-src[i];if(src[i]>0&&src[i]<32){shadow+=dst[i]-src[i];n++;}}
          report({test:"export comparison",time,meanDelta:delta/(src.length/4*3),shadowDelta:shadow/n});
          if(Math.abs(delta/(src.length/4*3))>1 || Math.abs(shadow/n)>2)throw new Error("Export changed brightness or shadow levels");
        }
      } finally {output.dispose();}
      setStatus("COLOR CHECK COMPLETE");
    }catch(error){setStatus(String(error));}finally{worker.terminate();input.dispose();}
  };
  return <main><h1>Real clip color regression</h1><label>Local videos <input type="file" multiple accept="video/*" onChange={event=>{const files=[...(event.target.files??[])];const source=files.find(file=>!file.name.includes("-enhanced"))??files[0],enhanced=files.find(file=>file.name.includes("-enhanced"));if(source)void run(source,enhanced);}} /></label><p role="status">{status}</p>{download&&<a href={download} download={downloadName}>Save repaired video</a>}<details><summary>Metrics</summary><pre>{JSON.stringify(results,null,2)}</pre></details><div id="frames" /></main>;
}
