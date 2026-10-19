import {describe,expect,it} from "vitest";
import {adaptiveUpscale} from "./adaptive-upscale";

async function upscale(values: number[]) {
  const source=new Uint8ClampedArray(values.length*2*4);
  for(let y=0;y<2;y++)for(let x=0;x<values.length;x++)source.set([values[x],values[x],values[x],255],(y*values.length+x)*4);
  const output=new Uint8ClampedArray(values.length*2*4*4);
  await adaptiveUpscale(source,values.length,2,output,values.length*2,4);
  return output;
}
describe("edge adaptive upscale",()=>{
  it("keeps flat near-black tones and white at the same levels",async()=>{
    for(const level of [0,1,4,16,128,255]){
      const output=await upscale([level,level,level,level]);
      expect(output.every((value,i)=>value===(i%4===3?255:level))).toBe(true);
    }
  });
  it("keeps edges sharper than bilinear without light or dark ringing",async()=>{
    const output=await upscale([40,40,40,220,220,220]);
    const row=Array.from({length:12},(_,x)=>output[x*4]);
    expect(row[5]).toBeLessThan(85);expect(row[6]).toBeGreaterThan(175);
    expect(Math.min(...row)).toBe(40);expect(Math.max(...row)).toBe(220);
  });
  it("leaves equal-sized images untouched",async()=>{
    const source=new Uint8ClampedArray([10,20,30,255,50,80,90,255]),output=new Uint8ClampedArray(8);
    await adaptiveUpscale(source,2,1,output,2,1);
    expect(output).toEqual(source);
  });
  it("allows cancellation during a large output frame",async()=>{
    const source=new Uint8ClampedArray(16*16*4),output=new Uint8ClampedArray(64*64*4);
    let checks=0;
    await expect(adaptiveUpscale(source,16,16,output,64,64,()=>++checks>1)).rejects.toMatchObject({name:"AbortError"});
  });
});
