"use client";
import { useState } from "react";
import { DEFAULT_ENHANCER_SETTINGS } from "@/lib/video-enhancer/filter";
import type { EnhancerWorkerRequest, EnhancerWorkerResponse } from "@/lib/video-enhancer/types";

type Reply = Extract<EnhancerWorkerResponse, {type: "preview" | "complete" | "cancelled" | "capabilities"}>;
export default function EnhancerCheck() {
  const [status, setStatus] = useState("Ready"), [results, setResults] = useState<unknown[]>([]);
  const run = async () => {
    setResults([]); setStatus("Running real worker checks");
    const worker = new Worker(new URL("../src/workers/video-enhancer.worker.ts", import.meta.url), {type:"module"});
    const waiting = new Map<string, {resolve: (reply: Reply) => void; reject: (error: Error) => void}>();
    let cancelOnProgress = "";
    worker.onmessage = (event: MessageEvent<EnhancerWorkerResponse>) => {
      const m = event.data, key = m.type === "capabilities" ? "capabilities" : m.jobId;
      if(m.type==="activity")return;
      if (m.type === "progress") { if (m.jobId === cancelOnProgress && m.fraction > 0) { cancelOnProgress = ""; worker.postMessage({type:"cancel",jobId:m.jobId}); } return; }
      const pending = waiting.get(key); if (!pending) { if (m.type === "preview") m.bitmap.close(); return; }
      waiting.delete(key);
      if (m.type === "error") pending.reject(new Error(m.message)); else pending.resolve(m);
    };
    const request = (message: EnhancerWorkerRequest, transfer: Transferable[] = []) => new Promise<Reply>((resolve, reject) => {
      const key = message.type === "capabilities" ? "capabilities" : "jobId" in message ? message.jobId : "";
      waiting.set(key, {resolve,reject}); worker.postMessage(message, transfer);
    });
    const report = (result: unknown) => setResults((previous) => [...previous, result]);
    const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
    const canvas = new OffscreenCanvas(320,180), c = canvas.getContext("2d")!;
    c.fillStyle = "#cc4433"; c.fillRect(0,0,320,90); c.fillStyle = "#2255cc"; c.fillRect(0,90,320,90);
    c.fillStyle = "#ffffff"; c.fillRect(20,20,50,30);
    const noisy = c.getImageData(0,0,320,180);
    const cleanReference = new Uint8ClampedArray(noisy.data);
    let seed = 421;
    for (let i = 0; i < noisy.data.length; i++) if (i % 4 < 3) {
      seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
      noisy.data[i] += Math.round((seed / 0xffffffff - .5) * 24);
    }
    c.putImageData(noisy,0,0);
    const read = (bitmap: ImageBitmap) => {
      const surface = new OffscreenCanvas(bitmap.width,bitmap.height), context = surface.getContext("2d")!;
      context.drawImage(bitmap,0,0); bitmap.close(); return context.getImageData(0,0,surface.width,surface.height);
    };
    const preview = async (device: "gpu" | "cpu", width: number, height: number) => {
      const bitmap = await createImageBitmap(canvas), reply = await request({type:"preview", jobId:crypto.randomUUID(), bitmap, device, settings:DEFAULT_ENHANCER_SETTINGS,width,height},[bitmap]);
      assert(reply.type === "preview", "Missing preview");
      return reply as Extract<Reply,{type:"preview"}>;
    };
    try {
      report(await request({type:"capabilities"}));
      if(new URLSearchParams(window.location.search).has("shapes")) {
        for(const [width,height] of [[320,180],[160,90],[320,180]]) {
          canvas.width=width;canvas.height=height;
          c.fillStyle="#cc4433";c.fillRect(0,0,width,height/2);c.fillStyle="#2255cc";c.fillRect(0,height/2,width,height/2);
          const reply=await preview("gpu",320,180),image=read(reply.bitmap);
          const top=image.data[(45*320+160)*4],bottom=image.data[(135*320+160)*4+2];
          assert(top>170&&bottom>170,"A changed source shape lost its picture");
          report({test:"source shape change on the same processor",width,height,passed:true});
        }
        const oldId=crypto.randomUUID(),old=await createImageBitmap(canvas);
        worker.postMessage({type:"preview",jobId:oldId,bitmap:old,device:"gpu",settings:DEFAULT_ENHANCER_SETTINGS,width:320,height:180},[old]);
        worker.postMessage({type:"cancel",jobId:oldId});
        c.fillStyle="#2255cc";c.fillRect(0,0,320,90);c.fillStyle="#cc4433";c.fillRect(0,90,320,90);
        for(let i=0;i<20;i++){
          const bitmap=await createImageBitmap(canvas);
          worker.postMessage({type:"preview",jobId:crypto.randomUUID(),bitmap,device:"gpu",settings:DEFAULT_ENHANCER_SETTINGS,width:320,height:180},[bitmap]);
        }
        const latest=read((await preview("gpu",320,180)).bitmap);
        assert(latest.data[(45*320+160)*4+2]>170&&latest.data[(135*320+160)*4]>170,"Cancelled preview replaced the latest frame");
        report({test:"cancelled preview and a rapid request burst followed by the latest source frame",passed:true});
        setStatus("SHAPE CHECKS PASSED");return;
      }
      const fractional=new URLSearchParams(window.location.search).has("fractional");
      for (const scale of fractional ? [1.5] : [1,2]) {
        const gpu = await preview("gpu",320 * scale,180 * scale), cpu = await preview("cpu",320 * scale,180 * scale);
        const gpuData = read(gpu.bitmap), cpuData = read(cpu.bitmap);
        let difference = 0,squareDifference=0,differenceIndex=0;
        for (let i=0;i<gpuData.data.length;i++) {const d=Math.abs(gpuData.data[i]-cpuData.data[i]);squareDifference+=d*d;if(d>difference){difference=d;differenceIndex=i;}}
        const parityRmse=Math.sqrt(squareDifference/(gpuData.data.length/4*3));
        report({test:"device parity measurement",scale,maxChannelDifference:difference,rmse:parityRmse,index:differenceIndex,gpu:gpuData.data[differenceIndex],cpu:cpuData.data[differenceIndex]});
        const top = [...gpuData.data.slice((45 * scale * gpuData.width + 160 * scale)*4,(45 * scale * gpuData.width + 160 * scale)*4+4)];
        const bottom = [...gpuData.data.slice((135 * scale * gpuData.width + 160 * scale)*4,(135 * scale * gpuData.width + 160 * scale)*4+4)];
        assert(top[0] > 180 && bottom[2] > 180, "Black or inverted preview");
        // GPU FP16 / CPU FP32 inference and 8-bit texture rounding can differ
        // slightly. Bound both peak and RMS error on the same restored fixture.
        assert(difference <= 4 && parityRmse < .8, "GPU/CPU disagree");
        if(scale===1) {
          let before=0,after=0;
          for(let y=2;y<178;y++) for(let x=2;x<318;x++) {
            if(Math.abs(y-90)<2 || (x>=18 && x<=72 && y>=18 && y<=52)) continue;
            const index=(y*320+x)*4;
            for(let channel=0;channel<3;channel++) {
              before+=(noisy.data[index+channel]-cleanReference[index+channel])**2;
              after+=(gpuData.data[index+channel]-cleanReference[index+channel])**2;
            }
          }
          report({test:"GPU measured noise error",before,after,reductionPercent:(1-after/before)*100});
          assert(after<before*.8,"GPU noise cleanup did not improve the reference");
        }
        report({test:"orientation + device parity",scale,maxChannelDifference:difference,top,bottom,gpuMs:gpu.elapsedMs,cpuMs:cpu.elapsedMs});
      }
      if(fractional){setStatus("FRACTIONAL CHECKS PASSED");return;}
      canvas.width = 1920; canvas.height = 1080; c.fillStyle="#56789a"; c.fillRect(0,0,1920,1080); c.fillStyle="#b9c8d0"; c.fillRect(300,200,500,400);
      for (const device of ["gpu"] as const) {
        const times=[];
        for(let i=0;i<2;i++) { const p=await preview(device,1920,1080); p.bitmap.close(); times.push(p.elapsedMs); }
        report({test:"1080p real worker benchmark",device,frameMs:times});
      }
      setStatus("Encoding fixture with audio");
      const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Quality, Input, BlobSource, ALL_FORMATS, CanvasSink } = await import("mediabunny");
      canvas.width=1024;canvas.height=576;
      const target=new BufferTarget(), output=new Output({format:new Mp4OutputFormat(),target});
      const track=new CanvasSource(canvas,{codec:"avc",bitrate:new Quality("high")}), audio=new AudioBufferSource({codec:"aac",bitrate:128000});
      output.addVideoTrack(track,{frameRate:30}); output.addAudioTrack(audio); await output.start();
      const sound = new AudioBuffer({numberOfChannels:1,length:48000*3,sampleRate:48000}), channel=sound.getChannelData(0);
      for(let i=0;i<channel.length;i++) channel[i]=Math.sin(i * 440 * 2 * Math.PI / 48000)*.1;
      const audioTask=audio.add(sound).then(()=>audio.close());
      for(let frame=0;frame<90;frame++) {
        c.fillStyle="#cc4433";c.fillRect(0,0,1024,288);c.fillStyle="#2255cc";c.fillRect(0,288,1024,288);
        c.fillStyle="white";c.font="bold 64px sans-serif";c.fillText(`CUT/WEAVE ${frame}`,120+frame,160);
        await track.add(frame/30,1/30);
      }
      track.close();await audioTask;await output.finalize();
      const file=new File([target.buffer!],"worker-fixture.mp4",{type:"video/mp4"});
      const inspect = async (blob: Blob, expectedFrames=90, expectedDuration=3) => {
        const input = new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
        try {
          const v=await input.getPrimaryVideoTrack(), a=await input.getPrimaryAudioTrack();
          assert(Boolean(v && a),"Picture or sound missing");
          const colorSpace=(await v!.getDecoderConfig())?.colorSpace;
          assert(colorSpace?.fullRange===false && colorSpace.matrix==="bt709" && colorSpace.transfer==="bt709","Ambiguous video color metadata");
          const sink=new CanvasSink(v!,{poolSize:1}), duration=await input.computeDuration();
          let frames=0, oriented=true; const samples: unknown[]=[];
          for await(const sample of sink.canvases()) {
            frames++; const surface=sample.canvas;const ctx=surface.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
            const top=ctx.getImageData(Math.floor(surface.width*.9),Math.floor(surface.height/4),1,1).data,bottom=ctx.getImageData(Math.floor(surface.width*.9),Math.floor(surface.height*3/4),1,1).data;
            if(frames===1 || frames===expectedFrames) samples.push({frame:frames,top:[...top],bottom:[...bottom]});
            if(top[0] < 170 || bottom[2] < 170) oriented=false;
          }
          report({inspection:{frames,duration,oriented,samples}});
          assert(frames===expectedFrames && oriented && Math.abs(duration-expectedDuration)<.1,"Lost frames, timing or orientation");
          return {frames,duration,width:await v!.getDisplayWidth(),height:await v!.getDisplayHeight(),audio:await a!.getCodec(),oriented,colorSpace};
        } finally {input.dispose();}
      };
      for(const device of ["gpu"] as const) {
        setStatus(`Exporting ${device}`);
        const started=performance.now();
        const reply=await request({type:"export",jobId:crypto.randomUUID(),file,device,settings:DEFAULT_ENHANCER_SETTINGS,width:2048,height:1152});
        assert(reply.type==="complete" && Boolean(reply.buffer),"No output buffer");
        const bytes=(reply as Extract<Reply,{type:"complete"}>).buffer!;
        report({test:"enhanced 2x MP4 decode",device,elapsedMs:performance.now()-started,...await inspect(new Blob([bytes]))});
      }
      canvas.width=96;canvas.height=54;
      const cpuTarget=new BufferTarget(),cpuOutput=new Output({format:new Mp4OutputFormat(),target:cpuTarget});
      const cpuTrack=new CanvasSource(canvas,{codec:"avc",bitrate:new Quality("high")}),cpuAudio=new AudioBufferSource({codec:"aac",bitrate:128000});
      cpuOutput.addVideoTrack(cpuTrack,{frameRate:10});cpuOutput.addAudioTrack(cpuAudio);await cpuOutput.start();
      const cpuSound=new AudioBuffer({numberOfChannels:1,length:48000*1.5,sampleRate:48000});cpuSound.getChannelData(0).set(channel.subarray(0,48000*1.5));
      const cpuAudioTask=cpuAudio.add(cpuSound).then(()=>cpuAudio.close());
      for(let frame=0;frame<15;frame++){
        c.fillStyle="#cc4433";c.fillRect(0,0,96,27);c.fillStyle="#2255cc";c.fillRect(0,27,96,27);
        c.fillStyle="white";c.fillRect(5+frame,5,12,7);await cpuTrack.add(frame/10,.1);
      }
      cpuTrack.close();await cpuAudioTask;await cpuOutput.finalize();
      const cpuFile=new File([cpuTarget.buffer!],"cpu-restoration-fixture.mp4",{type:"video/mp4"});
      setStatus("Exporting CPU restoration fixture");
      const cpuStarted=performance.now(),cpuReply=await request({type:"export",jobId:crypto.randomUUID(),file:cpuFile,device:"cpu",settings:DEFAULT_ENHANCER_SETTINGS,width:192,height:108});
      assert(cpuReply.type==="complete"&&!!cpuReply.buffer,"No CPU output");
      report({test:"CPU model + color + audio export",elapsedMs:performance.now()-cpuStarted,...await inspect(new Blob([(cpuReply as Extract<Reply,{type:"complete"}>).buffer!]),15,1.5)});
      const root=await navigator.storage.getDirectory(), handle=await root.getFileHandle("enhancer-stream-check.mp4",{create:true});
      try {
        setStatus("Checking streaming output");
        const reply=await request({type:"export",jobId:crypto.randomUUID(),file,device:"gpu",settings:DEFAULT_ENHANCER_SETTINGS,width:1024,height:576,fileHandle:handle});
        assert(reply.type==="complete" && !reply.buffer,"Streaming output buffered");
        report({test:"streamed MP4",...await inspect(await handle.getFile())});
      } finally {await root.removeEntry("enhancer-stream-check.mp4");}
      const cancelId=crypto.randomUUID();cancelOnProgress=cancelId;setStatus("Checking cancellation");
      const cancelled=await request({type:"export",jobId:cancelId,file:cpuFile,device:"cpu",settings:DEFAULT_ENHANCER_SETTINGS,width:192,height:108});
      assert(cancelled.type==="cancelled","Cancellation failed");report({test:"CPU export cancellation",passed:true});
      setStatus("ALL BROWSER CHECKS PASSED");
    } catch(error) {setStatus(`FAILED: ${String(error)}`);} finally {worker.terminate();}
  };
  return <main><h1>Local enhancer regression</h1><button onClick={()=>void run()}>Run browser checks</button><p role="status">{status}</p><pre>{JSON.stringify(results,null,2)}</pre></main>;
}
