// FSRCNN has a six-source-pixel receptive radius. An eight-pixel
// overlap covers the full network with a small interpolation margin.
// Discard the receptive-field border;
// tile size affects memory and speed, never reconstruction strength.
export const RESTORATION_TILE_PAD = 8;
const plans=new Map<string,{width:number;height:number}>();
export function restorationTileShape(width: number,height: number,device:"gpu"|"cpu",halfPrecision=false,pad=RESTORATION_TILE_PAD,pixelLimit?:number) {
  // Active callers supply model/device memory bounds. Keep historical defaults
  // for older processors. Cache dimensions only, never media or frame results.
  const maxPixels=pixelLimit??(device==="gpu" ? halfPrecision ? 786432 : 393216 : 65536);
  const key=`${width}:${height}:${pad}:${maxPixels}`;
  const cached=plans.get(key);if(cached)return cached;
  const align=(value:number)=>Math.ceil(value/8)*8;
  let best={width:128,height:128},score=Infinity;
  const maxX=Math.ceil(width/56),maxY=Math.ceil(height/56);
  for(let nx=1;nx<=maxX;nx++)for(let ny=1;ny<=maxY;ny++) {
    const w=align(Math.ceil(width/nx)+pad*2),h=align(Math.ceil(height/ny)+pad*2);
    if(w*h>maxPixels||w>1536||h>1536)continue;
    const count=Math.ceil(width/(w-pad*2))*Math.ceil(height/(h-pad*2));
    const cost=count*(w*h+12000);
    if(cost<score){score=cost;best={width:w,height:h};}
  }
  if(plans.size>=16)plans.delete(plans.keys().next().value!);
  plans.set(key,best);return best;
}
export function restorationInputSize(width: number, height: number, outputWidth: number, outputHeight: number) {
  const ratio = Math.min(1, outputWidth / width, outputHeight / height);
  return { width: Math.max(2, Math.round(width * ratio)), height: Math.max(2, Math.round(height * ratio)) };
}
