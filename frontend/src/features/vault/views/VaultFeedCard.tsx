import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  PanelRight,
} from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '../../../shared/hooks/useMediaQuery';
import { normalizeAssetUrl } from '../../../shared/editor/vaultMarkdownUtils';
import { IconRenderer } from '../../../shared/ui/previews/IconRenderer';
import { VaultMarkdown } from '../../../shared/editor/VaultMarkdown';
import {
  feedMetadataString,
  feedModifiedDate,
  feedNoteTitle,
  prepareFeedBody,
  splitFeedHighlight,
} from './vaultFeedModel';
import type { VaultFeedCardProps } from './vaultFeedTypes';


const PILL_PREVIEW_LIMIT = 5;
const MOBILE_PILL_PREVIEW_LIMIT = 3;
const EXCERPT_CAP = 480;


function excerptStyle(lines: number): CSSProperties {
  return { '--feed-excerpt-lines': lines } as CSSProperties;
}


export function VaultFeedCard({
  density,
  excerptLines,
  isRead,
  isSelected,
  note,
  onOpen,
  onPreview,
  onToggleSelect,
  pillLimit,
  pills,
  searchTerm,
  selectionActive,
  titlePreviewProps,
}: VaultFeedCardProps) {
  const { i18n, t } = useTranslation();
  const isCompact = useMediaQuery('(max-width: 768px)');
  const [expanded, setExpanded] = useState(false);
  const [showAllPills, setShowAllPills] = useState(false);
  const [previewOverflows, setPreviewOverflows] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const title = feedNoteTitle(note);
  const description = feedMetadataString(note, 'description');
  const icon = feedMetadataString(note, 'icon');
  const cover = feedMetadataString(note, 'cover');
  const coverUrl = cover ? normalizeAssetUrl(cover) : '';
  const previewMarkdown = useMemo(
    () => prepareFeedBody(description),
    [description],
  );
  const previewLimit = Math.min(
    pillLimit,
    isCompact ? MOBILE_PILL_PREVIEW_LIMIT : PILL_PREVIEW_LIMIT,
  );
  const visiblePills = showAllPills ? pills : pills.slice(0, previewLimit);
  const hiddenPillCount = Math.max(0, pills.length - visiblePills.length);
  const looksTruncated = description.length >= EXCERPT_CAP;

  useEffect(() => {
    const preview = previewRef.current;
    if (expanded || !previewMarkdown || !preview) return undefined;
    const measure = (): void => {
      setPreviewOverflows(preview.scrollHeight > preview.clientHeight + 1);
    };
    const frame = window.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(measure)
      : null;
    observer?.observe(preview);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [expanded, previewMarkdown]);

  const openNote = useCallback((event?: MouseEvent): void => {
    event?.stopPropagation();
    onOpen(note.id);
  }, [note.id, onOpen]);
  const previewNote = (event: MouseEvent): void => {
    event.stopPropagation();
    onPreview(note.id);
  };
  const displayTitle = title || t('common.untitled', 'Untitled');
  const modified = feedModifiedDate(note);

  return (
    <article
      data-feed-note-id={note.id}
      className={`vault-feed-card ${density === 'compact' ? 'vault-feed-card--compact' : ''} ${density === 'adaptive' ? 'vault-feed-card--adaptive' : ''} ${isRead ? 'is-read' : ''} group relative flex flex-col overflow-hidden rounded-2xl border bg-[var(--bg-primary)] shadow-sm transition-all hover:shadow-md ${isSelected ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/40'}`}
    >
      <label
        className={`absolute left-3 top-3 z-20 cursor-pointer ${isSelected || selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onClick={(event) => { event.stopPropagation(); }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(event) => {
            const shiftKey = event.nativeEvent instanceof globalThis.MouseEvent
              ? event.nativeEvent.shiftKey
              : false;
            onToggleSelect(note.id, shiftKey);
          }}
          aria-label={t('feed.select_record', { title: displayTitle })}
          className="h-4 w-4 cursor-pointer rounded border-[var(--border-primary)] bg-[var(--bg-secondary)]/90 text-[var(--gnosi-primary)] shadow-sm focus:ring-[var(--gnosi-primary)]"
        />
      </label>

      {coverUrl && (
        <div className="relative h-48 w-full flex-shrink-0 bg-[var(--bg-tertiary)] sm:h-64">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url("${coverUrl}")` }}
          />
        </div>
      )}

      <div className="vault-feed-card__body flex flex-col gap-3 p-6">
        <div className="vault-feed-card__header flex items-start justify-between gap-3">
          <div className="vault-feed-card__identity min-w-0">
            <div className="vault-feed-card__date mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)]">
              <Clock size={12} />
              <span>
                {t('feed.updated_at', {
                  date: modified.toLocaleDateString(i18n.language, {
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    month: 'short',
                  }),
                  defaultValue: 'Updated {{date}}',
                })}
              </span>
              <span className="sr-only">
                {modified.toLocaleDateString(i18n.language, {
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </div>
            <h2 className="min-w-0">
              <button
                type="button"
                onClick={selectionActive ? undefined : openNote}
                disabled={selectionActive}
                aria-label={`${t('feed.open_page', 'Open page')}: ${displayTitle}`}
                {...titlePreviewProps}
                className={`vault-feed-card__title flex min-w-0 items-center gap-2 text-left text-xl font-bold leading-tight text-[var(--text-primary)] transition-colors ${selectionActive ? 'cursor-default' : 'cursor-pointer hover:text-[var(--gnosi-primary)]'}`}
                title={title}
              >
                {icon && (
                  <span className="inline-flex shrink-0">
                    <IconRenderer icon={icon} size={24} />
                  </span>
                )}
                <span className="min-w-0">
                  {splitFeedHighlight(displayTitle, searchTerm).map((part, index) => (
                    part.highlighted
                      ? <mark key={`${part.text}-${String(index)}`} className="vault-feed-search-match">{part.text}</mark>
                      : <Fragment key={`${part.text}-${String(index)}`}>{part.text}</Fragment>
                  ))}
                </span>
              </button>
            </h2>
          </div>
          {!selectionActive && (
            <button
              type="button"
              onClick={previewNote}
              className="rounded-md p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--gnosi-primary)]"
              title={t('feed.open_reading_pane', 'Open reading pane')}
              aria-label={t('feed.open_reading_pane', 'Open reading pane')}
            >
              <PanelRight size={16} />
            </button>
          )}
        </div>

        {pills.length > 0 && (
          <div className="vault-feed-card__pills flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            {visiblePills.map(({ key, node }) => <Fragment key={key}>{node}</Fragment>)}
            {hiddenPillCount > 0 && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowAllPills(true);
                }}
                className="inline-flex min-h-6 items-center rounded-full border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-2 text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)]"
                aria-label={t('feed.show_more_tags', { count: hiddenPillCount })}
              >
                +{hiddenPillCount}
              </button>
            )}
            {showAllPills && pills.length > previewLimit && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowAllPills(false);
                }}
                className="inline-flex size-6 items-center justify-center rounded-full border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
                aria-label={t('feed.show_fewer_tags', 'Show fewer tags')}
              >
                <ChevronUp size={12} />
              </button>
            )}
          </div>
        )}

        {previewMarkdown && (
          <div
            ref={previewRef}
            style={expanded ? undefined : excerptStyle(excerptLines)}
            className={`vault-feed-card__preview text-sm leading-relaxed text-[var(--text-secondary)] ${expanded ? 'is-expanded' : ''}`}
          >
            <VaultMarkdown
              md={previewMarkdown}
              onActivate={() => { onOpen(note.id); }}
              imageTitle={title}
            />
          </div>
        )}

        {(looksTruncated || previewOverflows || expanded) && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((value) => !value);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3.5 py-1 text-xs font-semibold text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {expanded ? t('feed.see_less', 'See less') : t('feed.see_more', 'See more')}
            </button>
            {expanded && (
              <button
                type="button"
                onClick={openNote}
                className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3.5 py-1 text-xs font-semibold text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
              >
                <ExternalLink size={13} />
                {t('feed.read_full', 'Read in full')}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
