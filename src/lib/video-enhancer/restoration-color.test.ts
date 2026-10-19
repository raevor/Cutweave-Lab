import {describe,expect,it} from "vitest";
import {anchorRestorationColors} from "./restoration-color";

function picture(width:number,height:number,pixel:(x:number,y:number,c:number)=>number){
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    for(let c=0;c<3;c++)data[(y*width+x)*4+c]=pixel(x,y,c);
    data[(y*width+x)*4+3]=255;
  }return data;
}
describe("source-anchored restoration",()=>{
  it("preserves matching flat model colors across dark and bright levels",async()=>{
    for(const value of [0,4,16,32,96,180,240]){
      const source=picture(24,16,(_x,_y,c)=>Math.min(255,value+[0,5,9][c]));
      const model=new Uint8ClampedArray(source);
      const output=new Uint8ClampedArray(source.length);
      await anchorRestorationColors(source,model,output,24,16,12,8,{denoise:1,detail:1,scale:2});
      expect(output).toEqual(source);
    }
  });
  it("retains learned RGB predictions without subtracting a shifted color residual",async()=>{
    const source=picture(24,16,(_x,_y,c)=>150+c*5);
    const model=picture(24,16,(_x,_y,c)=>[140,159,173][c]);
    const output=new Uint8ClampedArray(source.length);
    await anchorRestorationColors(source,model,output,24,16,24,16,{denoise:0,detail:1,scale:1});
    expect(output).toEqual(model);
  });
  it("limits invented white lines over a dark source stroke",async()=>{
    const source=picture(24,16,()=>16),model=picture(24,16,()=>180);
    const output=new Uint8ClampedArray(source.length);
    await anchorRestorationColors(source,model,output,24,16,24,16,{denoise:0,detail:1,scale:1});
    for(let i=0;i<output.length;i+=4){
      expect(output[i]).toBeGreaterThanOrEqual(16);
      expect(output[i]).toBeLessThanOrEqual(20);
    }
  });
  it("transfers a recovered edge without grading unchanged plateaus",async()=>{
    const ideal=picture(64,32,x=>x<32 ? 70 : 170);
    const source=picture(64,32,x=>70+100/(1+Math.exp(-(x-32)/1.5)));
    const output=new Uint8ClampedArray(source.length);
    await anchorRestorationColors(source,ideal,output,64,32,64,32,{denoise:0,detail:1,scale:1});
    expect(output).toEqual(ideal);
    for(const x of [0,63])expect(output[(16*64+x)*4]).toBe(source[(16*64+x)*4]);
  });
  it("keeps the source exactly when both controls are off",async()=>{
    const source=picture(24,16,(x,y,c)=>(x*13+y*9+c*7)%256),model=picture(24,16,()=>120);
    const output=new Uint8ClampedArray(source.length);
    await anchorRestorationColors(source,model,output,24,16,24,16,{denoise:0,detail:0,scale:1});
    expect(output).toEqual(source);
  });
  it("samples a native reference consistently at fractional output sizes",async()=>{
    const source=picture(2,2,(x,y,c)=>20+x*160+y*40+c*5);
    const restored=picture(3,3,()=>0),output=new Uint8ClampedArray(restored.length);
    await anchorRestorationColors(source,restored,output,3,3,2,2,{denoise:0,detail:0,scale:2},()=>false,2,2);
    expect([...output.slice(0,3)]).toEqual([20,25,30]);
    expect([...output.slice(16,19)]).toEqual([120,125,130]);
    expect([...output.slice(32,35)]).toEqual([220,225,230]);
  });
  it("yields to cancellation without publishing a completed frame",async()=>{
    const source=picture(24,96,()=>75),output=new Uint8ClampedArray(source.length);
    let checks=0;
    await expect(anchorRestorationColors(source,source,output,24,96,24,96,{denoise:1,detail:1,scale:1},()=>++checks>1)).rejects.toMatchObject({name:"AbortError"});
  });
});
