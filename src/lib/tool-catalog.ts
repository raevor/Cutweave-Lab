export type ToolSlug = "face-recognition" | "bass-markers" | "anime-face-recognition";

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
  accent: "rust" | "blue";
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
    slug: "anime-face-recognition", index: "02", title: "Anime Face Recognition", shortTitle: "Find one animated character across a video",
    eyebrow: "Anime characters / scene finding", description: "Choose an illustrated character and find the scenes where the same character appears again.",
    promise: "Stop scrubbing through an episode just to find one character.", input: "One local animated video", output: "Character-matched scenes + timecodes", accent: "rust",
    results: ["Local character picker", "Reviewable anime matches", "Correctable timecodes", "Export-ready scene list"],
  },
  {
    slug: "bass-markers", index: "03", title: "Music & Bass Markers", shortTitle: "Put the hits on the timeline",
    eyebrow: "Music / bass and impact points", description: "Find strong hits in a local audio file and turn them into adjustable edit markers.",
    promise: "Let the rhythm points arrive before you start cutting.", input: "One local audio file", output: "Marker-rich WAV + timing data", accent: "blue",
    results: ["Bass and impact candidates", "Sensitivity and spacing controls", "Editable marker timeline", "WAV, XMP, JSON and CSV export"],
  },
];

export function getTool(slug: string) {
  return primaryTools.find((tool) => tool.slug === slug);
}

export function isToolAvailable(slug: ToolSlug) {
  return slug === "face-recognition" || slug === "anime-face-recognition" || slug === "bass-markers";
}
