import { useCallback, useContext, useEffect, useState } from 'react';
import { BookText, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../shared/notifications/notifyError';
import { resolveCitationKey } from '../../../shared/api/citations';
import { fetchVaultPage } from '../../../shared/api/vaults';
import { VaultEditorContext } from '../../../shared/editor/VaultEditorContext';
import {
    recursosPageToCsl,
    renderBibliography,
    type CslItem,
} from '../../../shared/citations/cslEngine';

interface CachedCslItem {
    readonly ts: number;
    readonly value: CslItem | null;
}

interface BibliographyBlockProperties {
    readonly locale?: string | null;
    readonly style?: string | null;
}

interface BibliographyBlockValue {
    readonly props?: BibliographyBlockProperties | null;
}

export interface BibliographyEditor {
    readonly document?: unknown;
    readonly onChange?: (callback: () => void) => unknown;
    readonly topLevelBlocks?: unknown;
}

export interface BibliographyBlockProps {
    readonly block?: BibliographyBlockValue | null;
    readonly editor?: BibliographyEditor | null;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

// Session-wide cache: citationKey → page CSL-JSON.
const CSL_ITEM_CACHE = new Map<string, CachedCslItem>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrFallback(value: unknown, fallback: string): string {
    return typeof value === 'string' && value ? value : fallback;
}

function isAborted(signal: AbortSignal): boolean {
    return signal.aborted;
}

function isCleanup(value: unknown): value is () => void {
    return typeof value === 'function';
}

async function fetchCslItem(citationKey: string): Promise<CslItem | null> {
    const entry = CSL_ITEM_CACHE.get(citationKey);
    if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.value;
    try {
        const resolved = await resolveCitationKey(citationKey);
        if (!resolved.id) {
            CSL_ITEM_CACHE.set(citationKey, { ts: Date.now(), value: null });
            return null;
        }
        const page = await fetchVaultPage(resolved.id);
        const item = recursosPageToCsl(page);
        CSL_ITEM_CACHE.set(citationKey, { ts: Date.now(), value: item });
        return item;
    } catch {
        CSL_ITEM_CACHE.set(citationKey, { ts: Date.now(), value: null });
        return null;
    }
}

function appendCitationKey(
    item: unknown,
    keys: string[],
    seen: Set<string>,
): void {
    if (!isRecord(item) || item.type !== 'cite' || !isRecord(item.props)) return;
    const citationKey = item.props.citationKey;
    if (typeof citationKey !== 'string' || !citationKey || seen.has(citationKey)) {
        return;
    }
    seen.add(citationKey);
    keys.push(citationKey);
}

/** Collect citation keys recursively while preserving their document order. */
function collectCitationKeys(
    blocks: unknown,
    keys: string[] = [],
    seen: Set<string> = new Set(),
): string[] {
    if (!Array.isArray(blocks)) return keys;
    for (const candidate of blocks) {
        if (!isRecord(candidate)) continue;
        if (Array.isArray(candidate.content)) {
            for (const item of candidate.content) {
                appendCitationKey(item, keys, seen);
                if (isRecord(item) && item.type === 'link' && Array.isArray(item.content)) {
                    for (const linkedItem of item.content) {
                        appendCitationKey(linkedItem, keys, seen);
                    }
                }
            }
        }
        collectCitationKeys(candidate.children, keys, seen);
    }
    return keys;
}

function editorBlocks(editor: BibliographyEditor): unknown {
    return editor.document ?? editor.topLevelBlocks ?? [];
}

/** Generates the bibliography for all citations in the current document. */
export function BibliographyBlock({ block, editor }: BibliographyBlockProps) {
    const { t } = useTranslation();
    const context = useContext(VaultEditorContext);
    const style = stringOrFallback(
        block?.props?.style,
        stringOrFallback(context.cslStyle, 'apa'),
    );
    const locale = stringOrFallback(
        block?.props?.locale,
        stringOrFallback(context.cslLocale, 'en-US'),
    );
    const [version, setVersion] = useState(0);
    const [citationKeys, setCitationKeys] = useState<string[]>([]);
    const [html, setHtml] = useState<string | null>(null);
    const [missing, setMissing] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!editor) return undefined;
        let active = true;
        const recollect = (): void => {
            try {
                setCitationKeys(collectCitationKeys(editorBlocks(editor)));
            } catch (error: unknown) {
                logError('bibliography-collect', error);
            }
        };
        queueMicrotask(() => {
            if (active) recollect();
        });
        let unsubscribe: (() => void) | undefined;
        try {
            const subscription = editor.onChange?.(recollect);
            if (isCleanup(subscription)) unsubscribe = subscription;
        } catch {
            // The editor can be disposing while this block is mounting.
        }
        return () => {
            active = false;
            try {
                unsubscribe?.();
            } catch {
                // The editor may already have disposed the subscription.
            }
        };
    }, [editor, version]);

    useEffect(() => {
        const controller = new AbortController();
        queueMicrotask(() => {
            if (controller.signal.aborted) return;
            setLoading(true);
            if (citationKeys.length === 0) {
                setHtml(null);
                setMissing([]);
                setLoading(false);
                return;
            }
            void Promise.all(citationKeys.map(fetchCslItem)).then(async (results) => {
                if (controller.signal.aborted) return;
                const items: Record<string, CslItem> = {};
                const missingKeys: string[] = [];
                results.forEach((item, index) => {
                    const citationKey = citationKeys[index];
                    if (!citationKey) return;
                    if (item) items[citationKey] = item;
                    else missingKeys.push(citationKey);
                });
                const knownKeys = citationKeys.filter((key) => items[key] !== undefined);
                try {
                    const bibliography = await renderBibliography(
                        knownKeys,
                        items,
                        style,
                        locale,
                    );
                    if (!isAborted(controller.signal)) {
                        setHtml(bibliography?.entries.join('') || null);
                        setMissing(missingKeys);
                        setLoading(false);
                    }
                } catch (error: unknown) {
                    logError('bibliography-render', error);
                    if (!isAborted(controller.signal)) {
                        setLoading(false);
                        setHtml(null);
                    }
                }
            });
        });
        return () => {
            controller.abort();
        };
    }, [citationKeys, style, locale, version]);

    const refresh = useCallback(() => {
        setVersion((current) => current + 1);
    }, []);

    return (
        <div className="bibliography-block my-6 p-4 rounded-lg border border-[var(--border-primary)]/40 bg-[var(--bg-secondary)]/30">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-[var(--text-secondary)]">
                <BookText size={16} className="text-[var(--gnosi-primary)]" />
                <span className="flex-1">
                    {t('citations.bibliography', { defaultValue: 'Bibliography' })}
                    <span className="ml-2 text-[var(--text-tertiary)] text-xs font-normal">
                        ({style.toUpperCase()} · {citationKeys.length}{' '}
                        {t('citations.refs', { defaultValue: 'citations' })})
                    </span>
                </span>
                <button
                    onClick={refresh}
                    title={t('citations.refresh', { defaultValue: 'Refresh' })}
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    contentEditable={false}
                >
                    <RefreshCw size={13} />
                </button>
            </div>
            {loading && (
                <div className="text-xs text-[var(--text-tertiary)] italic">
                    {t('citations.loading', { defaultValue: 'Loading references…' })}
                </div>
            )}
            {!loading && citationKeys.length === 0 && (
                <div className="text-xs text-[var(--text-tertiary)] italic">
                    {t('citations.empty', {
                        defaultValue: "This document doesn't have any citations yet.",
                    })}
                </div>
            )}
            {!loading && html && (
                <div
                    className="csl-bib text-[14px] leading-relaxed"
                    contentEditable={false}
                    style={{ pointerEvents: 'auto' }}
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            )}
            {!loading && missing.length > 0 && (
                <div className="mt-3 text-xs text-red-500">
                    {t('citations.missing', { defaultValue: 'Unresolved citations' })}:
                    {' '}{missing.map((key) => `@${key}`).join(', ')}
                </div>
            )}
        </div>
    );
}

export default BibliographyBlock;
