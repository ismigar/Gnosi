import { Download, Puzzle, Search, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SELECT_STYLE } from './pluginSettingsModel';
import type { ThirdPartyPluginsController } from './thirdPartyModel';

interface PluginCatalogGalleryProps {
    readonly controller: ThirdPartyPluginsController;
}

export function PluginCatalogGallery({ controller }: PluginCatalogGalleryProps) {
    const { t } = useTranslation();
    const tp = (key: string): string => t(`settings.plugins.${key}`);
    const normalizedSearch = controller.catalogSearch.trim().toLocaleLowerCase();
    const visible = controller.gallery.filter((entry) => {
        const matchesSource = controller.catalogSource === 'all'
            || (controller.catalogSource === 'official' ? entry.source === 'bundled' : entry.source === 'url');
        const haystack = `${entry.name ?? ''} ${entry.description ?? ''} ${entry.author ?? ''}`.toLocaleLowerCase();
        return matchesSource && (!normalizedSearch || haystack.includes(normalizedSearch));
    });

    return (
        <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                <label style={{ flex: '1 1 240px', position: 'relative' }}>
                    <Search size={15} style={{ color: 'var(--text-tertiary)', left: 10, position: 'absolute', top: 10 }} />
                    <input type="search" value={controller.catalogSearch} onChange={(event) => { controller.setCatalogSearch(event.target.value); }} placeholder={tp('catalog_search_placeholder')} style={{ ...SELECT_STYLE, paddingLeft: 32 }} />
                </label>
                <select value={controller.catalogSource} onChange={(event) => { controller.setCatalogSource(event.target.value); }} style={{ ...SELECT_STYLE, width: 170 }}>
                    <option value="all">{tp('catalog_source_all')}</option>
                    <option value="official">{tp('catalog_source_official')}</option>
                    <option value="community">{tp('catalog_source_community')}</option>
                </select>
            </div>
            {visible.length > 0 && (
                <div style={{ marginTop: 22 }}>
                    <div style={{ alignItems: 'center', display: 'flex', gap: 8, marginBottom: 8 }}>
                        <Download size={16} /><h4 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{tp('gallery')}</h4>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {visible.map((entry) => (
                            <div key={entry.id} style={{ alignItems: 'center', background: 'var(--bg-primary, #fff)', border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 10, display: 'flex', gap: 12, padding: '10px 14px' }}>
                                <Puzzle size={16} style={{ color: '#6366f1', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ alignItems: 'center', color: 'var(--text-primary, #0f172a)', display: 'flex', fontSize: 13, fontWeight: 600, gap: 6 }}>
                                        {entry.name}
                                        {entry.signed && <span title={tp('signed_tip')} style={{ alignItems: 'center', color: '#16a34a', display: 'inline-flex', fontSize: 10, fontWeight: 600, gap: 3 }}><ShieldCheck size={12} /> {tp('signed')}</span>}
                                        {entry.source === 'url' && !entry.signed && <span title={tp('unsigned_tip')} style={{ color: '#d97706', fontSize: 10, fontWeight: 600 }}>{tp('not_verified')}</span>}
                                    </div>
                                    <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>{entry.description}</div>
                                </div>
                                {entry.installed ? (
                                    <span style={{ color: '#16a34a', flexShrink: 0, fontSize: 12, fontWeight: 600 }}>{tp('installed')}</span>
                                ) : (
                                    <button type="button" onClick={() => { void controller.installFromCatalog(entry.id); }} disabled={controller.busy === `cat:${entry.id}`} style={{ alignItems: 'center', background: 'var(--bg-secondary, #f8fafc)', border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 8, color: 'var(--text-primary, #0f172a)', display: 'flex', flexShrink: 0, fontSize: 12, fontWeight: 600, gap: 6, padding: '6px 10px' }}>
                                        <Download size={14} /> {controller.busy === `cat:${entry.id}` ? tp('installing') : tp('install')}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {!controller.loading && visible.length === 0 && <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: 18, textAlign: 'center' }}>{tp('catalog_empty')}</div>}
        </>
    );
}
