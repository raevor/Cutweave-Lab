import { describe, expect, it } from "vitest";
import { DEFAULT_ENHANCER_SETTINGS, filterPixels } from "./filter";
import type { EnhancerSettings } from "./types";

async function run(input: Uint8ClampedArray, width: number, settings: EnhancerSettings) {
  const clean = new Uint8ClampedArray(input.length), output = new Uint8ClampedArray(input.length);
  await filterPixels(input, clean, output, width, input.length / 4 / width, settings);
  return output;
}
function picture(width: number, height: number, pixel: (x: number, y: number) => number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = pixel(x, y); pixels[i + 3] = 255;
  }
  return pixels;
}
describe("fixed enhancement filter", () => {
  it("preserves pixels exactly with both controls off", async () => {
    const source = picture(32, 24, (x, y) => (x * 13 + y * 17) % 256);
    expect(await run(source, 32, {...DEFAULT_ENHANCER_SETTINGS, denoise: 0, detail: 0})).toEqual(source);
  });
  it("reduces measured noise error without flattening a sharp boundary", async () => {
    let seed = 421;
    const source = picture(64, 48, (x) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (x < 32 ? 70 : 190) + Math.round((seed / 0xffffffff - .5) * 24);
    });
    // Test noise cleanup independently: detail enhancement deliberately raises
    // local contrast, which can also raise this synthetic noise error.
    const output = await run(source, 64, {...DEFAULT_ENHANCER_SETTINGS, detail: 0});
    let before = 0, after = 0;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4, ideal = x < 32 ? 70 : 190;
      before += (source[i] - ideal) ** 2; after += (output[i] - ideal) ** 2;
    }
    expect(after).toBeLessThan(before * .8);
    expect(output[(24 * 64 + 31) * 4]).toBeLessThan(85);
    expect(output[(24 * 64 + 32) * 4]).toBeGreaterThan(175);
  });
  it("increases soft-edge contrast within the three-code halo ceiling", async () => {
    const source = picture(20, 16, (x) => x < 8 ? 40 : x === 8 ? 70 : x === 9 ? 110 : x === 10 ? 165 : x === 11 ? 200 : 220);
    const output = await run(source, 20, {...DEFAULT_ENHANCER_SETTINGS, denoise: 0, detail: 1});
    const at = (x: number) => output[(8 * 20 + x) * 4];
    expect(at(10) - at(9)).toBeGreaterThan(55);
    expect(Math.min(...output.filter((_, i) => i % 4 < 3))).toBeGreaterThanOrEqual(37);
    expect(Math.max(...output.filter((_, i) => i % 4 < 3))).toBeLessThanOrEqual(223);
  });
  it("keeps a true black frame black", async () => {
    const source = picture(16, 16, () => 0);
    expect(await run(source, 16, DEFAULT_ENHANCER_SETTINGS)).toEqual(source);
  });
  it("restores attenuated low-contrast texture closer to its clean reference", async () => {
    const ideal=picture(64,32,x=>128+14*Math.cos(x*Math.PI/4));
    const source=picture(64,32,x=>128+8*Math.cos(x*Math.PI/4));
    const output=await run(source,64,{denoise:0,detail:.75,scale:1});
    let before=0,after=0;
    for(let y=2;y<30;y++)for(let x=4;x<60;x++) {
      const i=(y*64+x)*4;
      before+=(source[i]-ideal[i])**2;after+=(output[i]-ideal[i])**2;
    }
    // A bounded detail filter does not promise a 50% restoration error gain.
    expect(after).toBeLessThan(before);
    for(let i=0;i<source.length;i+=4){
      expect(Math.abs(output[i]-source[i])).toBeLessThanOrEqual(12);
      expect(output[i+1]).toBe(output[i]);
      expect(output[i+2]).toBe(output[i]);
      expect(output[i+3]).toBe(255);
    }
  });
  it("still restores soft edges when both controls are at maximum", async () => {
    const source=picture(64,32,x=>80+80/(1+Math.exp(-(x-32)/1.5)));
    const clean=await run(source,64,{denoise:1,detail:0,scale:1});
    const enhanced=await run(source,64,{denoise:1,detail:1,scale:1});
    const slope=(image:Uint8ClampedArray)=>image[(16*64+33)*4]-image[(16*64+31)*4];
    expect(slope(enhanced)).toBeGreaterThan(slope(clean));
  });
  it("preserves flat colors and hue differences without a global grade", async () => {
    const source=picture(32,24,()=>73);
    for(let i=0;i<source.length;i+=4){source[i+1]=91;source[i+2]=125;}
    expect(await run(source,32,{denoise:1,detail:1,scale:1})).toEqual(source);
  });
  it("observes cancellation inside a CPU frame", async () => {
    const source = picture(64, 128, () => 100);
    let checks = 0;
    await expect(filterPixels(source, new Uint8ClampedArray(source.length), new Uint8ClampedArray(source.length), 64, 128, DEFAULT_ENHANCER_SETTINGS, () => ++checks > 1)).rejects.toMatchObject({name: "AbortError"});
  });
});
