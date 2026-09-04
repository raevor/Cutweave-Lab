"use client";

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
import { ToolRouteLink } from "@/components/tool-route-link";
import { siteCopy as text } from "@/i18n/messages/en";
import { applySiteTheme, readSiteTheme } from "@/lib/site-theme";
import { primaryTools } from "@/lib/tool-catalog";
import styles from "./home.module.css";

type HomeTheme = "light" | "dark";
type TrailPoint = { x: number; y: number; createdAt: number };

const toolTracks = {
  "face-recognition": ["12%", "34%", "58%", "82%"],
  "bass-markers": ["17%", "43%", "67%", "88%"],
  "clarity-boost": ["9%", "38%", "72%"],
  "anime-face-recognition": ["14%", "36%", "62%", "87%"],
} as const;

export function HomeExperience() {
  const copy = text.home;
  const [theme, setTheme] = useState<HomeTheme>("dark");
  const [toolsOpen, setToolsOpen] = useState(false);
  const pageRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement>(null);
  const trailFrame = useRef<number | null>(null);
  const trailPoints = useRef<TrailPoint[]>([]);
  const lastTrailPoint = useRef<TrailPoint | null>(null);
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
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
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

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    applySiteTheme(nextTheme);
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

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    context.globalCompositeOperation = "lighter";

    const palette = trailTheme.current === "dark"
      ? {
          main: "rgba(157, 232, 42, .78)",
          soft: "rgba(121, 201, 48, .16)",
          tip: "rgba(240, 255, 209, .98)",
          glow: "rgba(147, 235, 47, .72)",
        }
      : {
          main: "rgba(10, 133, 182, .9)",
          soft: "rgba(40, 165, 207, .2)",
          tip: "rgba(230, 250, 255, .98)",
          glow: "rgba(10, 139, 192, .78)",
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
      context.strokeStyle = palette.soft;
      context.globalAlpha = alpha * .7;
      context.lineWidth = 4.5 + progress * 3.5;
      context.shadowColor = palette.glow;
      context.shadowBlur = 9 + progress * 5;
      context.stroke();

      context.strokeStyle = palette.main;
      context.globalAlpha = alpha * .92;
      context.lineWidth = .45 + progress * 1.45;
      context.shadowBlur = 4 + progress * 3;
      context.stroke();
      context.restore();
    }

    const head = points.at(-1);
    if (head) {
      const headLife = Math.max(0, 1 - (now - head.createdAt) / lifetime);
      const pulse = 4.8 + Math.sin(now / 145) * .7;

      context.save();
      context.globalAlpha = headLife * headLife;
      context.fillStyle = palette.tip;
      context.shadowColor = palette.glow;
      context.shadowBlur = 11;
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
    pageRef.current?.style.setProperty("--light-opacity", "1");
    if (trailFrame.current === null) trailFrame.current = requestAnimationFrame(renderTrail);
  };

  const hidePointer = () => {
    pageRef.current?.style.setProperty("--light-opacity", "0");
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
                      <small>{tool.slug === "face-recognition" || tool.slug === "anime-face-recognition" ? copy.available : copy.inBuild}</small>
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

        <section className={styles.hero} aria-labelledby="hero-title">
          <span className={`${styles.editMark} ${styles.editMarkOne}`} aria-hidden="true">+</span>
          <span className={`${styles.editMark} ${styles.editMarkTwo}`} aria-hidden="true">/</span>
          <span className={styles.heroTimecode} aria-hidden="true">TC / 00:00:00:00</span>

          <div className={styles.heroCopy}>
            <p className={styles.kicker}>
              <span>{copy.eyebrowA}</span><span>{copy.eyebrowB}</span>
            </p>
            <h1 id="hero-title">
              <span>{copy.titleLine1}</span>
              <span>{copy.titleLine2}</span>
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

            <div className={styles.localStatus}>
              <span><i aria-hidden="true" />{copy.privacyNote}</span>
              <strong><small>Media sent to us</small>0 B</strong>
            </div>
          </div>

          <div className={styles.editorStage} aria-label={copy.heroMapAria}>
            <div className={styles.stageShadow} aria-hidden="true" />
            <div className={styles.signalMap}>
              <div className={styles.mapHead}>
                <span>{copy.heroMapLabel}</span>
                <small>Interface anatomy / not analysis</small>
                <b>{copy.heroMapNote}</b>
              </div>
              <div className={styles.previewWindow} aria-hidden="true">
                <div className={styles.previewCornerA} />
                <div className={styles.previewCornerB} />
                <span className={styles.previewSubject}>LOCAL FILE</span>
                <div className={styles.focusFrame}><i /><i /><i /><i /></div>
                <div className={styles.previewReadout}>
                  <small>SEARCH TARGET</small><strong>FACE / 01</strong>
                </div>
              </div>
              <div className={styles.timeRail} aria-hidden="true">
                <span>00:00</span><span>12:16</span><span>28:42</span><span>44:08</span>
              </div>
              <div className={styles.trackField} aria-hidden="true">
                <div className={styles.playhead}><i /></div>
                {primaryTools.map((tool) => (
                  <div className={styles.track} key={tool.slug}>
                    <span>{tool.index}</span>
                    <strong>{text.tools[tool.slug].title}</strong>
                    <div className={styles.trackLine}>
                      {toolTracks[tool.slug].map((left, index) => (
                        <i style={{ left }} key={`${left}-${index}`} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.mapOutput}>
                <span>{copy.heroOutput}</span><strong>{copy.heroOutputValue}</strong><b aria-hidden="true">/</b>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.proofStrip} aria-label={copy.principlesLabel}>
          {copy.facts.map((fact, index) => (
            <div key={fact.label}>
              <small>0{index + 1}</small><strong>{fact.value}</strong><span>{fact.label}</span>
            </div>
          ))}
        </section>

        <section className={styles.tools} id="tools" aria-labelledby="home-tools-title">
          <header className={styles.sectionHead}>
            <div>
              <p className={styles.kicker}>{copy.toolsEyebrow}</p>
              <h2 id="home-tools-title">{copy.toolsTitleA}<br /><em>{copy.toolsTitleB}</em></h2>
            </div>
            <p>{copy.toolsIntro}</p>
          </header>

          <div className={styles.toolGrid}>
            {primaryTools.map((tool, index) => {
              const available = tool.slug === "face-recognition" || tool.slug === "anime-face-recognition";
              return (
                <article className={styles.toolCard} data-tool={`TOOL / ${tool.index}`} key={tool.slug}>
                  <div className={styles.toolVisual} aria-hidden="true">
                    <div className={styles.toolVisualHead}>
                      <span>TRACK {tool.index}</span><b>{available ? "ACTIVE" : "PREVIEW"}</b>
                    </div>
                    <div className={styles.miniTimeline}>
                      <span /><span /><span /><span /><span />
                      <i style={{ left: `${24 + index * 17}%` }} />
                    </div>
                    <div className={styles.miniClips}>
                      <i /><i /><i /><i />
                    </div>
                    <small>00:{12 + index * 9}:24:{8 + index * 3}</small>
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

        <section className={styles.workflow} id="workflow" aria-labelledby="workflow-title">
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

        <section className={styles.localProof} aria-labelledby="local-title">
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
