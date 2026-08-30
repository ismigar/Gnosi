import { X } from 'lucide-react';

import type { VaultFeedController } from './useVaultFeedController';


interface VaultFeedOverlaysProps {
  readonly controller: VaultFeedController;
}


export function VaultFeedOverlays({ controller }: VaultFeedOverlaysProps) {
  const {
    bulkProposal,
    bulkSaveState,
    confirmBulkField,
    isCommandOpen,
    onCreateRecord,
    onSearchChange,
    pendingBulkUndo,
    searchTerm,
    setBulkProposal,
    setIsCommandOpen,
    setPreviewId,
    sortedNotes,
    t,
    undoBulkField,
  } = controller;
  return (
    <>
      {(bulkSaveState !== 'idle' || pendingBulkUndo) && (
        <div
          className={`vault-feed-sync-state vault-feed-sync-state--${bulkSaveState}`}
          role="status"
        >
          <span>
            {bulkSaveState === 'saving'
              ? t('feed.sync_saving', 'Saving changes…')
              : bulkSaveState === 'error'
                ? t('feed.sync_error', 'Changes need attention')
                : t('feed.sync_saved', 'Changes saved')}
          </span>
          {pendingBulkUndo && (
            <button type="button" onClick={() => { void undoBulkField(); }}>
              {t('common.undo', 'Undo')}
            </button>
          )}
        </div>
      )}
      {bulkProposal && (
        <div
          className="vault-feed-bulk-proposal"
          role="dialog"
          aria-label={t('feed.confirm_bulk_update', 'Confirm batch update')}
        >
          <strong>{t('feed.bulk_preview_title', 'Review batch update')}</strong>
          <span>{t('feed.bulk_preview_hint', {
            count: bulkProposal.changes.length,
            defaultValue: '{{count}} records: {{field}} → {{value}}',
            field: bulkProposal.field,
            value: bulkProposal.value,
          })}</span>
          <div>
            <button type="button" onClick={() => { setBulkProposal(null); }}>
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              className="btn-gnosi btn-gnosi-primary !text-xs"
              onClick={() => { void confirmBulkField(); }}
            >
              {t('feed.apply_changes', 'Apply changes')}
            </button>
          </div>
        </div>
      )}
      {isCommandOpen && (
        <div
          className="vault-feed-command"
          role="dialog"
          aria-label={t('feed.command_title', 'Feed command')}
        >
          <button
            type="button"
            className="vault-feed-command__close"
            onClick={() => { setIsCommandOpen(false); }}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
          <strong>{t('feed.command_title', 'Feed command')}</strong>
          <input
            autoFocus
            value={searchTerm}
            onChange={(event) => { onSearchChange?.(event.target.value); }}
            placeholder={t('feed.command_search', 'Filter records…')}
          />
          <div>
            <button
              type="button"
              onClick={() => {
                onCreateRecord?.();
                setIsCommandOpen(false);
              }}
            >
              {t('feed.create_record', 'Create record')}
            </button>
            <button
              type="button"
              onClick={() => {
                const first = sortedNotes[0];
                if (first) setPreviewId(first.id);
                setIsCommandOpen(false);
              }}
            >
              {t('feed.command_open_first', 'Open first result')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
