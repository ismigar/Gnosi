import { createElement, useRef } from 'react';
import { Frame, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import { toAssetPreviewUrl } from '../../../lib/fileResource';
import { INSERT_CONTENT_TABS } from './insertContentCatalog';
import { InsertContentFooter } from './InsertContentFooter';
import { InsertContentPickers } from './InsertContentPickers';
import { InsertContentSourcePanels } from './InsertContentSourcePanels';
import type { InsertContentController } from './useInsertContentController';


interface InsertContentModalViewProps {
    readonly modal: InsertContentController;
    readonly onClose: () => void;
}


function InsertContentTabs({ modal }: Pick<InsertContentModalViewProps, 'modal'>) {
    const { t } = useTranslation();
    const visibleTabs = INSERT_CONTENT_TABS.filter(({ id }) => modal.allowedTabs.includes(id));
    return (
        <div className={`flex border-b border-[var(--border-primary)] ${
            visibleTabs.length <= 1 ? 'hidden' : ''
        }`}>
            {visibleTabs.map((tab) => (
                <button
                    className={`px-4 py-2.5 text-sm flex items-center gap-2 border-b-2 transition-colors ${
                        modal.tab === tab.id
                            ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]'
                            : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                    key={tab.id}
                    onClick={() => {
                        modal.actions.selectTab(tab.id);
                    }}
                    type="button"
                >
                    {createElement(tab.Icon, { size: 14 })}
                    {t(tab.labelKey, { defaultValue: tab.labelDefault })}
                </button>
            ))}
        </div>
    );
}


function CurrentImagePreview({ modal }: Pick<InsertContentModalViewProps, 'modal'>) {
    const { t } = useTranslation();
    if (!modal.imageField || !modal.currentSrc || modal.state.selected) return null;
    return (
        <div className="px-5 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 flex items-center gap-3">
            <img
                alt=""
                className="w-10 h-10 rounded object-cover border border-[var(--border-primary)] shrink-0 bg-[var(--bg-secondary)]"
                src={toAssetPreviewUrl(modal.currentSrc)}
            />
            <div className="min-w-0">
                <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                    {t('insert.current_image', { defaultValue: 'Current image' })}: {modal.currentSrc.split('/').pop()}
                </div>
                <div className="text-[11px] text-[var(--text-tertiary)]">
                    {t('insert.current_image_hint', {
                        defaultValue: 'Edit the fields below and save, or pick a new one to replace it.',
                    })}
                </div>
            </div>
        </div>
    );
}


export function InsertContentModalView({ modal, onClose }: InsertContentModalViewProps) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement>(null);
    useModalKeyboard({
        closeOnEscape: !modal.state.pickerOpen && !modal.destinationPickerOpen,
        confirmDisabled: !modal.canInsert || modal.state.busy,
        containerRef: panelRef,
        isOpen: true,
        onClose,
        onConfirm: modal.actions.confirm,
        trapFocus: !modal.state.pickerOpen && !modal.destinationPickerOpen,
    });
    return (
        <>
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div
                    ref={panelRef}
                    aria-labelledby="insert-content-title"
                    aria-modal="true"
                    className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] max-h-[760px] flex flex-col overflow-hidden"
                    role="dialog"
                >
                    <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-primary)]">
                        <h2 id="insert-content-title" className="text-base font-semibold flex items-center gap-2">
                            <Frame size={18} />
                            {t('insert.title', { defaultValue: 'Insert content' })}
                        </h2>
                        <button
                            aria-label={t('common.close', 'Close')}
                            className="p-1.5 rounded hover:bg-[var(--bg-secondary)]"
                            onClick={onClose}
                            type="button"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <InsertContentTabs modal={modal} />
                    <CurrentImagePreview modal={modal} />
                    <div className="flex-1 overflow-hidden p-4">
                        <InsertContentSourcePanels modal={modal} />
                    </div>
                    <InsertContentFooter modal={modal} onClose={onClose} />
                </div>
            </div>
            <InsertContentPickers modal={modal} />
        </>
    );
}
