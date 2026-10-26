import { describe, expect, it } from "vitest";
import { createAfterEffectsScript } from "./after-effects";

const cues = [
  { id: "a", start: 4.5, end: 7.1, text: "We have main engine start." },
  { id: "b", start: 7.1, end: 11.6, text: "4, 3, 2, 1, yeah." },
  { id: "c", start: 23.2, end: 24.5, text: "You're a jerk, \"Tom\"." },
  { id: "d", start: 30.8, end: 34.6, text: "Why don't you just admit that you're freaked out by my robot hand?" },
];
const settings = { name: "Tears of Steel", width: 1920, height: 800, frameRate: 24, duration: 734.2 };

type Keyframe = { time: number; text: string };

/** A small stand-in for the After Effects scripting objects the file uses. */
function runInFakeAfterEffects(script: string, openComp: boolean) {
  class CompItem {
    layers = { added: [] as unknown[], addText: () => this.addLayer() };
    opened = false;
    constructor(public name: string, public width: number, public height: number, public duration = 60) {}
    openInViewer() { this.opened = true; }
    addLayer() {
      const keyframes: Keyframe[] = [];
      let position: number[] = [];
      const sourceText = {
        value: { text: "" } as Record<string, unknown>,
        setValue(style: Record<string, unknown>) { this.value = { ...style }; },
        setValueAtTime(time: number, style: { text: string }) { keyframes.push({ time, text: style.text }); },
      };
      const layer = {
        name: "",
        keyframes,
        position: () => position,
        sourceText,
        property: (name: string) => name === "ADBE Text Properties"
          ? { property: () => sourceText }
          : { property: () => ({ setValue: (value: number[]) => { position = value; } }) },
      };
      this.layers.added.push(layer);
      return layer;
    }
  }
  const created: CompItem[] = [];
  const existing = new CompItem("My edit", 3840, 2160);
  const alerts: string[] = [];
  const app = {
    project: {
      activeItem: openComp ? existing : null,
      items: {
        addComp: (name: string, width: number, height: number, _aspect: number, duration: number) => {
          const comp = new CompItem(name, width, height, duration);
          created.push(comp);
          return comp;
        },
      },
    },
    beginUndoGroup: () => undefined,
    endUndoGroup: () => undefined,
  };
  new Function("app", "CompItem", "ParagraphJustification", "alert", script)(app, CompItem, { CENTER_JUSTIFY: "center" }, (message: string) => alerts.push(message));
  return { existing, created, alerts };
}

describe("After Effects subtitle script", () => {
  it("uses only ES3 syntax that ExtendScript understands", () => {
    const script = createAfterEffectsScript(cues, settings);
    expect(script).not.toMatch(/=>|\blet\b|\bconst\b|`/);
  });

  it("creates a matching composition with timed lines when none is open", () => {
    const { created, alerts } = runInFakeAfterEffects(createAfterEffectsScript(cues, settings), false);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Tears of Steel subtitles", width: 1920, height: 800, duration: 734.2, opened: true });
    const layer = created[0].layers.added[0] as { name: string; keyframes: Keyframe[]; position: () => number[] };
    expect(layer.name).toBe("Subtitles (Cutweave)");
    expect(layer.position()).toEqual([960, 688]);
    expect(layer.keyframes).toEqual([
      { time: 4.5, text: "We have main engine start." },
      { time: 7.1, text: "4, 3, 2, 1, yeah." },
      { time: 11.6, text: "" },
      { time: 23.2, text: "You're a jerk, \"Tom\"." },
      { time: 24.5, text: "" },
      { time: 30.8, text: "Why don't you just admit that\ryou're freaked out by my robot hand?" },
      { time: 34.6, text: "" },
    ]);
    expect(alerts).toEqual(["4 subtitle lines were added to \"Tears of Steel subtitles\"."]);
  });

  it("adds the subtitles to the open composition", () => {
    const { existing, created } = runInFakeAfterEffects(createAfterEffectsScript(cues, settings), true);
    expect(created).toHaveLength(0);
    expect(existing.layers.added).toHaveLength(1);
  });
});
