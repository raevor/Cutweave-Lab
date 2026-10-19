"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BrandMark } from "@/components/brand-mark";
import { ToolVisual } from "@/components/tool-visual";
import { siteCopy as text } from "@/i18n/messages/en";
import type { ToolDefinition } from "@/lib/tool-catalog";

const subscribeToCapabilities = () => () => undefined;

function getCapabilityMask() {
  const browser = window.navigator as Navigator & { gpu?: unknown };
  return (window.isSecureContext ? 1 : 0)
    | ("VideoDecoder" in window ? 2 : 0)
    | (browser.gpu ? 4 : 0)
    | ("Worker" in window ? 8 : 0);
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ToolWorkspace({ tool }: { tool: ToolDefinition }) {
  const copy = text.focused;
  const toolCopy = text.tools[tool.slug];
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Set<string>());
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const capabilityMask = useSyncExternalStore(subscribeToCapabilities, getCapabilityMask, () => 0);
  const availableCapabilities = useMemo(() => [1, 2, 4, 8].filter((flag) => capabilityMask & flag).length, [capabilityMask]);

  useEffect(() => {
    const activeUrls = objectUrls.current;
    return () => activeUrls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    if (mediaUrl) {
      URL.revokeObjectURL(mediaUrl);
      objectUrls.current.delete(mediaUrl);
    }
    setFile(nextFile);
    if (!nextFile) {
      setMediaUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(nextFile);
    objectUrls.current.add(nextUrl);
    setMediaUrl(nextUrl);
  }

  function clearFile() {
    if (mediaUrl) {
      URL.revokeObjectURL(mediaUrl);
      objectUrls.current.delete(mediaUrl);
    }
    setFile(null);
    setMediaUrl(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const accept = tool.slug === "bass-markers" ? "video/*,audio/*" : "video/*";
  const isAudio = file?.type.startsWith("audio/") ?? false;

  return (
    <main className={`focused-tool focused-tool--${tool.accent}`}>
      <header className="focused-tool-header">
        <BrandMark />
        <div className="focused-header-actions">
          <nav aria-label={copy.navLabel}>
            <Link href="/lab">← {copy.allTools}</Link>
            <Link href="/privacy">{copy.privacy}</Link>
          </nav>
        </div>
      </header>

      <section className="focused-tool-title">
        <div>
          <p className="eyebrow"><span>{tool.index} / {toolCopy.eyebrow}</span><span>{copy.localFoundation}</span></p>
          <h1>{toolCopy.title}</h1>
        </div>
        <p>{toolCopy.promise}</p>
      </section>

      <section className="focused-tool-layout">
        <aside className="tool-brief">
          <div className="tool-brief-block"><small>{copy.input}</small><strong>{toolCopy.input}</strong></div>
          <div className="tool-brief-block"><small>{copy.output}</small><strong>{toolCopy.output}</strong></div>
          <div className="tool-brief-block tool-brief-status"><small>{copy.mediaBoundary}</small><strong><i /> {copy.zeroSent}</strong><p>{copy.noUpload}</p></div>
          <div className="tool-capability"><span>{copy.browserPreflight}</span><strong>{availableCapabilities || "–"}/4</strong></div>
        </aside>

        <div className="focused-tool-stage">
          <div className="focused-stage-head">
            <span>{file ? copy.sourceReady : copy.chooseSource}</span>
            <b>{copy.analysisOffline}</b>
          </div>

          {!file ? (
            <div className="tool-intake">
              <div className="tool-intake-visual"><ToolVisual tool={tool.slug} anatomyLabel={toolCopy.anatomy} outputLabel={copy.output} outputValue={toolCopy.anatomyOutput} markerAxisLabel={copy.markerAxisLabel} /></div>
              <div className="tool-intake-copy">
                <small>{copy.localIntake}</small>
                <h2>{toolCopy.shortTitle}</h2>
                <p>{toolCopy.description} {copy.chooseSuffix}</p>
                <input ref={inputRef} className="sr-only" id={`file-${tool.slug}`} type="file" accept={accept} onChange={chooseFile} />
                <label className="button button--tool" htmlFor={`file-${tool.slug}`}>{tool.slug === "bass-markers" ? copy.chooseMedia : copy.chooseVideo} <span>↗</span></label>
              </div>
            </div>
          ) : (
            <div className="focused-media-panel">
              <div className="focused-media-viewer">
                {isAudio ? <audio src={mediaUrl ?? undefined} controls /> : <video src={mediaUrl ?? undefined} controls playsInline preload="metadata" />}
              </div>
              <div className="focused-media-meta">
                <div><small>{copy.localSource}</small><strong>{file.name}</strong></div>
                <div><small>{copy.size}</small><strong>{formatBytes(file.size)}</strong></div>
                <div><small>{copy.nextStep}</small><strong>{copy.pipelineSpike}</strong></div>
                <button type="button" onClick={clearFile}>{copy.clearSource}</button>
              </div>
              <div className="pipeline-notice"><span>02</span><p><strong>{copy.sourceReadyLead}</strong> {copy.pipelinePending}</p><button type="button" disabled>{copy.analyzeLocally}</button></div>
            </div>
          )}
        </div>
      </section>

      <section className="tool-result-contract" aria-labelledby="result-contract-title">
        <div><p className="eyebrow">{copy.resultContract}</p><h2 id="result-contract-title">{copy.resultTitle}</h2></div>
        <ol>{toolCopy.results.map((result, index) => <li key={result}><span>0{index + 1}</span>{result}</li>)}</ol>
      </section>
    </main>
  );
}
