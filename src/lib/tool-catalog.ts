export type ToolSlug = "face-recognition" | "bass-markers" | "clarity-boost";

export type ToolDefinition = {
  slug: ToolSlug;
  index: string;
  title: string;
  shortTitle: string;
  eyebrow: string;
  description: string;
  promise: string;
  input: string;
  output: string;
  accent: "signal" | "rust" | "blue";
  results: string[];
};

export const primaryTools: ToolDefinition[] = [
  {
    slug: "face-recognition", index: "01", title: "Face Recognition", shortTitle: "Find one face across a video",
    eyebrow: "Faces / scene finding", description: "Choose a face and find the scenes where it appears again.",
    promise: "Stop scrubbing through the whole video just to find one person.", input: "One local video", output: "Matched scenes + timecodes", accent: "rust",
    results: ["Local face picker", "Reviewable matches", "Correctable timecodes", "Export-ready scene list"],
  },
  {
    slug: "bass-markers", index: "02", title: "Music & Bass Markers", shortTitle: "Put the hits on the timeline",
    eyebrow: "Music / bass and impact points", description: "Find strong hits in a song or video and turn them into adjustable edit markers.",
    promise: "Let the rhythm points arrive before you start cutting.", input: "Local song, audio or video", output: "Adjustable timeline markers", accent: "blue",
    results: ["Bass and impact candidates", "Sensitivity controls", "Editable marker strip", "Marker data for export"],
  },
  {
    slug: "clarity-boost", index: "03", title: "Video Enhancer", shortTitle: "Bring back useful detail",
    eyebrow: "Picture / cleanup and upscale", description: "Clean up soft footage, reduce noise and prepare a sharper local upscale.",
    promise: "Rescue a usable shot before you give up on it.", input: "One local video", output: "Enhanced clip + comparison", accent: "signal",
    results: ["Before-and-after preview", "Denoise and detail controls", "Device-aware upscale options", "Enhanced local export"],
  },
];

export function getTool(slug: string) {
  return primaryTools.find((tool) => tool.slug === slug);
}
