"use client";

import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import styles from "./anime-face-recognition-reference-cropper.module.css";

export type AnimeNormalizedCrop = { x: number; y: number; width: number; height: number };

type Point = { x: number; y: number };
type DragMode = "draw" | "move" | "nw" | "ne" | "se" | "sw";
type DragState = { mode: DragMode; pointerId: number; start: Point; origin: AnimeNormalizedCrop };

const DEFAULT_CROP: AnimeNormalizedCrop = { x: 0.24, y: 0.08, width: 0.52, height: 0.84 };
const MINIMUM_CROP_SIZE = 0.08;

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function resizedCrop(mode: DragMode, origin: AnimeNormalizedCrop, current: Point): AnimeNormalizedCrop {
  const left = origin.x;
  const top = origin.y;
  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;
  if (mode === "nw") {
    const nextLeft = clamp(current.x, 0, right - MINIMUM_CROP_SIZE);
    const nextTop = clamp(current.y, 0, bottom - MINIMUM_CROP_SIZE);
    return { x: nextLeft, y: nextTop, width: right - nextLeft, height: bottom - nextTop };
  }
  if (mode === "ne") {
    const nextRight = clamp(current.x, left + MINIMUM_CROP_SIZE, 1);
    const nextTop = clamp(current.y, 0, bottom - MINIMUM_CROP_SIZE);
    return { x: left, y: nextTop, width: nextRight - left, height: bottom - nextTop };
  }
  if (mode === "se") {
    const nextRight = clamp(current.x, left + MINIMUM_CROP_SIZE, 1);
    const nextBottom = clamp(current.y, top + MINIMUM_CROP_SIZE, 1);
    return { x: left, y: top, width: nextRight - left, height: nextBottom - top };
  }
  const nextLeft = clamp(current.x, 0, right - MINIMUM_CROP_SIZE);
  const nextBottom = clamp(current.y, top + MINIMUM_CROP_SIZE, 1);
  return { x: nextLeft, y: top, width: right - nextLeft, height: nextBottom - top };
}

export function AnimeFaceRecognitionReferenceCropper({
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
  onConfirm: (crop: AnimeNormalizedCrop) => void;
  onCancel: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const cropRef = useRef<AnimeNormalizedCrop>(DEFAULT_CROP);
  const dragRef = useRef<DragState | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingCropRef = useRef<AnimeNormalizedCrop | null>(null);
  const onCancelRef = useRef(onCancel);

  const renderCrop = useCallback((next: AnimeNormalizedCrop) => {
    cropRef.current = next;
    const selection = selectionRef.current;
    const stage = stageRef.current;
    if (selection) {
      selection.style.left = `${next.x * 100}%`;
      selection.style.top = `${next.y * 100}%`;
      selection.style.width = `${next.width * 100}%`;
      selection.style.height = `${next.height * 100}%`;
    }
    if (stage) {
      stage.style.setProperty("--crop-x", `${next.x * 100}%`);
      stage.style.setProperty("--crop-y", `${next.y * 100}%`);
      stage.style.setProperty("--crop-width", `${next.width * 100}%`);
      stage.style.setProperty("--crop-height", `${next.height * 100}%`);
    }
  }, []);

  function scheduleCrop(next: AnimeNormalizedCrop) {
    pendingCropRef.current = next;
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      if (pendingCropRef.current) renderCrop(pendingCropRef.current);
      pendingCropRef.current = null;
    });
  }

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    renderCrop(DEFAULT_CROP);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      pendingCropRef.current = null;
      dragRef.current = null;
    };
  }, [imageUrl, renderCrop]);

  function confirmCrop() {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (pendingCropRef.current) renderCrop(pendingCropRef.current);
    pendingCropRef.current = null;
    onConfirm(cropRef.current);
  }

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
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>("[data-crop-handle]")?.dataset.cropHandle as DragMode | undefined;
    const mode: DragMode = handle ?? (target.closest("[data-crop-selection]") ? "move" : "draw");
    const start = pointFromEvent(event);
    const origin = cropRef.current;
    dragRef.current = { mode, pointerId: event.pointerId, start, origin };
    if (mode === "draw") scheduleCrop({ x: start.x, y: start.y, width: 0.01, height: 0.01 });
  }

  function updateCrop(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const current = pointFromEvent(event);
    if (drag.mode === "draw") {
      scheduleCrop({
        x: Math.min(drag.start.x, current.x),
        y: Math.min(drag.start.y, current.y),
        width: Math.max(0.01, Math.abs(current.x - drag.start.x)),
        height: Math.max(0.01, Math.abs(current.y - drag.start.y)),
      });
      return;
    }
    if (drag.mode === "move") {
      scheduleCrop({
        ...drag.origin,
        x: clamp(drag.origin.x + current.x - drag.start.x, 0, 1 - drag.origin.width),
        y: clamp(drag.origin.y + current.y - drag.start.y, 0, 1 - drag.origin.height),
      });
      return;
    }
    scheduleCrop(resizedCrop(drag.mode, drag.origin, current));
  }

  function finishCrop(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (pendingCropRef.current) renderCrop(pendingCropRef.current);
    pendingCropRef.current = null;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const current = cropRef.current;
    const next = current.width < MINIMUM_CROP_SIZE || current.height < MINIMUM_CROP_SIZE ? DEFAULT_CROP : current;
    renderCrop(next);
  }

  function changeCropWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
      : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
        : 0;
    if (!direction) return;
    event.preventDefault();
    const amount = event.ctrlKey ? 0.03 : 0.01;
    const current = cropRef.current;
    let next: AnimeNormalizedCrop;
    if (event.shiftKey) {
      next = event.key === "ArrowLeft" || event.key === "ArrowRight"
        ? { ...current, width: clamp(current.width + direction * amount, MINIMUM_CROP_SIZE, 1 - current.x) }
        : { ...current, height: clamp(current.height + direction * amount, MINIMUM_CROP_SIZE, 1 - current.y) };
    } else {
      next = event.key === "ArrowLeft" || event.key === "ArrowRight"
        ? { ...current, x: clamp(current.x + direction * amount, 0, 1 - current.width) }
        : { ...current, y: clamp(current.y + direction * amount, 0, 1 - current.height) };
    }
    renderCrop(next);
  }

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="crop-dialog-title">
        <header className={styles.header}><div><p>REFERENCE CROP</p><h2 id="crop-dialog-title">{title}</h2></div><button type="button" onClick={onCancel} aria-label={cancelLabel}>×</button></header>
        <p className={styles.copy}>{instructions}</p>
        <div
          ref={stageRef}
          className={styles.stage}
          onPointerDown={beginCrop}
          onPointerMove={updateCrop}
          onPointerUp={finishCrop}
          onPointerCancel={finishCrop}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" draggable={false} />
          <span className={`${styles.shade} ${styles.shadeTop}`} /><span className={`${styles.shade} ${styles.shadeRight}`} />
          <span className={`${styles.shade} ${styles.shadeBottom}`} /><span className={`${styles.shade} ${styles.shadeLeft}`} />
          <div
            ref={selectionRef}
            className={styles.selection}
            data-crop-selection
            style={{ left: "24%", top: "8%", width: "52%", height: "84%" }}
            tabIndex={0}
            onKeyDown={changeCropWithKeyboard}
            aria-label={keyboardHint}
          >
            {(["nw", "ne", "se", "sw"] as const).map((handle) => (
              <button key={handle} type="button" data-crop-handle={handle} aria-label={`Resize crop from ${handle} corner`} />
            ))}
          </div>
        </div>
        <p className={styles.keyboardHint}>{keyboardHint}</p>
        <footer className={styles.footer}><button type="button" className={styles.cancel} onClick={onCancel}>{cancelLabel}</button><button type="button" className={styles.confirm} onClick={confirmCrop}>{confirmLabel}</button></footer>
      </section>
    </div>
  );
}


