import type { EnhancerDevice, EnhancerSettings } from "./types";
import { filterPixels } from "./filter";
import { nv12Layout, rgbaToNv12, SDR_VIDEO_COLOR_SPACE } from "./color";
import { adaptiveSampling, adaptiveUpscale } from "./adaptive-upscale";
import { outputSharpening, sharpenPixels } from "./sharpen";
import { anchorRestorationColors, restorationColorShader, sourceLuminance } from "./restoration-color";

const vertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main() { uv = (position + 1.0) * 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D picture;
${adaptiveSampling}
uniform vec2 texel;
uniform float denoise;
uniform float detail;
uniform float flipY;
uniform int pass;
in vec2 uv;
out vec4 color;
${outputSharpening}
${restorationColorShader}
float luma(vec2 p) { return dot(texture(picture,p).rgb,vec3(0.2126,0.7152,0.0722))*255.0; }
void main() {
  vec2 point = vec2(uv.x, mix(uv.y, 1.0 - uv.y, flipY));
  vec3 center = texture(picture, point).rgb;
  if (pass == 0) {
    vec3 sum = center * 4.0;
    float total = 4.0;
    float range = (8.0 + denoise * 24.0)/255.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      vec3 neighbor = texture(picture, point + vec2(float(x), float(y)) * texel).rgb;
      float difference = dot(abs(neighbor - center), vec3(0.2126, 0.7152, 0.0722));
      float inverse = 1.0 / (1.0 + difference * difference / (range * range));
      float weight = (x == 0 || y == 0 ? 2.0 : 1.0) * inverse * inverse;
      sum += neighbor * weight; total += weight;
    }
    color = vec4(floor(mix(center, sum / total, denoise * 0.9)*255.0+0.5)/255.0, 1.0);
  } else if (pass == 1) {
    float c=luma(point),n=luma(point+vec2(0,texel.y)),s=luma(point-vec2(0,texel.y));
    float e=luma(point+vec2(texel.x,0)),w=luma(point-vec2(texel.x,0));
    float n2=luma(point+vec2(0,texel.y*2.0)),s2=luma(point-vec2(0,texel.y*2.0));
    float e2=luma(point+vec2(texel.x*2.0,0)),w2=luma(point-vec2(texel.x*2.0,0));
    float ne=luma(point+texel),sw=luma(point-texel);
    float nw=luma(point+texel*vec2(-1,1)),se=luma(point+texel*vec2(1,-1));
    float fine=(c*4.0+(n+s+e+w)*2.0+ne+sw+nw+se)/16.0;
    float broad=(c*4.0+(n2+s2+e2+w2)*2.0+luma(point+texel*2.0)+luma(point-texel*2.0)
      +luma(point+texel*vec2(-2,2))+luma(point+texel*vec2(2,-2)))/16.0;
    float low=min(c,min(min(min(n,s),min(e,w)),min(min(n2,s2),min(e2,w2))));
    float high=max(c,max(max(max(n,s),max(e,w)),max(max(n2,s2),max(e2,w2))));
    float band=c-fine;
    float gate=smoothstep(1.0+denoise*3.0,6.0+denoise*8.0,high-low);
    float signal=sign(band)*max(0.0,abs(band)-(.25+denoise*1.5));
    float delta=detail*gate*(signal*1.8+(fine-broad)*.8);
    float limit=min(12.0,(high-low)*.2+1.0);
    float overshoot=min(3.0,(high-low)*.08)*detail;
    delta=clamp(c+clamp(delta,-limit,limit),low-overshoot,high+overshoot)-c;
    delta=clamp(delta/255.0,-min(center.r,min(center.g,center.b)),1.0-max(center.r,max(center.g,center.b)));
    color=vec4(center+delta,1.0);
  } else if(pass==2) color = vec4(samplePicture(point), 1.0);
  else if(pass==3) color = vec4(protectDarkDetails(point,sharpenPicture(point)),1.0);
  else if(pass==5) color=vec4(restorePicture(point),1.0);
  else color = vec4(center,1.0);
}`;

// Pack four Y/UV bytes into each RGBA texel. readPixels reads just 1.5 bytes per
// output pixel; the GPU does the matrix conversion and 2x2 chroma averaging.
const nv12Fragment = `#version 300 es
precision highp float;
uniform sampler2D picture;
${adaptiveSampling}
uniform ivec2 size;
out vec4 color;
vec3 rgb(ivec2 pixel) {
  vec2 point = (vec2(clamp(pixel, ivec2(0), size - 1)) + 0.5) / vec2(size);
  return samplePicture(vec2(point.x, 1.0 - point.y));
}
float yByte(int x, int y) {
  if (x >= size.x) return 16.0;
  return floor(16.0 + 219.0 * dot(rgb(ivec2(x,y)), vec3(0.2126,0.7152,0.0722)) + 0.5);
}
vec2 uvBytes(int x, int y) {
  if (x >= size.x) return vec2(128);
  vec3 c = (rgb(ivec2(x,y)) + rgb(ivec2(x+1,y)) + rgb(ivec2(x,y+1)) + rgb(ivec2(x+1,y+1))) * 0.25;
  float luma = dot(c, vec3(0.2126,0.7152,0.0722));
  return floor(vec2(128) + 224.0 * vec2((c.b-luma)/1.8556, (c.r-luma)/1.5748) + 0.5);
}
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  int x = pixel.x * 4;
  if (pixel.y < size.y) color = vec4(yByte(x,pixel.y),yByte(x+1,pixel.y),yByte(x+2,pixel.y),yByte(x+3,pixel.y)) / 255.0;
  else {
    int y = (pixel.y - size.y) * 2;
    color = vec4(uvBytes(x,y), uvBytes(x+2,y)) / 255.0;
  }
}`;

function program(gl: WebGL2RenderingContext, fragmentCode = fragment) {
  const p = gl.createProgram();
  if (!p) throw new Error("GPU processor could not be created.");
  for (const [type, code] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragmentCode]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "GPU compilation failed.");
    gl.attachShader(p, shader); gl.deleteShader(shader);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("GPU processor could not be linked.");
  return p;
}

/** Filters at source resolution, then resamples once; never holds a video in memory. */
export class FrameProcessor {
  readonly canvas: OffscreenCanvas;
  private input: OffscreenCanvas;
  private inputContext: OffscreenCanvasRenderingContext2D;
  private gl: WebGL2RenderingContext | null = null;
  private outputContext: OffscreenCanvasRenderingContext2D | null = null;
  private clean: Uint8ClampedArray | null = null;
  private pixels: Uint8ClampedArray | null = null;
  private p: WebGLProgram | null = null;
  private textures: WebGLTexture[] = [];
  private framebuffer: WebGLFramebuffer | null = null;
  private workingWidth = 0;
  private workingHeight = 0;
  private exportProgram: WebGLProgram | null = null;
  private exportTexture: WebGLTexture | null = null;
  private exportPixels: Uint8Array<ArrayBuffer> | null = null;
  private resizedPixels: ImageData | null = null;
  private luma: Float32Array | null = null;
  private upscaledPixels: Uint8ClampedArray | null = null;
  private reference: OffscreenCanvas | null = null;
  private sharpenedPixels: ImageData | null = null;
  private renderedCpuPixels:ImageData|null=null;

  constructor(readonly device: EnhancerDevice, width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    this.input = new OffscreenCanvas(1, 1);
    const inputContext = this.input.getContext("2d", { willReadFrequently: device === "cpu", alpha: false, colorSpace: "srgb" });
    if (!inputContext) throw new Error("Local frame capture is unavailable.");
    this.inputContext = inputContext;
    if (device === "gpu") {
      const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
      if (!gl) throw new Error("GPU processing is unavailable. Reload and check browser hardware acceleration.");
      this.gl = gl; this.p = program(gl); gl.useProgram(this.p);
      gl.disable(gl.DITHER);
      if ("drawingBufferColorSpace" in gl) gl.drawingBufferColorSpace = "srgb";
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(this.p, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.uniform1i(gl.getUniformLocation(this.p, "picture"), 0);
      this.framebuffer = gl.createFramebuffer();
      for (let i = 0; i < 5; i++) {
        const texture = gl.createTexture();
        if (!texture) throw new Error("GPU frame storage is unavailable.");
        this.textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if(i>=3) gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      }
    } else {
      this.outputContext = this.canvas.getContext("2d", {alpha: false, colorSpace: "srgb", willReadFrequently: true});
      if (!this.outputContext) throw new Error("CPU processing is unavailable.");
    }
  }

  async render(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, settings: EnhancerSettings, shouldCancel: () => boolean = () => false) {
    this.renderedCpuPixels=null;
    const ratio = Math.min(1, this.canvas.width / sourceWidth, this.canvas.height / sourceHeight);
    const width = Math.max(2, Math.round(sourceWidth * ratio)), height = Math.max(2, Math.round(sourceHeight * ratio));
    const resized = width !== this.workingWidth || height !== this.workingHeight;
    if (resized) { this.workingWidth = width; this.workingHeight = height; this.input.width = width; this.input.height = height; }
    if (shouldCancel()) throw new DOMException("Cancelled", "AbortError");
    if (this.gl && this.p) {
      const gl = this.gl;
      if (gl.isContextLost()) throw new Error("GPU connection was lost. Reload and check browser hardware acceleration.");
      if (width !== sourceWidth || height !== sourceHeight || typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
        this.inputContext.drawImage(source, 0, 0, width, height); source = this.input;
      }
      gl.useProgram(this.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(gl.getUniformLocation(this.p,"originalPicture"),0);
      gl.uniform1f(gl.getUniformLocation(this.p,"sourceGuard"),0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
      const bitmap = source instanceof ImageBitmap;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !bitmap);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
      gl.uniform2f(gl.getUniformLocation(this.p, "texel"), 1 / width, 1 / height);
      gl.uniform1f(gl.getUniformLocation(this.p, "denoise"), settings.denoise);
      gl.uniform1f(gl.getUniformLocation(this.p, "detail"), settings.detail);
      gl.uniform2f(gl.getUniformLocation(this.p,"sourceSize"),width,height);
      gl.uniform1i(gl.getUniformLocation(this.p,"upscale"),this.canvas.width>width||this.canvas.height>height ? 1 : 0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[1]);
      if (resized) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[1], 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("GPU frame buffer is unavailable. Reload and check browser hardware acceleration.");
      gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
      gl.viewport(0, 0, width, height); gl.uniform1i(gl.getUniformLocation(this.p, "pass"), 0); gl.uniform1f(gl.getUniformLocation(this.p, "flipY"), bitmap ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[2]);
      if (resized) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[2], 0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[1]);
      gl.uniform1i(gl.getUniformLocation(this.p, "pass"), 1); gl.uniform1f(gl.getUniformLocation(this.p, "flipY"), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.textures[3],0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[2]);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.uniform1i(gl.getUniformLocation(this.p, "pass"), 2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.textures[4],0);
      gl.bindTexture(gl.TEXTURE_2D,this.textures[3]);
      gl.uniform2f(gl.getUniformLocation(this.p,"sourceSize"),this.canvas.width,this.canvas.height);
      gl.uniform1f(gl.getUniformLocation(this.p,"sharpness"),settings.sharpen??0);
      gl.uniform2f(gl.getUniformLocation(this.p,"detailStep"),1/width,1/height);
      gl.uniform1i(gl.getUniformLocation(this.p,"pass"),3);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,this.textures[4]);
      gl.uniform1i(gl.getUniformLocation(this.p,"pass"),4);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`GPU processing failed (${error}). Reload and check browser hardware acceleration.`);
      gl.flush();
    } else {
      if (resized) { this.clean = new Uint8ClampedArray(width * height * 4); this.pixels = new Uint8ClampedArray(width * height * 4); this.luma = new Float32Array(width * height); }
      this.inputContext.drawImage(source, 0, 0, width, height);
      const image = this.inputContext.getImageData(0, 0, width, height);
      await filterPixels(image.data, this.clean!, this.pixels!, width, height, settings, shouldCancel, this.luma!);
      image.data.set(this.pixels!); this.inputContext.putImageData(image, 0, 0);
      this.resizedPixels ??= new ImageData(this.canvas.width,this.canvas.height);
      if(this.canvas.width===width&&this.canvas.height===height) {
        await sharpenPixels(this.pixels!,this.resizedPixels.data,width,height,settings.sharpen??0,shouldCancel,this.canvas.width/width,this.canvas.height/height);
        this.outputContext!.putImageData(this.resizedPixels,0,0);
      } else {
        this.upscaledPixels ??= new Uint8ClampedArray(this.canvas.width*this.canvas.height*4);
        await adaptiveUpscale(this.pixels!,width,height,this.upscaledPixels,this.canvas.width,this.canvas.height,shouldCancel);
        await sharpenPixels(this.upscaledPixels,this.resizedPixels.data,this.canvas.width,this.canvas.height,settings.sharpen??0,shouldCancel,this.canvas.width/width,this.canvas.height/height);
        this.outputContext!.putImageData(this.resizedPixels,0,0);
      }
    }
    return this.canvas;
  }

  /** Finish learned detail with the source's color, then use the same explicit
   * video-domain encoder path as the capability fallback. */
  async renderRestored(restored:CanvasImageSource,original:CanvasImageSource,sourceWidth:number,sourceHeight:number,settings:EnhancerSettings,shouldCancel:()=>boolean,present=true) {
    this.renderedCpuPixels=null;
    const width=this.canvas.width,height=this.canvas.height;
    const sharpness=settings.sharpen??0;
    if(this.input.width!==width||this.input.height!==height){this.input.width=width;this.input.height=height;}
    this.workingWidth=0;this.workingHeight=0;
    if(shouldCancel())throw new DOMException("Cancelled","AbortError");
    if(this.gl&&this.p) {
      const gl=this.gl;
      if(gl.isContextLost())throw new Error("GPU connection was lost. Reload and check browser hardware acceleration.");
      gl.useProgram(this.p);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[0]);
      // Import the GPU reconstruction directly; the previous intermediate 2D
      // canvas copied the full enlarged picture before uploading it again.
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,restored as TexImageSource);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.textures[1]);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,original as TexImageSource);
      gl.uniform1i(gl.getUniformLocation(this.p,"originalPicture"),1);
      gl.uniform1f(gl.getUniformLocation(this.p,"sourceGuard"),1);
      gl.uniform2f(gl.getUniformLocation(this.p,"restorationStep"),1/sourceWidth,1/sourceHeight);
      gl.uniform1f(gl.getUniformLocation(this.p,"denoise"),settings.denoise);
      gl.uniform1f(gl.getUniformLocation(this.p,"detail"),settings.detail);
      gl.uniform1f(gl.getUniformLocation(this.p,"flipY"),0);
      gl.uniform1i(gl.getUniformLocation(this.p,"pass"),5);
      gl.uniform1i(gl.getUniformLocation(this.p,"upscale"),0);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.textures[sharpness>0 ? 3 : 4],0);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[0]);
      gl.viewport(0,0,width,height);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      if(sharpness>0) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.textures[4],0);
        gl.bindTexture(gl.TEXTURE_2D,this.textures[3]);
        gl.uniform2f(gl.getUniformLocation(this.p,"sourceSize"),width,height);
        gl.uniform1f(gl.getUniformLocation(this.p,"sharpness"),sharpness);
        gl.uniform2f(gl.getUniformLocation(this.p,"detailStep"),1/sourceWidth,1/sourceHeight);
        gl.uniform1i(gl.getUniformLocation(this.p,"pass"),3);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,this.textures[4]);
      if(present){gl.uniform1i(gl.getUniformLocation(this.p,"pass"),4);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}
      const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error(`GPU color restoration failed (${error}).`);
      gl.flush();
    } else {
      this.inputContext.drawImage(restored,0,0,width,height);
      this.reference ??= new OffscreenCanvas(sourceWidth,sourceHeight);
      if(this.reference.width!==sourceWidth||this.reference.height!==sourceHeight){this.reference.width=sourceWidth;this.reference.height=sourceHeight;}
      const referenceContext=this.reference.getContext("2d",{alpha:false,colorSpace:"srgb",willReadFrequently:true});
      if(!referenceContext)throw new Error("Source color reference is unavailable.");
      referenceContext.drawImage(original,0,0,sourceWidth,sourceHeight);
      this.resizedPixels ??= new ImageData(width,height);
      const source=referenceContext.getImageData(0,0,sourceWidth,sourceHeight),model=this.inputContext.getImageData(0,0,width,height);
      return this.renderRestoredPixels(model,source,settings,shouldCancel,present);
    }
    return this.canvas;
  }

  /** CPU restoration already owns RGBA arrays. Keep them in memory through
   * finishing/encoding instead of round-tripping model and reference canvases. */
  async renderRestoredPixels(restored:ImageData,source:ImageData,settings:EnhancerSettings,shouldCancel:()=>boolean,present=true) {
    this.renderedCpuPixels=null;
    if(shouldCancel())throw new DOMException("Cancelled","AbortError");
    const width=this.canvas.width,height=this.canvas.height;
    if(restored.width!==width||restored.height!==height)throw new Error("Unexpected CPU output dimensions.");
    this.resizedPixels??=new ImageData(width,height);
    const luminance=sourceLuminance(source.data);
    await anchorRestorationColors(source.data,restored.data,this.resizedPixels.data,width,height,source.width,source.height,settings,shouldCancel,source.width,source.height,luminance);
    let output=this.resizedPixels;
    const sharpness=settings.sharpen??0;
    if(sharpness>0) {
      this.sharpenedPixels??=new ImageData(width,height);
      await sharpenPixels(output.data,this.sharpenedPixels.data,width,height,sharpness,shouldCancel,width/source.width,height/source.height,source,luminance);
      output=this.sharpenedPixels;
    }
    if(shouldCancel())throw new DOMException("Cancelled","AbortError");
    this.renderedCpuPixels=output;
    if(present)this.outputContext!.putImageData(output,0,0);
    return this.canvas;
  }

  /** Pass an explicit video-domain frame to the encoder, never an ambiguously
   * tagged RGB canvas. Both hardware/software encoders receive the same range. */
  toVideoFrame(timestamp: number, duration: number) {
    const width=this.canvas.width,height=this.canvas.height;
    const {stride,chromaOffset,byteLength}=nv12Layout(width,height);
    this.exportPixels ??= new Uint8Array(byteLength);
    if(this.gl) {
      const gl=this.gl;
      if(!this.exportProgram) {
        this.exportProgram=program(gl,nv12Fragment);
        this.exportTexture=gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D,this.exportTexture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,stride/4,height*1.5,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      }
      gl.useProgram(this.exportProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.exportTexture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error("Video color buffer is unavailable.");
      gl.bindTexture(gl.TEXTURE_2D,this.textures[4]);
      gl.uniform1i(gl.getUniformLocation(this.exportProgram,"picture"),0);
      gl.uniform2i(gl.getUniformLocation(this.exportProgram,"size"),width,height);
      gl.uniform2f(gl.getUniformLocation(this.exportProgram,"sourceSize"),width,height);
      gl.uniform1i(gl.getUniformLocation(this.exportProgram,"upscale"),0);
      gl.viewport(0,0,stride/4,height*1.5);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      gl.readPixels(0,0,stride/4,height*1.5,gl.RGBA,gl.UNSIGNED_BYTE,this.exportPixels);
      const error=gl.getError();
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      if(error!==gl.NO_ERROR) throw new Error(`Video color conversion failed (${error}).`);
    } else {
      rgbaToNv12((this.renderedCpuPixels??this.outputContext!.getImageData(0,0,width,height)).data,this.exportPixels,width,height);
    }
    return new VideoFrame(this.exportPixels,{
      format:"NV12",codedWidth:width,codedHeight:height,
      layout:[{offset:0,stride},{offset:chromaOffset,stride}],
      timestamp:Math.round(timestamp*1_000_000),
      duration:duration>0 ? Math.max(1,Math.round(duration*1_000_000)) : undefined,
      colorSpace:SDR_VIDEO_COLOR_SPACE,
    });
  }

  dispose() {
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.width = 1; this.canvas.height = 1; this.input.width = 1; this.input.height = 1;
    this.clean = null; this.pixels = null; this.exportPixels = null; this.resizedPixels = null; this.luma = null; this.upscaledPixels = null;
    this.sharpenedPixels=null;this.renderedCpuPixels=null;
    if(this.reference){this.reference.width=1;this.reference.height=1;this.reference=null;}
  }
}
