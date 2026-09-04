import { Zip, ZipPassThrough } from "fflate";
import type { SceneMatch } from "./anime-face-recognition-types";
import { seekVideo, waitForVideoEvent } from "./anime-face-recognition-pipeline";

type CaptureVideo = HTMLVideoElement & { captureStream?: () => MediaStream };
type RenderedClip = { bytes: Uint8Array; extension: "mp4" | "webm" };
type SceneCover = { data: Uint8Array; mimeType: string };

export function sceneClipFilename(index: number, extension: RenderedClip["extension"]) {
  return `Scene${String(index + 1).padStart(2, "0")}.${extension}`;
}

function hasWebCodecs() {
  return typeof VideoDecoder !== "undefined"
    && typeof VideoEncoder !== "undefined"
    && typeof AudioDecoder !== "undefined"
    && typeof AudioEncoder !== "undefined";
}

function supportedRecorderType() {
  if (!("MediaRecorder" in window)) return null;
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    .find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function canRenderSceneClips() {
  return hasWebCodecs() || ("MediaRecorder" in window
    && typeof (document.createElement("video") as CaptureVideo).captureStream === "function"
    && Boolean(supportedRecorderType()));
}

export function preferredClipFormat() {
  return hasWebCodecs() ? "MP4" : "WebM";
}

async function renderMp4Scene(
  source: File,
  scene: SceneMatch,
  isCancelled: () => boolean,
  cover?: SceneCover,
): Promise<RenderedClip> {
  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    ConversionCanceledError,
    Input,
    Mp4OutputFormat,
    Output,
  } = await import("mediabunny");
  if (isCancelled()) throw new DOMException("Export cancelled", "AbortError");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const conversion = await Conversion.init({
    input,
    output,
    tracks: "primary",
    trim: { start: scene.start, end: scene.end },
    video: { codec: "avc", hardwareAcceleration: "prefer-hardware" },
    audio: { codec: "aac" },
    tags: cover ? {
      images: [{
        data: cover.data,
        mimeType: cover.mimeType,
        kind: "coverFront",
        name: "Scene cover",
        description: "First frame of this Cutweave scene",
      }],
    } : {},
    showWarnings: false,
  });
  if (!conversion.isValid) {
    input.dispose();
    throw new Error("This browser cannot create a compatible local MP4 clip.");
  }
  conversion.onProgress = () => {
    if (isCancelled()) void conversion.cancel();
  };
  try {
    await conversion.execute();
  } catch (error) {
    if (error instanceof ConversionCanceledError || isCancelled()) {
      throw new DOMException("Export cancelled", "AbortError");
    }
    throw error;
  } finally {
    input.dispose();
  }
  if (!target.buffer) throw new Error("The local MP4 encoder produced no output.");
  return { bytes: new Uint8Array(target.buffer), extension: "mp4" };
}

async function loadSceneCover(scene: SceneMatch): Promise<SceneCover | undefined> {
  if (!scene.thumbnailUrl) return undefined;
  try {
    const response = await fetch(scene.thumbnailUrl);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type || "image/jpeg",
    };
  } catch {
    return undefined;
  }
}

async function renderLegacyScene(
  mediaUrl: string,
  scene: SceneMatch,
  isCancelled: () => boolean,
): Promise<RenderedClip> {
  const video = document.createElement("video") as CaptureVideo;
  video.src = mediaUrl;
  video.preload = "auto";
  video.playsInline = true;
  video.muted = true;
  await waitForVideoEvent(video, "loadedmetadata");
  await seekVideo(video, scene.start);
  if (video.readyState < 3) await waitForVideoEvent(video, "canplay");
  const stream = video.captureStream?.();
  const mimeType = supportedRecorderType();
  if (!stream || !mimeType) throw new Error("This browser cannot create local WebM clips.");

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });

  const stopped = new Promise<void>((resolve, reject) => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
    recorder.addEventListener("error", () => reject(new Error("The browser could not encode this clip.")), { once: true });
  });

  recorder.start(750);
  await video.play();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Clip rendering timed out.")), (scene.end - scene.start + 8) * 1000);
    const interval = window.setInterval(() => {
      if (isCancelled()) {
        window.clearTimeout(timeout);
        window.clearInterval(interval);
        resolve();
      } else if (video.currentTime >= scene.end || video.ended) {
        window.clearTimeout(timeout);
        window.clearInterval(interval);
        resolve();
      }
    }, 80);
  });
  video.pause();
  if (recorder.state !== "inactive") recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  video.removeAttribute("src");
  video.load();
  if (isCancelled()) throw new DOMException("Export cancelled", "AbortError");
  return { bytes: new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer()), extension: "webm" };
}

export async function exportScenePackage(
  source: File,
  mediaUrl: string,
  scenes: SceneMatch[],
  isCancelled: () => boolean,
  onProgress: (completed: number, total: number) => void,
) {
  const outputChunks: ArrayBuffer[] = [];
  let resolveZip: (blob: Blob) => void;
  let rejectZip: (error: Error) => void;
  const completedZip = new Promise<Blob>((resolve, reject) => {
    resolveZip = resolve;
    rejectZip = reject;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      outputChunks.length = 0;
      rejectZip(error);
      return;
    }
    const ownedChunk = new Uint8Array(chunk.byteLength);
    ownedChunk.set(chunk);
    outputChunks.push(ownedChunk.buffer);
    if (final) {
      const blob = new Blob(outputChunks, { type: "application/zip" });
      outputChunks.length = 0;
      resolveZip(blob);
    }
  });

  try {
    for (let index = 0; index < scenes.length; index += 1) {
      if (isCancelled()) throw new DOMException("Export cancelled", "AbortError");
      let clip: RenderedClip;
      if (hasWebCodecs()) {
        try {
          const cover = await loadSceneCover(scenes[index]);
          clip = await renderMp4Scene(source, scenes[index], isCancelled, cover);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          clip = await renderLegacyScene(mediaUrl, scenes[index], isCancelled);
        }
      } else {
        clip = await renderLegacyScene(mediaUrl, scenes[index], isCancelled);
      }
      const filename = sceneClipFilename(index, clip.extension);
      const entry = new ZipPassThrough(filename);
      zip.add(entry);
      entry.push(clip.bytes, true);
      onProgress(index + 1, scenes.length);
    }
    zip.end();
    return await completedZip;
  } catch (error) {
    zip.terminate();
    outputChunks.length = 0;
    throw error;
  }
}

