import {describe,expect,it} from "vitest";
import {sharpenPixels} from "./sharpen";

describe("output contrast adaptive restoration",()=>{
  it("preserves flat colors, near-black tones and exact bypass",async()=>{
    for(const level of [0,1,4,16,73,128,255]) {
      const source=new Uint8ClampedArray(16*8*4),output=new Uint8ClampedArray(source.length);
      for(let i=0;i<source.length;i+=4)source.set([level,level,level,255],i);
      await sharpenPixels(source,output,16,8,1);expect(output).toEqual(source);
      await sharpenPixels(source,output,16,8,0);expect(output).toEqual(source);
    }
  });
  it("recovers definition in a smooth resized edge",async()=>{
    const source=new Uint8ClampedArray(32*16*4),output=new Uint8ClampedArray(source.length);
    for(let y=0;y<16;y++)for(let x=0;x<32;x++) {
      const value=40+160/(1+Math.exp(-(x-16)/1.5));source.set([value,value,value,255],(y*32+x)*4);
    }
    await sharpenPixels(source,output,32,16,1);
    let before=0,after=0;
    for(let x=4;x<28;x++) {
      const ideal=40+160/(1+Math.exp(-(x-16)/1.25)),i=(8*32+x)*4;
      before+=(source[i]-ideal)**2;after+=(output[i]-ideal)**2;
    }
    expect(after).toBeLessThan(before);
    // Stronger reconstruction is delegated to the learned model. Finishing
    // must sharpen gently without overshooting existing local colors.
    for(let x=1;x<31;x++){
      const i=(8*32+x)*4;
      expect(Math.abs(output[i]-source[i])).toBeLessThanOrEqual(6);
      expect(output[i]).toBeGreaterThanOrEqual(source[i-4]);
      expect(output[i]).toBeLessThanOrEqual(source[i+4]);
    }
  });
  it("observes cancellation within a frame",async()=>{
    const source=new Uint8ClampedArray(16*128*4);let checks=0;
    await expect(sharpenPixels(source,new Uint8ClampedArray(source.length),16,128,1,()=>++checks>1)).rejects.toMatchObject({name:"AbortError"});
  });
});
