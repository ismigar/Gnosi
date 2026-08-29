import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BrainInbox } from '../BrainInbox';
import { ReferenceImportExport } from '../ReferenceImportExport';

interface HeaderTitleProps {
    readonly brainTableId?: string | null;
    readonly isFilteredView: boolean;
    readonly onClose?: (() => unknown) | null;
    readonly onReferencesImported?: (() => unknown) | null;
    readonly recordCount: number;
    readonly referenceTableId?: string | null;
    readonly tableName: string;
    readonly viewRecordCount: number;
}

export function HeaderTitle({
    brainTableId,
    isFilteredView,
    onClose,
    onReferencesImported,
    recordCount,
    referenceTableId,
    tableName,
    viewRecordCount,
}: HeaderTitleProps) {
    const { t } = useTranslation();

    return (
        <div className="flex items-start justify-between px-2 pt-vault-header-top pb-1.5 md:px-4 md:pb-2">
            <div className="flex items-center gap-3">
                <h1 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2 md:gap-3 mt-0 leading-none">
                    {tableName}
                </h1>
                <span
                    className="text-[10px] md:text-xs font-medium text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full border border-[var(--border-primary)]"
                    title={isFilteredView
                        ? t('views_header.records_count_in_view_hint', {
                            count: viewRecordCount,
                            total: recordCount,
                        })
                        : undefined}
                >
                    {isFilteredView
                        ? t('views_header.records_count_in_view', {
                            count: viewRecordCount,
                            total: recordCount,
                        })
                        : t('views_header.records_count', { count: recordCount })}
                </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {brainTableId && (
                    <BrainInbox onAccepted={onReferencesImported ? () => {
                        onReferencesImported();
                    } : undefined} />
                )}
                {referenceTableId && (
                    <ReferenceImportExport
                        tableId={referenceTableId}
                        onImported={onReferencesImported}
                    />
                )}
                {onClose && (
                    <button
                        onClick={() => {
                            onClose();
                        }}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors p-1"
                        title={t('views_header.close_panel')}
                    >
                        <X size={20} />
                    </button>
                )}
            </div>
        </div>
    );
}
