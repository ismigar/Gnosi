import { useMemo } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { toast } from '../../lib/toast';
import { getLocaleMeta } from '../../locales/registry';
import { uiLangToZoteroLocale } from './zoteroLocale';
import { useZoteroReaderController } from './useZoteroReaderController';
import {
  detectKindFromSrc,
  toFilesystemPath,
  type ZoteroReaderTabProps,
} from './zoteroReaderModel';

const HOST_URL = '/zotero-reader/host.html?v=20260802-citation-highlights-2';

function displayedFilename(
  rawSrc: string,
  title: string | null | undefined,
  kind: string,
): string {
  if (title) return title;
  const name = toFilesystemPath(rawSrc).split('/').at(-1);
  if (name) return name;
  const extension = kind === 'epub' ? 'epub' : kind === 'snapshot' ? 'html' : 'pdf';
  return `document.${extension}`;
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

export function ZoteroReaderTab({
  kind: kindProp,
  location: locationProp = null,
  onClose,
  src,
  title: titleProp,
}: ZoteroReaderTabProps) {
  const { i18n, t } = useTranslation();
  const language = i18n.language;
  const zoteroLanguage = useMemo(() => uiLangToZoteroLocale(language), [language]);
  const zoteroDirection = useMemo(() => getLocaleMeta(language).direction, [language]);
  const rawSrc = src || '';
  const kind = kindProp || detectKindFromSrc(rawSrc);
  const filename = useMemo(
    () => displayedFilename(rawSrc, titleProp, kind),
    [kind, rawSrc, titleProp],
  );
  const {
    error,
    iframeRef,
    openExternal,
    readerReady,
  } = useZoteroReaderController({
    direction: zoteroDirection,
    kind,
    language: zoteroLanguage,
    location: locationProp,
    noSourceMessage: t('pdf.no_src', { defaultValue: 'There is no PDF to display' }),
    rawSrc,
  });

  const handleOpenExternal = () => {
    void openExternal().catch((openError: unknown) => {
      toast.error(t(
        'pdf.open_external_error',
        'Could not open externally: {{message}}',
        { message: messageFromError(openError) },
      ));
    });
  };

  return (
    <div className="flex flex-col h-full" style={{ background: '#525659' }}>
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ background: '#3c3f41', borderBottom: '1px solid #222' }}
      >
        {onClose ? (
          <button
            className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/10"
            onClick={() => {
              void onClose();
            }}
            title={t('pdf.back', { defaultValue: 'Back' })}
            type="button"
          >
            <ArrowLeft size={16} />
          </button>
        ) : null}
        <div
          className="text-white/90 text-[13px] font-medium truncate max-w-[60vw]"
          title={filename}
        >
          {filename}
        </div>
        {!readerReady && !error ? (
          <span className="text-white/40 text-[11px] ml-2 italic">
            {t('pdf.loading', { defaultValue: 'Loading…' })}
          </span>
        ) : null}
        <button
          className="ml-auto w-7 h-7 flex items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white"
          onClick={handleOpenExternal}
          title={t('pdf.open_external', { defaultValue: 'Open with the system app' })}
          type="button"
        >
          <ExternalLink size={15} />
        </button>
      </div>
      {error ? (
        <div className="p-12 text-center text-red-300 text-sm">{error}</div>
      ) : (
        <iframe
          allow="clipboard-write; clipboard-read; fullscreen"
          className="flex-1 border-0 w-full"
          ref={iframeRef}
          src={HOST_URL}
          title={filename}
        />
      )}
    </div>
  );
}

export function ZoteroReaderPage() {
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const params = useMemo(
    () => new URLSearchParams(routeLocation.search),
    [routeLocation.search],
  );
  const rawSrc = params.get('src') || '';
  const kindParam = params.get('kind');
  const pageParam = params.get('page');
  const readerLocation = useMemo(
    () => pageParam ? { pageNumber: pageParam } : null,
    [pageParam],
  );
  return (
    <ZoteroReaderTab
      kind={kindParam}
      location={readerLocation}
      onClose={() => {
        void navigate(-1);
      }}
      src={rawSrc}
    />
  );
}

export default ZoteroReaderTab;
