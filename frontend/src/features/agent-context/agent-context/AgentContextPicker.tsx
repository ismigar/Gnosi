import { useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
    Blocks,
    Database,
    FileText,
    Globe,
    Landmark,
    Layers,
    Loader2,
    Paperclip,
    Plus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { internalSourceLabel } from './agentContextLabels';
import type {
    ContextCatalogItem,
    ContextPickingKind,
    ContextScope,
    ContextSourceKind,
} from './agentContextModel';


interface ContextPickerProps {
    readonly onAdd: (
        type: ContextSourceKind,
        ref: string,
        label: string,
        scope?: ContextScope,
    ) => void;
    readonly onAddUrl: (url: string) => boolean;
    readonly onPickingChange: (kind: ContextPickingKind | null) => void;
    readonly onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
    readonly options: readonly ContextCatalogItem[] | null;
    readonly picking: ContextPickingKind | null;
    readonly uploading: boolean;
}


const ADD_BUTTON_STYLE: CSSProperties = {
    alignItems: 'center',
    background: 'var(--settings-sidebar-bg)',
    border: '1px solid var(--settings-border)',
    borderRadius: '12px',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    display: 'flex',
    fontSize: '0.82rem',
    gap: '6px',
    padding: '8px 12px',
};


export function AgentContextPicker({
    onAdd,
    onAddUrl,
    onPickingChange,
    onUpload,
    options,
    picking,
    uploading,
}: ContextPickerProps) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [urlDraft, setUrlDraft] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const visibleOptions = useMemo(() => {
        if (options === null) return null;
        const needle = query.trim().toLowerCase();
        const filtered = needle
            ? options.filter((item) => item.label.toLowerCase().includes(needle))
            : options;
        return filtered.slice(0, 50);
    }, [options, query]);

    const togglePicker = (kind: ContextPickingKind): void => {
        setUrlDraft(null);
        setQuery('');
        onPickingChange(picking === kind ? null : kind);
    };
    const submitUrl = (): void => {
        const url = (urlDraft ?? '').trim();
        if (url && onAddUrl(url)) setUrlDraft(null);
    };

    return (
        <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button
                    disabled={uploading}
                    onClick={() => {
                        fileInputRef.current?.click();
                    }}
                    style={ADD_BUTTON_STYLE}
                    type="button"
                >
                    {uploading
                        ? <Loader2 className="spin" size={14} />
                        : <Paperclip size={14} />}
                    {t('settings.ai.context_add_file', 'File')}
                </button>
                <button
                    onClick={() => {
                        onPickingChange(null);
                        setUrlDraft((current) => current === null ? '' : null);
                    }}
                    style={ADD_BUTTON_STYLE}
                    type="button"
                >
                    <Globe size={14} />
                    {t('settings.ai.context_add_url', 'URL')}
                </button>
                <button
                    onClick={() => {
                        togglePicker('source');
                    }}
                    style={ADD_BUTTON_STYLE}
                    type="button"
                >
                    <Landmark size={14} />
                    {t('settings.ai.context_add_external', 'External source')}
                </button>
                <button
                    onClick={() => {
                        togglePicker('internal');
                    }}
                    style={ADD_BUTTON_STYLE}
                    type="button"
                >
                    <Blocks size={14} />
                    {t('settings.ai.context_add_internal', 'Gnosi source')}
                </button>
                <input
                    onChange={onUpload}
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    type="file"
                />
            </div>

            {urlDraft !== null ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                        autoFocus
                        className="gnosi-input"
                        onChange={(event) => {
                            setUrlDraft(event.target.value);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                submitUrl();
                            }
                        }}
                        placeholder={t('settings.ai.context_url_placeholder', 'https://...')}
                        style={{ flex: 1 }}
                        value={urlDraft}
                    />
                    <button onClick={submitUrl} style={ADD_BUTTON_STYLE} type="button">
                        <Plus size={14} />
                        {t('common.add', 'Add')}
                    </button>
                </div>
            ) : null}

            {picking === 'vault' || picking === 'page' || picking === 'table' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button style={ADD_BUTTON_STYLE} type="button" onClick={() => { togglePicker('internal'); }}>
                        {t('settings.ai.context_back_sources', 'Back to Gnosi sources')}
                    </button>
                    <strong>Vault</strong>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                        {t('settings.ai.context_vault_description', 'Pages and databases in the active vault.')}
                    </span>
                    <button style={ADD_BUTTON_STYLE} type="button" onClick={() => {
                        onAdd('vault', 'active', t('settings.ai.context_whole_vault', 'Entire active vault'));
                    }}>
                        <Layers size={14} />
                        {t('settings.ai.context_whole_vault', 'Entire active vault')}
                    </button>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                        {t('settings.ai.context_vault_specific', 'Specific pages or databases')}
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        <button style={ADD_BUTTON_STYLE} type="button" aria-pressed={picking === 'page'} onClick={() => { togglePicker('page'); }}>
                            <FileText size={14} />
                            {t('settings.ai.context_add_page', 'Page')}
                        </button>
                        <button style={ADD_BUTTON_STYLE} type="button" aria-pressed={picking === 'table'} onClick={() => { togglePicker('table'); }}>
                            <Database size={14} />
                            {t('settings.ai.context_add_table', 'Database')}
                        </button>
                    </div>
                </div>
            ) : null}

            {picking && picking !== 'vault' ? (
                <div style={{
                    background: 'var(--settings-bg)',
                    border: '1px solid var(--settings-border)',
                    borderRadius: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    padding: '10px',
                }}>
                    {picking === 'internal' && (!query.trim() || 'vault'.includes(query.trim().toLowerCase())) ? (
                        <button style={ADD_BUTTON_STYLE} type="button" onClick={() => { togglePicker('vault'); }}>
                            <Layers size={14} />
                            <span style={{ textAlign: 'left' }}>
                                <strong>Vault</strong>
                                <span style={{ display: 'block', fontSize: '0.8rem' }}>
                                    {t('settings.ai.context_vault_description', 'Pages and databases in the active vault.')}
                                </span>
                            </span>
                        </button>
                    ) : null}
                    <input
                        autoFocus
                        className="gnosi-input"
                        onChange={(event) => {
                            setQuery(event.target.value);
                        }}
                        placeholder={t('settings.ai.context_search_placeholder', 'Search...')}
                        value={query}
                    />
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        maxHeight: '180px',
                        overflowY: 'auto',
                    }}>
                        {visibleOptions === null ? (
                            <span style={{
                                color: 'var(--text-tertiary)',
                                fontSize: '0.82rem',
                                padding: '10px',
                            }}>
                                {t('common.loading', 'Loading...')}
                            </span>
                        ) : null}
                        {visibleOptions?.length === 0 && !(picking === 'internal' && (!query.trim() || 'vault'.includes(query.trim().toLowerCase()))) ? (
                            <span style={{
                                color: 'var(--text-tertiary)',
                                fontSize: '0.82rem',
                                padding: '10px',
                            }}>
                                {t('settings.ai.context_no_results', 'No results.')}
                            </span>
                        ) : null}
                        {visibleOptions?.map((item) => {
                            const label = picking === 'internal'
                                ? internalSourceLabel(t, item.id, item.label)
                                : item.label;
                            return (
                                <button
                                    className="hover-bg"
                                    key={item.id}
                                    onClick={() => {
                                        onAdd(picking, item.id, label, item.scope);
                                        onPickingChange(null);
                                        setQuery('');
                                    }}
                                    style={{
                                        alignItems: 'center',
                                        background: 'none',
                                        border: 'none',
                                        borderRadius: '10px',
                                        color: 'var(--text-primary)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        fontSize: '0.85rem',
                                        gap: '8px',
                                        padding: '8px 10px',
                                        textAlign: 'left',
                                    }}
                                    type="button"
                                >
                                    <Plus size={13} />
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </>
    );
}
