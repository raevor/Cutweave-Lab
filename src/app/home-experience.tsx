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
} from "react";
import darkThemeIcon from "../../assets/dark-theme.png";
import lightThemeIcon from "../../assets/light-theme.png";
import { BrandMark } from "@/components/brand-mark";
import { TimelineBackdrop } from "@/components/timeline-backdrop";
import { ToolIllustration } from "@/components/tool-illustration";
import { ToolRouteLink } from "@/components/tool-route-link";
import { siteCopy as text } from "@/i18n/messages/en";
import { applySiteTheme, readSiteTheme, switchSiteTheme } from "@/lib/site-theme";
import { isToolAvailable, primaryTools } from "@/lib/tool-catalog";
import { AmbientLayer } from "@/components/ambient-layer";
import { SequenceNav } from "@/components/sequence-nav";
import styles from "./home.module.css";

type HomeTheme = "light" | "dark";
type TrailPoint = { x: number; y: number; createdAt: number };

const SEQUENCE = [
  { id: "top", label: "Opening" },
  { id: "tool-face-recognition", label: "Face Recognition", tool: "face-recognition" },
  { id: "tool-anime-face-recognition", label: "Anime Face Recognition", tool: "anime-face-recognition" },
  { id: "tool-bass-markers", label: "Music & Bass Markers", tool: "bass-markers" },
  { id: "tool-auto-subtitles", label: "Auto Subtitles", tool: "auto-subtitles" },
  { id: "tool-background-remover", label: "Background Remover", tool: "background-remover" },
  { id: "workflow", label: "How it works" },
  { id: "local", label: "Local by design" },
];

export function HomeExperience() {
  const copy = text.home;
  const [theme, setTheme] = useState<HomeTheme>("dark");
  const [toolsOpen, setToolsOpen] = useState(false);
  const pageRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement>(null);
  const trailFrame = useRef<number | null>(null);
  const trailPoints = useRef<TrailPoint[]>([]);
  const lastTrailPoint = useRef<TrailPoint | null>(null);
  /* Writing a custom property on <main> restyles the whole page, so only write it when it changes. */
  const lightOn = useRef(false);
  const trailTheme = useRef<HomeTheme>("dark");

  useLayoutEffect(() => {
    const savedTheme = readSiteTheme();
    applySiteTheme(savedTheme, false);
    const restoreFrame = window.requestAnimationFrame(() => setTheme(savedTheme));
    return () => {
      window.cancelAnimationFrame(restoreFrame);
    };
  }, []);

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setToolsOpen(false);
      }
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
    trailTheme.current = theme;
  }, [theme]);

  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = trailCanvasRef.current;
      if (!canvas) return;
      /* A soft glowing line reads the same at 1x and costs far less on a viewport-sized canvas. */
      const pixelRatio = 1;
      canvas.width = Math.round(window.innerWidth * pixelRatio);
      canvas.height = Math.round(window.innerHeight * pixelRatio);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (trailFrame.current !== null) cancelAnimationFrame(trailFrame.current);
    };
  }, []);

  /* Hovering a headline line spotlights the matching timeline lanes. */
  const focusLanes = (lanes: string | null) => {
    const hero = heroRef.current;
    if (!hero) return;
    if (lanes) hero.dataset.laneFocus = lanes;
    else delete hero.dataset.laneFocus;
  };

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
          main: "rgba(244, 180, 67, .7)",
          soft: "rgba(244, 180, 67, .16)",
          tip: "rgba(255, 240, 214, .98)",
        }
      : {
          main: "rgba(176, 108, 20, .85)",
          soft: "rgba(196, 128, 36, .18)",
          tip: "rgba(255, 246, 230, .98)",
        };

    const points = trailPoints.current;

    for (let index = 1; index < points.length; index += 1) {
      const beforePrevious = points[Math.max(index - 2, 0)];
      const previous = points[index - 1];
      const point = points[index];
      const next = points[Math.min(index + 1, points.length - 1)];
      const age = now - point.createdAt;
      const life = Math.max(0, 1 - age / lifetime);
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
      context.bezierCurveTo(
        firstControlX,
        firstControlY,
        secondControlX,
        secondControlY,
        point.x,
        point.y,
      );
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

    if (trailPoints.current.length > 0) {
      trailFrame.current = requestAnimationFrame(renderTrail);
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
    if (trailFrame.current === null) trailFrame.current = requestAnimationFrame(renderTrail);
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
      id="top"
      onPointerEnter={followPointer}
      onPointerLeave={hidePointer}
      onPointerMove={followPointer}
      ref={pageRef}
    >
      <canvas className={styles.pointerLight} ref={trailCanvasRef} aria-hidden="true" />
      <div className={styles.pageGrain} aria-hidden="true" />

      <div className={styles.shell}>
        <header className={styles.header}>
          <BrandMark />

          <nav className={styles.nav} aria-label="Primary navigation">
            <Link href="/roadmap">Roadmap</Link>
            <Link href="#workflow">How it works</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>

          <div className={styles.headerActions}>
            <button
              className={styles.themeToggle}
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
              title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            >
              <Image
                src={theme === "dark" ? darkThemeIcon : lightThemeIcon}
                alt=""
                width={24}
                height={24}
                priority
              />
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
                    <ToolRouteLink
                      toolSlug={tool.slug}
                      key={tool.slug}
                      role="menuitem"
                      onClick={() => setToolsOpen(false)}
                    >
                      <span>{tool.index}</span>
                      <strong>{text.tools[tool.slug].title}</strong>
                      <small>{isToolAvailable(tool.slug) ? copy.available : copy.inBuild}</small>
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

        <section className={styles.hero} aria-labelledby="hero-title" ref={heroRef}>
          <TimelineBackdrop scrubTarget={heroRef} className={styles.heroTimeline} />

          <div className={styles.heroCopy}>
            <h1 id="hero-title">
              <span onPointerEnter={() => focusLanes("face,anime")} onPointerLeave={() => focusLanes(null)}>{copy.titleLine1}</span>
              <span onPointerEnter={() => focusLanes("bass")} onPointerLeave={() => focusLanes(null)}>{copy.titleLine2}</span>
              <em>{copy.titleLine3}</em>
            </h1>
            <p className={styles.lede}>{copy.lede}</p>

            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/lab/face-recognition">
                {copy.primaryAction}<span aria-hidden="true">↗</span>
              </Link>
              <Link className={styles.secondaryAction} href="/lab">
                {copy.secondaryAction}<span aria-hidden="true">→</span>
              </Link>
            </div>

          </div>

          <p className={styles.heroHint} aria-hidden="true">Move across the timeline to scrub it</p>
        </section>

        <section className={styles.proofStrip} aria-label={copy.principlesLabel}>
          {copy.facts.map((fact, index) => (
            <div key={fact.label}>
              <small>0{index + 1}</small><strong>{fact.value}</strong><span>{fact.label}</span>
            </div>
          ))}
        </section>

        <section className={`${styles.tools} ambient-host`} id="tools" aria-labelledby="home-tools-title">
          <AmbientLayer seed={3} />
          <header className={styles.sectionHead}>
            <div>
              <p className={styles.kicker}>{copy.toolsEyebrow}</p>
              <h2 id="home-tools-title">{copy.toolsTitleA}<br /><em>{copy.toolsTitleB}</em></h2>
            </div>
            <p>{copy.toolsIntro}</p>
          </header>

          <div className={styles.toolGrid}>
            {primaryTools.map((tool) => {
              const available = isToolAvailable(tool.slug);
              return (
                <article className={styles.toolCard} id={`tool-${tool.slug}`} data-tool={`TOOL / ${tool.index}`} data-tool-key={tool.slug} key={tool.slug}>
                  <div className={`${styles.toolVisual} ${styles.toolVisualHasCover}`} aria-hidden="true">
                    <div className={styles.toolVisualHead}>
                      <span>{text.tools[tool.slug].title}</span><b>{available ? "Ready to use" : "In development"}</b>
                    </div>
                    <ToolIllustration tool={tool.slug} className={styles.toolIllustration} />
                  </div>

                  <div className={styles.toolCardBody}>
                    <div className={styles.toolMeta}>
                      <span>{text.tools[tool.slug].eyebrow}</span>
                      <b className={available ? styles.statusReady : styles.statusBuild}>
                        <i aria-hidden="true" />{available ? copy.available : copy.inBuild}
                      </b>
                    </div>
                    <h3>{text.tools[tool.slug].title}</h3>
                    <p>{text.tools[tool.slug].description}</p>
                    <dl>
                      <div><dt>{copy.inputLabel}</dt><dd>{text.tools[tool.slug].input}</dd></div>
                      <div><dt>{copy.outputLabel}</dt><dd>{text.tools[tool.slug].output}</dd></div>
                    </dl>
                    <ToolRouteLink toolSlug={tool.slug} aria-label={`${available ? copy.startTool : copy.previewTool}: ${text.tools[tool.slug].title}`}>
                      {available ? copy.startTool : copy.previewTool}<span aria-hidden="true">↗</span>
                    </ToolRouteLink>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className={styles.sectionBand} aria-hidden="true" />

        <section className={`${styles.workflow} ambient-host`} id="workflow" aria-labelledby="workflow-title">
          <AmbientLayer seed={5} density={0.8} />
          <div className={styles.workflowTitle}>
            <p className={styles.kicker}>{copy.workflowEyebrow}</p>
            <h2 id="workflow-title">{copy.workflowTitleA}<br /><em>{copy.workflowTitleB}</em></h2>
          </div>
          <div className={styles.workflowSteps}>
            {copy.workflow.map((step, index) => (
              <article key={step.title}>
                <span>0{index + 1}</span>
                <div aria-hidden="true"><i /></div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <div className={styles.sectionBand} aria-hidden="true" />

        <section className={`${styles.localProof} ambient-host`} id="local" aria-labelledby="local-title">
          <AmbientLayer seed={8} density={0.8} />
          <div className={styles.localCopy}>
            <p className={styles.kicker}>{copy.localEyebrow}</p>
            <h2 id="local-title">{copy.localTitleA}<br /><em>{copy.localTitleB}</em></h2>
            <p>{copy.localCopy}</p>
            <Link href="/privacy">{copy.localLink}<span aria-hidden="true">→</span></Link>
          </div>
          <div className={styles.localDiagram} aria-label={copy.routeAria}>
            <div className={styles.localDiagramHead}><span>{copy.routeTitle}</span><b>{copy.routeStatus}</b></div>
            <div className={styles.boundary}>
              <div><small>01 / {copy.routeDevice}</small><strong>{copy.routeFile}</strong></div>
              <span aria-hidden="true">→</span>
              <div className={styles.browserNode}><small>02 / {copy.routeBrowser}</small><strong>{copy.routeWorkspace}</strong></div>
              <span aria-hidden="true">→</span>
              <div><small>03 / {copy.routeDevice}</small><strong>{copy.routeExport}</strong></div>
            </div>
            <div className={styles.blockedRoute}><span aria-hidden="true">×</span><small>{copy.routeCloud}</small><strong>{copy.routeCloudStatus}</strong></div>
          </div>
        </section>

        <SequenceNav items={SEQUENCE} />

        <footer className={styles.footer}>
          <BrandMark />
          <p>Focused media tools. Local by design.</p>
          <nav aria-label="Footer navigation">
            <Link href="/lab">Tools</Link><Link href="/roadmap">Roadmap</Link><Link href="/privacy">Privacy</Link><Link href="#top">Back to top ↑</Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
