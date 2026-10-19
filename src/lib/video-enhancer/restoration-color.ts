import type { EnhancerSettings } from "./types";
import { sampleRgb } from "./cpu-sampling";
import { yieldToWorker } from "./worker-yield";

// Retain the single-model RGB reconstruction. No shifted coarse color residual:
// that operation can imprint displaced color bands around source transitions.
export const restorationColorShader = `
uniform sampler2D originalPicture;
uniform vec2 restorationStep;
uniform float sourceGuard;
// A dark source stroke must not acquire a bright invented hairline. Limit only
// positive luma residuals; retain contour darkening and source highlights.
vec3 protectDarkDetails(vec2 point,vec3 candidate) {
  if(sourceGuard<.5) return candidate;
  const vec3 Y=vec3(.2126,.7152,.0722);
  float baseY=dot(texture(originalPicture,point).rgb,Y);
  if(baseY>=96.0/255.0) return candidate;
  float lowY=baseY,highY=baseY;
  for(int i=0;i<4;i++) {
    vec2 offset=i==0 ? vec2(1,0) : i==1 ? vec2(-1,0) : i==2 ? vec2(0,1) : vec2(0,-1);
    float l=dot(texture(originalPicture,point+offset*restorationStep*.5).rgb,Y);
    lowY=min(lowY,l);highY=max(highY,l);
  }
  float weight=1.0-smoothstep(32.0/255.0,96.0/255.0,baseY);
  float ceiling=baseY+4.0/255.0+min(12.0/255.0,(highY-lowY)*.12);
  float l=dot(candidate,Y);
  float limited=mix(l,min(l,ceiling),weight);
  return candidate*(limited/max(l,.00001));
}
vec3 restorePicture(vec2 point) {
  vec3 base=texture(originalPicture,point).rgb;
  if(detail<=0.0) return base;
  vec3 model=texture(picture,point).rgb;
  vec3 clean=model*4.0;
  float total=4.0,range=(4.0+denoise*16.0)/255.0;
  const vec3 Y=vec3(.2126,.7152,.0722);
  float lowY=dot(model,Y),highY=lowY;
  if(denoise>0.0) {
    vec2 outputStep=1.0/vec2(textureSize(picture,0));
    for(int i=0;i<4;i++) {
      vec2 offset=i==0 ? vec2(1,0) : i==1 ? vec2(-1,0) : i==2 ? vec2(0,1) : vec2(0,-1);
      vec3 neighbor=texture(picture,point+offset*outputStep).rgb;
      float difference=dot(abs(neighbor-model),vec3(.2126,.7152,.0722));
      float inverse=1.0/(1.0+difference*difference/(range*range));
      clean+=neighbor*inverse;total+=inverse;
      float l=dot(neighbor,Y);lowY=min(lowY,l);highY=max(highY,l);
    }
  }
  float flatWeight=1.0-smoothstep(4.0/255.0,16.0/255.0,highY-lowY);
  vec3 reconstructed=mix(model,clean/total,denoise*.6*flatWeight);
  return protectDarkDetails(point,clamp(mix(base,reconstructed,detail),vec3(0),vec3(1)));
}`;

const NEIGHBORS=[[1,0],[-1,0],[0,1],[0,-1]] as const;

/** Same source-guided limit as the GPU, reused after CPU sharpening. */
export function sourceLuminance(source:Uint8ClampedArray){
  const luma=new Float64Array(source.length/4);
  for(let i=0,j=0;i<source.length;i+=4,j++)luma[j]=source[i]*.2126+source[i+1]*.7152+source[i+2]*.0722;
  return luma;
}

export function createDarkDetailGuard(source:Uint8ClampedArray,referenceWidth:number,referenceHeight:number,width:number,height:number,luminance:Float64Array=sourceLuminance(source)) {
  const sourceY=(x:number,y:number)=>{
    x=Math.max(0,Math.min(referenceWidth-1,x));y=Math.max(0,Math.min(referenceHeight-1,y));
    const left=Math.floor(x),top=Math.floor(y),right=Math.min(referenceWidth-1,left+1),bottom=Math.min(referenceHeight-1,top+1);
    const wx=x-left,wy=y-top;
    return (luminance[top*referenceWidth+left]*(1-wx)+luminance[top*referenceWidth+right]*wx)*(1-wy)
      +(luminance[bottom*referenceWidth+left]*(1-wx)+luminance[bottom*referenceWidth+right]*wx)*wy;
  };
  return (x:number,y:number,target:Uint8ClampedArray,i:number)=>{
    const px=(x+.5)*referenceWidth/width-.5,py=(y+.5)*referenceHeight/height-.5;
    const baseY=sourceY(px,py);
    if(baseY>=96)return;
    let lowY=baseY,highY=baseY;
    for(const [dx,dy] of NEIGHBORS){const l=sourceY(px+dx*.5,py+dy*.5);lowY=Math.min(lowY,l);highY=Math.max(highY,l);}
    const t=Math.max(0,Math.min(1,(baseY-32)/64)),weight=1-t*t*(3-2*t);
    const ceiling=baseY+4+Math.min(12,(highY-lowY)*.12);
    const l=target[i]*.2126+target[i+1]*.7152+target[i+2]*.0722;
    const ratio=(l+(Math.min(l,ceiling)-l)*weight)/Math.max(l,.00001);
    target[i]*=ratio;target[i+1]*=ratio;target[i+2]*=ratio;
  };
}

export async function anchorRestorationColors(
  source:Uint8ClampedArray,restored:Uint8ClampedArray,output:Uint8ClampedArray,
  width:number,height:number,sourceWidth:number,sourceHeight:number,settings:EnhancerSettings,shouldCancel:()=>boolean=()=>false,
  referenceWidth=width,referenceHeight=height,
  luminance?:Float64Array,
) {
  const range=4+settings.denoise*16;
  // Source dimensions are retained in the public signature for compatibility.
  void sourceWidth;void sourceHeight;
  const protect=createDarkDetailGuard(source,referenceWidth,referenceHeight,width,height,luminance);
  const base=new Float64Array(3);
  const direct=referenceWidth===width&&referenceHeight===height;
  for(let y=0;y<height;y++) {
    if(y%32===0) {
      if(shouldCancel())throw new DOMException("Cancelled","AbortError");
      if(y)await yieldToWorker();
    }
    for(let x=0;x<width;x++) {
      const i=(y*width+x)*4;
      if(direct){base[0]=source[i];base[1]=source[i+1];base[2]=source[i+2];}
      else sampleRgb(source,referenceWidth,referenceHeight,(x+.5)*referenceWidth/width-.5,(y+.5)*referenceHeight/height-.5,base);
      if(settings.detail===0) {
        for(let c=0;c<3;c++)output[i+c]=base[c];
        output[i+3]=255;continue;
      }
      const mr=restored[i],mg=restored[i+1],mb=restored[i+2];
      let cr=mr*4,cg=mg*4,cb=mb*4,total=4;
      let lowY=mr*.2126+mg*.7152+mb*.0722,highY=lowY;
      if(settings.denoise>0)for(const [dx,dy] of NEIGHBORS) {
        const ni=(Math.max(0,Math.min(height-1,y+dy))*width+Math.max(0,Math.min(width-1,x+dx)))*4;
        const nr=restored[ni],ng=restored[ni+1],nb=restored[ni+2];
        const difference=Math.abs(nr-mr)*.2126+Math.abs(ng-mg)*.7152+Math.abs(nb-mb)*.0722;
        const weight=1/(1+difference*difference/(range*range));
        cr+=nr*weight;cg+=ng*weight;cb+=nb*weight;total+=weight;
        const l=nr*.2126+ng*.7152+nb*.0722;lowY=Math.min(lowY,l);highY=Math.max(highY,l);
      }
      const edge=Math.max(0,Math.min(1,(highY-lowY-4)/12));
      const cleanup=settings.denoise*.6*(1-edge*edge*(3-2*edge));
      const br=base[0],bg=base[1],bb=base[2];
      output[i]=br+(mr+(cr/total-mr)*cleanup-br)*settings.detail;
      output[i+1]=bg+(mg+(cg/total-mg)*cleanup-bg)*settings.detail;
      output[i+2]=bb+(mb+(cb/total-mb)*cleanup-bb)*settings.detail;
      protect(x,y,output,i);
      output[i+3]=255;
    }
  }
  if(shouldCancel())throw new DOMException("Cancelled","AbortError");
}
