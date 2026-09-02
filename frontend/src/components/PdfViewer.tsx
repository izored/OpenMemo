import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RotateCw,
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
// Vite emits the worker as its own asset and hands back a same-origin URL, so
// the engine never reaches for a CDN copy of itself.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { cn } from '@/lib/utils';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Side data pdf.js keeps outside its bundle, served from our own origin.
 *  Copied there at build time by scripts/copy-pdfjs-assets.mjs; unconfigured,
 *  every one of these defaults to a CDN fetch (ADR-025). */
const PDFJS_ASSETS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
  iccUrl: '/pdfjs/iccs/',
};

/** Zoom steps, in multiples of the PDF's own 72dpi size. 'fit' tracks the
 *  column width instead, which is what you want the moment the window moves. */
const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];
type Zoom = 'fit' | number;

/** How far outside the viewport a page still renders. One screen of lead in
 *  each direction means scrolling at a normal speed never shows a blank page,
 *  while a 400-page document still only ever holds a handful of canvases. */
const RENDER_MARGIN = '100% 0px';

function PdfPage({
  doc,
  pageNumber,
  width,
  zoom,
  rotation,
  onVisible,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** Width of the scroll column, for 'fit'. */
  width: number;
  zoom: Zoom;
  rotation: number;
  onVisible: (page: number, ratio: number) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const [near, setNear] = useState(false);
  const [painted, setPainted] = useState(false);
  // Placeholder height, so the scrollbar is honest before a page has rendered
  // and the page number under the pointer doesn't jump as canvases appear.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  // Two observers, because they answer different questions: one decides when a
  // page is close enough to be worth rendering, the other reports which page
  // you are actually looking at for the toolbar's counter.
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: RENDER_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => onVisible(pageNumber, entry.isIntersecting ? entry.intersectionRatio : 0),
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pageNumber, onVisible]);

  useEffect(() => {
    if (!near || !width) return;
    let cancelled = false;

    (async () => {
      try {
        const page = pageRef.current ?? (await doc.getPage(pageNumber));
        if (cancelled) return;
        pageRef.current = page;

        const base = page.getViewport({ scale: 1, rotation });
        const scale = zoom === 'fit' ? width / base.width : zoom;
        const viewport = page.getViewport({ scale, rotation });
        setBox({ w: viewport.width, h: viewport.height });

        const canvas = canvasRef.current;
        if (!canvas) return;
        // Render at device resolution and scale back down in CSS, or the page
        // is a blurry photograph of itself on any modern display.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        // A zoom change while the previous paint is still going: cancel it
        // rather than let two renders fight over one canvas.
        taskRef.current?.cancel();
        const task = page.render({
          canvas,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        });
        taskRef.current = task;
        await task.promise;
        if (!cancelled) setPainted(true);
      } catch (e) {
        // A cancelled render is the normal outcome of scrolling or zooming, not
        // a failure worth showing anyone.
        if ((e as Error)?.name !== 'RenderingCancelledException') {
          console.error(`PDF page ${pageNumber} failed to render:`, e);
        }
      }
    })();

    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      taskRef.current = null;
    };
  }, [doc, pageNumber, near, width, zoom, rotation]);

  // Drop the page's own resources when it scrolls far out of range. Without
  // this a long document keeps every page it has ever shown in memory.
  useEffect(() => {
    if (near) return;
    return () => {
      pageRef.current?.cleanup();
    };
  }, [near]);

  return (
    <div
      ref={holderRef}
      className="om-pdf-page"
      data-page={pageNumber}
      style={box ? { width: box.w, height: box.h } : undefined}
    >
      <canvas ref={canvasRef} className={cn('om-pdf-canvas', painted && 'is-painted')} />
      {!painted && <span className="om-pdf-page-num mono">{pageNumber}</span>}
    </div>
  );
}

/**
 * An in-app viewer for a PDF memo.
 *
 * openMemo already extracted the text of every PDF it holds, and until now that
 * extraction WAS the memo: a wall of paragraphs with the layout, the figures,
 * the tables and the signatures thrown away. For anything designed rather than
 * typed (a statement, a ticket, a contract, a paper), that is not the document.
 *
 * Rendered here rather than handed to the browser's built-in viewer in an
 * <iframe>: the native one carries its own chrome, ignores the app's theme, and
 * (because nginx's frame-src does not list 'self') would be blocked outright in
 * the container. pdf.js paints to a canvas we own, so the frame is the app's.
 *
 * Pages render lazily and are freed when they scroll away, which is what lets a
 * 400-page document open as fast as a one-page receipt.
 */
export function PdfViewer({
  src,
  title,
  downloadHref,
  theater,
  onTheaterChange,
}: {
  src: string;
  title: string;
  /** Force-a-download URL for the toolbar's save button. */
  downloadHref: string;
  theater?: boolean;
  onTheaterChange?: (v: boolean) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [rotation, setRotation] = useState(0);
  const [page, setPage] = useState(1);
  const [colWidth, setColWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ratios = useRef(new Map<number, number>());

  useEffect(() => {
    let cancelled = false;
    const seen = ratios.current;
    const task = pdfjs.getDocument({ url: src, ...PDFJS_ASSETS });
    task.promise.then(
      // Nothing to tear down on the late-resolve path: destroying the loading
      // task takes the document and its worker with it.
      (d) => { if (!cancelled) setDoc(d); },
      (e: Error) => {
        if (cancelled) return;
        console.error('Could not open the PDF:', e);
        setError(
          e?.name === 'PasswordException'
            ? 'This PDF is password protected, so it cannot be shown here.'
            : 'This PDF could not be opened.',
        );
      },
    );
    return () => {
      cancelled = true;
      void task.destroy();
      setDoc(null);
      setError(null);
      setPage(1);
      seen.clear();
    };
  }, [src]);

  // The column width drives 'fit', so it has to survive a window resize, the
  // sidebar collapsing and the theater toggle, all of which move it without a
  // re-render of this component.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      // Read the gutter rather than hardcode it: .om-pdf-scroll's padding is
      // smaller on a phone, and a fitted page that assumed the desktop value
      // would come out narrow there.
      const cs = getComputedStyle(el);
      const gutter = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      setColWidth(Math.max(0, el.clientWidth - (Number.isFinite(gutter) ? gutter : 48)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  const onVisible = useCallback((n: number, ratio: number) => {
    if (ratio > 0) ratios.current.set(n, ratio);
    else ratios.current.delete(n);
    let best = 0;
    let bestRatio = 0;
    for (const [p, r] of ratios.current) {
      if (r > bestRatio) { bestRatio = r; best = p; }
    }
    if (best) setPage(best);
  }, []);

  const goto = useCallback((n: number) => {
    const total = doc?.numPages ?? 1;
    const target = Math.min(total, Math.max(1, n));
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setPage(target);
  }, [doc]);

  const zoomBy = (dir: 1 | -1) => {
    setZoom((cur) => {
      // 'fit' has no place in the step list, so step off from whatever it is
      // currently showing rather than snapping to 100%.
      const from = cur === 'fit' && colWidth ? colWidth / 800 : cur === 'fit' ? 1 : cur;
      const next = dir === 1
        ? ZOOM_STEPS.find((s) => s > from + 0.01)
        : [...ZOOM_STEPS].reverse().find((s) => s < from - 0.01);
      return next ?? from;
    });
  };

  const pages = useMemo(
    () => (doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : []),
    [doc],
  );

  const zoomLabel = zoom === 'fit'
    ? 'Fit'
    : `${Math.round(zoom * 100)}%`;

  if (error) {
    return (
      <div className="om-pdf om-pdf-error">
        <p className="om-detail-desc">{error}</p>
        <a className="om-btn-secondary" href={downloadHref}>
          <Download size={13} /> Download it instead
        </a>
      </div>
    );
  }

  return (
    <div className={cn('om-pdf', theater && 'theater')}>
      <div className="om-pdf-bar">
        <div className="om-pdf-bar-group">
          <button
            type="button"
            className="om-pdf-btn"
            onClick={() => goto(page - 1)}
            disabled={page <= 1}
            title="Previous page"
            aria-label="Previous page"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="om-pdf-count mono">
            {page} / {doc?.numPages ?? '?'}
          </span>
          <button
            type="button"
            className="om-pdf-btn"
            onClick={() => goto(page + 1)}
            disabled={!doc || page >= doc.numPages}
            title="Next page"
            aria-label="Next page"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <div className="om-pdf-bar-group">
          <button
            type="button"
            className="om-pdf-btn"
            onClick={() => zoomBy(-1)}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className={cn('om-pdf-zoom mono', zoom === 'fit' && 'is-fit')}
            onClick={() => setZoom((z) => (z === 'fit' ? 1 : 'fit'))}
            title={zoom === 'fit' ? 'Zoom to 100%' : 'Fit to width'}
          >
            {zoomLabel}
          </button>
          <button
            type="button"
            className="om-pdf-btn"
            onClick={() => zoomBy(1)}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="om-pdf-bar-group om-pdf-bar-end">
          <button
            type="button"
            className="om-pdf-btn"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            title="Rotate"
            aria-label="Rotate 90 degrees"
          >
            <RotateCw size={15} />
          </button>
          {onTheaterChange && (
            <button
              type="button"
              className="om-pdf-btn"
              onClick={() => onTheaterChange(!theater)}
              title={theater ? 'Exit theater (compact)' : 'Theater (full width)'}
              aria-label={theater ? 'Exit theater mode' : 'Theater mode'}
            >
              <Maximize2 size={15} />
            </button>
          )}
          <a
            className="om-pdf-btn"
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in a new tab"
            aria-label="Open in a new tab"
          >
            <ExternalLink size={15} />
          </a>
          <a
            className="om-pdf-btn"
            href={downloadHref}
            title={`Download ${title}`}
            aria-label="Download the PDF"
          >
            <Download size={15} />
          </a>
        </div>
      </div>

      <div className="om-pdf-scroll" ref={scrollRef}>
        {!doc ? (
          <div className="om-pdf-loading">
            <Loader2 size={18} className="om-spin" />
            <span className="om-detail-desc">Opening the PDF…</span>
          </div>
        ) : (
          pages.map((n) => (
            <PdfPage
              key={n}
              doc={doc}
              pageNumber={n}
              width={colWidth}
              zoom={zoom}
              rotation={rotation}
              onVisible={onVisible}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default PdfViewer;
