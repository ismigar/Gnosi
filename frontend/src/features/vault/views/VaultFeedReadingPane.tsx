import { ArrowLeft, ArrowRight, X } from 'lucide-react';

import { VaultMarkdown } from '../../../shared/editor/VaultMarkdown';
import { feedMetadataString, feedNoteTitle, prepareFeedBody } from './vaultFeedModel';
import type { VaultFeedController } from './useVaultFeedController';


interface VaultFeedReadingPaneProps {
  readonly controller: VaultFeedController;
}


export function VaultFeedReadingPane({ controller }: VaultFeedReadingPaneProps) {
  const {
    cleanReading,
    dockReadingPane,
    movePreview,
    openFeedRecord,
    paneWidth,
    previewIndex,
    previewNote,
    setCleanReading,
    setPreviewId,
    sortedNotes,
    startPaneResize,
    summarizePreview,
    summaryForId,
    summaryModel,
    summaryState,
    summaryText,
    t,
    toggleDockReadingPane,
  } = controller;
  if (!previewNote) return null;
  const title = feedNoteTitle(previewNote);
  const description = feedMetadataString(previewNote, 'description');

  return (
    <aside
      className={`vault-feed-reading-pane ${cleanReading ? 'is-clean' : ''} ${dockReadingPane ? 'is-docked' : ''}`}
      style={{ width: `min(${String(paneWidth)}px, 92vw)` }}
      aria-label={t('feed.reading_pane', 'Reading pane')}
    >
      <div
        className="vault-feed-reading-pane__resize"
        onPointerDown={startPaneResize}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('feed.resize_reading_pane', 'Resize reading pane')}
      />
      <div className="vault-feed-reading-pane__header">
        <span>{t('feed.reading_pane', 'Reading pane')}</span>
        <button
          type="button"
          onClick={toggleDockReadingPane}
          aria-pressed={dockReadingPane}
        >
          {dockReadingPane
            ? t('feed.undock_pane', 'Float pane')
            : t('feed.dock_pane', 'Dock pane')}
        </button>
        <button
          type="button"
          onClick={() => { setCleanReading((current) => !current); }}
          aria-pressed={cleanReading}
        >
          {cleanReading
            ? t('feed.show_details', 'Show details')
            : t('feed.clean_reading', 'Clean reading')}
        </button>
        <button
          type="button"
          onClick={() => { setPreviewId(''); }}
          aria-label={t('common.close')}
        >
          <X size={18} />
        </button>
      </div>
      <div className="vault-feed-reading-pane__content">
        <div className="flex items-start justify-between gap-3">
          <h2>{title || t('common.untitled', 'Untitled')}</h2>
          <button
            type="button"
            className="btn-gnosi btn-gnosi-secondary !text-xs"
            onClick={() => { void summarizePreview(); }}
            disabled={!summaryModel || summaryState === 'loading'}
          >
            {summaryState === 'loading'
              ? t('feed.summarizing', 'Summarizing…')
              : t('feed.summarize', 'Summarize')}
          </button>
        </div>
        {summaryText && summaryForId === previewNote.id && (
          <section
            className="vault-feed-summary"
            aria-label={t('feed.summary', 'AI summary')}
          >
            <strong>{t('feed.summary', 'AI summary')}</strong>
            <VaultMarkdown
              md={summaryText}
              onActivate={() => { openFeedRecord(previewNote.id); }}
              imageTitle={title}
            />
          </section>
        )}
        {summaryState === 'error' && summaryForId === previewNote.id && (
          <p className="vault-feed-reading-pane__meta">
            {t(
              'feed.summary_error_hint',
              'Check that the selected model is active and available.',
            )}
          </p>
        )}
        {!cleanReading && (
          <p className="vault-feed-reading-pane__meta">
            {t('feed.reading_shortcuts', 'Use ← → to navigate · Esc to close')}
          </p>
        )}
        {description ? (
          <VaultMarkdown
            md={prepareFeedBody(description)}
            onActivate={() => { openFeedRecord(previewNote.id); }}
            imageTitle={title}
          />
        ) : (
          <p>{t('feed.no_excerpt', 'This record has no excerpt yet.')}</p>
        )}
      </div>
      <div className="vault-feed-reading-pane__footer">
        <button
          type="button"
          onClick={() => { movePreview(-1); }}
          disabled={previewIndex <= 0}
          aria-label={t('feed.previous_record', 'Previous record')}
        >
          <ArrowLeft size={16} />
        </button>
        <span>{previewIndex + 1} / {sortedNotes.length}</span>
        <button
          type="button"
          onClick={() => { movePreview(1); }}
          disabled={previewIndex >= sortedNotes.length - 1}
          aria-label={t('feed.next_record', 'Next record')}
        >
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          className="btn-gnosi btn-gnosi-primary !text-xs"
          onClick={() => { openFeedRecord(previewNote.id); }}
        >
          {t('feed.open_page', 'Open page')}
        </button>
      </div>
    </aside>
  );
}
