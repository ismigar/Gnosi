import React from 'react';
import type { SchemaConfigModel } from './useSchemaConfig';
import { Globe, Loader2, Link2 } from 'lucide-react';
export function DrupalSettings({ model }: { model: SchemaConfigModel }) {
    const {
        t, enableDrupalSync, handleToggleDrupalSync, drupalError, drupalBundle, setDrupalBundle,
        drupalLoading, drupalContentTypes, drupalFieldMapping, setDrupalFieldMapping, drupalFields,
        tableId, matching, handleMatchExisting,
    } = model;
    return <>
                        <div className="border-t border-[var(--border-primary)] pt-4">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableDrupalSync ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableDrupalSync}
                                        onChange={(e) => { handleToggleDrupalSync(e.target.checked); }}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableDrupalSync ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5">
                                    <Globe size={14} className={enableDrupalSync ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                                    {t('schema.drupal_sync_enabled', "Sync with Drupal")}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {t('schema.drupal_sync_hint', "Publishes the records as Drupal nodes. Pick the content type; then map each field from the column list below.")}
                            </p>

                            {enableDrupalSync && (
                                <div className="mt-3 space-y-3">
                                    {drupalError && (
                                        <p className="text-xs text-red-500">{drupalError}</p>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-medium text-[var(--text-secondary)] w-36 shrink-0">
                                            {t('schema.drupal_content_type', "Content type")}
                                        </label>
                                        <select
                                            value={drupalBundle}
                                            onChange={(e) => { setDrupalBundle(e.target.value); }}
                                            className="flex-1 text-sm px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                        >
                                            <option value="">{drupalLoading && drupalContentTypes.length === 0 ? t('common.loading', "Loading...") : t('schema.drupal_pick_type', "— Pick a type —")}</option>
                                            {drupalContentTypes.map((ct) => (
                                                <option key={ct.machine} value={ct.machine}>{ct.label} ({ct.machine})</option>
                                            ))}
                                            {/* Fallback: if Drupal doesn't respond, show the saved bundle
                                                so it doesn't look like the configuration was lost. */}
                                            {drupalBundle && !drupalContentTypes.some((ct) => ct.machine === drupalBundle) && (
                                                <option value={drupalBundle}>{drupalBundle}</option>
                                            )}
                                        </select>
                                    </div>

                                    {drupalBundle && (
                                        <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
                                            <div className="px-3 py-2 bg-[var(--bg-tertiary)] text-xs font-semibold text-[var(--text-secondary)] flex items-center justify-between">
                                                <span>{t('schema.drupal_field_mapping', "Field mapping")}</span>
                                                <span className="text-[var(--text-tertiary)] font-normal">{t('schema.drupal_field_drupal', "Drupal field")}</span>
                                            </div>
                                            <div className="divide-y divide-[var(--border-primary)]">
                                                <div className="flex items-center gap-2 px-3 py-1.5">
                                                    <span className="text-xs italic text-[var(--text-secondary)] w-36 shrink-0 truncate" title={t('schema.drupal_body_hint', "The Markdown text of the page body")}>{t('schema.drupal_body_field', "Page body")}</span>
                                                    <span className="text-[var(--text-tertiary)] text-xs">→</span>
                                                    <select
                                                        value={drupalFieldMapping['__body__'] || ''}
                                                        onChange={(e) => { setDrupalFieldMapping((prev) => {
                                                            const next = { ...prev };
                                                            if (e.target.value) next['__body__'] = e.target.value;
                                                            else delete next['__body__'];
                                                            return next;
                                                        }); }}
                                                        className="flex-1 text-xs px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                                    >
                                                        <option value="">{t('schema.drupal_no_map', "— Do not sync —")}</option>
                                                        {drupalFields.map((df) => (
                                                            <option key={df.field_name} value={df.field_name}>{df.label} · {df.field_type}</option>
                                                        ))}
                                                        {/* Fallback: saved value even if Drupal doesn't respond. */}
                                                        {drupalFieldMapping['__body__'] && !drupalFields.some((df) => df.field_name === drupalFieldMapping['__body__']) && (
                                                            <option value={drupalFieldMapping['__body__']}>{drupalFieldMapping['__body__']}</option>
                                                        )}
                                                    </select>
                                                </div>
                                                <div className="px-3 py-2 text-[11px] text-[var(--text-secondary)]/60">
                                                    {t('schema.drupal_perfield_note', "Each field's mapping is configured in the column list below, next to each field.")}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {drupalBundle && tableId && (
                                        <button
                                            type="button"
                                            onClick={() => { void handleMatchExisting(); }}
                                            disabled={matching}
                                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                                            title={t('schema.drupal_match_hint', "Searches Drupal for existing nodes by title and fills their NID/URL into the rows (creates nothing).")}
                                        >
                                            {matching ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                                            {t('schema.drupal_match_existing', "Link existing records by title")}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

    </>;
}
