import { Fragment, useCallback, useState } from 'react';
import { ArrowUpRight, ChevronRight, Plus, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { toast } from '../../../shared/notifications/toast';
import {
    promoteZoteroExtra,
    type ZoteroExtraPromotionResponse,
} from '../../../shared/api/resource-lookup';


type ZoteroExtras = Readonly<Record<string, unknown>>;


interface PromotionDraft {
    readonly columnName: string;
    readonly key: string;
}


interface ZoteroExtrasSectionProps {
    readonly extras: ZoteroExtras | null | undefined;
    readonly onChange?: (extras: ZoteroExtras) => void;
    readonly onPromoted?: (result: ZoteroExtraPromotionResponse) => void;
    readonly onRemoveAll?: () => void;
    readonly readOnly?: boolean;
    readonly tableId?: string | null;
}


function editableValue(value: unknown): string {
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}


export function ZoteroExtrasSection({
    extras,
    onChange,
    onPromoted,
    onRemoveAll,
    readOnly = false,
    tableId,
}: ZoteroExtrasSectionProps) {
    const { t } = useTranslation();
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');
    const [promoting, setPromoting] = useState<PromotionDraft | null>(null);

    const updateField = useCallback((key: string, value: string): void => {
        if (!onChange || !extras) return;
        onChange({ ...extras, [key]: value });
    }, [extras, onChange]);
    const removeField = useCallback((key: string): void => {
        if (!onChange || !extras) return;
        const next = Object.fromEntries(
            Object.entries(extras).filter(([candidate]) => candidate !== key),
        );
        if (Object.keys(next).length === 0 && onRemoveAll) {
            onRemoveAll();
            return;
        }
        onChange(next);
    }, [extras, onChange, onRemoveAll]);
    const addField = useCallback((): void => {
        const key = newKey.trim();
        if (!key || !onChange || !extras || key in extras) return;
        onChange({ ...extras, [key]: newValue.trim() });
        setNewKey('');
        setNewValue('');
    }, [extras, newKey, newValue, onChange]);
    const handlePromote = useCallback(async (): Promise<void> => {
        if (!promoting || !tableId) return;
        const finalName = (promoting.columnName || promoting.key).trim();
        if (!finalName) {
            toast.error(t('zotero_extras.promote_invalid', { defaultValue: 'Invalid column name' }));
            return;
        }
        try {
            const result = await promoteZoteroExtra({
                table_id: tableId,
                zotero_field: promoting.key,
                column_name: finalName,
                column_type: 'text',
            });
            toast.success(t('zotero_extras.promote_done', {
                defaultValue: `Field "${promoting.key}" promoted to column "${finalName}" (${String(result.migrated)} pages migrated)`,
                key: promoting.key,
                col: finalName,
                migrated: result.migrated,
            }));
            setPromoting(null);
            onPromoted?.(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            toast.error(t('zotero_extras.promote_failed', {
                defaultValue: `Error promoting: ${message}`,
                err: message,
            }));
        }
    }, [onPromoted, promoting, t, tableId]);

    if (!extras || Array.isArray(extras)) return null;
    const entries = Object.entries(extras).filter(([, value]) => (
        value !== null && value !== undefined && value !== ''
    ));
    if (entries.length === 0) return null;

    return (
        <details className="group col-span-2 mt-3 overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-secondary)]/60 [&::-webkit-details-marker]:hidden">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                    <Sparkles className="text-[var(--gnosi-primary)]/70" size={14} />
                    <span>{t('zotero_extras.title', { defaultValue: 'Additional Zotero details' })}</span>
                    <span className="text-xs font-normal text-[var(--text-tertiary)]">({entries.length})</span>
                </div>
                <ChevronRight className="text-[var(--text-tertiary)] transition-transform group-open:rotate-90" size={14} />
            </summary>
            <div className="border-t border-[var(--border-primary)]/50 px-3 py-2.5">
                <p className="mb-2 text-[11px] italic text-[var(--text-tertiary)]">
                    {readOnly
                        ? t('zotero_extras.hint_readonly', "Fields imported from Zotero that don't have their own column in the Vault.")
                        : t('zotero_extras.hint_editable', 'Fields imported from Zotero. Editable in the cell; X to delete; + to add.')}
                </p>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-x-2 gap-y-1.5 text-xs">
                    {entries.map(([key, value]) => (
                        <Fragment key={key}>
                            <span className="truncate font-mono text-[var(--text-secondary)]" title={key}>{key}</span>
                            <input
                                className="rounded border border-transparent bg-transparent px-1.5 py-0.5 text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-primary)] focus:border-[var(--gnosi-primary)]/60 disabled:cursor-not-allowed disabled:opacity-70"
                                disabled={readOnly || typeof value === 'object'}
                                onChange={(event) => {
                                    updateField(key, event.target.value);
                                }}
                                title={typeof value === 'object'
                                    ? t('zotero_extras.object_uneditable', { defaultValue: 'Structured value — edit the .md directly' })
                                    : ''}
                                type="text"
                                value={editableValue(value)}
                            />
                            {!readOnly ? (
                                <div className="flex items-center gap-0.5">
                                    {tableId ? (
                                        <button
                                            className="p-1 text-[var(--text-tertiary)]/40 transition-colors hover:text-[var(--gnosi-primary)]"
                                            onClick={() => {
                                                setPromoting({ key, columnName: key });
                                            }}
                                            title={t('zotero_extras.promote_to_column', { defaultValue: 'Promote to registry column' })}
                                            type="button"
                                        ><ArrowUpRight size={12} /></button>
                                    ) : null}
                                    <button
                                        className="p-1 text-[var(--text-tertiary)]/40 transition-colors hover:text-[var(--status-error)]"
                                        onClick={() => {
                                            removeField(key);
                                        }}
                                        title={t('zotero_extras.remove_field', { defaultValue: 'Delete this field' })}
                                        type="button"
                                    ><X size={12} /></button>
                                </div>
                            ) : <span />}
                        </Fragment>
                    ))}
                    {promoting ? (
                        <div className="col-span-3 mt-2 flex items-center gap-2 rounded-md border border-[var(--gnosi-primary)]/30 bg-[var(--gnosi-primary)]/5 p-2 text-xs">
                            <ArrowUpRight className="shrink-0 text-[var(--gnosi-primary)]" size={12} />
                            <span className="text-[var(--text-secondary)]">
                                {t('zotero_extras.promote_dialog', {
                                    defaultValue: `Promote "${promoting.key}" as:`,
                                    key: promoting.key,
                                })}
                            </span>
                            <input
                                autoFocus
                                className="flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-1.5 py-0.5 outline-none focus:border-[var(--gnosi-primary)]"
                                onChange={(event) => {
                                    setPromoting({ ...promoting, columnName: event.target.value });
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        void handlePromote();
                                    }
                                    if (event.key === 'Escape') {
                                        setPromoting(null);
                                    }
                                }}
                                placeholder={t('zotero_extras.promote_column_placeholder', { defaultValue: 'Column name' })}
                                type="text"
                                value={promoting.columnName}
                            />
                            <button
                                className="rounded bg-[var(--gnosi-primary)] px-2 py-0.5 text-[11px] text-white hover:opacity-90"
                                onClick={() => { void handlePromote(); }}
                                type="button"
                            >{t('zotero_extras.promote_apply', { defaultValue: 'Apply' })}</button>
                            <button
                                className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                                onClick={() => {
                                    setPromoting(null);
                                }}
                                type="button"
                            ><X size={12} /></button>
                        </div>
                    ) : null}
                    {!readOnly ? (
                        <>
                            <input
                                className="rounded border border-dashed border-[var(--border-primary)]/50 bg-transparent px-1.5 py-0.5 font-mono text-[var(--text-secondary)] outline-none transition-colors hover:border-[var(--border-primary)] focus:border-[var(--gnosi-primary)]/60"
                                onChange={(event) => {
                                    setNewKey(event.target.value);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addField();
                                    }
                                }}
                                placeholder={t('zotero_extras.new_key_placeholder', { defaultValue: 'new field' })}
                                type="text"
                                value={newKey}
                            />
                            <input
                                className="rounded border border-dashed border-[var(--border-primary)]/50 bg-transparent px-1.5 py-0.5 text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-primary)] focus:border-[var(--gnosi-primary)]/60"
                                onChange={(event) => {
                                    setNewValue(event.target.value);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addField();
                                    }
                                }}
                                placeholder={t('zotero_extras.new_value_placeholder', { defaultValue: 'value' })}
                                type="text"
                                value={newValue}
                            />
                            <button
                                className="p-1 text-[var(--gnosi-primary)]/60 transition-colors hover:text-[var(--gnosi-primary)] disabled:cursor-not-allowed disabled:opacity-30"
                                disabled={!newKey.trim() || newKey.trim() in extras}
                                onClick={addField}
                                title={newKey.trim() in extras
                                    ? t('zotero_extras.duplicate_key', { defaultValue: 'This field already exists' })
                                    : t('zotero_extras.add_field', { defaultValue: 'Add field' })}
                                type="button"
                            ><Plus size={12} /></button>
                        </>
                    ) : null}
                </div>
            </div>
        </details>
    );
}


export default ZoteroExtrasSection;
