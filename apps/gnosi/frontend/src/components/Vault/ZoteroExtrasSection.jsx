import React, { useState, useCallback } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Sparkles, ChevronRight, X, Plus, ArrowUpRight } from 'lucide-react';
import { toast } from '../../lib/toast';

/**
 * Renders and edits the `Zotero Extras` key of the frontmatter (a dict with
 * rare Zotero fields: patentNumber, conferenceName, meetingName, ...).
 *
 * Editing:
 *   - Each field has an editable input. onChange propagates the whole dict
 *     with the updated field to the caller's `onChange` callback.
 *   - Each field has an X button to delete it individually.
 *   - At the end, an "add field" row with 2 inputs (key + value) and a + button.
 *
 * When no fields remain:
 *   - If the caller passes `onRemoveAll`, we invoke it so it removes the
 *     entire `Zotero Extras` key from the frontmatter (avoid leaving an empty dict).
 *   - Otherwise, an empty dict remains and the section stops rendering
 *     due to the `entries.length === 0` guard.
 *
 * Read-only via `readOnly` (disables inputs and buttons). Useful for
 * non-editor users or for rendering in read-only views.
 */
export function ZoteroExtrasSection({ extras, onChange, onRemoveAll, readOnly = false, tableId, onPromoted }) {
    const { t } = useTranslation();
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');
    const [promoting, setPromoting] = useState(null);  // {key, columnName} | null

    const updateField = useCallback((key, value) => {
        if (!onChange) return;
        const next = { ...extras, [key]: value };
        onChange(next);
    }, [extras, onChange]);

    const removeField = useCallback((key) => {
        if (!onChange) return;
        const next = { ...extras };
        delete next[key];
        if (Object.keys(next).length === 0 && onRemoveAll) {
            // Notifies the caller that it can remove the entire key from the frontmatter.
            onRemoveAll();
            return;
        }
        onChange(next);
    }, [extras, onChange, onRemoveAll]);

    const addField = useCallback(() => {
        const k = newKey.trim();
        const v = newValue.trim();
        if (!k || !onChange) return;
        if (k in extras) return; // duplicat: no sobreescriure silenciosament
        onChange({ ...extras, [k]: v });
        setNewKey('');
        setNewValue('');
    }, [newKey, newValue, extras, onChange]);

    const handlePromote = useCallback(async () => {
        if (!promoting || !tableId) return;
        const { key, columnName } = promoting;
        const finalName = (columnName || key).trim();
        if (!finalName) {
            toast.error(t('zotero_extras.promote_invalid', { defaultValue: "Invalid column name" }));
            return;
        }
        try {
            const r = await axios.post('/api/vault/promote-zotero-extra', {
                table_id: tableId,
                zotero_field: key,
                column_name: finalName,
                column_type: 'text',
            });
            const d = r.data || {};
            toast.success(t('zotero_extras.promote_done', {
                defaultValue: `Field "${key}" promoted to column "${finalName}" (${d.migrated || 0} pages migrated)`,
                key,
                col: finalName,
                migrated: d.migrated || 0,
            }));
            setPromoting(null);
            onPromoted?.(d);
        } catch (err) {
            const msg = err?.response?.data?.detail || err?.message;
            toast.error(t('zotero_extras.promote_failed', {
                defaultValue: `Error promovent: ${msg}`,
                err: msg,
            }));
        }
    }, [promoting, tableId, onPromoted, t]);

    // Early returns AFTER all hooks (React's rules of hooks): if they were
    // placed earlier, the `useCallback`s above would be called conditionally, and,
    // when `extras` changes between renders (e.g. a reference page that
    // loads, or a field being deleted), React would crash with "Rendered more/fewer
    // hooks than during the previous render".
    if (!extras || typeof extras !== 'object' || Array.isArray(extras)) return null;
    const entries = Object.entries(extras).filter(([, v]) => v !== null && v !== undefined && v !== '');
    if (entries.length === 0) return null;

    return (
        <details className="col-span-2 mt-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 overflow-hidden group">
            <summary
                className="cursor-pointer flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[var(--bg-secondary)]/60 transition-colors list-none [&::-webkit-details-marker]:hidden"
            >
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                    <Sparkles size={14} className="text-[var(--gnosi-primary)]/70" />
                    <span>
                        {t('zotero_extras.title', { defaultValue: "Additional Zotero details" })}
                    </span>
                    <span className="text-xs font-normal text-[var(--text-tertiary)]">({entries.length})</span>
                </div>
                <ChevronRight
                    size={14}
                    className="text-[var(--text-tertiary)] transition-transform group-open:rotate-90"
                />
            </summary>
            <div className="px-3 py-2.5 border-t border-[var(--border-primary)]/50">
                <p className="text-[11px] text-[var(--text-tertiary)] italic mb-2">
                    {readOnly
                        ? t('zotero_extras.hint_readonly', "Fields imported from Zotero that don't have their own column in the Vault.")
                        : t('zotero_extras.hint_editable', "Fields imported from Zotero. Editable in the cell; X to delete; + to add.")}
                </p>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-x-2 gap-y-1.5 text-xs items-center">
                    {entries.map(([k, v]) => (
                        <React.Fragment key={k}>
                            <span
                                className="font-mono text-[var(--text-secondary)] truncate"
                                title={k}
                            >
                                {k}
                            </span>
                            <input
                                type="text"
                                value={typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                onChange={(e) => updateField(k, e.target.value)}
                                disabled={readOnly || typeof v === 'object'}
                                className="bg-transparent border border-transparent hover:border-[var(--border-primary)] focus:border-[var(--gnosi-primary)]/60 rounded px-1.5 py-0.5 text-[var(--text-primary)] outline-none transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                                title={typeof v === 'object' ? t('zotero_extras.object_uneditable', { defaultValue: "Structured value — edit the .md directly" }) : ''}
                            />
                            {!readOnly && (
                                <div className="flex items-center gap-0.5">
                                    {tableId && (
                                        <button
                                            type="button"
                                            onClick={() => setPromoting({ key: k, columnName: k })}
                                            className="p-1 text-[var(--text-tertiary)]/40 hover:text-[var(--gnosi-primary)] transition-colors"
                                            title={t('zotero_extras.promote_to_column', { defaultValue: "Promote to registry column" })}
                                        >
                                            <ArrowUpRight size={12} />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => removeField(k)}
                                        className="p-1 text-[var(--text-tertiary)]/40 hover:text-[var(--status-error)] transition-colors"
                                        title={t('zotero_extras.remove_field', { defaultValue: "Delete this field" })}
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            )}
                            {readOnly && <span />}
                        </React.Fragment>
                    ))}
                    {promoting && (
                        <div className="col-span-3 mt-2 p-2 rounded-md border border-[var(--gnosi-primary)]/30 bg-[var(--gnosi-primary)]/5 flex items-center gap-2 text-xs">
                            <ArrowUpRight size={12} className="text-[var(--gnosi-primary)] shrink-0" />
                            <span className="text-[var(--text-secondary)]">
                                {t('zotero_extras.promote_dialog', {
                                    defaultValue: `Promou "${promoting.key}" com a:`,
                                    key: promoting.key,
                                })}
                            </span>
                            <input
                                autoFocus
                                type="text"
                                value={promoting.columnName}
                                onChange={(e) => setPromoting({ ...promoting, columnName: e.target.value })}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); handlePromote(); }
                                    if (e.key === 'Escape') setPromoting(null);
                                }}
                                placeholder={t('zotero_extras.promote_column_placeholder', { defaultValue: "Column name" })}
                                className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded px-1.5 py-0.5 outline-none focus:border-[var(--gnosi-primary)]"
                            />
                            <button
                                type="button"
                                onClick={handlePromote}
                                className="px-2 py-0.5 rounded bg-[var(--gnosi-primary)] text-white text-[11px] hover:opacity-90"
                            >
                                {t('zotero_extras.promote_apply', { defaultValue: "Apply" })}
                            </button>
                            <button
                                type="button"
                                onClick={() => setPromoting(null)}
                                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-0.5"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    )}
                    {!readOnly && (
                        <>
                            <input
                                type="text"
                                value={newKey}
                                onChange={(e) => setNewKey(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addField(); } }}
                                placeholder={t('zotero_extras.new_key_placeholder', { defaultValue: "new field" })}
                                className="font-mono bg-transparent border border-dashed border-[var(--border-primary)]/50 hover:border-[var(--border-primary)] focus:border-[var(--gnosi-primary)]/60 rounded px-1.5 py-0.5 text-[var(--text-secondary)] outline-none transition-colors"
                            />
                            <input
                                type="text"
                                value={newValue}
                                onChange={(e) => setNewValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addField(); } }}
                                placeholder={t('zotero_extras.new_value_placeholder', { defaultValue: "value" })}
                                className="bg-transparent border border-dashed border-[var(--border-primary)]/50 hover:border-[var(--border-primary)] focus:border-[var(--gnosi-primary)]/60 rounded px-1.5 py-0.5 text-[var(--text-primary)] outline-none transition-colors"
                            />
                            <button
                                type="button"
                                onClick={addField}
                                disabled={!newKey.trim() || newKey.trim() in extras}
                                className="p-1 text-[var(--gnosi-primary)]/60 hover:text-[var(--gnosi-primary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title={newKey.trim() in extras
                                    ? t('zotero_extras.duplicate_key', { defaultValue: "This field already exists" })
                                    : t('zotero_extras.add_field', { defaultValue: "Add field" })}
                            >
                                <Plus size={12} />
                            </button>
                        </>
                    )}
                </div>
            </div>
        </details>
    );
}

export default ZoteroExtrasSection;
