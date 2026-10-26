import { exportableCues, wrapCueText } from "./cues";
import type { SubtitleCue } from "./types";

export type AfterEffectsCompSettings = {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
};

/**
 * After Effects cannot import SRT or VTT files, so the subtitles travel as an
 * ExtendScript file instead (File > Scripts > Run Script File). It adds one text
 * layer whose Source Text changes at every line, into the open composition or a
 * new one matching the source. ExtendScript is ES3: no arrow functions, let or const.
 */
export function createAfterEffectsScript(cues: SubtitleCue[], comp: AfterEffectsCompSettings) {
  const lines = exportableCues(cues).map((cue) => [
    Number(cue.start.toFixed(3)),
    Number(cue.end.toFixed(3)),
    // After Effects breaks text lines with a carriage return.
    wrapCueText(cue.text).replace(/\n/g, "\r"),
  ]);
  const lastEnd = lines.reduce((latest, line) => Math.max(latest, line[1] as number), 0);
  const settings = {
    name: `${comp.name} subtitles`,
    width: Math.max(16, Math.round(comp.width)),
    height: Math.max(16, Math.round(comp.height)),
    frameRate: comp.frameRate,
    duration: Math.max(comp.duration, lastEnd + 1),
  };

  return `// Cutweave Lab: English subtitles for After Effects.
// Run it in After Effects with File > Scripts > Run Script File.
// With a composition open, the subtitles are added to it, starting at 0:00.
// Otherwise a new composition is created that matches the source video.
(function () {
  var lines = ${JSON.stringify(lines)};
  var settings = ${JSON.stringify(settings)};

  app.beginUndoGroup("Add Cutweave subtitles");
  var comp = app.project.activeItem;
  if (!(comp && comp instanceof CompItem)) {
    comp = app.project.items.addComp(settings.name, settings.width, settings.height, 1, settings.duration, settings.frameRate);
    comp.openInViewer();
  }

  var layer = comp.layers.addText("");
  layer.name = "Subtitles (Cutweave)";
  var sourceText = layer.property("ADBE Text Properties").property("ADBE Text Document");
  var style = sourceText.value;
  style.fontSize = Math.round(comp.height * 0.045);
  style.fillColor = [1, 1, 1];
  style.applyStroke = true;
  style.strokeColor = [0, 0, 0];
  style.strokeWidth = Math.max(2, Math.round(comp.height * 0.004));
  style.strokeOverFill = false;
  style.justification = ParagraphJustification.CENTER_JUSTIFY;
  style.text = "";
  sourceText.setValue(style);
  layer.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height * 0.86]);

  // Source Text keyframes hold, so each line stays until the next keyframe.
  for (var i = 0; i < lines.length; i++) {
    style.text = lines[i][2];
    sourceText.setValueAtTime(lines[i][0], style);
    var next = lines[i + 1];
    if (!next || next[0] - lines[i][1] > 0.001) {
      style.text = "";
      sourceText.setValueAtTime(lines[i][1], style);
    }
  }

  app.endUndoGroup();
  alert(lines.length + " subtitle lines were added to \\"" + comp.name + "\\".");
})();
`;
}
