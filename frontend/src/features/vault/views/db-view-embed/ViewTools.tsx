import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, ListTree, Focus, Accessibility, Copy, Plus, Edit2, Trash2 } from 'lucide-react';
import { subscribeDocumentEvent, eventTargetIsWithin } from '../../../../shared/platform/browser-events';
import { emitAppEvent, subscribeAppSignal } from './events';
import { toggleContrast, toggleTextSize } from './preferences';
import type { ViewActionsProps } from './types';
export function ViewTools({ onToggleGroup, groupMode = 'none', presets = [], onExportPresets, onImportPresets, onApplyPreset, onRenamePreset, onDeletePreset, loadDuration = null }: ViewActionsProps) {
    const { t } = useTranslation();
    const [showTools, setShowTools] = useState(false);
    const toolsRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!showTools) return;
        return subscribeDocumentEvent('mousedown', event => {
            if (toolsRef.current && !eventTargetIsWithin(toolsRef.current, event.target)) setShowTools(false);
        });
    }, [showTools]);
    useEffect(() => subscribeAppSignal('gnosi:open-view-tools', () => { setShowTools(true); }), []);
    return (<div className="relative" ref={toolsRef}>
        <button
            type="button"
            onClick={() => { setShowTools((current) => !current); }}
            className="vault-view-action"
            title={t('views_header.tools_and_shortcuts')}
            aria-label={t('views_header.tools_and_shortcuts')}
            aria-expanded={showTools}
            aria-haspopup="dialog"
        >
            <HelpCircle size={14} />
        </button>
        {showTools && (
            <div className="vault-view-tools-popover" role="dialog" aria-label={t('views_header.tools_and_shortcuts')}>
                <div className="vault-view-tools-title">{t('views_header.shortcuts')}</div>
                <div className="vault-shortcut-grid">
                    {[
                        ['Ctrl + /', t('views_header.search_title')],
                        ['Ctrl + F', t('views_header.view_settings')],
                        ['Ctrl + N', t('views_header.new_action')],
                        ['Ctrl + D', t('views_header.compact_density')],
                        ['Ctrl + L', t('sidebar.locate_active_page')],
                        ['Ctrl + ?', t('views_header.tools_and_shortcuts')],
                    ].map(([key, label]) => (
                        <React.Fragment key={key}><kbd className="text-nowrap">{key}</kbd><span>{label}</span></React.Fragment>
                    ))}
                </div>
                {onToggleGroup && (
                    <button type="button" className="vault-view-tools-row" onClick={onToggleGroup}>
                        <ListTree size={14} />
                        <span>{groupMode === 'date' ? t('feed.disable_date_groups') : t('feed.enable_date_groups')}</span>
                    </button>
                )}
                <button
                    type="button"
                    className="vault-view-tools-row"
                    onClick={() => emitAppEvent('gnosi:toggle-focus-mode')}
                >
                    <Focus size={14} /><span>{t('editor.toggle_focus_mode')}</span>
                </button>
                <button
                    type="button"
                    className="vault-view-tools-row"
                    onClick={toggleContrast}
                >
                    <Accessibility size={14} /><span>{t('editor.toggle_high_contrast')}</span>
                </button>
                <button
                    type="button"
                    className="vault-view-tools-row"
                    onClick={toggleTextSize}
                >
                    <Accessibility size={14} /><span>{t('editor.toggle_large_text')}</span>
                </button>
                {presets.length > 0 && (
                    <>
                        <div className="vault-view-tools-title">{t('views_header.manage_quick_views')}</div>
                        <div className="flex gap-1 px-2 pb-1">
                            <button type="button" className="vault-view-tools-row" onClick={onExportPresets}><Copy size={14} /><span>{t('views_header.export_quick_views', 'Copy configuration')}</span></button>
                            <button type="button" className="vault-view-tools-row" onClick={onImportPresets}><Plus size={14} /><span>{t('views_header.import_quick_views', 'Import configuration')}</span></button>
                        </div>
                        {presets.map((preset) => (
                            <div className="vault-view-preset-row" key={preset.id}>
                                <button type="button" onClick={() => onApplyPreset?.(preset.id)}>{preset.label}</button>
                                <button type="button" onClick={() => onRenamePreset?.(preset.id)} aria-label={t('views_header.rename')}><Edit2 size={12} /></button>
                                <button type="button" onClick={() => onDeletePreset?.(preset.id)} aria-label={t('views_header.delete')}><Trash2 size={12} /></button>
                            </div>
                        ))}
                    </>
                )}
                {loadDuration != null && (
                    <div className="vault-view-performance">
                        {t('views_header.last_load_time', { duration: Math.round(loadDuration) })}
                    </div>
                )}
            </div>
        )}
    </div>);
}
