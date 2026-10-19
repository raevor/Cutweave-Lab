import type { ToolSlug } from "@/lib/tool-catalog";

type ToolVisualProps = {
  tool: ToolSlug;
  anatomyLabel?: string;
  outputLabel?: string;
  outputValue?: string;
  markerAxisLabel?: string;
};

export function ToolVisual({ tool, anatomyLabel, outputLabel = "OUTPUT", outputValue, markerAxisLabel = "TIMECODE / MARKER CANDIDATES" }: ToolVisualProps) {
  if (tool === "face-recognition" || tool === "anime-face-recognition") {
    return (
      <div className="tool-anatomy subject-anatomy" aria-hidden="true">
        <div className="anatomy-label">{anatomyLabel ?? "PREVIEW / FACE-MATCHED SCENES"}</div>
        <div className="subject-node subject-node--one"><span>01</span></div>
        <div className="subject-node subject-node--two"><span>02</span></div>
        <div className="subject-node subject-node--three"><span>03</span></div>
        <div className="face-match-connector" />
        <div className="anatomy-reading"><small>{outputLabel}</small><strong>{outputValue ?? "SCENES READY TO REVIEW"}</strong></div>
      </div>
    );
  }

  return (
    <div className="tool-anatomy beat-anatomy" aria-hidden="true">
      <div className="anatomy-label">{anatomyLabel ?? "PREVIEW / MUSIC & BASS MARKERS"}</div>
      <div className="beat-axis">
        <span className="beat-axis-label">{markerAxisLabel}</span>
        {[12, 28, 48, 64, 82].map((position, index) => <i key={position} style={{ left: `${position}%`, height: `${34 + index * 8}%` }}><span>{String(index + 1).padStart(2, "0")}</span></i>)}
      </div>
      <div className="anatomy-reading"><small>{outputLabel}</small><strong>{outputValue ?? "HITS READY TO ADJUST"}</strong></div>
    </div>
  );
}
