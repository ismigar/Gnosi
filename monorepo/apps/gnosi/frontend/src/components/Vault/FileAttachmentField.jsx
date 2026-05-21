import { useState } from 'react';
import { FileText, X, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InsertContentModal } from './InsertContentModal';

/**
 * FileAttachmentField — camp de tipus `files`.
 *
 * Un sol botó "+" obre `InsertContentModal` (el mateix modal que el "/+" de
 * l'editor): pestanyes Vault / Disc local / Puja / URL. El resultat (`url`)
 * es desa com a valor del camp.
 *
 * Props: tableId, value (string), onChange(newValue: string).
 */
export function FileAttachmentField({ tableId, value, onChange }) {
    const { t } = useTranslation();
    const [modalOpen, setModalOpen] = useState(false);

    const hasValue = Boolean(value);
    const fileName = value ? value.split('/').pop().split('\\').pop() : '';
    const isLocalPath = value && !value.startsWith('/api/') && !value.startsWith('http');
    const displayUrl = value && !isLocalPath ? value : null;

    return (
        <div className="space-y-1.5">
            {/* Valor actual */}
            {hasValue && (
                <div className="flex items-center gap-2 text-xs bg-[var(--bg-secondary)] rounded-lg px-2.5 py-1.5 border border-[var(--border-primary)]">
                    <FileText size={13} className="text-[var(--gnosi-primary)] shrink-0" />
                    {displayUrl ? (
                        <a href={displayUrl} target="_blank" rel="noreferrer" className="truncate text-[var(--gnosi-primary)] hover:underline flex-1">
                            {fileName}
                        </a>
                    ) : (
                        <span className="truncate text-[var(--text-secondary)] flex-1" title={value}>{fileName}</span>
                    )}
                    <button
                        type="button"
                        onClick={() => onChange('')}
                        className="text-[var(--text-tertiary)] hover:text-red-500 transition-colors shrink-0"
                        title={t('common.delete', 'Elimina')}
                    >
                        <X size={13} />
                    </button>
                </div>
            )}

            {/* Un sol "+" → InsertContentModal (mateix modal que el /+ de l'editor) */}
            <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:border-[var(--gnosi-primary)]/50 hover:text-[var(--gnosi-primary)] transition-colors"
                title={t('files.add', 'Afegeix un adjunt')}
            >
                <Plus size={15} />
            </button>

            <InsertContentModal
                open={modalOpen}
                tableId={tableId}
                onClose={() => setModalOpen(false)}
                onInsert={(result) => { onChange(result?.url || ''); setModalOpen(false); }}
            />
        </div>
    );
}
