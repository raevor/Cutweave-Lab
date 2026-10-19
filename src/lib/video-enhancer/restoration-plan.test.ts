import {describe,expect,it} from "vitest";
import {RESTORATION_TILE_PAD,restorationTileShape,restorationInputSize} from "./restoration-plan";
describe("bounded restoration tiling",()=>{
  it("covers landscape, portrait and tiny sources without exceeding either device's feature-buffer bound",()=>{
    for(const [width,height] of [[1024,576],[2160,3840],[8,6],[1920,1080]])for(const device of ["gpu","cpu"] as const){
      const tile=restorationTileShape(width,height,device);
      expect(tile.width*tile.height).toBeLessThanOrEqual(device==="gpu" ? 393216 : 65536);
      expect(tile.width).toBeGreaterThan(RESTORATION_TILE_PAD*2);
      expect(tile.height).toBeGreaterThan(RESTORATION_TILE_PAD*2);
    }
  });
  it("reduces padded work on the real source compared with 384-pixel square GPU tiles",()=>{
    const t=restorationTileShape(1024,576,"gpu"),pad=RESTORATION_TILE_PAD*2;
    const work=Math.ceil(1024/(t.width-pad))*Math.ceil(576/(t.height-pad))*t.width*t.height;
    expect(work).toBeLessThan(Math.ceil(1024/(384-pad))*Math.ceil(576/(384-pad))*384*384*.8);
  });
  it("preserves source pixels until an output ceiling actually requires reduction",()=>{
    expect(restorationInputSize(1920,1080,3840,2160)).toEqual({width:1920,height:1080});
    expect(restorationInputSize(7680,4320,3840,2160)).toEqual({width:3840,height:2160});
  });
});
