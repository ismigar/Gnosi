import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
    CheckSquare,
    ChevronDown,
    Download,
    Languages,
    LayoutTemplate,
    Tag,
    Trash2,
    X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ConfirmModal from '../ui/dialogs/ConfirmModal';


export interface BulkActionTemplate {
    readonly id: string;
    readonly title?: string | null;
    readonly [key: string]: unknown;
}


export interface BulkItemTypeOption {
    readonly label: string;
    readonly value: string;
}


export interface VaultBulkActionsBarProps {
    readonly extraActions?: ReactNode;
    readonly itemTypeOptions?: readonly BulkItemTypeOption[];
    readonly onApplyTemplate?: ((templateId: string) => void) | null;
    readonly onChangeItemType?: (value: string) => void;
    readonly onClearSelection: () => void;
    readonly onDeleteSelected?: (() => void) | null;
    readonly onExportSelection?: (format: 'bibtex' | 'ris') => void;
    readonly onSelectAll?: () => void;
    readonly onTranslateSelection?: () => void;
    readonly selectedIds: ReadonlySet<string>;
    readonly templates?: readonly BulkActionTemplate[];
    readonly totalCount?: number;
}


export function VaultBulkActionsBar({
    extraActions,
    itemTypeOptions = [],
    onApplyTemplate,
    onChangeItemType,
    onClearSelection,
    onDeleteSelected,
    onExportSelection,
    onSelectAll,
    onTranslateSelection,
    selectedIds,
    templates = [],
    totalCount = 0,
}: VaultBulkActionsBarProps) {
    const { t } = useTranslation();
    const [typeMenuOpen, setTypeMenuOpen] = useState(false);
    const [exportMenuOpen, setExportMenuOpen] = useState(false);
    const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
    const [pendingTemplate, setPendingTemplate] = useState<BulkActionTemplate | null>(null);
    const typeMenuRef = useRef<HTMLDivElement | null>(null);
    const exportMenuRef = useRef<HTMLDivElement | null>(null);
    const templateMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!typeMenuOpen && !exportMenuOpen && !templateMenuOpen) return undefined;
        const handler = (event: MouseEvent): void => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (typeMenuRef.current && !typeMenuRef.current.contains(target)) setTypeMenuOpen(false);
            if (exportMenuRef.current && !exportMenuRef.current.contains(target)) setExportMenuOpen(false);
            if (templateMenuRef.current && !templateMenuRef.current.contains(target)) setTemplateMenuOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => { document.removeEventListener('mousedown', handler); };
    }, [exportMenuOpen, templateMenuOpen, typeMenuOpen]);

    const count = selectedIds.size;
    if (count === 0) return null;
    const confirmTemplateApplication = (): void => {
        if (!pendingTemplate || !onApplyTemplate) return;
        onApplyTemplate(pendingTemplate.id);
        setPendingTemplate(null);
    };

    return <>
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 animate-in items-center gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-2.5 text-[var(--text-primary)] shadow-2xl ring-1 ring-black/5 slide-in-from-bottom-4">
            <span className="text-sm font-bold text-[var(--text-secondary)]">
                {t('bulk_actions.selected_count', { count })}
            </span>
            <div className="h-5 w-px bg-[var(--border-primary)]" />

            {onSelectAll && count < totalCount ? <button
                className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]/70 transition-colors hover:text-[var(--text-primary)]"
                onClick={onSelectAll}
                title={t('bulk_actions.select_all_title', 'Select all')}
                type="button"
            ><CheckSquare size={14} />{t('bulk_actions.select_all_count', { count: totalCount, defaultValue: 'All ({{count}})' })}</button> : null}

            {onChangeItemType && itemTypeOptions.length > 0 ? <div className="relative" ref={typeMenuRef}>
                <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]" onClick={() => { setTypeMenuOpen((open) => !open); }} title={t('bulk_actions.change_type_title', 'Change item type')} type="button">
                    <Tag size={13} />{t('bulk_actions.change_type', 'Change type')}<ChevronDown size={11} />
                </button>
                {typeMenuOpen ? <div className="absolute bottom-full left-0 z-50 mb-1 max-h-[280px] min-w-[200px] overflow-y-auto rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] py-1 shadow-lg">
                    {itemTypeOptions.map((option) => <button className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" key={option.value} onClick={() => { onChangeItemType(option.value); setTypeMenuOpen(false); }} type="button">{option.label}</button>)}
                </div> : null}
            </div> : null}

            {onExportSelection ? <div className="relative" ref={exportMenuRef}>
                <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]" onClick={() => { setExportMenuOpen((open) => !open); }} title={t('bulk_actions.export_title', 'Export selection')} type="button">
                    <Download size={13} />{t('bulk_actions.export', 'Export')}<ChevronDown size={11} />
                </button>
                {exportMenuOpen ? <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[130px] rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] py-1 shadow-lg">
                    <button className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" onClick={() => { onExportSelection('bibtex'); setExportMenuOpen(false); }} type="button">BibTeX (.bib)</button>
                    <button className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" onClick={() => { onExportSelection('ris'); setExportMenuOpen(false); }} type="button">RIS (.ris)</button>
                </div> : null}
            </div> : null}

            {onTranslateSelection ? <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]" onClick={onTranslateSelection} title={t('bulk_actions.translate_title', 'Translate selected')} type="button"><Languages size={13} />{t('translate.submit', 'Translate')}</button> : null}

            {onApplyTemplate && templates.length > 0 ? <div className="relative" ref={templateMenuRef}>
                <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]" onClick={() => { setTemplateMenuOpen((open) => !open); }} title={t('bulk_actions.apply_template_title', 'Apply template')} type="button">
                    <LayoutTemplate size={13} />{t('bulk_actions.apply_template', 'Apply template')}<ChevronDown size={11} />
                </button>
                {templateMenuOpen ? <div className="absolute bottom-full left-0 z-50 mb-1 max-h-[280px] min-w-[200px] overflow-y-auto rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] py-1 shadow-lg">
                    {templates.map((template) => <button className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" key={template.id} onClick={() => { setPendingTemplate(template); setTemplateMenuOpen(false); }} type="button">{template.title || t('common.untitled', 'Untitled')}</button>)}
                </div> : null}
            </div> : null}

            {extraActions}
            {onDeleteSelected ? <button className="btn-gnosi btn-gnosi-danger !rounded-lg !px-3 !py-1.5" onClick={onDeleteSelected} title={t('bulk_actions.delete_title', 'Delete selected')} type="button"><Trash2 size={13} />{t('common.delete', 'Delete')}</button> : null}
            <button className="rounded-md p-1.5 text-[var(--text-tertiary)]/60 transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" onClick={onClearSelection} title={t('bulk_actions.deselect_title', 'Deselect')} type="button"><X size={14} /></button>
        </div>

        <ConfirmModal
            cancelText={t('common.cancel')}
            confirmText={t('bulk_actions.confirm_apply_template')}
            isDestructive={false}
            isOpen={Boolean(pendingTemplate)}
            message={t('bulk_actions.confirm_apply_template_message', {
                count,
                title: pendingTemplate?.title || t('common.untitled'),
            })}
            onClose={() => { setPendingTemplate(null); }}
            onConfirm={confirmTemplateApplication}
            title={t('bulk_actions.confirm_apply_template_title')}
        />
    </>;
}
