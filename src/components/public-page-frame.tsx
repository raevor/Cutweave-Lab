"use client";

import { flushSync } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import darkThemeIcon from "../../assets/dark-theme.png";
import lightThemeIcon from "../../assets/light-theme.png";
import { siteCopy as text } from "@/i18n/messages/en";
import { applySiteTheme, readSiteTheme, switchSiteTheme } from "@/lib/site-theme";
import { isToolAvailable, primaryTools } from "@/lib/tool-catalog";
import { BrandMark } from "./brand-mark";
import { ToolRouteLink } from "./tool-route-link";
import styles from "./public-page-frame.module.css";

type Theme = "light" | "dark";
type ActivePage = "tools" | "privacy" | "roadmap";
type TrailPoint = { x: number; y: number; createdAt: number };

type PublicPageFrameProps = {
  activePage?: ActivePage;
  children: ReactNode;
};

export function PublicPageFrame({ activePage, children }: PublicPageFrameProps) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [toolsOpen, setToolsOpen] = useState(false);
  const pageRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement>(null);
  const trailFrame = useRef<number | null>(null);
  const trailPoints = useRef<TrailPoint[]>([]);
  const lastTrailPoint = useRef<TrailPoint | null>(null);
  /* Writing a custom property restyles the whole subtree, so only write it when it changes. */
  const lightOn = useRef(false);
  const trailTheme = useRef<Theme>("dark");

  useLayoutEffect(() => {
    const savedTheme = readSiteTheme();
    applySiteTheme(savedTheme, false);
    const restoreFrame = window.requestAnimationFrame(() => setTheme(savedTheme));
    return () => {
      window.cancelAnimationFrame(restoreFrame);
    };
  }, []);

  useEffect(() => {
    trailTheme.current = theme;
  }, [theme]);

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setToolsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolsOpen(false);
    };

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = trailCanvasRef.current;
      if (!canvas) return;
      /* The trail reads the same at 1x and costs far less on a viewport-sized canvas. */
      const pixelRatio = 1;
      canvas.width = Math.round(window.innerWidth * pixelRatio);
      canvas.height = Math.round(window.innerHeight * pixelRatio);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (trailFrame.current !== null) window.cancelAnimationFrame(trailFrame.current);
    };
  }, []);

  const toggleTheme = (event?: { currentTarget: Element }) => {
    const nextTheme = theme === "light" ? "dark" : "light";
    switchSiteTheme(nextTheme, event?.currentTarget ?? null, () => setTheme(nextTheme), flushSync);
  };

  const renderTrail = (now: number) => {
    const canvas = trailCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      trailFrame.current = null;
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lifetime = reducedMotion ? 430 : 680;
    trailPoints.current = trailPoints.current.filter((point) => now - point.createdAt < lifetime);

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    context.globalCompositeOperation = "lighter";

    const palette = trailTheme.current === "dark"
      ? {
          main: "rgba(157, 232, 42, .78)",
          soft: "rgba(121, 201, 48, .16)",
          tip: "rgba(240, 255, 209, .98)",
        }
      : {
          main: "rgba(10, 133, 182, .9)",
          soft: "rgba(40, 165, 207, .2)",
          tip: "rgba(230, 250, 255, .98)",
        };

    const points = trailPoints.current;
    for (let index = 1; index < points.length; index += 1) {
      const beforePrevious = points[Math.max(index - 2, 0)];
      const previous = points[index - 1];
      const point = points[index];
      const next = points[Math.min(index + 1, points.length - 1)];
      const life = Math.max(0, 1 - (now - point.createdAt) / lifetime);
      const alpha = life * life;
      const progress = index / Math.max(points.length - 1, 1);
      const firstControlX = previous.x + (point.x - beforePrevious.x) / 6;
      const firstControlY = previous.y + (point.y - beforePrevious.y) / 6;
      const secondControlX = point.x - (next.x - previous.x) / 6;
      const secondControlY = point.y - (next.y - previous.y) / 6;

      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.bezierCurveTo(firstControlX, firstControlY, secondControlX, secondControlY, point.x, point.y);
      /* Glow from two wide, faint strokes instead of shadowBlur, which is very expensive per segment. */
      context.strokeStyle = palette.soft;
      context.globalAlpha = alpha * .45;
      context.lineWidth = 12 + progress * 8;
      context.stroke();
      context.globalAlpha = alpha * .8;
      context.lineWidth = 5 + progress * 4;
      context.stroke();
      context.strokeStyle = palette.main;
      context.globalAlpha = alpha * .92;
      context.lineWidth = .6 + progress * 1.5;
      context.stroke();
      context.restore();
    }

    const head = points.at(-1);
    if (head) {
      const headLife = Math.max(0, 1 - (now - head.createdAt) / lifetime);
      const pulse = 4.8 + Math.sin(now / 145) * .7;
      context.save();
      context.globalAlpha = headLife * headLife;
      context.fillStyle = palette.soft;
      context.beginPath();
      context.arc(head.x, head.y, pulse * 1.8, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = palette.tip;
      context.beginPath();
      context.moveTo(head.x, head.y - pulse);
      context.lineTo(head.x + 1.25, head.y - 1.15);
      context.lineTo(head.x + pulse, head.y);
      context.lineTo(head.x + 1.25, head.y + 1.15);
      context.lineTo(head.x, head.y + pulse);
      context.lineTo(head.x - 1.25, head.y + 1.15);
      context.lineTo(head.x - pulse, head.y);
      context.lineTo(head.x - 1.25, head.y - 1.15);
      context.closePath();
      context.fill();
      context.restore();
    }

    if (points.length > 0) {
      trailFrame.current = window.requestAnimationFrame(renderTrail);
    } else {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      trailFrame.current = null;
    }
  };

  const followPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const now = event.timeStamp;
    const nextPoint = { x: event.clientX, y: event.clientY, createdAt: now };
    const previous = lastTrailPoint.current;
    const distance = previous ? Math.hypot(nextPoint.x - previous.x, nextPoint.y - previous.y) : Number.POSITIVE_INFINITY;
    const elapsed = previous ? now - previous.createdAt : Number.POSITIVE_INFINITY;

    if (distance >= 5 || elapsed >= 24) {
      trailPoints.current.push(nextPoint);
      if (trailPoints.current.length > 30) trailPoints.current.shift();
      lastTrailPoint.current = nextPoint;
    }
    if (!lightOn.current) {
      pageRef.current?.style.setProperty("--light-opacity", "1");
      lightOn.current = true;
    }
    if (trailFrame.current === null) trailFrame.current = window.requestAnimationFrame(renderTrail);
  };

  const hidePointer = () => {
    pageRef.current?.style.setProperty("--light-opacity", "0");
    lightOn.current = false;
    lastTrailPoint.current = null;
    trailPoints.current = [];
  };

  return (
    <main
      className={styles.page}
      onPointerEnter={followPointer}
      onPointerLeave={hidePointer}
      onPointerMove={followPointer}
      ref={pageRef}
    >
      <canvas className={styles.pointerLight} ref={trailCanvasRef} aria-hidden="true" />
      <div className={styles.pageGrid} aria-hidden="true" />

      <header className={styles.header}>
        <BrandMark />
        <nav className={styles.nav} aria-label="Primary navigation">
          <Link href="/roadmap" aria-current={activePage === "roadmap" ? "page" : undefined}>Roadmap</Link>
          <Link href="/#workflow">How it works</Link>
          <Link href="/privacy" aria-current={activePage === "privacy" ? "page" : undefined}>Privacy</Link>
        </nav>

        <div className={styles.headerActions}>
          <button
            className={styles.themeToggle}
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            <Image src={theme === "dark" ? darkThemeIcon : lightThemeIcon} alt="" width={24} height={24} priority />
          </button>

          <div className={styles.toolsMenu} ref={menuRef}>
            <button
              className={styles.openTools}
              type="button"
              aria-expanded={toolsOpen}
              aria-haspopup="menu"
              onClick={() => setToolsOpen((open) => !open)}
            >
              Open tools <span aria-hidden="true">{toolsOpen ? "×" : "↗"}</span>
            </button>

            {toolsOpen ? (
              <div className={styles.menuPanel} role="menu">
                <p><span>Tool desk</span><small>Choose a focused workspace</small></p>
                {primaryTools.map((tool) => (
                  <ToolRouteLink toolSlug={tool.slug} key={tool.slug} role="menuitem" onClick={() => setToolsOpen(false)}>
                    <span>{tool.index}</span>
                    <strong>{text.tools[tool.slug].title}</strong>
                    <small>{isToolAvailable(tool.slug) ? text.home.available : text.home.inBuild}</small>
                  </ToolRouteLink>
                ))}
                <Link href="/lab" role="menuitem" onClick={() => setToolsOpen(false)}>
                  <span>ALL</span><strong>View the tool desk</strong><small>Overview</small>
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className={styles.content}>{children}</div>

      <footer className={styles.footer}>
        <BrandMark />
        <p>Focused media tools. Local by design.</p>
        <nav aria-label="Footer navigation">
          <Link href="/">Home</Link>
          <Link href="/lab">Tools</Link>
          <Link href="/roadmap">Roadmap</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </footer>
    </main>
  );
}
