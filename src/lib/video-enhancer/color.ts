/** The RGB picture has already been decoded for display. Encode its code values
 * as limited-range Rec.709 YUV, with matching frame and MP4 metadata. Never
 * reinterpret full-range RGB bytes as limited-range YUV or inherit canvas tags. */
export const SDR_VIDEO_COLOR_SPACE: VideoColorSpaceInit = {
  primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false,
};

export function nv12Layout(width: number, height: number) {
  if (width < 2 || height < 2 || width % 2 || height % 2) throw new Error("Video output dimensions must be positive and even.");
  const stride = Math.ceil(width / 4) * 4;
  return {stride, chromaOffset: stride * height, byteLength: stride * (height + height / 2)};
}

/** CPU counterpart of the GPU export packing pass. Padding is deterministic. */
export function rgbaToNv12(rgba: Uint8ClampedArray, output: Uint8Array, width: number, height: number) {
  const {stride,chromaOffset,byteLength}=nv12Layout(width,height);
  if(rgba.length!==width*height*4 || output.length!==byteLength) throw new Error("Invalid video color buffer dimensions.");
  output.fill(16,0,chromaOffset);output.fill(128,chromaOffset);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    const luma=.2126*rgba[i]+.7152*rgba[i+1]+.0722*rgba[i+2];
    output[y*stride+x]=Math.round(16+219*luma/255);
  }
  for(let y=0;y<height;y+=2) for(let x=0;x<width;x+=2) {
    const a=(y*width+x)*4,b=a+4,c=a+width*4,d=c+4;
    const r=(rgba[a]+rgba[b]+rgba[c]+rgba[d])/4;
    const g=(rgba[a+1]+rgba[b+1]+rgba[c+1]+rgba[d+1])/4;
    const blue=(rgba[a+2]+rgba[b+2]+rgba[c+2]+rgba[d+2])/4;
    const luma=.2126*r+.7152*g+.0722*blue;
    const i=chromaOffset+(y/2)*stride+x;
    output[i]=Math.round(128+224*(blue-luma)/(255*1.8556));
    output[i+1]=Math.round(128+224*(r-luma)/(255*1.5748));
  }
}
