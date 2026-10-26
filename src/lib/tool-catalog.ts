export type ToolSlug = "face-recognition" | "bass-markers" | "anime-face-recognition" | "auto-subtitles" | "background-remover";

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
    promise: "Let the rhythm points arrive before you start cutting.", input: "One local audio file", output: "WAV with markers + timing data", accent: "blue",
    results: ["Bass and impact candidates", "Sensitivity and spacing controls", "Editable marker timeline", "WAV, XMP, JSON and CSV export"],
  },
  {
    slug: "auto-subtitles", index: "04", title: "Auto Subtitles", shortTitle: "Turn English speech into subtitles",
    eyebrow: "Speech / subtitle lines", description: "Transcribe spoken English into timed subtitle lines you can correct and export.",
    promise: "Stop typing subtitles by hand while scrubbing back and forth.", input: "One local video or audio file", output: "Timed English subtitles", accent: "blue",
    results: ["Local English transcription", "Timed, readable subtitle lines", "Editable text for every line", "SRT, VTT and transcript export"],
  },
  {
    slug: "background-remover", index: "05", title: "Background Remover", shortTitle: "Cut the subject out of an image",
    eyebrow: "Images / subject cut-out", description: "Separate the subject from its background and export a transparent PNG or a matte.",
    promise: "Stop masking thumbnails and stills by hand.", input: "One local image", output: "Transparent PNG + matte", accent: "rust",
    results: ["Local subject separation", "Before and after comparison", "Adjustable edge", "PNG, background and matte export"],
  },
];

export function getTool(slug: string) {
  return primaryTools.find((tool) => tool.slug === slug);
}

export function isToolAvailable(slug: ToolSlug) {
  return slug === "face-recognition" || slug === "anime-face-recognition" || slug === "bass-markers" || slug === "auto-subtitles" || slug === "background-remover";
}
