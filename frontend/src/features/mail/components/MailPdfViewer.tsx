import { Maximize2, Minimize2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Document, Page, pdfjs } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { subscribeWindowEvent } from '../../../shared/platform/browser-events';


pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDF_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
type PdfZoom = 'fit' | number;


interface MailPdfViewerProps {
  readonly url: string;
}


interface PdfToolbarProps {
  readonly atMax: boolean;
  readonly atMin: boolean;
  readonly fullscreen: boolean;
  readonly label: string;
  readonly onFit: () => void;
  readonly onFullscreenToggle: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
}


function PdfToolbar({
  atMax,
  atMin,
  fullscreen,
  label,
  onFit,
  onFullscreenToggle,
  onZoomIn,
  onZoomOut,
}: PdfToolbarProps) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-2 px-3 py-2"
      style={{ background: '#3c3f41', borderBottom: '1px solid #222' }}
    >
      <button
        type="button"
        onClick={onZoomOut}
        disabled={atMin}
        className="flex h-7 w-7 items-center justify-center rounded text-lg font-bold text-white transition-all hover:bg-white/10 disabled:opacity-30"
      >−</button>
      <span className="min-w-[56px] select-none text-center text-[12px] font-bold text-white/80">
        {label}
      </span>
      <button
        type="button"
        onClick={onZoomIn}
        disabled={atMax}
        className="flex h-7 w-7 items-center justify-center rounded text-lg font-bold text-white transition-all hover:bg-white/10 disabled:opacity-30"
      >+</button>
      <button
        type="button"
        onClick={onFit}
        className="ml-1 rounded px-2 py-1 text-[11px] font-bold text-white/60 transition-all hover:bg-white/10"
      >
        {t('mail.pdf_fit_width', 'Fit width')}
      </button>
      <span className="ml-auto mr-2 text-[10px] text-white/30">⌘+/−/0</span>
      <button
        type="button"
        onClick={onFullscreenToggle}
        title={fullscreen
          ? t('mail.pdf_exit_fullscreen', 'Exit fullscreen (Esc)')
          : t('mail.pdf_fullscreen', 'Fullscreen')}
        className="flex h-7 w-7 items-center justify-center rounded text-white/70 transition-all hover:bg-white/10 hover:text-white"
      >
        {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>
    </div>
  );
}


export function MailPdfViewer({ url }: MailPdfViewerProps) {
  const { t } = useTranslation();
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState<PdfZoom>('fit');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoveredRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => { observer.disconnect(); };
  }, [isFullscreen]);

  const zoomIn = useCallback((): void => {
    setZoom((current) => {
      const value = typeof current === 'number' ? current : 1;
      return PDF_ZOOM_STEPS.find((candidate) => candidate > value) ?? value;
    });
  }, []);
  const zoomOut = useCallback((): void => {
    setZoom((current) => {
      const value = typeof current === 'number' ? current : 1;
      return [...PDF_ZOOM_STEPS].reverse().find((candidate) => candidate < value)
        ?? 'fit';
    });
  }, []);

  useEffect(() => subscribeWindowEvent('keydown', (event) => {
    if (event.metaKey || event.ctrlKey) {
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        zoomIn();
      } else if (event.key === '-') {
        event.preventDefault();
        zoomOut();
      } else if (event.key === '0') {
        event.preventDefault();
        setZoom('fit');
      }
    }
    if (event.key === 'Escape' && isFullscreen) {
      setIsFullscreen(false);
      return;
    }
    const container = containerRef.current;
    if (!hoveredRef.current || !container) return;
    const step = 80;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      container.scrollBy(0, step);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      container.scrollBy(0, -step);
    } else if (event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault();
      container.scrollBy(0, container.clientHeight * 0.9);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      container.scrollBy(0, -container.clientHeight * 0.9);
    } else if (event.key === 'Home') {
      event.preventDefault();
      container.scrollTo(0, 0);
    } else if (event.key === 'End') {
      event.preventDefault();
      container.scrollTo(0, container.scrollHeight);
    }
  }), [isFullscreen, zoomIn, zoomOut]);

  const pageWidth = containerWidth
    ? zoom === 'fit' ? containerWidth : containerWidth * zoom
    : undefined;
  const zoomLabel = zoom === 'fit'
    ? t('mail.pdf_fit_width', 'Fit width')
    : `${String(Math.round(zoom * 100))}%`;
  const toolbar = (
    <PdfToolbar
      atMax={typeof zoom === 'number' && zoom >= (PDF_ZOOM_STEPS.at(-1) ?? 2)}
      atMin={zoom === 'fit'}
      fullscreen={isFullscreen}
      label={zoomLabel}
      onFit={() => { setZoom('fit'); }}
      onFullscreenToggle={() => { setIsFullscreen((value) => !value); }}
      onZoomIn={zoomIn}
      onZoomOut={zoomOut}
    />
  );

  const content = (maxHeight: string): ReactNode => (
    <div
      ref={containerRef}
      className="overflow-auto"
      style={{ maxHeight }}
      onMouseEnter={() => { hoveredRef.current = true; }}
      onMouseLeave={() => { hoveredRef.current = false; }}
    >
      {containerWidth > 0 && (
        <Document
          file={url}
          onLoadSuccess={(document: PDFDocumentProxy) => { setNumPages(document.numPages); }}
          loading={<div className="flex items-center justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" /></div>}
          error={<div className="p-8 text-center text-sm text-red-400">{t('mail.pdf_load_error', "Couldn't load the PDF")}</div>}
        >
          {Array.from({ length: numPages }, (_, index) => (
            <div key={String(index)} className="flex justify-center py-2">
              <Page
                pageNumber={index + 1}
                width={pageWidth}
                renderTextLayer
                renderAnnotationLayer
              />
            </div>
          ))}
        </Document>
      )}
    </div>
  );

  if (isFullscreen) {
    return <div className="fixed inset-0 z-[var(--z-modal)] flex flex-col" style={{ background: '#525659' }}>{toolbar}{content('calc(100vh - 41px)')}</div>;
  }
  return <div className="w-full overflow-hidden rounded-xl border border-[var(--border-primary)]" style={{ background: '#525659' }}>{toolbar}{content('75vh')}</div>;
}
