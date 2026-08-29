import { createElement, useEffect, useRef } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CONTENT_KIND_META } from './insertContentCatalog';
import {
    isFocusableFileSelection,
    modeAvailableFor,
} from './insertContentModel';
import type { InsertContentMode } from './insertContentTypes';
import type { InsertContentController } from './useInsertContentController';


interface FooterProps {
    readonly modal: InsertContentController;
    readonly onClose: () => void;
}


const MODES: readonly InsertContentMode[] = ['link', 'frame', 'block'];


function SelectionSummary({ modal }: FooterProps) {
    const { t } = useTranslation();
    const selected = modal.state.selected;
    const kindMeta = selected ? CONTENT_KIND_META[selected.kind] : undefined;
    if (!selected) {
        return (
            <span className="text-[var(--text-tertiary)] text-xs">
                {t('insert.no_selection', { defaultValue: 'Pick a file or enter a URL' })}
            </span>
        );
    }
    let sourceLabel: string;
    if (selected.source === 'vault') {
        sourceLabel = t('insert.from_vault', { defaultValue: 'From the Vault' });
    } else if (selected.source === 'local') {
        sourceLabel = t('insert.from_local', { defaultValue: 'Local disk' });
    } else if (selected.source === 'local-multi') {
        sourceLabel = t('insert.from_local_multi', {
            count: selected.paths.length,
            defaultValue: '{{count}} files from the local disk',
        });
    } else if (selected.source === 'local-folder') {
        sourceLabel = t('insert.from_local_folder', { defaultValue: 'Local folder' });
    } else if (selected.source === 'upload-pending') {
        sourceLabel = t('insert.will_upload', {
            defaultValue: 'Will be uploaded on confirm',
        });
    } else {
        sourceLabel = t('insert.from_url', { defaultValue: 'External URL' });
    }
    return (
        <>
            <div className="flex items-center gap-2 text-[var(--text-secondary)] min-w-0">
                {kindMeta ? createElement(kindMeta.Icon, {
                    className: 'shrink-0',
                    size: 14,
                }) : null}
                <span className="truncate" title={selected.name}>{selected.name}</span>
            </div>
            <div className="text-[var(--text-tertiary)] text-xs ml-auto shrink-0">
                {sourceLabel}
            </div>
        </>
    );
}


function ModeSelector({ modal }: FooterProps) {
    const { t } = useTranslation();
    const selected = modal.state.selected;
    const labels: Readonly<Record<InsertContentMode, string>> = {
        block: t('insert.mode_block', { defaultValue: 'Block' }),
        frame: t('insert.mode_frame', { defaultValue: 'Frame' }),
        link: t('insert.mode_link', { defaultValue: 'Link' }),
    };
    return (
        <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider">
                {t('insert.mode', { defaultValue: 'Mode' })}
            </span>
            {MODES.map((mode) => {
                const disabled = selected?.source === 'local-multi'
                    ? mode !== 'link'
                    : selected ? !modeAvailableFor(selected.kind, mode) : false;
                return (
                    <button
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            modal.state.mode === mode
                                ? 'bg-[var(--gnosi-primary)] text-white'
                                : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)]/70 text-[var(--text-primary)]'
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                        disabled={disabled}
                        key={mode}
                        onClick={() => {
                            modal.actions.selectMode(mode);
                        }}
                        type="button"
                    >
                        {labels[mode]}
                    </button>
                );
            })}
            {selected && !modeAvailableFor(selected.kind, modal.state.mode) ? (
                <span className="text-[10px] text-[var(--status-warning)] flex items-center gap-1">
                    <AlertCircle size={11} />
                    {t('insert.mode_unavailable', {
                        defaultValue: 'Mode not compatible with the type',
                    })}
                </span>
            ) : null}
        </div>
    );
}


function ImageMetadataFields({ modal }: FooterProps) {
    const { t } = useTranslation();
    if (!modal.imageField) return null;
    const fields = [
        ['alt', t('insert.img_alt', { defaultValue: 'Alt text (accessibility)' })],
        ['title', t('insert.img_title', { defaultValue: 'Title (optional)' })],
        ['caption', t('insert.img_caption', { defaultValue: 'Caption (optional)' })],
        ['credit', t('insert.img_credit', { defaultValue: 'Credit (optional)' })],
    ] as const;
    return (
        <div className="flex-1 grid grid-cols-2 gap-1.5 mr-3 max-w-lg">
            {fields.map(([key, placeholder]) => (
                <input
                    className="px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                    key={key}
                    onChange={(event) => {
                        modal.actions.setImageMetadata(key, event.target.value);
                    }}
                    placeholder={placeholder}
                    value={modal.state.imageMeta[key] || ''}
                />
            ))}
        </div>
    );
}


function FooterActions({ modal, onClose }: FooterProps) {
    const { t } = useTranslation();
    const confirmRef = useRef<HTMLButtonElement>(null);
    const metadataOnly = !modal.state.selected && modal.imageField && modal.currentSrc;
    useEffect(() => {
        if (
            !modal.state.busy
            && modal.canInsert
            && isFocusableFileSelection(modal.state.selected)
        ) {
            confirmRef.current?.focus();
        }
    }, [modal.canInsert, modal.state.busy, modal.state.selected]);
    return (
        <div className="flex gap-2 ml-auto">
            <button
                className="px-4 py-2 rounded-lg text-sm border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]"
                onClick={onClose}
                type="button"
            >
                {t('common.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
                ref={confirmRef}
                className="px-4 py-2 rounded-lg text-sm bg-[var(--gnosi-primary)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                disabled={!modal.canInsert || modal.state.busy}
                onClick={() => {
                    void modal.actions.confirm();
                }}
                type="button"
            >
                {modal.state.busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {metadataOnly
                    ? t('insert.save_meta', { defaultValue: 'Save' })
                    : t('insert.confirm', { defaultValue: 'Insert' })}
            </button>
        </div>
    );
}


export function InsertContentFooter({ modal, onClose }: FooterProps) {
    const { t } = useTranslation();
    const selected = modal.state.selected;
    const showMaterializing = modal.state.busy && (
        modal.state.materializing
        || selected?.source === 'local'
        || selected?.source === 'local-folder'
        || selected?.source === 'local-multi'
    );
    return (
        <div className="border-t border-[var(--border-primary)] px-5 py-3 space-y-3">
            <div className="flex items-center gap-2 text-sm">
                <SelectionSummary modal={modal} onClose={onClose} />
            </div>
            {showMaterializing ? (
                <div className="flex items-center gap-1.5 text-xs text-[var(--gnosi-primary)]">
                    <Loader2 size={12} className="animate-spin" />
                    {t('insert.materializing', {
                        defaultValue: 'Downloading the file from OneDrive if needed… (may take a while)',
                    })}
                </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <ModeSelector modal={modal} onClose={onClose} />
                <ImageMetadataFields modal={modal} onClose={onClose} />
                <FooterActions modal={modal} onClose={onClose} />
            </div>
        </div>
    );
}
