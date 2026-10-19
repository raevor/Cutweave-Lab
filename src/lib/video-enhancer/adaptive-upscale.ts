// Adapted from AMD FidelityFX FSR 1 EASU (2021), MIT. See FSR-LICENSE.txt.
// Exact reciprocal/square root replace the platform-specific approximations.
export const adaptiveSampling = `
uniform vec2 sourceSize;
uniform bool upscale;
float edgeLuma(vec3 c) { return c.g + 0.5 * (c.r + c.b); }
void edgeSet(inout vec2 direction, inout float strength, float weight,
             float a, float b, float c, float d, float e) {
  vec2 gradient = vec2(d-b,e-a);
  vec2 range = max(abs(vec2(d,e)-c),abs(c-vec2(b,a)));
  vec2 shape = clamp(abs(gradient)/max(range,vec2(0.00001)),0.0,1.0);
  direction += gradient * weight;
  strength += dot(shape,shape) * weight;
}
vec3 samplePicture(vec2 point) {
  if (!upscale) return texture(picture,point).rgb;
  vec2 pixel=point*sourceSize-0.5,base=floor(pixel),f=fract(pixel);
  const ivec2 offsets[12]=ivec2[12](ivec2(0,-1),ivec2(1,-1),ivec2(-1,0),ivec2(0,0),
    ivec2(1,0),ivec2(2,0),ivec2(-1,1),ivec2(0,1),ivec2(1,1),ivec2(2,1),ivec2(0,2),ivec2(1,2));
  vec3 taps[12]; float l[12];
  for(int i=0;i<12;i++) {
    taps[i]=texture(picture,(base+vec2(offsets[i])+0.5)/sourceSize).rgb;
    l[i]=edgeLuma(taps[i]);
  }
  vec2 direction=vec2(0); float strength=0.0;
  edgeSet(direction,strength,(1.0-f.x)*(1.0-f.y),l[0],l[2],l[3],l[4],l[7]);
  edgeSet(direction,strength,f.x*(1.0-f.y),l[1],l[3],l[4],l[5],l[8]);
  edgeSet(direction,strength,(1.0-f.x)*f.y,l[3],l[6],l[7],l[8],l[10]);
  edgeSet(direction,strength,f.x*f.y,l[4],l[7],l[8],l[9],l[11]);
  float magnitude=dot(direction,direction);
  direction=magnitude<1.0/32768.0 ? vec2(1,0) : direction*inversesqrt(magnitude);
  // Fade anisotropy on nearly flat neighborhoods; one-code rounding must not
  // select an unrelated strong direction between GPU and CPU.
  strength *= smoothstep(1.0/32768.0,4.0/32768.0,magnitude);
  strength *= 0.5; strength *= strength;
  float stretch=dot(direction,direction)/max(abs(direction.x),abs(direction.y));
  vec2 shape=vec2(1.0+(stretch-1.0)*strength,1.0-0.5*strength);
  float lobe=0.5-0.29*strength,clipDistance=1.0/lobe;
  vec3 sum=vec3(0); float total=0.0;
  for(int i=0;i<12;i++) {
    vec2 offset=vec2(offsets[i])-f;
    vec2 v=vec2(dot(offset,direction),dot(offset,vec2(-direction.y,direction.x)))*shape;
    float d=min(dot(v,v),clipDistance);
    float b=0.4*d-1.0,a=lobe*d-1.0;
    float weight=(1.5625*b*b-0.5625)*a*a;
    sum+=taps[i]*weight; total+=weight;
  }
  vec3 low=min(min(taps[3],taps[4]),min(taps[7],taps[8]));
  vec3 high=max(max(taps[3],taps[4]),max(taps[7],taps[8]));
  return clamp(sum/max(total,0.00001),low,high);
}`;

const tapX = [0,1,-1,0,1,2,-1,0,1,2,0,1];
const tapY = [-1,-1,0,0,0,0,1,1,1,1,2,2];
const centers = [3,4,7,8], tops = [0,1,3,4], lefts = [2,3,6,7], rights = [4,5,8,9], bottoms = [7,8,10,11];

/** Twelve-tap directional reconstruction; fixed buffers, no learned weights. */
export async function adaptiveUpscale(
  source: Uint8ClampedArray, width: number, height: number,
  output: Uint8ClampedArray, outWidth: number, outHeight: number,
  shouldCancel: () => boolean = () => false,
) {
  if (width === outWidth && height === outHeight) { output.set(source); return; }
  const taps = new Float32Array(36), luma = new Float32Array(12);
  for (let y = 0; y < outHeight; y++) {
    if (y % 32 === 0) {
      const scheduler = (globalThis as typeof globalThis & {scheduler?: {yield: () => Promise<void>}}).scheduler;
      if (scheduler) await scheduler.yield(); else await new Promise<void>(resolve => setTimeout(resolve,0));
      if (shouldCancel()) throw new DOMException("Cancelled", "AbortError");
    }
    const py = (y+.5)*height/outHeight-.5, by = Math.floor(py), fy = py-by;
    for (let x = 0; x < outWidth; x++) {
      const px = (x+.5)*width/outWidth-.5, bx = Math.floor(px), fx = px-bx;
      for (let k = 0; k < 12; k++) {
        const index = (Math.max(0,Math.min(height-1,by+tapY[k]))*width+Math.max(0,Math.min(width-1,bx+tapX[k])))*4;
        taps[k*3] = source[index]; taps[k*3+1] = source[index+1]; taps[k*3+2] = source[index+2];
        luma[k] = (source[index+1]+.5*(source[index]+source[index+2]))/255;
      }
      let dx=0,dy=0,strength=0;
      // Four bilinear centers share the same twelve loaded samples.
      for (let k=0;k<4;k++) {
        const center=centers[k], top=tops[k], left=lefts[k], right=rights[k], bottom=bottoms[k];
        const weight=(k%2 ? fx : 1-fx)*(k>=2 ? fy : 1-fy);
        const gx=luma[right]-luma[left],gy=luma[bottom]-luma[top];
        const sx=Math.min(1,Math.abs(gx)/Math.max(.00001,Math.abs(luma[right]-luma[center]),Math.abs(luma[center]-luma[left])));
        const sy=Math.min(1,Math.abs(gy)/Math.max(.00001,Math.abs(luma[bottom]-luma[center]),Math.abs(luma[center]-luma[top])));
        dx+=gx*weight;dy+=gy*weight;strength+=(sx*sx+sy*sy)*weight;
      }
      const magnitude=dx*dx+dy*dy;
      if(magnitude<1/32768){dx=1;dy=0;}else{const inverse=1/Math.sqrt(magnitude);dx*=inverse;dy*=inverse;}
      const confidence=Math.max(0,Math.min(1,(magnitude-1/32768)/(3/32768)));
      strength*=confidence*confidence*(3-2*confidence);
      strength=(strength*.5)**2;
      const stretch=(dx*dx+dy*dy)/Math.max(Math.abs(dx),Math.abs(dy));
      const lengthX=1+(stretch-1)*strength,lengthY=1-.5*strength,lobe=.5-.29*strength;
      let red=0,green=0,blue=0,total=0;
      for(let k=0;k<12;k++) {
        const ox=tapX[k]-fx,oy=tapY[k]-fy;
        const vx=(ox*dx+oy*dy)*lengthX,vy=(-ox*dy+oy*dx)*lengthY;
        const distance=Math.min(vx*vx+vy*vy,1/lobe),b=.4*distance-1,a=lobe*distance-1;
        const weight=(1.5625*b*b-.5625)*a*a;
        red+=taps[k*3]*weight;green+=taps[k*3+1]*weight;blue+=taps[k*3+2]*weight;total+=weight;
      }
      const index=(y*outWidth+x)*4;
      for(let c=0;c<3;c++) {
        const low=Math.min(taps[9+c],taps[12+c],taps[21+c],taps[24+c]);
        const high=Math.max(taps[9+c],taps[12+c],taps[21+c],taps[24+c]);
        output[index+c]=Math.max(low,Math.min(high,(c===0?red:c===1?green:blue)/Math.max(total,.00001)));
      }
      output[index+3]=255;
    }
  }
}
