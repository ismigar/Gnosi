import { useState } from 'react';
import { AlertTriangle, FileArchive, ShieldCheck } from 'lucide-react';
import { SettingsSectionTabs } from '../../shared/ui/settings/SettingsSectionTabs';
import { useTranslation } from 'react-i18next';
import type { VaultTemplateExportPreview } from '../../shared/api/vault-templates';

const PAGE_SIZE = 100;
const sections = ['findings', 'included', 'excluded'] as const;
type Section = typeof sections[number];

/** Only display paths and finding categories, never the suspected secret itself. */
export function VaultTemplatePrivacyPreview({ preview }: { readonly preview: VaultTemplateExportPreview }) {
    const { t } = useTranslation();
    const [section, setSection] = useState<Section>(preview.findings.length ? 'findings' : 'included');
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(PAGE_SIZE);
    const rows = preview[section].filter((row) => typeof row.path === 'string'
        && row.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return <div className="template-privacy-details">
        <p>{t('vault_templates.privacy_help')}</p>
        <SettingsSectionTabs ariaLabel={t('vault_templates.privacy_preview')} activeId={section}
            items={sections.map((key) => ({ id: key, icon: key === 'findings' ? AlertTriangle : key === 'included' ? FileArchive : ShieldCheck,
                label: <>{t(`vault_templates.files_${key}`)} ({preview[key].length})</> }))}
            onChange={(id) => { if (id === 'findings' || id === 'included' || id === 'excluded') { setSection(id); setLimit(PAGE_SIZE); } }} />
        <label className="template-search"><span className="settings-label">{t('vault_templates.search_files')}</span>
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} />
        </label>
        <div className="template-file-list" tabIndex={0} role="region" aria-label={t(`vault_templates.files_${section}`)}>
            {rows.length === 0 && <p>{t('vault_templates.no_files')}</p>}
            <ul>{rows.slice(0, limit).map((row, index) => {
                const detail = section === 'findings' ? row.kind : row.reason;
                return <li key={`${String(row.path)}:${String(index)}`}>
                    <span className="template-file-path">{String(row.path)}</span>
                    <span className="template-file-detail">{section === 'included'
                        ? `${(Number(row.size || 0) / 1024).toFixed(1)} KB`
                        : t(`vault_templates.privacy_reason_${typeof detail === 'string' ? detail : 'unknown'}`, { defaultValue: t('vault_templates.privacy_reason_unknown') })}</span>
                </li>;
            })}</ul>
        </div>
        {rows.length > limit && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { setLimit(limit + PAGE_SIZE); }}>
            {t('vault_templates.show_more')}
        </button>}
    </div>;
}
