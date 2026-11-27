"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type PageArtifacts = {
  pageNumber: number;
  scale: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewport: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[];
  pageWrap: HTMLDivElement;
  overlay: HTMLDivElement;
};

type Rect = { left: number; top: number; width: number; height: number };

function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function compactWithMap(value: string) {
  let compact = "";
  const map: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    if (/\s/.test(value[i]!)) continue;
    map.push(i);
    compact += value[i];
  }
  return { compact, map };
}

/**
 * Map evidence to tight PDF text-item rects (CSS viewport pixels).
 */
function findEvidenceRects(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfjs: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewport: any,
  scale: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[],
  evidence: string,
): Rect[] {
  if (!evidence.trim()) return [];

  const textItems = items.filter((item) => typeof item.str === "string" && item.str.length > 0);
  if (textItems.length === 0) return [];

  // Concatenate PDF fragments as-is (no extra spaces) so offsets stay aligned.
  let full = "";
  const ranges: Array<{ itemIndex: number; start: number; end: number }> = [];
  textItems.forEach((item, itemIndex) => {
    const start = full.length;
    full += item.str;
    ranges.push({ itemIndex, start, end: full.length });
  });

  let rawStart = full.indexOf(evidence);
  let rawEnd = rawStart >= 0 ? rawStart + evidence.length : -1;

  if (rawStart < 0) {
    const normalizedNeedle = normalize(evidence);
    const normalizedHay = normalize(full);
    const normIdx = normalizedHay.indexOf(normalizedNeedle);
    if (normIdx >= 0) {
      // Fall through to compact map for a robust raw range.
      rawStart = -1;
    }
    const { compact, map } = compactWithMap(full);
    const compactNeedle = evidence.replace(/\s+/g, "");
    const compactStart = compact.indexOf(compactNeedle);
    if (compactStart < 0) return [];
    rawStart = map[compactStart] ?? 0;
    rawEnd = (map[compactStart + compactNeedle.length - 1] ?? rawStart) + 1;
  }

  const matchedIndexes = ranges
    .filter((range) => range.end > rawStart && range.start < rawEnd)
    .map((range) => range.itemIndex);

  if (matchedIndexes.length === 0) return [];

  const rects: Rect[] = [];
  for (const itemIndex of matchedIndexes) {
    const item = textItems[itemIndex];
    if (!item) continue;
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const height = Math.max(Math.hypot(tx[2], tx[3]), 8);
    // item.width is PDF text-space width; multiply by CSS viewport scale only.
    const width = Math.max((typeof item.width === "number" ? item.width : 0) * scale, 4);

    rects.push({
      left: tx[4],
      top: tx[5] - height,
      width: Math.min(width, viewport.width - tx[4]),
      height: height * 1.15,
    });
  }
  return rects;
}

function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.left + r.width);
    bottom = Math.max(bottom, r.top + r.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}

export type PdfAnchorRect = { left: number; top: number; width: number; height: number };

export function PdfPreview({
  pdfUrl,
  evidence,
  fieldKey,
  onAnchorChange,
}: {
  pdfUrl: string;
  evidence: string | null;
  fieldKey: string | null;
  onAnchorChange?: (anchor: PdfAnchorRect | null) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<PageArtifacts[]>([]);
  const anchorElRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsRef = useRef<any>(null);
  const panRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const onAnchorChangeRef = useRef(onAnchorChange);
  onAnchorChangeRef.current = onAnchorChange;

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const panStateRef = useRef(pan);
  zoomRef.current = zoom;
  panStateRef.current = pan;

  const reportAnchor = useCallback(() => {
    const el = anchorElRef.current;
    if (!el || !onAnchorChangeRef.current) {
      onAnchorChangeRef.current?.(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      onAnchorChangeRef.current(null);
      return;
    }
    onAnchorChangeRef.current({
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    });
  }, []);

  const applyTransform = useCallback(
    (nextPan: { x: number; y: number }, nextZoom: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.style.transform = `translate(${nextPan.x}px, ${nextPan.y}px) scale(${nextZoom})`;
      requestAnimationFrame(() => reportAnchor());
    },
    [reportAnchor],
  );

  useEffect(() => {
    applyTransform(pan, zoom);
  }, [pan, zoom, applyTransform]);

  useEffect(() => {
    let cancelled = false;
    pagesRef.current = [];
    setReady(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });

    async function render() {
      const stage = stageRef.current;
      if (!stage) return;
      stage.innerHTML = "";
      setError(null);

      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        pdfjsRef.current = pdfjs;

        const pdf = await pdfjs.getDocument({ url: pdfUrl }).promise;
        if (cancelled) return;

        const viewportEl = viewportRef.current;
        const targetWidth = Math.max((viewportEl?.clientWidth || 640) - 24, 480);
        const pages: PageArtifacts[] = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const fitScale = targetWidth / baseViewport.width;
          const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
          const renderScale = fitScale * pixelRatio;
          const renderViewport = page.getViewport({ scale: renderScale });
          const textContent = await page.getTextContent();

          const cssWidth = baseViewport.width * fitScale;
          const cssHeight = baseViewport.height * fitScale;

          const pageWrap = document.createElement("div");
          pageWrap.className =
            "relative mb-3 overflow-hidden rounded-md border border-border bg-white shadow-sm";
          pageWrap.style.width = `${cssWidth}px`;
          pageWrap.style.height = `${cssHeight}px`;

          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) continue;
          canvas.width = renderViewport.width;
          canvas.height = renderViewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          pageWrap.appendChild(canvas);

          const overlay = document.createElement("div");
          overlay.className = "pointer-events-none absolute inset-0";
          pageWrap.appendChild(overlay);

          await page.render({
            canvasContext: context,
            viewport: renderViewport,
            canvas,
          }).promise;
          if (cancelled) return;

          const cssViewport = page.getViewport({ scale: fitScale });
          stage.appendChild(pageWrap);
          pages.push({
            pageNumber,
            scale: fitScale,
            viewport: cssViewport,
            items: textContent.items,
            pageWrap,
            overlay,
          });
        }

        pagesRef.current = pages;
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render PDF");
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  // Highlights + vertical-first focus + anchor for floating card.
  useEffect(() => {
    const pdfjs = pdfjsRef.current;
    const pages = pagesRef.current;
    const viewportEl = viewportRef.current;
    const stage = stageRef.current;
    if (!ready || !pdfjs || !viewportEl || !stage || pages.length === 0) return;

    anchorElRef.current = null;
    let focus: { page: PageArtifacts; union: Rect } | null = null;

    for (const page of pages) {
      page.overlay.innerHTML = "";
      if (!evidence) continue;

      const rects = findEvidenceRects(
        pdfjs,
        page.viewport,
        page.scale,
        page.items,
        evidence,
      );
      for (const r of rects) {
        const box = document.createElement("div");
        box.className = "absolute rounded-[2px] pdf-evidence-highlight";
        box.style.left = `${(r.left / page.viewport.width) * 100}%`;
        box.style.top = `${(r.top / page.viewport.height) * 100}%`;
        box.style.width = `${(r.width / page.viewport.width) * 100}%`;
        box.style.height = `${(r.height / page.viewport.height) * 100}%`;
        page.overlay.appendChild(box);
      }

      const union = unionRects(rects);
      if (union && !focus) {
        focus = { page, union };
        const anchor = document.createElement("div");
        anchor.className = "absolute pointer-events-none";
        anchor.style.left = `${(union.left / page.viewport.width) * 100}%`;
        anchor.style.top = `${(union.top / page.viewport.height) * 100}%`;
        anchor.style.width = `${(union.width / page.viewport.width) * 100}%`;
        anchor.style.height = `${(union.height / page.viewport.height) * 100}%`;
        page.overlay.appendChild(anchor);
        anchorElRef.current = anchor;
      }
    }

    if (!focus || !evidence) {
      onAnchorChangeRef.current?.(null);
      return;
    }

    const zoomNow = zoomRef.current;
    const stagePad = 12;
    const stageLeft = stagePad + focus.page.pageWrap.offsetLeft + focus.union.left;
    const stageTop = stagePad + focus.page.pageWrap.offsetTop + focus.union.top;
    const stageRight = stageLeft + focus.union.width;
    const stageCenterY = stageTop + focus.union.height / 2;

    const viewW = viewportEl.clientWidth;
    const viewH = viewportEl.clientHeight;
    const margin = 48;

    // Bias evidence slightly above center so floating card has room below.
    const nextY = viewH * 0.42 - stageCenterY * zoomNow;

    let nextX = panStateRef.current.x;
    const left = nextX + stageLeft * zoomNow;
    const right = nextX + stageRight * zoomNow;
    if (left < margin) {
      nextX += margin - left;
    } else if (right > viewW - margin) {
      nextX -= right - (viewW - margin);
    }

    const nextPan = { x: nextX, y: nextY };
    setPan(nextPan);
    applyTransform(nextPan, zoomNow);
  }, [evidence, fieldKey, ready, applyTransform]);

  function clampZoom(value: number) {
    return Math.min(4, Math.max(0.5, value));
  }

  function zoomBy(factor: number, originX?: number, originY?: number) {
    const viewportEl = viewportRef.current;
    if (!viewportEl) return;
    const prev = zoomRef.current;
    const next = clampZoom(prev * factor);
    if (next === prev) return;

    const ox = originX ?? viewportEl.clientWidth / 2;
    const oy = originY ?? viewportEl.clientHeight / 2;
    const currentPan = panStateRef.current;

    const nextPan = {
      x: ox - ((ox - currentPan.x) * next) / prev,
      y: oy - ((oy - currentPan.y) * next) / prev,
    };
    setZoom(next);
    setPan(nextPan);
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const viewportEl = viewportRef.current;
    if (!viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomBy(factor, e.clientX - rect.left, e.clientY - rect.top);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLDivElement;
    target.setPointerCapture(e.pointerId);
    panRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: panStateRef.current.x,
      originY: panStateRef.current.y,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!panRef.current.active) return;
    const nextPan = {
      x: panRef.current.originX + (e.clientX - panRef.current.startX),
      y: panRef.current.originY + (e.clientY - panRef.current.startY),
    };
    setPan(nextPan);
  }

  function onPointerUp(e: React.PointerEvent) {
    panRef.current.active = false;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold uppercase tracking-wide text-muted">
            PDF {fieldKey ? `· ${fieldKey}` : ""}
          </div>
          <div className="text-[11px] text-muted">Scroll to zoom · drag to pan</div>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="secondary" onClick={() => zoomBy(1 / 1.2)}>
            −
          </Button>
          <button
            type="button"
            className="min-w-14 rounded-md px-2 py-1 text-xs font-semibold text-muted hover:bg-surface"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            title="Reset view"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button type="button" size="sm" variant="secondary" onClick={() => zoomBy(1.2)}>
            +
          </Button>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-1 text-xs font-semibold text-accent hover:underline"
          >
            Open
          </a>
        </div>
      </div>

      {error ? <p className="px-3 py-2 text-sm text-danger">{error}</p> : null}
      {!ready && !error ? (
        <p className="px-3 py-2 text-sm text-muted">Rendering PDF…</p>
      ) : null}

      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden bg-[#d9d2c4] active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={stageRef}
          className="origin-top-left p-3 will-change-transform"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        />
      </div>
    </div>
  );
}
