import { useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { MetadataLookupForm } from './metadata-lookup/MetadataLookupForm';
import { MetadataLookupResults } from './metadata-lookup/MetadataLookupResults';
import type {
    MetadataLookupMode,
    MetadataRecord,
} from './metadata-lookup/metadataLookupModel';
import { useMetadataLookup } from './metadata-lookup/useMetadataLookup';


export interface MetadataLookupModalProps {
    readonly currentMetadata?: MetadataRecord;
    readonly isOpen: boolean;
    readonly mode?: MetadataLookupMode;
    readonly onApply?: (patch: Record<string, unknown>) => void;
    readonly onClose?: () => void;
    readonly onCreate?: (metadata: MetadataRecord) => void;
}


const EMPTY_METADATA: MetadataRecord = {};
const NOOP = (): void => undefined;


export function MetadataLookupModal({
    currentMetadata = EMPTY_METADATA,
    isOpen,
    mode = 'enrich',
    onApply,
    onClose,
    onCreate,
}: MetadataLookupModalProps) {
    const { i18n, t } = useTranslation();
    const panelRef = useRef<HTMLDivElement>(null);
    const controller = useMetadataLookup({
        currentMetadata,
        isOpen,
        mode,
        onApply,
        onClose,
        onCreate,
    });
    const portalElement = useMemo(() => {
        if (typeof document === 'undefined') return null;
        const existing = document.getElementById('metadata-lookup-root');
        if (existing) return existing;
        const created = document.createElement('div');
        created.id = 'metadata-lookup-root';
        document.body.appendChild(created);
        return created;
    }, []);
    useModalKeyboard({
        containerRef: panelRef,
        isOpen,
        onClose: onClose ?? NOOP,
        trapFocus: true,
    });

    if (!isOpen || !portalElement) return null;
    const title = mode === 'create'
        ? t('metadata_lookup.create_title', {
            defaultValue: 'Create from a source',
        })
        : t('metadata_lookup.title', { defaultValue: 'Fill in metadata' });
    return createPortal(
        <div
            className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center pt-16 bg-black/40"
            onKeyDown={controller.handleKeyDown}
        >
            <div
                aria-label={title}
                aria-modal="true"
                className="w-full max-w-3xl rounded-xl shadow-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-hidden max-h-[85vh] flex flex-col"
                ref={panelRef}
                role="dialog"
            >
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-secondary)] shrink-0">
                    <Search className="text-[var(--text-tertiary)]" size={18} />
                    <div className="flex-1 text-sm font-medium text-[var(--text-primary)]">
                        {title}
                    </div>
                    <button
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                        onClick={onClose}
                        title={t('common.close', { defaultValue: 'Close' })}
                        type="button"
                    >
                        <X size={18} />
                    </button>
                </div>
                <MetadataLookupForm
                    controller={controller}
                    language={i18n.language}
                />
                <MetadataLookupResults
                    controller={controller}
                    currentMetadata={currentMetadata}
                />
                <div className="px-4 py-3 border-t border-[var(--border-secondary)] flex items-center justify-end gap-2 shrink-0">
                    <button
                        className="px-3 py-1.5 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        onClick={onClose}
                        type="button"
                    >
                        {t('common.cancel', { defaultValue: 'Cancel' })}
                    </button>
                    <button
                        className="px-3 py-1.5 rounded-md bg-[var(--gnosi-primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                        disabled={!controller.result
                            || controller.grouped.fieldEntries.length === 0}
                        onClick={controller.handleApply}
                        type="button"
                    >
                        <Check size={14} />
                        {t('metadata_lookup.apply', {
                            defaultValue: 'Apply selection',
                        })}
                    </button>
                </div>
            </div>
        </div>,
        portalElement,
    );
}


export default MetadataLookupModal;
