/// <reference types="@webgpu/types" />
import * as ort from "onnxruntime-web/webgpu";

let gpuConfiguration:Promise<boolean>|null=null;
let storageBindingLimit=128*1024*1024;
export function restorationGpuPixelBudget(capture=false,half=false,native=false) {
  // ORT requests the adapter's advertised limits. Use them instead of assuming
  // every card has only the WebGPU minimum, but cap the concat at 256 MiB.
  const memory=(navigator as Navigator & {deviceMemory?:number}).deviceMemory;
  const ceiling=(memory!==undefined&&memory<=4 ? 128 : 256)*1024*1024;
  if(native)return Math.min(2_500_000,Math.floor(storageBindingLimit*.75/(8*4)));
  const bindingBudget=Math.floor(Math.min(ceiling,storageBindingLimit*.75)/(192*(half?2:4)));
  // The installed ORT capture pins intermediates rather than recycling them.
  // 3,522 spatial channels in the author graph = 14,088 FP32 bytes per input
  // pixel before backend workspaces/layout conversion. Bound their sum to
  // < 1.85 GiB, rather than capturing a 5+ GiB full-size graph on an 8 GB GPU.
  return capture ? Math.min(bindingBudget,half?262144:131072) : bindingBudget;
}
export function configureRestorationGpu():Promise<boolean> {
  // Reuse the adapter as well as the ORT session across preview/export frames.
  // Tile planning needs the precision before it chooses a safe buffer area.
  if(gpuConfiguration)return gpuConfiguration;
  gpuConfiguration=configureGpu().catch(error=>{gpuConfiguration=null;throw error;});
  return gpuConfiguration;
}

async function configureGpu() {
  if (!navigator.gpu) throw new Error("GPU restoration requires a WebGPU-enabled browser. Try the latest Chrome or Edge with hardware acceleration enabled.");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter || adapter.isFallbackAdapter) throw new Error("No compatible hardware GPU is available. Enable browser hardware acceleration to continue.");
  ort.env.webgpu.adapter = adapter;
  storageBindingLimit=adapter.limits.maxStorageBufferBindingSize;
  ort.env.webgpu.powerPreference = "high-performance";
  return adapter.features.has("shader-f16");
}

export async function requestRestorationGpuDevice() {
  const device = await ort.env.webgpu.device;
  if (!device) throw new Error("The Restoration GPU device could not be initialized.");
  return device;
}

const preprocessShader = `
struct Params { tileWidth: u32, tileHeight: u32, pad: u32, x: u32, y: u32, width: u32, height: u32, a: u32 }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> input: array<f32>;
@group(0) @binding(2) var<uniform> p: Params;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.tileWidth || id.y >= p.tileHeight) { return; }
  let point = clamp(vec2<i32>(vec2<u32>(p.x + id.x, p.y + id.y)) - vec2<i32>(i32(p.pad)), vec2<i32>(0), vec2<i32>(i32(p.width) - 1, i32(p.height) - 1));
  let rgb = textureLoad(source, point, 0).rgb;
  let index = id.y * p.tileWidth + id.x;
  input[index] = dot(rgb,vec3<f32>(0.299,0.587,0.114));
}`;

const postprocessShader = `
struct Params { tileWidth: u32, tileHeight: u32, pad: u32, x: u32, y: u32, inWidth: u32, inHeight: u32, outWidth: u32, outHeight: u32, left: u32, top: u32, width: u32, height: u32, strength: f32, a: f32, b: f32 }
@group(0) @binding(0) var<storage, read> tensorValues: array<f32>;
@group(0) @binding(1) var outputImage: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> p: Params;
@group(0) @binding(3) var original: texture_2d<f32>;
@group(0) @binding(4) var originalSampler: sampler;
fn sampleTensor(point: vec2<i32>) -> f32 {
  let width = p.tileWidth * 2u; let height = p.tileHeight * 2u;
  let clamped = clamp(point, vec2<i32>(0), vec2<i32>(i32(width)-1,i32(height)-1));
  let index = u32(clamped.y) * width + u32(clamped.x);
  return tensorValues[index];
}
fn bilinear(point: vec2<f32>) -> f32 {
  let low = vec2<i32>(floor(point)); let weight = fract(point);
  let top = mix(sampleTensor(low), sampleTensor(low + vec2<i32>(1, 0)), weight.x);
  let bottom = mix(sampleTensor(low + vec2<i32>(0, 1)), sampleTensor(low + vec2<i32>(1, 1)), weight.x);
  return mix(top, bottom, weight.y);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.width || id.y >= p.height) { return; }
  let pixel = vec2<u32>(p.left + id.x, p.top + id.y);
  let uv = (vec2<f32>(pixel) + 0.5) / vec2<f32>(f32(p.outWidth), f32(p.outHeight));
  let source = uv * vec2<f32>(f32(p.inWidth), f32(p.inHeight));
  let point = (source - vec2<f32>(f32(p.x), f32(p.y)) + f32(p.pad)) * 2.0 - 0.5;
  let steps = clamp(u32(round(2.0 * f32(p.inWidth) / f32(p.outWidth))), 1u, 2u);
  var luma = 0.0;
  for (var y = 0u; y < steps; y++) { for (var x = 0u; x < steps; x++) {
    luma += bilinear(point + vec2<f32>(f32(x), f32(y)) - f32(steps - 1u) * 0.5);
  } }
  luma /= f32(steps * steps);
  let base = textureSampleLevel(original, originalSampler, uv, 0).rgb;
  let delta = luma-dot(base,vec3<f32>(0.299,0.587,0.114));
  textureStore(outputImage, pixel, vec4<f32>(clamp(base+vec3<f32>(delta*p.strength),vec3<f32>(0),vec3<f32>(1)),1));
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

export class RestorationGpuProcessor {
  private inputTexture: GPUTexture;
  private outputTexture: GPUTexture;
  private inputBuffer: GPUBuffer;
  private preUniform: GPUBuffer;
  private postUniform: GPUBuffer;
  private prePipeline!: GPUComputePipeline;
  private postPipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private inputTensor: ort.Tensor;
  private sampler: GPUSampler;
  private preBind!: GPUBindGroup;
  private presentBind!: GPUBindGroup;
  private context: GPUCanvasContext;
  readonly canvas: OffscreenCanvas;

  constructor(private device: GPUDevice, readonly width: number, readonly height: number, readonly outputWidth: number, readonly outputHeight: number, readonly tileWidth: number, readonly tileHeight: number, readonly pad: number) {
    this.sampler = device.createSampler({magFilter:"linear",minFilter:"linear"});
    this.canvas = new OffscreenCanvas(outputWidth, outputHeight);
    const context = this.canvas.getContext("webgpu");
    if (!context) throw new Error("The GPU preview canvas could not be created.");
    this.context = context;
    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: "opaque" });
    this.inputTexture = device.createTexture({ size: [width, height], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.outputTexture = device.createTexture({ size: [outputWidth, outputHeight], format: "rgba8unorm", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    this.inputBuffer = device.createBuffer({ size: tileWidth * tileHeight * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.preUniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.postUniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.inputTensor = ort.Tensor.fromGpuBuffer(this.inputBuffer, { dataType: "float32", dims: [1, 1, tileHeight, tileWidth] });
  }

  async initialize() {
    const compile = async (code: string, label: string) => {
      const shader = this.device.createShaderModule({ code, label });
      const info = await shader.getCompilationInfo();
      const errors = info.messages.filter((message) => message.type === "error");
      if (errors.length) throw new Error(`${label}: ${errors.map((message) => message.message).join("; ")}`);
      return shader;
    };
    const [pre, post, present] = await Promise.all([compile(preprocessShader, "Restoration input"), compile(postprocessShader, "Restoration output"), compile(presentShader, "Restoration display")]);
    [this.prePipeline, this.postPipeline, this.renderPipeline] = await Promise.all([
      this.device.createComputePipelineAsync({ layout: "auto", compute: { module: pre, entryPoint: "main" } }),
      this.device.createComputePipelineAsync({ layout: "auto", compute: { module: post, entryPoint: "main" } }),
      this.device.createRenderPipelineAsync({ layout: "auto", vertex: { module: present, entryPoint: "vertex" }, fragment: { module: present, entryPoint: "fragment", targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] } }),
    ]);
    this.preBind = this.device.createBindGroup({ layout: this.prePipeline.getBindGroupLayout(0), entries: [{binding:0,resource:this.inputTexture.createView()},{binding:1,resource:{buffer:this.inputBuffer}},{binding:2,resource:{buffer:this.preUniform}}] });
    this.presentBind = this.device.createBindGroup({ layout:this.renderPipeline.getBindGroupLayout(0), entries:[{binding:0,resource:this.outputTexture.createView()},{binding:1,resource:this.sampler}] });
  }

  async render(source: OffscreenCanvas, model: ort.InferenceSession, shouldCancel: () => boolean, strength: number) {
    const device = this.device;
    device.queue.copyExternalImageToTexture({ source }, { texture: this.inputTexture }, [this.width, this.height]);
    const coreWidth = this.tileWidth - this.pad*2,coreHeight=this.tileHeight-this.pad*2;
    for (let y = 0; y < this.height; y += coreHeight) {
      for (let x = 0; x < this.width; x += coreWidth) {
        if (shouldCancel()) throw new DOMException("Cancelled", "AbortError");
        device.queue.writeBuffer(this.preUniform, 0, new Uint32Array([this.tileWidth,this.tileHeight, this.pad, x, y, this.width, this.height, 0]));
        const preEncoder = device.createCommandEncoder(); const pre = preEncoder.beginComputePass();
        pre.setPipeline(this.prePipeline); pre.setBindGroup(0, this.preBind); pre.dispatchWorkgroups(Math.ceil(this.tileWidth / 8), Math.ceil(this.tileHeight / 8)); pre.end();
        device.queue.submit([preEncoder.finish()]);
        const result = await model.run({ input: this.inputTensor });
        try {
          const tensor = result.output;
          if (tensor?.location !== "gpu-buffer") throw new Error("Restoration output did not stay on the GPU. Reload and check browser hardware acceleration.");
          const left = Math.round(x * this.outputWidth / this.width), top = Math.round(y * this.outputHeight / this.height);
          const right = Math.round(Math.min(x + coreWidth, this.width) * this.outputWidth / this.width), bottom = Math.round(Math.min(y + coreHeight, this.height) * this.outputHeight / this.height);
          const params = new ArrayBuffer(64);
          new Uint32Array(params).set([this.tileWidth,this.tileHeight, this.pad, x, y, this.width, this.height, this.outputWidth, this.outputHeight, left, top, right - left, bottom - top]);
          new Float32Array(params)[13] = strength;
          device.queue.writeBuffer(this.postUniform, 0, params);
          const postBind = device.createBindGroup({ layout: this.postPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: tensor.gpuBuffer as GPUBuffer } }, { binding: 1, resource: this.outputTexture.createView() }, { binding: 2, resource: { buffer: this.postUniform } }, { binding: 3, resource: this.inputTexture.createView() }, { binding: 4, resource: this.sampler }] });
          const postEncoder = device.createCommandEncoder(); const post = postEncoder.beginComputePass();
          post.setPipeline(this.postPipeline); post.setBindGroup(0, postBind); post.dispatchWorkgroups(Math.ceil((right - left) / 8), Math.ceil((bottom - top) / 8)); post.end();
          device.queue.submit([postEncoder.finish()]);
        } finally { for (const tensor of Object.values(result)) tensor.dispose(); }
      }
    }
    if (shouldCancel()) throw new DOMException("Cancelled", "AbortError");
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(this.renderPipeline); pass.setBindGroup(0, this.presentBind); pass.draw(3); pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    return this.canvas;
  }

  dispose() {
    this.inputTensor.dispose();
    this.inputTexture.destroy(); this.outputTexture.destroy(); this.inputBuffer.destroy();
    this.preUniform.destroy(); this.postUniform.destroy(); this.context.unconfigure();
    this.canvas.width = 1; this.canvas.height = 1;
  }
}
