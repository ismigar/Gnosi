import { forwardRef, useContext, useState } from 'react';
import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VaultEditorContext } from '../VaultEditorContext';
import { SingleSelectPill } from './property-controls/SingleSelectPill';

interface InlineDatabaseProps { readonly block: { readonly props: { readonly database_table_id: string } }; readonly onUpdateTable: (id: string) => void; }
interface TableChoice { readonly id: string; readonly name: string; }
function isTable(value: unknown): value is TableChoice { return value !== null && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && 'name' in value && typeof value.name === 'string'; }

export const InlineDatabase = forwardRef<HTMLDivElement, InlineDatabaseProps>(({ block, onUpdateTable }, ref) => {
    const { t } = useTranslation();
    const context = useContext(VaultEditorContext);
    const allTables = context.allTables.filter(isTable);
    const [activeTableId, setActiveTableId] = useState(block.props.database_table_id);

    const handleTableChange = (id: string) => {
        setActiveTableId(id);
        onUpdateTable(id);
    };

    if (!activeTableId) {
        return (
            <div className="p-12 border-2 border-dashed border-[var(--border-primary)] rounded-xl flex flex-col items-center justify-center gap-4 bg-[var(--bg-secondary)]/30 group-hover:border-[var(--gnosi-primary)]/30 transition-colors">
                <div className="p-4 bg-[var(--gnosi-primary)]/10 rounded-2xl"><Database size={32} className="text-[var(--gnosi-primary)]/60" /></div>
                <div className="text-center">
                    <h3 className="text-sm font-semibold text-[var(--text-secondary)]">{t('editor.configure_view')}</h3>
                    <p className="text-xs text-[var(--text-tertiary)]/60 mt-1">{t('editor.select_database_to_start')}</p>
                </div>
                <SingleSelectPill
                    value={activeTableId}
                    onChange={handleTableChange}
                    options={allTables.map(t => t.id)}
                    idToTitle={Object.fromEntries(allTables.map(t => [t.id, t.name]))}
                    placeholder={t('editor.choose_table')}
                />
            </div>
        );
    }
    return (
        <div ref={ref} className="bn-database-container">
            <div className="p-8 text-center text-[var(--text-tertiary)]/60 text-[11px] italic border border-[var(--border-primary)] rounded-lg bg-[var(--bg-primary)] shadow-sm my-6">
                {t('editor.inline_database_future')}
            </div>
        </div>
    );
});
InlineDatabase.displayName = 'InlineDatabase';
