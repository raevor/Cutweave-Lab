import {describe,expect,it} from "vitest";
import {nv12Layout,rgbaToNv12,SDR_VIDEO_COLOR_SPACE} from "./color";

function encode(colors: number[][],width=colors.length,height=2) {
  const rgba=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set([...colors[x],255],(y*width+x)*4);
  const layout=nv12Layout(width,height),bytes=new Uint8Array(layout.byteLength);
  rgbaToNv12(rgba,bytes,width,height);
  return {bytes,layout};
}
describe("SDR export color",()=>{
  it("encodes real black and white as legal video levels with neutral chroma",()=>{
    const {bytes,layout}=encode([[0,0,0],[0,0,0],[255,255,255],[255,255,255]]);
    expect([...bytes.slice(0,4)]).toEqual([16,16,235,235]);
    expect([...bytes.slice(layout.chromaOffset)]).toEqual([128,128,128,128]);
    expect(SDR_VIDEO_COLOR_SPACE).toEqual({primaries:"bt709",transfer:"bt709",matrix:"bt709",fullRange:false});
  });
  it("preserves every near-black grey level within one RGB code value after range conversion",()=>{
    const colors=Array.from({length:32},(_,i)=>[i,i,i]),{bytes}=encode(colors);
    for(let i=0;i<32;i++) expect(Math.abs((bytes[i]-16)*255/219-i)).toBeLessThanOrEqual(.6);
    expect(bytes[2]).toBeGreaterThan(bytes[0]);
    expect(bytes[16]).toBeGreaterThan(bytes[2]);
  });
  it("uses the Rec.709 matrix rather than changing color saturation",()=>{
    const {bytes,layout}=encode([[255,0,0],[255,0,0],[0,0,255],[0,0,255]]);
    expect([...bytes.slice(0,4)]).toEqual([63,63,32,32]);
    expect([...bytes.slice(layout.chromaOffset)]).toEqual([102,240,240,118]);
  });
  it("pads even widths that are not a multiple of four without mixing the Y and UV planes",()=>{
    const {bytes,layout}=encode(Array.from({length:6},()=>[128,128,128]));
    expect(layout).toEqual({stride:8,chromaOffset:16,byteLength:24});
    expect([...bytes.slice(6,8)]).toEqual([16,16]);
    expect([...bytes.slice(16,24)]).toEqual([128,128,128,128,128,128,128,128]);
  });
  it("rejects odd sizes and malformed buffers",()=>{
    expect(()=>nv12Layout(5,4)).toThrow();
    expect(()=>rgbaToNv12(new Uint8ClampedArray(4),new Uint8Array(6),2,2)).toThrow();
  });
});
