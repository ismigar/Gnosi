import React from 'react';
import type { SchemaConfigModel } from './useSchemaConfig';
import { Layers, Languages, Send } from 'lucide-react';
import { FunctionalitiesSection } from './FunctionalitiesSection';
import { DrupalSettings } from './DrupalSettings';
export function TableSettings({ model }: { model: SchemaConfigModel }) {
    const {
        t, enableSubitems, setEnableSubitems, enableTranslation, handleToggleTranslation,
        enableSocialPublish, handleToggleSocialPublish,
    } = model;
    return <>
                    <div className="bg-[var(--bg-secondary)] p-4 rounded-lg border border-[var(--border-primary)] shadow-sm mb-6 space-y-4">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                            <Layers size={16} className="text-[var(--gnosi-primary)]" />
                            {t('schema.table_config')}
                        </h3>

                        <div>
                            <label
                                className={`flex items-center gap-3 group ${enableTranslation ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                title={enableTranslation ? t('schema.subitems_locked_by_translation', "Subitems are required for translation. Disable “Translatable table” first.") : undefined}
                            >
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableSubitems ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'} ${enableTranslation ? 'opacity-60' : ''}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableSubitems}
                                        disabled={enableTranslation}
                                        onChange={(e) => {
                                            // Blocked while the table is translatable: the
                                            // translations are persisted as subitems.
                                            if (enableTranslation && !e.target.checked) return;
                                            setEnableSubitems(e.target.checked);
                                        }}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableSubitems ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                                    {t('schema.allow_subitems')}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {enableTranslation
                                    ? t('schema.subitems_required_for_translation', "Enabled automatically: translations are saved as subitems.")
                                    : t('schema.subitems_hint')}
                            </p>
                        </div>

                        <div className="border-t border-[var(--border-primary)] pt-4">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableTranslation ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableTranslation}
                                        onChange={(e) => { handleToggleTranslation(e.target.checked); }}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableTranslation ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5">
                                    <Languages size={14} className={enableTranslation ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                                    {t('schema.translation_enabled', "Translatable table")}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {t('schema.translation_hint', "Lets you mark fields as translatable and add buttons that generate subitems with the translation to other languages.")}
                            </p>
                        </div>

                        <div className="border-t border-[var(--border-primary)] pt-4">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableSocialPublish ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableSocialPublish}
                                        onChange={(e) => { handleToggleSocialPublish(e.target.checked); }}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableSocialPublish ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5">
                                    <Send size={14} className={enableSocialPublish ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                                    {t('schema.social_publish_enabled', "Publishable to social media")}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {t('schema.social_publish_hint', "Adds a button to generate with AI and publish the records to the configured social networks.")}
                            </p>
                        </div>

                        <DrupalSettings model={model} />
                        <FunctionalitiesSection model={model} />
                    </div>

    </>;
}
