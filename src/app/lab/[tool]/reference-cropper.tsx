"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";

export type NormalizedCrop = { x: number; y: number; width: number; height: number };

type Point = { x: number; y: number };

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function ReferenceCropper({
  imageUrl,
  title,
  instructions,
  keyboardHint,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  imageUrl: string;
  title: string;
  instructions: string;
  keyboardHint: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (crop: NormalizedCrop) => void;
  onCancel: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<Point | null>(null);
  const [crop, setCrop] = useState<NormalizedCrop>({ x: 0.24, y: 0.08, width: 0.52, height: 0.84 });

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  function pointFromEvent(event: PointerEvent<HTMLDivElement>) {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  }

  function beginCrop(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = pointFromEvent(event);
    dragStartRef.current = start;
    setCrop({ x: start.x, y: start.y, width: 0.01, height: 0.01 });
  }

  function updateCrop(event: PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start) return;
    const current = pointFromEvent(event);
    setCrop({
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.max(0.01, Math.abs(current.x - start.x)),
      height: Math.max(0.01, Math.abs(current.y - start.y)),
    });
  }

  function finishCrop(event: PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragStartRef.current = null;
    setCrop((current) => current.width < 0.08 || current.height < 0.08
      ? { x: 0.24, y: 0.08, width: 0.52, height: 0.84 }
      : current);
  }

  function changeCropWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
      : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
        : 0;
    if (!direction) return;
    event.preventDefault();
    const amount = event.ctrlKey ? 0.03 : 0.01;
    setCrop((current) => {
      if (event.shiftKey) {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          return { ...current, width: clamp(current.width + direction * amount, 0.08, 1 - current.x) };
        }
        return { ...current, height: clamp(current.height + direction * amount, 0.08, 1 - current.y) };
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        return { ...current, x: clamp(current.x + direction * amount, 0, 1 - current.width) };
      }
      return { ...current, y: clamp(current.y + direction * amount, 0, 1 - current.height) };
    });
  }

  return (
    <div className="crop-dialog-backdrop" role="presentation">
      <section className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-dialog-title">
        <header><div><p>REFERENCE CROP</p><h2 id="crop-dialog-title">{title}</h2></div><button type="button" onClick={onCancel} aria-label={cancelLabel}>×</button></header>
        <p className="crop-dialog-copy">{instructions}</p>
        <div
          ref={stageRef}
          className="crop-stage"
          onPointerDown={beginCrop}
          onPointerMove={updateCrop}
          onPointerUp={finishCrop}
          onPointerCancel={finishCrop}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" draggable={false} />
          <div
            className="crop-selection"
            style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
            tabIndex={0}
            onKeyDown={changeCropWithKeyboard}
            aria-label={keyboardHint}
          ><i /><i /><i /><i /></div>
        </div>
        <p className="crop-keyboard-hint">{keyboardHint}</p>
        <footer><button type="button" className="face-text-action" onClick={onCancel}>{cancelLabel}</button><button type="button" className="face-action" onClick={() => onConfirm(crop)}>{confirmLabel}</button></footer>
      </section>
    </div>
  );
}
