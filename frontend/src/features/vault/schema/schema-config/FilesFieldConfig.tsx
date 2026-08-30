import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SortableFieldProps } from './types';
export function FilesFieldConfig({ field, idx, allFields, handleUpdateField }: SortableFieldProps) {
    const { t } = useTranslation();
    return <>
            {/* Files: storage folder config */}
            {field.type === 'files' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                            {t('schema.file_mode', 'Mode')}
                        </label>
                        <div className="flex gap-2">
                            {[
                                { value: 'link', label: t('schema.file_mode_link', "Link") },
                                { value: 'upload', label: t('schema.file_mode_upload', "Upload") },
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => { handleUpdateField(idx, 'file_mode', opt.value); }}
                                    className={`flex-1 text-xs rounded-lg border px-2 py-1.5 font-semibold transition-colors ${
                                        (field.file_mode || 'upload') === opt.value
                                            ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)]'
                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {(field.file_mode || 'upload') === 'link'
                                ? t('schema.file_mode_link_desc', "Links a local file without copying it (reference).")
                                : t('schema.file_mode_upload_desc', "Copies the file to the destination folder.")}
                        </p>

                        {(field.file_mode || 'upload') === 'upload' && (
                        <div className="pt-2 mt-1 space-y-2 border-t border-[var(--border-primary)]/50">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                            {t('schema.storage_folder', "Storage folder")}
                        </label>
                        <div className="flex gap-2">
                            {[
                                { value: 'assets',    label: 'Assets',    desc: t('schema.storage_assets_desc', "Vault Assets folder") },
                                { value: 'library', label: 'Library', desc: t('schema.storage_library_desc', "Shared reference library (OneDrive/Library)") },
                                { value: 'free',      label: t('schema.storage_free', "Free"), desc: t('schema.storage_free_desc', "User selects the destination folder or existing file on each attachment") },
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => { handleUpdateField(idx, 'storage_folder', opt.value); }}
                                    title={opt.desc}
                                    className={`flex-1 text-xs rounded-lg border px-2 py-1.5 font-semibold transition-colors ${
                                        (field.storage_folder || 'assets') === opt.value
                                            ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)]'
                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {{
                                assets:    t('schema.storage_assets_desc', "Vault Assets folder"),
                                library: t('schema.storage_library_desc', "Shared reference library (OneDrive/Library)"),
                                free:      t('schema.storage_free_desc', "User selects the destination folder or existing file on each attachment"),
                            }[field.storage_folder || 'assets']}
                        </p>

                        <div className="pt-2 mt-1 space-y-1 border-t border-[var(--border-primary)]/50">
                            <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                                {t('schema.name_pattern', "Name pattern")}
                            </label>
                            <input
                                type="text"
                                value={field.name_pattern || ''}
                                onChange={(e) => { handleUpdateField(idx, 'name_pattern', e.target.value); }}
                                placeholder={t('schema.name_pattern_ph', "E.g. {Authors} - {Any} - {Títol}")}
                                className="w-full text-xs rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                            />
                            {allFields.filter(f => f !== field && (f.name || '').trim()).length > 0 && (
                                <div className="flex flex-wrap gap-1 px-1">
                                    {allFields.filter(f => f !== field && (f.name || '').trim()).sort((a, b) => (a.name || '').localeCompare(b.name || '')).flatMap(f => (
                                        (f.type === 'autoria' ? [`${f.name}.nom`, `${f.name}.cognom1`, `${f.name}.cognom2`] : [f.name]).map(tok => (
                                            <button
                                                key={tok}
                                                type="button"
                                                onClick={() => { handleUpdateField(idx, 'name_pattern', `${field.name_pattern || ''}{${tok}}`); }}
                                                className="text-[10px] rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                                                title={t('schema.name_pattern_insert', "Insert the field into the pattern")}
                                            >
                                                {`{${tok}}`}
                                            </button>
                                        ))
                                    ))}
                                </div>
                            )}
                            <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                                {t('schema.name_pattern_hint', "On upload, the file is renamed on disk according to the pattern (empty fields are omitted). For authors: {Autor.nom}, {Autor.cognom1} and {Autor.cognom2} (and {Autor} alone, the full name).")}
                            </p>
                        </div>
                        </div>
                        )}
                    </div>
                </div>
            )}

    </>;
}
