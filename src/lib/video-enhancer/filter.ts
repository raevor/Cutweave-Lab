import type { EnhancerSettings } from "./types";

export const DEFAULT_ENHANCER_SETTINGS: EnhancerSettings = { denoise: 0.7, detail: 1, sharpen: 0.5, scale: 2 };
const luminance = [0.2126, 0.7152, 0.0722];
function smooth(low: number, high: number, value: number) {
  const t = Math.max(0, Math.min(1, (value-low)/(high-low)));
  return t*t*(3-2*t);
}

/** Both devices run this fixed two-pass filter, in source pixel coordinates. */
export async function filterPixels(
  source: Uint8ClampedArray, clean: Uint8ClampedArray, output: Uint8ClampedArray,
  width: number, height: number, settings: EnhancerSettings,
  shouldCancel: () => boolean = () => false,
  luma: Float32Array = new Float32Array(width * height),
) {
  const range = 8 + settings.denoise * 24;
  const rangeFactor = 1 / (range * range);
  const blend = settings.denoise * 0.9;
  const check = async () => {
    // Yield to the worker message loop so cancellation does not wait a whole CPU frame.
    const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield: () => Promise<void> } }).scheduler;
    if (scheduler) await scheduler.yield();
    else await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (shouldCancel()) throw new DOMException("Cancelled", "AbortError");
  };
  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) await check();
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = source[i] * 4, g = source[i + 1] * 4, b = source[i + 2] * 4, total = 4;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = (Math.min(height - 1, Math.max(0, y + dy)) * width + Math.min(width - 1, Math.max(0, x + dx))) * 4;
        const difference = Math.abs(source[j] - source[i]) * luminance[0] + Math.abs(source[j + 1] - source[i + 1]) * luminance[1] + Math.abs(source[j + 2] - source[i + 2]) * luminance[2];
        const inverse = 1 / (1 + difference * difference * rangeFactor);
        const weight = (dx === 0 || dy === 0 ? 2 : 1) * inverse * inverse;
        r += source[j] * weight; g += source[j + 1] * weight; b += source[j + 2] * weight; total += weight;
      }
      clean[i] = Math.round(source[i] + (r / total - source[i]) * blend);
      clean[i + 1] = Math.round(source[i + 1] + (g / total - source[i + 1]) * blend);
      clean[i + 2] = Math.round(source[i + 2] + (b / total - source[i + 2]) * blend);
      clean[i + 3] = 255;
      luma[y * width + x] = clean[i]*luminance[0]+clean[i+1]*luminance[1]+clean[i+2]*luminance[2];
    }
  }
  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) await check();
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const row=y*width,top=Math.max(0,y-1)*width,bottom=Math.min(height-1,y+1)*width;
      const top2=Math.max(0,y-2)*width,bottom2=Math.min(height-1,y+2)*width;
      const left=Math.max(0,x-1),right=Math.min(width-1,x+1),left2=Math.max(0,x-2),right2=Math.min(width-1,x+2);
      const center=luma[row+x],n=luma[top+x],s=luma[bottom+x],e=luma[row+right],w=luma[row+left];
      const n2=luma[top2+x],s2=luma[bottom2+x],e2=luma[row+right2],w2=luma[row+left2];
      const nw=luma[top+left],ne=luma[top+right],sw=luma[bottom+left],se=luma[bottom+right];
      const fine=(center*4+(n+s+e+w)*2+nw+ne+sw+se)/16;
      const broad=(center*4+(n2+s2+e2+w2)*2+luma[top2+left2]+luma[top2+right2]+luma[bottom2+left2]+luma[bottom2+right2])/16;
      const low=Math.min(center,n,s,e,w,n2,s2,e2,w2),high=Math.max(center,n,s,e,w,n2,s2,e2,w2);
      const band=center-fine;
      const gate=smooth(1+settings.denoise*3,6+settings.denoise*8,high-low);
      const signal=Math.sign(band)*Math.max(0,Math.abs(band)-(.25+settings.denoise*1.5));
      let delta=settings.detail*gate*(signal*1.8+(fine-broad)*.8);
      const limit=Math.min(12,(high-low)*.2+1);
      delta=Math.max(-limit,Math.min(limit,delta));
      const overshoot=Math.min(3,(high-low)*.08)*settings.detail;
      delta=Math.max(low-overshoot,Math.min(high+overshoot,center+delta))-center;
      // Change luminance only; constrain one shared delta to the RGB gamut.
      delta=Math.max(-Math.min(clean[i],clean[i+1],clean[i+2]),Math.min(255-Math.max(clean[i],clean[i+1],clean[i+2]),delta));
      for(let c=0;c<3;c++) output[i+c]=clean[i+c]+delta;
      output[i + 3] = 255;
    }
  }
}
