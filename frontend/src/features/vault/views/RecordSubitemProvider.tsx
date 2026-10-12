import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RecordSubitemContext } from '../../../shared/record-views/recordSubitemContext';
import PromptModal from '../../../shared/ui/dialogs/PromptModal';
import { createVaultTablePage } from '../../../shared/api/vault-table';
import { notifyError } from '../../../shared/notifications/notifyError';
import { toast } from '../../../shared/notifications/toast';
import { applyDefaultFormulasToMetadata } from '../properties/defaultFormulaUtils';
import type { VaultViewPage } from '../../../shared/records/hooks/useVaultViewData';

interface Props {
    creationMetadata?: Readonly<Record<string, unknown>>;
    children: ReactNode;
    enabled: boolean;
    records: readonly VaultViewPage[];
    tableId?: unknown;
    schema: Readonly<Record<string, unknown>>;
    onSaved: () => unknown;
}

export function RecordSubitemProvider({ children, enabled, records, tableId, schema, creationMetadata, onSaved }: Props) {
    const { t } = useTranslation();
    const [parentId, setParentId] = useState<string | null>(null);
    const parent = records.find(record => record.id === parentId);
    const text = (value: unknown) => typeof value === 'string' ? value : '';
    const submit = async (title: string) => {
        if (!enabled || !parent) return;
        const metadata = parent.metadata;
        const targetTableId = text(tableId) || text(parent.resolved_table_id)
            || text(metadata?.table_id) || text(metadata?.database_table_id);
        try {
            if (!targetTableId) throw new Error('Missing parent table');
            const defaults = applyDefaultFormulasToMetadata({
                schema, title, notes: records, currentTableId: targetTableId,
                metadata: { ...creationMetadata, title, parent_id: parent.id, table_id: targetTableId, database_table_id: targetTableId,
                    ...(text(metadata?.database_id) ? { database_id: text(metadata?.database_id) } : {}) },
            });
            await createVaultTablePage({ title, content: '', parent_id: parent.id,
                metadata: { ...defaults, parent_id: parent.id, table_id: targetTableId, database_table_id: targetTableId } });
        } catch (error) {
            notifyError('view-create-subitem', error, t('table.subitem_create_error'));
            throw error;
        }
        setParentId(null);
        toast.success(t('table.subitem_created'));
        await onSaved();
    };
    return <RecordSubitemContext.Provider value={enabled ? setParentId : null}>
        {children}
        <PromptModal isOpen={enabled && !!parent} onClose={() => { setParentId(null); }} onSubmit={submit}
            title={t('table.add_subitem')} message={text(parent?.title)}
            label={t('table.subitem_name_placeholder')} confirmText={t('common.create')} />
    </RecordSubitemContext.Provider>;
}
