import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Pencil, Check, Loader2 } from 'lucide-react';

import { VaultMarkdown } from '../../../shared/editor/VaultMarkdown';
import { emitAppEvent, subscribeAppEvent } from '../../../shared/platform/app-events';
import { openEventStream, supportsEventStreams } from '../../../shared/api/specialized-transports';
import { fetchSyncedBlock, saveSyncedBlock } from '../../../shared/api/synced-blocks';

declare module '../../../shared/platform/app-events' {
    interface AppEventMap {
        readonly 'gnosi:synced-updated': { readonly syncId: string };
    }
}

/**
 * SyncedBlock
 * Bidirectional synced block (Notion synced block style). The content lives
 * in a shared source (`/api/vault/synced/{sync_id}`); editing one
 * instance updates the source and all other instances reflect it
 * LIVE: within the same window (event) and across tabs/windows of the app
 * (BroadcastChannel). Saved to Markdown as a ```gnosi-synced fence with the sync_id.
 * (Cross-device would require pushing via the collaboration WS — out of scope for v1.)
 */

// Cross-tab channel: propagates changes to all tabs/windows of
// the app on the same origin (not just the current window).
type SyncedBlockScalar = string | number | bigint | boolean | null | undefined;

interface SyncedBlockProps {
    readonly block?: {
        readonly props?: { readonly sync_id?: SyncedBlockScalar };
    } | null;
}

interface SyncMessage {
    readonly syncId: string;
}

type SyncedSseListener = (syncId: string) => void;

function isSyncMessage(value: unknown): value is SyncMessage {
    return typeof value === 'object'
        && value !== null
        && 'syncId' in value
        && typeof value.syncId === 'string';
}

const syncChannel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('gnosi-synced')
    : null;

// REAL-TIME push between DEVICES via SSE (/api/vault/synced-events): a
// single EventSource shared across the whole app; each synced block subscribes to it.
const sseListeners = new Set<SyncedSseListener>();
let syncedEventSource: EventSource | null = null;
function ensureSyncedSSE(): void {
    if (syncedEventSource || !supportsEventStreams()) return;
    try {
        syncedEventSource = openEventStream('/api/vault/synced-events');
        syncedEventSource.onmessage = (event: MessageEvent<string>) => {
            let data: unknown;
            try { data = JSON.parse(event.data); } catch { return; }
            if (isSyncMessage(data)) {
                sseListeners.forEach((listener) => {
                    try { listener(data.syncId); } catch { /* noop */ }
                });
            }
        };
        // EventSource reconnects on its own on error; no need to close it.
    } catch { syncedEventSource = null; }
}

export default function SyncedBlock({ block }: SyncedBlockProps) {
    const { t } = useTranslation();
    const syncId = String(block?.props?.sync_id || '').trim();
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        if (!syncId) { setLoading(false); return; }
        setLoading(true);
        try {
            const result = await fetchSyncedBlock(syncId);
            setContent(result.content || '');
            setDraft(result.content || '');
        } catch {
            setContent('');
            setDraft('');
        }
        finally { setLoading(false); }
    }, [syncId]);

    useEffect(() => {
        queueMicrotask(() => {
            void load();
        });
    }, [load]);

    const save = async (): Promise<void> => {
        setSaving(true);
        try {
            await saveSyncedBlock(syncId, draft);
            setContent(draft);
            setEditing(false);
            // Same window (other instances) + other tabs/windows.
            emitAppEvent('gnosi:synced-updated', { syncId });
            try { syncChannel?.postMessage({ syncId }); } catch { /* noop */ }
        } catch { /* noop */ } finally { setSaving(false); }
    };

    // Reloads if another instance with the same sync_id has been saved: same
    // window (event), another tab (BroadcastChannel) or another
    // DISPOSITIU (SSE en temps real).
    useEffect(() => {
        const unsubscribeAppEvent = subscribeAppEvent(
            'gnosi:synced-updated',
            (detail) => {
                if (detail.syncId === syncId && !editing) void load();
            },
        );
        const onMessage = (event: MessageEvent<unknown>): void => {
            if (isSyncMessage(event.data) && event.data.syncId === syncId && !editing) {
                void load();
            }
        };
        const onSse: SyncedSseListener = (incomingSyncId) => {
            if (incomingSyncId === syncId && !editing) void load();
        };
        syncChannel?.addEventListener('message', onMessage);
        ensureSyncedSSE();
        sseListeners.add(onSse);
        return () => {
            unsubscribeAppEvent();
            syncChannel?.removeEventListener('message', onMessage);
            sseListeners.delete(onSse);
        };
    }, [syncId, editing, load]);

    return (
        <div className="bn-synced group/synced relative my-3 rounded-lg border-l-2 border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/5 py-2 pl-3 pr-3" contentEditable={false}>
            <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--gnosi-primary)]">
                    <RefreshCw size={11} /> {t('editor.synced_block_label', "Synced block")}
                </span>
                {!editing ? (
                    <button onClick={() => {
                        setEditing(true);
                    }} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--text-tertiary)] opacity-0 transition-opacity hover:text-[var(--gnosi-primary)] group-hover/synced:opacity-100">
                        <Pencil size={12} /> {t('common.edit', "Edit")}
                    </button>
                ) : (
                    <button onClick={() => {
                        void save();
                    }} disabled={saving} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10">
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {t('editor.synced_done', "Done")}
                    </button>
                )}
            </div>
            {loading ? (
                <div className="py-2 text-sm text-[var(--text-tertiary)]">{t('common.loading', "Loading...")}</div>
            ) : editing ? (
                <textarea
                    value={draft}
                    onChange={(event) => {
                        setDraft(event.target.value);
                    }}
                    onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                            event.preventDefault();
                            void save();
                        }
                    }}
                    placeholder={t('editor.synced_placeholder', "Shared content (Markdown)…")}
                    autoFocus
                    className="h-32 w-full resize-y rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                />
            ) : content.trim() ? (
                <div className="text-[var(--text-primary)]"><VaultMarkdown md={content} /></div>
            ) : (
                <div className="py-1 text-sm italic text-[var(--text-tertiary)]">{t('editor.synced_empty', "Empty synced block — click «Edit» to add content.")}</div>
            )}
        </div>
    );
}
