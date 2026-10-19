import { restorationInputSize } from "./restoration-plan";

interface LayerWeights { weights:number[]; bias:number[] }
interface ModelWeights { layers:Record<string,LayerWeights> }
let weights:Promise<ModelWeights>|null=null;
function loadWeights() {
  weights??=fetch(`${self.location.origin}/models/video-enhancer/websr-cnn-2x-m-rl.json`)
    .then(response=>{if(!response.ok)throw new Error("The local RGB restoration model could not load.");return response.json() as Promise<ModelWeights>;})
    .catch(error=>{weights=null;throw error;});
  return weights;
}

// Weight layout follows WebSR 0.0.16 (MIT). This runtime deliberately does not
// use its row-wrapping feature reads, repeat sampler or per-frame pipeline setup.
const vertex=`@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);
}`;
interface Stage { pipeline:GPUComputePipeline; bindings:GPUBindGroup }

/** One real-life-trained Medium RGB CNN, no stacked Anime4K repair network.
 * All convolution coordinates clamp independently to the actual source edges.
 * Native-size output uses the same 2x reconstruction, downsampled by the finish. */
export class WebFrameRestorer {
  readonly sourceCanvas=new OffscreenCanvas(2,2);
  private sourceContext:OffscreenCanvasRenderingContext2D;
  private output=new OffscreenCanvas(4,4);
  private device:GPUDevice|null=null;
  private input:GPUTexture|null=null;
  private result:GPUTexture|null=null;
  private context:GPUCanvasContext|null=null;
  private stages:Stage[]=[];
  private paint:GPURenderPipeline|null=null;
  private paintBindings:GPUBindGroup|null=null;
  private key="";
  private disposed=false;
  private lost=false;

  constructor(readonly outputWidth:number,readonly outputHeight:number) {
    const context=this.sourceCanvas.getContext("2d",{alpha:false,colorSpace:"srgb"});
    if(!context)throw new Error("Local frame capture is unavailable.");
    this.sourceContext=context;
  }

  async render(source:CanvasImageSource,width:number,height:number,shouldCancel:()=>boolean) {
    const size=restorationInputSize(width,height,this.outputWidth,this.outputHeight);
    const w=size.width,h=size.height,key=`${w}:${h}`;
    if(this.sourceCanvas.width!==w||this.sourceCanvas.height!==h){this.sourceCanvas.width=w;this.sourceCanvas.height=h;}
    this.sourceContext.drawImage(source,0,0,w,h);
    this.check(shouldCancel);
    if(this.key!==key) {
      this.release();
      try {await this.initialize(w,h,shouldCancel);this.key=key;}
      catch(error){this.release();throw error;}
    }
    this.check(shouldCancel);
    const device=this.device!;
    device.queue.copyExternalImageToTexture({source:this.sourceCanvas},{texture:this.input!},[w,h]);
    const commands=device.createCommandEncoder({label:"Local RGB reconstruction"});
    for(const stage of this.stages) {
      const pass=commands.beginComputePass();
      pass.setPipeline(stage.pipeline);pass.setBindGroup(0,stage.bindings);
      pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(h/8));pass.end();
    }
    const pass=commands.beginRenderPass({colorAttachments:[{view:this.context!.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:{r:0,g:0,b:0,a:1}}]});
    pass.setPipeline(this.paint!);pass.setBindGroup(0,this.paintBindings!);pass.draw(3);pass.end();
    device.queue.submit([commands.finish()]);
    await device.queue.onSubmittedWorkDone();
    this.check(shouldCancel);
    return this.output;
  }

  private check(shouldCancel:()=>boolean) {
    if(this.disposed||shouldCancel())throw new DOMException("Cancelled","AbortError");
    if(this.lost)throw new Error("The GPU connection was lost. Reload to restart it.");
  }

  private async initialize(w:number,h:number,shouldCancel:()=>boolean) {
    const [model,adapter]=await Promise.all([loadWeights(),navigator.gpu?.requestAdapter({powerPreference:"high-performance"})]);
    this.check(shouldCancel);
    if(!adapter||adapter.isFallbackAdapter)throw new Error("RGB restoration requires a hardware WebGPU adapter.");
    const device=await adapter.requestDevice();
    if(this.disposed||shouldCancel()){device.destroy();throw new DOMException("Cancelled","AbortError");}
    this.device=device;
    void device.lost.then(()=>{if(this.device===device)this.lost=true;});
    if(w*h*16>device.limits.maxStorageBufferBindingSize||w*2>device.limits.maxTextureDimension2D||h*2>device.limits.maxTextureDimension2D)
      throw new Error("This video exceeds the GPU restoration memory limits. Use a smaller output or select CPU.");
    this.input=device.createTexture({size:[w,h],format:"rgba8unorm",usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});
    this.result=device.createTexture({size:[w*2,h*2],format:"rgba8unorm",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});
    const features=Array.from({length:7},(_,i)=>device.createBuffer({label:`RGB feature ${i}`,size:w*h*16,usage:GPUBufferUsage.STORAGE}));
    const uniform=(layer:LayerWeights,matrices:number)=>{
      if(layer.weights.length!==matrices*16||layer.bias.length!==4)throw new Error("Invalid local RGB model weights.");
      const buffer=device.createBuffer({size:matrices*64+16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      device.queue.writeBuffer(buffer,0,new Float32Array([...layer.weights,...layer.bias]));return buffer;
    };
    const dimensions=`const W:u32=${w}u;const H:u32=${h}u;`;
    const location=`let p=vec2i(id.xy);let index=id.y*W+id.x;`;
    const offsets=`let offset=vec2i(i32(k/3u)-1,i32(k%3u)-1);
      let q=clamp(p+offset,vec2i(0),vec2i(i32(W)-1,i32(H)-1));`;
    for(let i=0;i<7;i++) {
      const first=i===0,matrices=first?9:18;
      const layer=model.layers[i===0?"conv2d_tf":`conv2d_${i}_tf`];
      const params=uniform(layer,matrices);
      const code=`${dimensions}
        struct Params { kernels:array<mat4x4f,${matrices}>,bias:vec4f }
        @group(0) @binding(0) var ${first?"src:texture_2d<f32>":"<storage,read> src:array<vec4f>"};
        @group(0) @binding(1) var<uniform> params:Params;
        @group(0) @binding(2) var<storage,read_write> dst:array<vec4f>;
        @compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u) {
          if(id.x>=W||id.y>=H){return;} ${location}
          var sum=params.bias;
          for(var k=0u;k<9u;k++){${offsets}
            let v=${first?"textureLoad(src,q,0)":"src[u32(q.y)*W+u32(q.x)]"};
            ${first?"sum+=params.kernels[k]*v;":"sum+=params.kernels[k]*max(v,vec4f(0))+params.kernels[k+9u]*max(-v,vec4f(0));"}
          } dst[index]=sum;
        }`;
      const pipeline=await device.createComputePipelineAsync({label:`RGB convolution ${i}`,layout:"auto",compute:{module:device.createShaderModule({code}),entryPoint:"main"}});
      this.check(shouldCancel);
      const bindings=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:first?this.input.createView():{buffer:features[i-1]}},
        {binding:1,resource:{buffer:params}},{binding:2,resource:{buffer:features[i]}},
      ]});
      this.stages.push({pipeline,bindings});
    }
    const headData:number[]=[];
    for(const name of ["conv2d_7_tf","conv2d_7_tf1","conv2d_7_tf2"]) {
      const layer=model.layers[name];
      if(layer.weights.length!==224||layer.bias.length!==4)throw new Error("Invalid RGB reconstruction head.");
      headData.push(...layer.weights,...layer.bias);
    }
    const heads=device.createBuffer({size:headData.length*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(heads,0,new Float32Array(headData));
    const sampler=device.createSampler({addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",magFilter:"linear",minFilter:"linear"});
    const headCode=`${dimensions}
      struct Head { kernels:array<mat4x4f,14>,bias:vec4f }
      ${features.map((_,i)=>`@group(0) @binding(${i}) var<storage,read> feature${i}:array<vec4f>;`).join("\n")}
      @group(0) @binding(7) var<uniform> heads:array<Head,3>;
      @group(0) @binding(8) var src:texture_2d<f32>;
      @group(0) @binding(9) var linearSampler:sampler;
      @group(0) @binding(10) var dst:texture_storage_2d<rgba8unorm,write>;
      @compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u) {
        if(id.x>=W||id.y>=H){return;} ${location}
        var residual:array<vec4f,3>;
        for(var c=0u;c<3u;c++) {
          var sum=heads[c].bias;
          ${features.map((_,i)=>`let v${i}=feature${i}[index];sum+=heads[c].kernels[${i*2}]*max(v${i},vec4f(0))+heads[c].kernels[${i*2+1}]*max(-v${i},vec4f(0));`).join("\n")}
          residual[c]=sum;
        }
        for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
          let pixel=id.xy*2u+vec2u(x,y);let c=x+y*2u;
          let uv=(vec2f(pixel)+.5)/vec2f(f32(W*2u),f32(H*2u));
          let base=textureSampleLevel(src,linearSampler,uv,0).rgb;
          let rgb=base+vec3f(residual[0][c],residual[1][c],residual[2][c]);
          textureStore(dst,vec2i(pixel),vec4f(clamp(rgb,vec3f(0),vec3f(1)),1));
        }}
      }`;
    const pipeline=await device.createComputePipelineAsync({label:"RGB subpixel reconstruction",layout:"auto",compute:{module:device.createShaderModule({code:headCode}),entryPoint:"main"}});
    this.check(shouldCancel);
    this.stages.push({pipeline,bindings:device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
      ...features.map((buffer,i)=>({binding:i,resource:{buffer}})),{binding:7,resource:{buffer:heads}},
      {binding:8,resource:this.input.createView()},{binding:9,resource:sampler},{binding:10,resource:this.result.createView()},
    ]})});
    this.output=new OffscreenCanvas(w*2,h*2);
    this.context=this.output.getContext("webgpu");
    if(!this.context)throw new Error("GPU output is unavailable.");
    const format=navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({device,format,alphaMode:"opaque"});
    this.paint=await device.createRenderPipelineAsync({layout:"auto",vertex:{module:device.createShaderModule({code:vertex}),entryPoint:"vs"},fragment:{module:device.createShaderModule({code:`
      @group(0) @binding(0) var src:texture_2d<f32>;
      @fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {return vec4f(textureLoad(src,vec2i(p.xy),0).rgb,1);}
    `}),entryPoint:"fs",targets:[{format}]},primitive:{topology:"triangle-list"}});
    this.check(shouldCancel);
    this.paintBindings=device.createBindGroup({layout:this.paint.getBindGroupLayout(0),entries:[{binding:0,resource:this.result.createView()}]});
  }

  private release() {
    this.context?.unconfigure();this.context=null;
    this.device?.destroy();this.device=null;this.input=null;this.result=null;
    this.stages=[];this.paint=null;this.paintBindings=null;this.key="";this.lost=false;
  }
  dispose(){this.disposed=true;this.release();this.sourceCanvas.width=2;this.sourceCanvas.height=2;this.output.width=1;this.output.height=1;}
}
