/** Bilinear RGB with shared coordinate math. Keep each channel's arithmetic
 * order identical to the previous scalar sampler; no per-pixel allocations. */
export function sampleRgb(
  data:Uint8ClampedArray,width:number,height:number,x:number,y:number,out:Float64Array,
) {
  x=Math.max(0,Math.min(width-1,x));y=Math.max(0,Math.min(height-1,y));
  const left=Math.floor(x),top=Math.floor(y),right=Math.min(width-1,left+1),bottom=Math.min(height-1,top+1);
  const wx=x-left,wy=y-top,a=(top*width+left)*4,b=(top*width+right)*4,c=(bottom*width+left)*4,d=(bottom*width+right)*4;
  for(let channel=0;channel<3;channel++)out[channel]=
    (data[a+channel]*(1-wx)+data[b+channel]*wx)*(1-wy)
    +(data[c+channel]*(1-wx)+data[d+channel]*wx)*wy;
}
