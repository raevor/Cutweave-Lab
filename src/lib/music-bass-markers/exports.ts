import type { MusicMarker } from "./types";

export type PcmAudioSource = {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData: (channel: number) => Float32Array;
};

export type MarkerFrameRate = {
  numerator: number;
  denominator: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function markerName(marker: MusicMarker, index: number) {
  if (marker.source === "manual") return `MANUAL ${String(index + 1).padStart(3, "0")}`;
  return `${marker.kind.toUpperCase()} ${String(index + 1).padStart(3, "0")}`;
}

function validFrameRate(frameRate?: MarkerFrameRate): frameRate is MarkerFrameRate {
  return Boolean(frameRate && frameRate.numerator > 0 && frameRate.denominator > 0);
}

function frameRateXmp(frameRate: MarkerFrameRate) {
  return frameRate.denominator === 1
    ? `f${frameRate.numerator}`
    : `f${frameRate.numerator}s${frameRate.denominator}`;
}

export function snapTimeToFrame(seconds: number, frameRate?: MarkerFrameRate) {
  if (!validFrameRate(frameRate)) return Math.max(0, seconds);
  const frame = Math.round(Math.max(0, seconds) * frameRate.numerator / frameRate.denominator);
  return frame * frameRate.denominator / frameRate.numerator;
}

function relativeMarkerTime(marker: MusicMarker, trimStart: number, trimEnd: number, frameRate?: MarkerFrameRate) {
  return clamp(
    snapTimeToFrame(marker.time - trimStart, frameRate),
    0,
    Math.max(0, trimEnd - trimStart),
  );
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function riffChunk(id: string, payload: Uint8Array) {
  const paddedLength = payload.byteLength + (payload.byteLength % 2);
  const bytes = new Uint8Array(8 + paddedLength);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, id);
  view.setUint32(4, payload.byteLength, true);
  bytes.set(payload, 8);
  return bytes;
}

function createCueChunk(
  markers: MusicMarker[],
  sampleRate: number,
  trimStart: number,
  trimEnd: number,
  frameRate?: MarkerFrameRate,
) {
  const included = markers.filter((marker) => marker.time >= trimStart && marker.time <= trimEnd);
  const payload = new Uint8Array(4 + included.length * 24);
  const view = new DataView(payload.buffer);
  view.setUint32(0, included.length, true);
  included.forEach((marker, index) => {
    const offset = 4 + index * 24;
    const sampleOffset = Math.max(0, Math.round(relativeMarkerTime(marker, trimStart, trimEnd, frameRate) * sampleRate));
    view.setUint32(offset, index + 1, true);
    view.setUint32(offset + 4, sampleOffset, true);
    writeAscii(view, offset + 8, "data");
    view.setUint32(offset + 12, 0, true);
    view.setUint32(offset + 16, 0, true);
    view.setUint32(offset + 20, sampleOffset, true);
  });
  return riffChunk("cue ", payload);
}

export function createMarkerXmp(
  markers: MusicMarker[],
  sampleRate: number,
  trimStart = 0,
  trimEnd = Number.POSITIVE_INFINITY,
  frameRate?: MarkerFrameRate,
) {
  const included = markers.filter((marker) => marker.time >= trimStart && marker.time <= trimEnd);
  const items = included.map((marker) => {
    const relativeTime = relativeMarkerTime(marker, trimStart, trimEnd, frameRate);
    const startTick = validFrameRate(frameRate)
      ? Math.round(relativeTime * frameRate.numerator / frameRate.denominator)
      : Math.max(0, Math.round(relativeTime * sampleRate));
    return `          <rdf:li rdf:parseType="Resource">\n            <xmpDM:startTime>${startTick}</xmpDM:startTime>\n            <xmpDM:duration>0</xmpDM:duration>\n            <xmpDM:type>Cue</xmpDM:type>\n          </rdf:li>`;
  }).join("\n");

  const xmpFrameRate = validFrameRate(frameRate) ? frameRateXmp(frameRate) : `f${Math.round(sampleRate)}`;

  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Cutweave Lab">\n  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n    <rdf:Description rdf:about="" xmlns:xmpDM="http://ns.adobe.com/xmp/1.0/DynamicMedia/">\n      <xmpDM:Tracks>\n        <rdf:Bag>\n          <rdf:li rdf:parseType="Resource">\n            <xmpDM:trackName>Cutweave Markers</xmpDM:trackName>\n            <xmpDM:trackType>Cue</xmpDM:trackType>\n            <xmpDM:frameRate>${xmpFrameRate}</xmpDM:frameRate>\n            <xmpDM:markers>\n              <rdf:Seq>\n${items}\n              </rdf:Seq>\n            </xmpDM:markers>\n          </rdf:li>\n        </rdf:Bag>\n      </xmpDM:Tracks>\n    </rdf:Description>\n  </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>`;
}

export function createMarkerCsv(
  markers: MusicMarker[],
  trimStart = 0,
  trimEnd = Number.POSITIVE_INFINITY,
  frameRate?: MarkerFrameRate,
) {
  const rows = ["marker,time_seconds,timecode,type,source,confidence"];
  markers.filter((marker) => marker.time >= trimStart && marker.time <= trimEnd).forEach((marker, index) => {
    const relativeTime = relativeMarkerTime(marker, trimStart, trimEnd, frameRate);
    rows.push([
      markerName(marker, index),
      relativeTime.toFixed(6),
      formatTimecode(relativeTime),
      marker.kind,
      marker.source,
      marker.confidence.toFixed(4),
    ].join(","));
  });
  return rows.join("\r\n");
}

export function createMarkerJson(
  markers: MusicMarker[],
  sourceName: string,
  trimStart: number,
  trimEnd: number,
  frameRate?: MarkerFrameRate,
) {
  return JSON.stringify({
    schema: "cutweave.music-markers.v1",
    source: sourceName,
    trim: { start: trimStart, end: trimEnd, duration: Math.max(0, trimEnd - trimStart) },
    ...(validFrameRate(frameRate) ? { timelineFrameRate: frameRate } : {}),
    markers: markers
      .filter((marker) => marker.time >= trimStart && marker.time <= trimEnd)
      .map((marker, index) => ({
        name: markerName(marker, index),
        time: relativeMarkerTime(marker, trimStart, trimEnd, frameRate),
        sourceTime: trimStart + relativeMarkerTime(marker, trimStart, trimEnd, frameRate),
        type: marker.kind,
        source: marker.source,
        confidence: marker.confidence,
      })),
  }, null, 2);
}

export function formatTimecode(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export function createMarkerRichWav(
  audio: PcmAudioSource,
  markers: MusicMarker[],
  trimStart: number,
  trimEnd: number,
  frameRate?: MarkerFrameRate,
) {
  const channelCount = clamp(audio.numberOfChannels, 1, 8);
  const startFrame = clamp(Math.floor(trimStart * audio.sampleRate), 0, audio.length);
  const endFrame = clamp(Math.ceil(trimEnd * audio.sampleRate), startFrame, audio.length);
  const frameCount = endFrame - startFrame;
  const bytesPerSample = 2;
  const dataBytes = frameCount * channelCount * bytesPerSample;
  if (dataBytes > 0xfffffff0) throw new Error("This selection is too large for a standard WAV file. Shorten the export range.");

  const fmtPayload = new Uint8Array(16);
  const fmtView = new DataView(fmtPayload.buffer);
  fmtView.setUint16(0, 1, true);
  fmtView.setUint16(2, channelCount, true);
  fmtView.setUint32(4, audio.sampleRate, true);
  fmtView.setUint32(8, audio.sampleRate * channelCount * bytesPerSample, true);
  fmtView.setUint16(12, channelCount * bytesPerSample, true);
  fmtView.setUint16(14, bytesPerSample * 8, true);
  const fmtChunk = riffChunk("fmt ", fmtPayload);

  const cueChunk = createCueChunk(markers, audio.sampleRate, trimStart, trimEnd, frameRate);
  const xmpChunk = riffChunk("_PMX", new TextEncoder().encode(createMarkerXmp(markers, audio.sampleRate, trimStart, trimEnd, frameRate)));
  const dataPad = dataBytes % 2;
  const fileBytes = 12 + fmtChunk.byteLength + 8 + dataBytes + dataPad + cueChunk.byteLength + xmpChunk.byteLength;
  const riffHeader = new Uint8Array(12);
  const riffView = new DataView(riffHeader.buffer);
  writeAscii(riffView, 0, "RIFF");
  riffView.setUint32(4, fileBytes - 8, true);
  writeAscii(riffView, 8, "WAVE");
  const dataHeader = new Uint8Array(8);
  const dataView = new DataView(dataHeader.buffer);
  writeAscii(dataView, 0, "data");
  dataView.setUint32(4, dataBytes, true);

  const parts: BlobPart[] = [riffHeader, fmtChunk, dataHeader];
  const chunkFrames = 32_768;
  const channels = Array.from({ length: channelCount }, (_, channel) => audio.getChannelData(channel));
  for (let chunkStart = 0; chunkStart < frameCount; chunkStart += chunkFrames) {
    const frames = Math.min(chunkFrames, frameCount - chunkStart);
    const pcm = new ArrayBuffer(frames * channelCount * bytesPerSample);
    const view = new DataView(pcm);
    let byteOffset = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const sample = clamp(channels[channel][startFrame + chunkStart + frame] ?? 0, -1, 1);
        view.setInt16(byteOffset, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true);
        byteOffset += bytesPerSample;
      }
    }
    parts.push(pcm);
  }
  if (dataPad) parts.push(new Uint8Array(1));
  parts.push(cueChunk, xmpChunk);
  return new Blob(parts, { type: "audio/wav" });
}
