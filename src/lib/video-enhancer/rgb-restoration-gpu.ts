/// <reference types="@webgpu/types" />
import * as ort from "onnxruntime-web/webgpu";
import type { EnhancerActivityCallback, EnhancerSettings } from "./types";
import { GpuFinisher } from "./gpu-finishing";
import { yieldToWorker } from "./worker-yield";

const preprocessShader = (half=false) => `
struct Params { tileWidth: u32, tileHeight: u32, pad: u32, x: u32, y: u32, width: u32, height: u32, a: u32 }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> input: array<${half ? "u32" : "f32"}>;
@group(0) @binding(2) var<uniform> p: Params;
fn reflectCoordinate(v:i32,size:i32)->i32{
  let period=2*(size-1);let positive=((v%period)+period)%period;
  return min(positive,period-positive);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.tileWidth/${half ? "2u" : "1u"} || id.y >= p.tileHeight) { return; }
  let localX=id.x*${half ? "2u" : "1u"};
  let coordinate=vec2i(vec2u(p.x+localX,p.y+id.y))-vec2i(i32(p.pad));
  var point=clamp(coordinate,vec2i(0),vec2i(i32(p.width)-1,i32(p.height)-1));
  if(p.a==1u){point=vec2i(reflectCoordinate(coordinate.x,i32(p.width)),reflectCoordinate(coordinate.y,i32(p.height)));}
  let rgb = textureLoad(source, point, 0).rgb;
  let index = id.y * p.tileWidth + localX;
  let plane=p.tileWidth*p.tileHeight;
  ${half ? `
  // Each invocation owns two adjacent half values; no shared-word races.
  let next=clamp(coordinate+vec2i(1,0),vec2i(0),vec2i(i32(p.width)-1,i32(p.height)-1));
  let other=textureLoad(source,next,0).rgb;
  input[index/2u]=pack2x16float(vec2f(rgb.r,other.r));
  input[(index+plane)/2u]=pack2x16float(vec2f(rgb.g,other.g));
  input[(index+plane*2u)/2u]=pack2x16float(vec2f(rgb.b,other.b));
  ` : `input[index]=rgb.r;input[index+plane]=rgb.g;input[index+plane*2u]=rgb.b;`}
}`;

const postprocessShader = (half=false) => `
struct Params { tileWidth: u32, tileHeight: u32, pad: u32, x: u32, y: u32, inWidth: u32, inHeight: u32, outWidth: u32, outHeight: u32, left: u32, top: u32, width: u32, height: u32, strength: f32, a: f32, b: f32 }
@group(0) @binding(0) var<storage, read> tensorValues: array<${half ? "u32" : "f32"}>;
@group(0) @binding(1) var outputImage: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> p: Params;
@group(0) @binding(3) var original: texture_2d<f32>;
@group(0) @binding(4) var originalSampler: sampler;
fn value(index:u32)->f32{return ${half ? "unpack2x16float(tensorValues[index/2u])[index%2u]" : "tensorValues[index]"};}
fn sampleTensor(point: vec2<i32>, channel:u32) -> f32 {
  let scale=u32(p.a);let width=p.tileWidth*scale;let height=p.tileHeight*scale;
  let clamped = clamp(point, vec2<i32>(0), vec2<i32>(i32(width)-1,i32(height)-1));
  let plane=p.tileWidth*p.tileHeight;
  if(p.b>.5){return clamp(value(channel*plane+u32(clamped.y)*p.tileWidth+u32(clamped.x)),0.0,1.0);}
  if(scale==1u){
    let index=u32(clamped.y)*p.tileWidth+u32(clamped.x);
    let offset=channel*4u*plane+index;
    // Clip each prediction BEFORE averaging. No enlarged source-size tensor.
    return (clamp(value(offset),0.0,1.0)+clamp(value(offset+plane),0.0,1.0)
      +clamp(value(offset+plane*2u),0.0,1.0)+clamp(value(offset+plane*3u),0.0,1.0))*.25;
  }
  let subpixel=(u32(clamped.y)%2u)*2u+u32(clamped.x)%2u;
  let index=(channel*4u+subpixel)*plane+(u32(clamped.y)/2u)*p.tileWidth+u32(clamped.x)/2u;
  return clamp(value(index),0.0,1.0);
}
fn bilinear(point: vec2<f32>, channel:u32) -> f32 {
  let low = vec2<i32>(floor(point)); let weight = fract(point);
  let top = mix(sampleTensor(low,channel), sampleTensor(low + vec2<i32>(1, 0),channel), weight.x);
  let bottom = mix(sampleTensor(low + vec2<i32>(0, 1),channel), sampleTensor(low + vec2<i32>(1, 1),channel), weight.x);
  return mix(top, bottom, weight.y);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.width || id.y >= p.height) { return; }
  let pixel = vec2<u32>(p.left + id.x, p.top + id.y);
  let uv = (vec2<f32>(pixel) + 0.5) / vec2<f32>(f32(p.outWidth), f32(p.outHeight));
  let source = uv * vec2<f32>(f32(p.inWidth), f32(p.inHeight));
  let scale=u32(p.a);
  if(p.outWidth==p.inWidth*scale&&p.outHeight==p.inHeight*scale) {
    let q=vec2i(pixel)-vec2i(i32(p.x),i32(p.y))*i32(scale)+vec2i(i32(p.pad*scale));
    let model=vec3f(sampleTensor(q,0u),sampleTensor(q,1u),sampleTensor(q,2u));
    let base=textureSampleLevel(original,originalSampler,uv,0.0).rgb;
    textureStore(outputImage,pixel,vec4f(clamp(mix(base,model,p.strength),vec3f(0),vec3f(1)),1));return;
  }
  let point = (source - vec2<f32>(f32(p.x), f32(p.y)) + f32(p.pad)) * f32(scale) - 0.5;
  let steps = clamp(u32(round(f32(scale) * f32(p.inWidth) / f32(p.outWidth))), 1u, 2u);
  var reconstructed = vec3f(0);
  for (var y = 0u; y < steps; y++) { for (var x = 0u; x < steps; x++) {
    let tap=point+vec2f(f32(x),f32(y))-f32(steps-1u)*.5;
    reconstructed+=vec3f(bilinear(tap,0u),bilinear(tap,1u),bilinear(tap,2u));
  } }
  reconstructed /= f32(steps * steps);
  let base = textureSampleLevel(original, originalSampler, uv, 0.0).rgb;
  let rgb=mix(base,reconstructed,p.strength);
  textureStore(outputImage, pixel, vec4<f32>(clamp(rgb,vec3<f32>(0),vec3<f32>(1)),1));
}`;

const presentShader = `
@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var pictureSampler: sampler;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertex(@builtin(vertex_index) index: u32) -> Vertex {
  let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
  return Vertex(vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0, 1), uv);
}
@fragment fn fragment(v: Vertex) -> @location(0) vec4<f32> { return textureSample(picture, pictureSampler, v.uv); }
`;

export class RgbRestorationGpuProcessor {
  private inputTexture: GPUTexture;
  private outputTexture: GPUTexture;
  private inputBuffer: GPUBuffer;
  private preUniform: GPUBuffer;
  private postUniform: GPUBuffer;
  private prePipeline!: GPUComputePipeline;
  private postPipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private inputTensor: ort.Tensor;
  private heldOutput:ort.Tensor|null=null;
  private pendingOutput:ort.Tensor|null=null;
  private modelOutput:GPUBuffer|null=null;
  private finisher:GpuFinisher;
  private sampler: GPUSampler;
  private preBind!: GPUBindGroup;
  private presentBind!: GPUBindGroup;
  private context: GPUCanvasContext;
  private postBind!:GPUBindGroup;
  private preParams=new Uint32Array(8);
  private postParams=new ArrayBuffer(64);
  readonly canvas: OffscreenCanvas;

  constructor(private device: GPUDevice, readonly width: number, readonly height: number, readonly outputWidth: number, readonly outputHeight: number, readonly tileWidth: number, readonly tileHeight: number, readonly pad: number,readonly modelScale:1|2=2,readonly native=false,readonly half=false) {
    this.sampler = device.createSampler({magFilter:"linear",minFilter:"linear"});
    this.canvas = new OffscreenCanvas(outputWidth, outputHeight);
    const context = this.canvas.getContext("webgpu");
    if (!context) throw new Error("The GPU preview canvas could not be created.");
    this.context = context;
    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: "opaque" });
    this.inputTexture = device.createTexture({ size: [width, height], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.outputTexture = device.createTexture({ size: [outputWidth, outputHeight], format: "rgba8unorm", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    this.inputBuffer = device.createBuffer({ size: tileWidth * tileHeight * 3 * (half?2:4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.preUniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.postUniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.inputTensor = ort.Tensor.fromGpuBuffer(this.inputBuffer, { dataType: half?"float16":"float32", dims: [1, 3, tileHeight, tileWidth] });
    this.finisher=new GpuFinisher(device,this.outputTexture,this.inputTexture,outputWidth,outputHeight,width,height);
  }

  async initialize() {
    const compile = async (code: string, label: string) => {
      const shader = this.device.createShaderModule({ code, label });
      const info = await shader.getCompilationInfo();
      const errors = info.messages.filter((message) => message.type === "error");
      if (errors.length) throw new Error(`${label}: ${errors.map((message) => message.message).join("; ")}`);
      return shader;
    };
    const [pre, post, present] = await Promise.all([compile(preprocessShader(this.half), "Restoration input"), compile(postprocessShader(this.half), "Restoration output"), compile(presentShader, "Restoration display")]);
    [this.prePipeline, this.postPipeline, this.renderPipeline] = await Promise.all([
      this.device.createComputePipelineAsync({ layout: "auto", compute: { module: pre, entryPoint: "main" } }),
      this.device.createComputePipelineAsync({ layout: "auto", compute: { module: post, entryPoint: "main" } }),
      this.device.createRenderPipelineAsync({ layout: "auto", vertex: { module: present, entryPoint: "vertex" }, fragment: { module: present, entryPoint: "fragment", targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] } }),
    ]);
    this.preBind = this.device.createBindGroup({ layout: this.prePipeline.getBindGroupLayout(0), entries: [{binding:0,resource:this.inputTexture.createView()},{binding:1,resource:{buffer:this.inputBuffer}},{binding:2,resource:{buffer:this.preUniform}}] });
    this.presentBind = this.device.createBindGroup({ layout:this.renderPipeline.getBindGroupLayout(0), entries:[{binding:0,resource:this.outputTexture.createView()},{binding:1,resource:this.sampler}] });
    await this.finisher.initialize();
  }

  async render(source:OffscreenCanvas,model:ort.InferenceSession,shouldCancel:()=>boolean,strength:number,onActivity?:EnhancerActivityCallback) {
    const device=this.device;
    device.queue.copyExternalImageToTexture({source},{texture:this.inputTexture},[this.width,this.height]);
    const coreWidth=this.tileWidth-this.pad*2,coreHeight=this.tileHeight-this.pad*2;
    const totalTiles=Math.ceil(this.width/coreWidth)*Math.ceil(this.height/coreHeight);
    let completedTiles=0;
    // After a model run, retain its post-pass encoder. At the next tile append
    // preprocessing and submit both together, before ORT can overwrite model
    // output. Queue ordering also protects the reused uniform buffers.
    let pending:GPUCommandEncoder|null=null;
    onActivity?.({stage:"restoring",completedTiles,totalTiles});
    for(let y=0;y<this.height;y+=coreHeight)for(let x=0;x<this.width;x+=coreWidth) {
      if(completedTiles%4===0)await yieldToWorker();
      if(shouldCancel())throw new DOMException("Cancelled","AbortError");
      this.preParams.set([this.tileWidth,this.tileHeight,this.pad,x,y,this.width,this.height,this.native?1:0]);
      device.queue.writeBuffer(this.preUniform,0,this.preParams);
      const beforeModel:GPUCommandEncoder=pending??device.createCommandEncoder();
      const pre=beforeModel.beginComputePass();
      pre.setPipeline(this.prePipeline);pre.setBindGroup(0,this.preBind);
      pre.dispatchWorkgroups(Math.ceil(this.tileWidth/(this.half?16:8)),Math.ceil(this.tileHeight/8));pre.end();
      device.queue.submit([beforeModel.finish()]);pending=null;
      this.pendingOutput?.dispose();this.pendingOutput=null;
      // Let ORT own the output. External preallocated output + capture took
      // the stale-handle path in v11. A retained first result pins its storage.
      const outputs=await model.run({[model.inputNames[0]]:this.inputTensor});
      const result=outputs[model.outputNames[0]];
      const buffer=result.gpuBuffer;
      if(result.type!==(this.half?"float16":"float32")||result.dims.join(":")!==`1:${this.native?3:12}:${this.tileHeight}:${this.tileWidth}`){result.dispose();throw new Error("Unexpected GPU restoration output shape.");}
      if(!this.heldOutput)this.heldOutput=result;else this.pendingOutput=result;
      if(this.modelOutput!==buffer){
        this.modelOutput=buffer;
        this.postBind=device.createBindGroup({layout:this.postPipeline.getBindGroupLayout(0),entries:[
          {binding:0,resource:{buffer}},{binding:1,resource:this.outputTexture.createView()},
          {binding:2,resource:{buffer:this.postUniform}},{binding:3,resource:this.inputTexture.createView()},{binding:4,resource:this.sampler},
        ]});
      }
      if(shouldCancel())throw new DOMException("Cancelled","AbortError");
      const left=Math.round(x*this.outputWidth/this.width),top=Math.round(y*this.outputHeight/this.height);
      const right=Math.round(Math.min(x+coreWidth,this.width)*this.outputWidth/this.width);
      const bottom=Math.round(Math.min(y+coreHeight,this.height)*this.outputHeight/this.height);
      new Uint32Array(this.postParams).set([this.tileWidth,this.tileHeight,this.pad,x,y,this.width,this.height,this.outputWidth,this.outputHeight,left,top,right-left,bottom-top]);
      new Float32Array(this.postParams).set([strength,this.modelScale,this.native?1:0],13);
      device.queue.writeBuffer(this.postUniform,0,this.postParams);
      pending=device.createCommandEncoder();
      const post=pending.beginComputePass();post.setPipeline(this.postPipeline);post.setBindGroup(0,this.postBind);
      post.dispatchWorkgroups(Math.ceil((right-left)/8),Math.ceil((bottom-top)/8));post.end();
      onActivity?.({stage:"restoring",completedTiles:++completedTiles,totalTiles});
    }
    if(shouldCancel())throw new DOMException("Cancelled","AbortError");
    if(pending)device.queue.submit([pending.finish()]);
    this.pendingOutput?.dispose();this.pendingOutput=null;
    if(shouldCancel())throw new DOMException("Cancelled","AbortError");
    return this.canvas;
  }

  async finish(settings:EnhancerSettings,cancel:()=>boolean,present:boolean){
    if(cancel())throw new DOMException("Cancelled","AbortError");
    this.finisher.finish(settings);
    if(present){
      this.presentBind=this.device.createBindGroup({layout:this.renderPipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:this.finisher.result.createView()},{binding:1,resource:this.sampler},
      ]});
      const encoder=this.device.createCommandEncoder();
      const pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:{r:0,g:0,b:0,a:1}}]});
      pass.setPipeline(this.renderPipeline);pass.setBindGroup(0,this.presentBind);pass.draw(3);pass.end();
      this.device.queue.submit([encoder.finish()]);await this.device.queue.onSubmittedWorkDone();
    }
    if(cancel())throw new DOMException("Cancelled","AbortError");
    return this.canvas;
  }

  toVideoFrame(timestamp:number,duration:number,cancel:()=>boolean){return this.finisher.toVideoFrame(timestamp,duration,cancel);}
  releaseOutput(){this.pendingOutput?.dispose();this.pendingOutput=null;this.heldOutput?.dispose();this.heldOutput=null;this.modelOutput=null;}

  dispose() {
    this.releaseOutput();this.inputTensor.dispose();this.finisher.dispose();
    this.inputTexture.destroy(); this.outputTexture.destroy(); this.inputBuffer.destroy();
    this.preUniform.destroy(); this.postUniform.destroy(); this.context.unconfigure();
    this.canvas.width = 1; this.canvas.height = 1;
  }
}
