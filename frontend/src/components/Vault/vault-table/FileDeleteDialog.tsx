import { toast } from '../../../lib/toast';
import { transportFetch } from '../../../shared/api/transports';
import { displayString, isRecord } from './fieldConfig';
import type { TableController } from './useTableController';

export function FileDeleteDialog({ model }: { model: TableController; }) {
  const { t, handleCellSave, fileDeletePrompt, fileDeleteBusy, setFileDeletePrompt, setFileDeleteBusy } = model;
  if (!fileDeletePrompt) return null;
  return ((
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={() => { if (!fileDeleteBusy) setFileDeletePrompt(null); }}
    >
      <div
        className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl w-full max-w-md p-5"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">
          {t('files.delete_title', { defaultValue: "Delete file" })}
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mb-4 break-words">
          {t('files.delete_question', { defaultValue: "What do you want to do with “{{name}}”?", name: fileDeletePrompt.fileName })}
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={fileDeleteBusy}
            onClick={() => {
              const p = fileDeletePrompt;
              const next = p.arr.filter((_, i) => i !== p.idx);
              void handleCellSave(p.rowId, p.field, next.length === 0 ? '' : (next.length === 1 ? next[0] : next), p.originalMetaKey);
              setFileDeletePrompt(null);
            }}
            className="w-full text-left px-3 py-2 rounded-lg border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            {t('files.delete_link_only', { defaultValue: "Remove only the link (keep the file)" })}
          </button>
          <button
            type="button"
            disabled={fileDeleteBusy}
            onClick={() => {
              void (async () => {
                const p = fileDeletePrompt;
                setFileDeleteBusy(true);
                try {
                  const res = await transportFetch('/api/vault/delete-physical-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target: p.target }),
                  });
                  if (!res.ok) {
                    const err: unknown = await res.json().catch(() => ({}));
                    throw new Error(displayString((isRecord(err) ? err.detail : undefined) || `HTTP ${String(res.status)}`));
                  }
                  const data: unknown = await res.json();
                  const next = p.arr.filter((_, i) => i !== p.idx);
                  void handleCellSave(p.rowId, p.field, next.length === 0 ? '' : (next.length === 1 ? next[0] : next), p.originalMetaKey);
                  toast.success((isRecord(data) ? data.method : undefined) === 'macos_trash'
                    ? t('files.trashed', { defaultValue: "File moved to Trash" })
                    : t('files.deleted', { defaultValue: "File deleted" }));
                  setFileDeletePrompt(null);
                } catch (err) {
                  toast.error(t('files.delete_error', { defaultValue: "Could not delete the file: {{msg}}", msg: (err instanceof Error ? err.message : displayString(err)) }));
                } finally {
                  setFileDeleteBusy(false);
                }
              })();
            }}
            className="w-full text-left px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 text-sm text-red-600 disabled:opacity-50"
          >
            {t('files.delete_physical', { defaultValue: "Also delete the file (to Trash)" })}
          </button>
          <button
            type="button"
            disabled={fileDeleteBusy}
            onClick={() => { setFileDeletePrompt(null); }}
            className="w-full px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] text-sm text-[var(--text-secondary)] disabled:opacity-50"
          >
            {t('common.cancel', { defaultValue: "Cancel" })}
          </button>
        </div>
      </div>
    </div>
  ));
}
