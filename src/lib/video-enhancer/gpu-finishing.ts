/// <reference types="@webgpu/types" />
import { nv12Layout, SDR_VIDEO_COLOR_SPACE } from "./color";
import type { EnhancerSettings } from "./types";

const parameters=`
struct Params { width:u32,height:u32,sourceWidth:u32,sourceHeight:u32,stride:u32,chromaOffset:u32,
 denoise:f32,detail:f32,sharpness:f32,a:f32,b:f32,c:f32 }
`;
// Same source-guided cleanup, dark-stroke guard and bounded luma sharpening
// as restoration-color.ts/sharpen.ts. RGBA8 intermediates retain quantization.
const common=`${parameters}
@group(0) @binding(0) var picture:texture_2d<f32>;
@group(0) @binding(1) var original:texture_2d<f32>;
@group(0) @binding(2) var linearSampler:sampler;
@group(0) @binding(3) var<uniform> p:Params;
@group(0) @binding(4) var outputImage:texture_storage_2d<rgba8unorm,write>;
const Y=vec3f(.2126,.7152,.0722);
fn base(uv:vec2f)->vec3f{return textureSampleLevel(original,linearSampler,uv,0.0).rgb;}
fn tap(uv:vec2f)->vec3f{return textureSampleLevel(picture,linearSampler,uv,0.0).rgb;}
fn direction(i:u32)->vec2f {
 if(i==0u){return vec2f(1,0);}if(i==1u){return vec2f(-1,0);}
 if(i==2u){return vec2f(0,1);}return vec2f(0,-1);
}
fn protect(uv:vec2f,candidate:vec3f)->vec3f {
 let b=dot(base(uv),Y);if(b>=96.0/255.0){return candidate;}
 var low=b;var high=b;
 for(var i=0u;i<4u;i++){
  let l=dot(base(uv+direction(i)*.5/vec2f(f32(p.sourceWidth),f32(p.sourceHeight))),Y);
  low=min(low,l);high=max(high,l);
 }
 let weight=1.0-smoothstep(32.0/255.0,96.0/255.0,b);
 let ceiling=b+4.0/255.0+min(12.0/255.0,(high-low)*.12);
 let l=dot(candidate,Y);let limited=mix(l,min(l,ceiling),weight);
 return candidate*(limited/max(l,.00001));
}
@compute @workgroup_size(8,8)
fn clean(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=p.width||id.y>=p.height){return;}
 let uv=(vec2f(id.xy)+.5)/vec2f(f32(p.width),f32(p.height));
 let source=base(uv);let model=tap(uv);
 var sum=model*4.0;var total=4.0;
 let range=(4.0+p.denoise*16.0)/255.0;
 var low=dot(model,Y);var high=low;
 if(p.denoise>0.0){for(var i=0u;i<4u;i++){
  let neighbor=tap(uv+direction(i)/vec2f(f32(p.width),f32(p.height)));
  let difference=dot(abs(neighbor-model),Y);
  let inverse=1.0/(1.0+difference*difference/(range*range));
  sum+=neighbor*inverse;total+=inverse;let l=dot(neighbor,Y);low=min(low,l);high=max(high,l);
 }}
 let flatWeight=1.0-smoothstep(4.0/255.0,16.0/255.0,high-low);
 let reconstructed=mix(model,sum/total,p.denoise*.6*flatWeight);
 let result=select(protect(uv,clamp(mix(source,reconstructed,p.detail),vec3f(0),vec3f(1))),source,p.detail<=0.0);
 textureStore(outputImage,id.xy,vec4f(result,1));
}
@compute @workgroup_size(8,8)
fn sharpen(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=p.width||id.y>=p.height){return;}
 let uv=(vec2f(id.xy)+.5)/vec2f(f32(p.width),f32(p.height));
 let center=tap(uv);var blur=center*4.0;var low=center;var high=center;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  if(x==0&&y==0){continue;}
  let neighbor=tap(uv+vec2f(f32(x),f32(y))/vec2f(f32(p.sourceWidth),f32(p.sourceHeight)));
  blur+=neighbor*select(1.0,2.0,x==0||y==0);low=min(low,neighbor);high=max(high,neighbor);
 }}
 let band=dot(center-blur/16.0,Y);
 let contrast=dot(high-low,Y);
 var delta=sign(band)*max(0.0,abs(band)-1.0/255.0)*p.sharpness*.8;
 if(p.a>0.0){
  // Native restoration cleans compression but needs a wider detail band.
  // Only four extra taps, in the existing pass; never amplify model residuals.
  var broad=center*4.0;
  for(var i=0u;i<4u;i++){
   broad+=tap(uv+direction(i)*2.0/vec2f(f32(p.sourceWidth),f32(p.sourceHeight)));
  }
  let wideBand=dot(center-broad/8.0,Y);
  let fine=sign(band)*max(0.0,abs(band)-1.0/255.0);
  let wide=sign(wideBand)*max(0.0,abs(wideBand)-1.5/255.0);
  let edgeWeight=smoothstep(3.0/255.0,16.0/255.0,contrast);
  delta=mix(delta,(fine*1.35+wide*.65)*p.sharpness*edgeWeight,p.a);
 }
 let cap=min(mix(6.0,10.0,p.a)/255.0,contrast*mix(.15,.22,p.a));
 textureStore(outputImage,id.xy,vec4f(protect(uv,clamp(center+vec3f(clamp(delta,-cap,cap)),low,high)),1));
}`;

const pack=`${parameters}
@group(0) @binding(0) var picture:texture_2d<f32>;
@group(0) @binding(1) var<storage,read_write> output:array<u32>;
@group(0) @binding(2) var<uniform> p:Params;
const Y=vec3f(.2126,.7152,.0722);
fn rgb(x:u32,y:u32)->vec3f{return textureLoad(picture,vec2i(i32(min(x,p.width-1u)),i32(min(y,p.height-1u))),0).rgb;}
fn yByte(x:u32,y:u32)->u32 {
 if(x>=p.width){return 16u;}return u32(floor(16.0+219.0*dot(rgb(x,y),Y)+.5));
}
fn uvBytes(x:u32,y:u32)->vec2u {
 if(x>=p.width){return vec2u(128);}
 let c=(rgb(x,y)+rgb(x+1u,y)+rgb(x,y+1u)+rgb(x+1u,y+1u))*.25;
 let l=dot(c,Y);
 return vec2u(floor(vec2f(128)+224.0*vec2f((c.b-l)/1.8556,(c.r-l)/1.5748)+.5));
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id:vec3u){
 let words=p.stride/4u;let count=words*(p.height+p.height/2u);
 if(id.x>=count){return;}
 let row=id.x/words;let x=(id.x%words)*4u;var bytes:vec4u;
 if(row<p.height){bytes=vec4u(yByte(x,row),yByte(x+1u,row),yByte(x+2u,row),yByte(x+3u,row));}
 else{let y=(row-p.height)*2u;bytes=vec4u(uvBytes(x,y),uvBytes(x+2u,y));}
 output[id.x]=bytes.x|(bytes.y<<8u)|(bytes.z<<16u)|(bytes.w<<24u);
}`;

export class GpuFinisher {
  private cleanTexture:GPUTexture;
  readonly texture:GPUTexture;
  private uniform:GPUBuffer;
  private params=new ArrayBuffer(48);
  private cleanPipeline!:GPUComputePipeline;
  private sharpenPipeline!:GPUComputePipeline;
  private packPipeline!:GPUComputePipeline;
  private cleanBind!:GPUBindGroup;
  private sharpenBind!:GPUBindGroup;
  private packBinds=new Map<GPUTexture,GPUBindGroup>();
  private packed:GPUBuffer|null=null;
  private staging:GPUBuffer|null=null;
  private sharpened=false;
  constructor(private device:GPUDevice,private reconstructed:GPUTexture,private original:GPUTexture,
    private width:number,private height:number,private sourceWidth:number,private sourceHeight:number) {
    const descriptor:GPUTextureDescriptor={size:[width,height],format:"rgba8unorm",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING};
    this.cleanTexture=device.createTexture(descriptor);this.texture=device.createTexture(descriptor);
    this.uniform=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  }
  async initialize(){
    const finishingModule=this.device.createShaderModule({code:common,label:"Restoration finishing"});
    const packing=this.device.createShaderModule({code:pack,label:"Restoration NV12"});
    for(const shader of [finishingModule,packing]){
      const errors=(await shader.getCompilationInfo()).messages.filter(m=>m.type==="error");
      if(errors.length)throw new Error(errors.map(m=>m.message).join("; "));
    }
    [this.cleanPipeline,this.sharpenPipeline,this.packPipeline]=await Promise.all([
      this.device.createComputePipelineAsync({layout:"auto",compute:{module:finishingModule,entryPoint:"clean"}}),
      this.device.createComputePipelineAsync({layout:"auto",compute:{module:finishingModule,entryPoint:"sharpen"}}),
      this.device.createComputePipelineAsync({layout:"auto",compute:{module:packing,entryPoint:"main"}}),
    ]);
    const sampler=this.device.createSampler({magFilter:"linear",minFilter:"linear"});
    const bind=(pipeline:GPUComputePipeline,input:GPUTexture,output:GPUTexture)=>this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
      {binding:0,resource:input.createView()},{binding:1,resource:this.original.createView()},
      {binding:2,resource:sampler},{binding:3,resource:{buffer:this.uniform}},{binding:4,resource:output.createView()},
    ]});
    this.cleanBind=bind(this.cleanPipeline,this.reconstructed,this.cleanTexture);
    this.sharpenBind=bind(this.sharpenPipeline,this.cleanTexture,this.texture);
  }
  get result(){return this.sharpened ? this.texture : this.cleanTexture;}
  finish(settings:EnhancerSettings){
    const {stride,chromaOffset}=nv12Layout(this.width,this.height);
    new Uint32Array(this.params).set([this.width,this.height,this.sourceWidth,this.sourceHeight,stride,chromaOffset]);
    new Float32Array(this.params).set([settings.denoise,settings.detail,settings.sharpen??0],6);
    new Float32Array(this.params)[9]=settings.scale===1 ? settings.detail : 0;
    this.device.queue.writeBuffer(this.uniform,0,this.params);
    const encoder=this.device.createCommandEncoder();
    const dispatch=(pipeline:GPUComputePipeline,bind:GPUBindGroup)=>{
      const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);
      pass.dispatchWorkgroups(Math.ceil(this.width/8),Math.ceil(this.height/8));pass.end();
    };
    dispatch(this.cleanPipeline,this.cleanBind);this.sharpened=(settings.sharpen??0)>0;
    if(this.sharpened)dispatch(this.sharpenPipeline,this.sharpenBind);
    this.device.queue.submit([encoder.finish()]);
  }
  async toVideoFrame(timestamp:number,duration:number,cancel:()=>boolean){
    const {stride,chromaOffset,byteLength}=nv12Layout(this.width,this.height);
    if(!this.packed){
      this.packed=this.device.createBuffer({size:byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      this.staging=this.device.createBuffer({size:byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    }
    // Binding switches only when sharpening changes, never once per tile.
    let packBind=this.packBinds.get(this.result);
    if(!packBind){
      packBind=this.device.createBindGroup({layout:this.packPipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:this.result.createView()},{binding:1,resource:{buffer:this.packed}},{binding:2,resource:{buffer:this.uniform}},
      ]});this.packBinds.set(this.result,packBind);
    }
    const encoder=this.device.createCommandEncoder(),pass=encoder.beginComputePass();
    pass.setPipeline(this.packPipeline);pass.setBindGroup(0,packBind);pass.dispatchWorkgroups(Math.ceil(byteLength/4/256));pass.end();
    encoder.copyBufferToBuffer(this.packed,0,this.staging!,0,byteLength);this.device.queue.submit([encoder.finish()]);
    // mapAsync waits for this copy only; no synchronous readPixels or CPU YUV conversion.
    await this.staging!.mapAsync(GPUMapMode.READ);
    try{
      if(cancel())throw new DOMException("Cancelled","AbortError");
      return new VideoFrame(new Uint8Array(this.staging!.getMappedRange()),{format:"NV12",codedWidth:this.width,codedHeight:this.height,
        layout:[{offset:0,stride},{offset:chromaOffset,stride}],timestamp:Math.round(timestamp*1e6),
        duration:duration>0?Math.max(1,Math.round(duration*1e6)):undefined,colorSpace:SDR_VIDEO_COLOR_SPACE});
    }finally{this.staging!.unmap();}
  }
  dispose(){this.packBinds.clear();this.cleanTexture.destroy();this.texture.destroy();this.uniform.destroy();this.packed?.destroy();this.staging?.destroy();}
}
