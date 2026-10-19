import { createDarkDetailGuard } from "./restoration-color";
import { sampleRgb } from "./cpu-sampling";
import { yieldToWorker } from "./worker-yield";

// One source-radius, luminance-only detail pass. No stacked RCAS/chroma boost.
// Clamp each channel to its existing neighborhood: do not create bright/dark
// overshoot outside the local range, even with the slider at maximum.
export const outputSharpening = `
uniform float sharpness;
uniform vec2 detailStep;
vec3 sharpenPicture(vec2 point) {
  vec3 c=texture(picture,point).rgb;
  if(sharpness<=0.0) return c;
  const vec3 Y=vec3(.2126,.7152,.0722);
  vec3 blur=c*4.0,low=c,high=c;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
    if(x==0&&y==0)continue;
    vec3 tap=texture(picture,point+vec2(float(x),float(y))*detailStep).rgb;
    blur+=tap*(x==0||y==0 ? 2.0 : 1.0);
    low=min(low,tap);high=max(high,tap);
  }
  blur/=16.0;
  float band=dot(c-blur,Y);
  float cap=min(6.0/255.0,dot(high-low,Y)*.15);
  float delta=sign(band)*max(0.0,abs(band)-1.0/255.0)*sharpness*.8;
  return clamp(c+vec3(clamp(delta,-cap,cap)),low,high);
}`;

export async function sharpenPixels(
  source:Uint8ClampedArray,output:Uint8ClampedArray,width:number,height:number,
  detail:number,shouldCancel:()=>boolean=()=>false,radiusX=1,radiusY=radiusX,
  reference?:{data:Uint8ClampedArray;width:number;height:number},
  luminance?:Float64Array,
) {
  if(detail<=0){output.set(source);return;}
  const protect=reference ? createDarkDetailGuard(reference.data,reference.width,reference.height,width,height,luminance) : null;
  const tap=new Float64Array(3);
  const integerRadius=Number.isInteger(radiusX)&&Number.isInteger(radiusY);
  for(let y=0;y<height;y++) {
    if(y%64===0) {
      await yieldToWorker();
      if(shouldCancel())throw new DOMException("Cancelled","AbortError");
    }
    for(let x=0;x<width;x++) {
      const i=(y*width+x)*4;
      let br=source[i]*4,bg=source[i+1]*4,bb=source[i+2]*4;
      let lr=source[i],lg=source[i+1],lb=source[i+2],hr=lr,hg=lg,hb=lb;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
        if(!dx&&!dy)continue;
        if(integerRadius){
          const at=(Math.max(0,Math.min(height-1,y+dy*radiusY))*width+Math.max(0,Math.min(width-1,x+dx*radiusX)))*4;
          tap[0]=source[at];tap[1]=source[at+1];tap[2]=source[at+2];
        }else sampleRgb(source,width,height,x+dx*radiusX,y+dy*radiusY,tap);
        const r=tap[0],g=tap[1],b=tap[2];
        const weight=!dx||!dy ? 2 : 1;
        br+=r*weight;bg+=g*weight;bb+=b*weight;
        lr=Math.min(lr,r);lg=Math.min(lg,g);lb=Math.min(lb,b);
        hr=Math.max(hr,r);hg=Math.max(hg,g);hb=Math.max(hb,b);
      }
      const band=(source[i]-br/16)*.2126+(source[i+1]-bg/16)*.7152+(source[i+2]-bb/16)*.0722;
      const cap=Math.min(6,((hr-lr)*.2126+(hg-lg)*.7152+(hb-lb)*.0722)*.15);
      const delta=Math.max(-cap,Math.min(cap,Math.sign(band)*Math.max(0,Math.abs(band)-1)*detail*.8));
      output[i]=Math.max(lr,Math.min(hr,source[i]+delta));
      output[i+1]=Math.max(lg,Math.min(hg,source[i+1]+delta));
      output[i+2]=Math.max(lb,Math.min(hb,source[i+2]+delta));
      protect?.(x,y,output,i);
      output[i+3]=255;
    }
  }
}
