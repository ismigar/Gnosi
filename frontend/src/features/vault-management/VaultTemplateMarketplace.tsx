import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import '../settings/styles/settings-controls.css';
import '../../shared/styles/base/buttons.css';
import { SettingsSectionTabs } from '../../shared/ui/settings/SettingsSectionTabs';
import './VaultTemplateMarketplace.css';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { GnosiToggle } from '../../shared/ui/settings/SettingsPrimitives';
import { VaultTemplatePrivacyPreview } from './VaultTemplatePrivacyPreview';
import {
    AlertTriangle, CheckCircle2, Download, FileArchive, Loader,
    PackagePlus, Send, ShieldCheck, Store, X,
} from 'lucide-react';
import { useModalKeyboard } from '../../shared/hooks/useModalKeyboard';
import {
    createVaultFromTemplate,
    downloadVaultTemplate,
    fetchVaultTemplateCatalog,
    fetchVaultTemplateExportPreview,
    submitVaultTemplate,
    type VaultTemplateExportInput,
    type VaultTemplateExportPreview,
} from '../../shared/api/vault-templates';

const inputStyle: CSSProperties = {
    width: '100%', padding: '9px 11px', borderRadius: 9,
    border: '1px solid var(--settings-border)',
    background: 'var(--bg-primary)', color: 'var(--text-primary)',
};

interface MarketplaceVault {
    readonly active?: boolean;
    readonly id: string;
    readonly name: string;
}


interface CatalogTemplate {
    readonly author?: string;
    readonly categories: readonly string[];
    readonly languages: readonly string[];
    readonly preview: string;
    readonly description: string;
    readonly id: string;
    readonly name: string;
    readonly version: string;
}


export interface VaultTemplateMarketplaceProps {
    readonly initialSection?: MarketplaceSection;
    readonly onClose: () => unknown;
    readonly onCreated?: () => unknown;
    readonly vaults: readonly MarketplaceVault[];
}


type MarketplaceSection = 'catalog' | 'publish';


function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function catalogTemplates(values: readonly unknown[]): CatalogTemplate[] {
    return values.flatMap((value) => {
        if (!isUnknownRecord(value)
            || typeof value.id !== 'string'
            || typeof value.name !== 'string'
            || typeof value.version !== 'string') return [];
        const item: CatalogTemplate = {
            categories: Array.isArray(value.categories) ? value.categories.filter((v): v is string => typeof v === 'string') : [],
            languages: Array.isArray(value.languages) ? value.languages.filter((v): v is string => typeof v === 'string') : [],
            preview: typeof value.preview === 'string' ? value.preview : '',
            description: typeof value.description === 'string' ? value.description : '',
            id: value.id,
            name: value.name,
            version: value.version,
        };
        if (typeof value.author === 'string' && value.author) {
            return [{ ...item, author: value.author }];
        }
        return [item];
    });
}


function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function slugify(value: unknown): string {
    const source = typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
        ? String(value)
        : '';
    return source
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'vault-template';
}

function requestErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

export default function VaultTemplateMarketplace({
    vaults,
    initialSection = 'catalog',
    onClose,
    onCreated,
}: VaultTemplateMarketplaceProps) {
    const { t } = useTranslation();
    const localized = (item: CatalogTemplate, field: 'name' | 'description' | 'preview'): string =>
        t(`vault_templates.catalog_${item.id}_${field}`, { defaultValue: item[field] });
    const [section, setSection] = useState(initialSection);
    const [catalog, setCatalog] = useState<CatalogTemplate[]>([]);
    const [catalogError, setCatalogError] = useState('');
    const [catalogRevision, setCatalogRevision] = useState(0);
    const [catalogLoading, setCatalogLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('');
    const [previewRevision, setPreviewRevision] = useState(0);
    const categories = [...new Set(catalog.flatMap((item) => item.categories))].sort();
    const visibleCatalog = catalog.filter((item) => (!category || item.categories.includes(category))
        && `${localized(item, 'name')} ${localized(item, 'description')} ${item.languages.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const [submissionConfigured, setSubmissionConfigured] = useState(false);
    const [selected, setSelected] = useState<CatalogTemplate | null>(null);
    const [newName, setNewName] = useState('');
    const [preview, setPreview] = useState<VaultTemplateExportPreview | null>(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const dialogRef = useRef<HTMLDivElement>(null);
    const activeVault = useMemo(() => vaults.find((vault) => vault.active), [vaults]);
    const [form, setForm] = useState<VaultTemplateExportInput>(() => ({
        acknowledgeFindings: false,
        author: '',
        categories: [],
        description: '',
        id: slugify(activeVault?.name),
        languages: [],
        license: 'CC-BY-4.0',
        minGnosiVersion: '',
        name: activeVault?.name || '',
        preview: '',
        recommendedPlugins: [],
        version: '1.0.0',
    }));

    useModalKeyboard({ isOpen: true, onClose, containerRef: dialogRef, trapFocus: true });

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        fetchVaultTemplateCatalog(controller.signal).then((data) => {
            if (cancelled) return;
            setCatalog(catalogTemplates(data.templates));
            setCatalogError(data.unavailable || '');
            setSubmissionConfigured(data.submissionConfigured);
            setSelected(null);
        }).catch((requestError: unknown) => {
            if (!cancelled) setCatalogError(requestErrorMessage(requestError, t('vault_templates.catalog_unavailable')));
        }).finally(() => { if (!cancelled) setCatalogLoading(false); });
        return () => { cancelled = true; controller.abort(); };
    }, [catalogRevision, t]);

    useEffect(() => {
        if (section !== 'publish' || !activeVault || preview) return;
        const controller = new AbortController();
        const isCancelled = (): boolean => controller.signal.aborted;
        const loadPreview = async (): Promise<void> => {
            await Promise.resolve();
            if (isCancelled()) return;
            setBusy('preview');
            try {
                const data = await fetchVaultTemplateExportPreview(
                    activeVault.id,
                    controller.signal,
                );
                if (isCancelled()) return;
                setPreview(data);
            } catch (requestError) {
                if (isCancelled()) return;
                setError(requestErrorMessage(
                    requestError,
                    t('vault_templates.preview_error'),
                ));
            } finally {
                if (!isCancelled()) setBusy('');
            }
        };
        void loadPreview();
        return () => {
            controller.abort();
        };
    }, [activeVault, preview, previewRevision, section, t]);

    const createFromTemplate = async (): Promise<void> => {
        if (!selected || !newName.trim()) return;
        setBusy('create'); setError(''); setSuccess('');
        try {
            await createVaultFromTemplate({
                name: newName.trim(),
                template_id: selected.id,
                version: selected.version,
            });
            setSuccess(t('vault_templates.created'));
            await onCreated?.();
        } catch (requestError) {
            setError(requestErrorMessage(requestError, t('vault_templates.create_error')));
        } finally {
            setBusy('');
        }
    };

    const exportTemplate = async (): Promise<void> => {
        if (!activeVault) return;
        setBusy('export'); setError(''); setSuccess('');
        try {
            const blob = await downloadVaultTemplate(activeVault.id, form);
            downloadBlob(blob, `${form.id}-${form.version}.gnosi-vault.zip`);
            setSuccess(t('vault_templates.exported'));
        } catch (requestError) {
            setError(requestErrorMessage(requestError, t('vault_templates.export_error')));
        } finally {
            setBusy('');
        }
    };

    const submitTemplate = async (): Promise<void> => {
        if (!activeVault) return;
        setBusy('submit'); setError(''); setSuccess('');
        try {
            await submitVaultTemplate(activeVault.id, form);
            setSuccess(t('vault_templates.submitted'));
        } catch (requestError) {
            setError(requestErrorMessage(requestError, t('vault_templates.submit_error')));
        } finally {
            setBusy('');
        }
    };

    const findingsBlocked = Boolean(preview?.findings.length) && !form.acknowledgeFindings;
    const update = <Key extends keyof VaultTemplateExportInput,>(
        key: Key,
        value: VaultTemplateExportInput[Key],
    ): void => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    return (
        <div className="vault-template-modal" role="presentation">
            <div ref={dialogRef} className="vault-template-modal__content" role="dialog" aria-modal="true" aria-labelledby="vault-template-title">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <Store size={20} />
                    <h2 id="vault-template-title" style={{ margin: 0, flex: 1 }}>{t('vault_templates.title')}</h2>
                    <button type="button" onClick={onClose} aria-label={t('common.close')} className="vault-template-modal__close" data-autofocus><X size={18} /></button>
                </div>

                <SettingsSectionTabs ariaLabel={t('vault_templates.title')} activeId={section}
                    items={[
                        { id: 'catalog', icon: Store, label: t('vault_templates.catalog_tab') },
                        { id: 'publish', icon: PackagePlus, label: t('vault_templates.publish_tab') },
                    ]}
                    onChange={(id) => { if (id === 'catalog' || id === 'publish') setSection(id); }} />

                {error && <div className="vault-template-notice is-error">{error}</div>}
                {success && <div className="vault-template-notice is-success"><CheckCircle2 size={15} /> {success}</div>}

                {section === 'catalog' && (
                    <div>
                        <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>{t('vault_templates.catalog_description')}</p>
                        {catalogError && <div className="vault-template-notice"><AlertTriangle size={15} /> {catalogError}</div>}
                        <div className="template-catalog-tools">
                            <label className="template-search"><span className="settings-label">{t('vault_templates.search_catalog')}</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} /></label>
                            <label className="template-search"><span className="settings-label">{t('vault_templates.category')}</span><select value={category} onChange={(event) => { setCategory(event.target.value); setSelected(null); }}><option value="">{t('vault_templates.all_categories')}</option>{categories.map((value) => <option key={value} value={value}>{t(`vault_templates.category_${value}`, { defaultValue: value })}</option>)}</select></label>
                            <RefreshButton loading={catalogLoading} onClick={() => { setCatalogLoading(true); setCatalogRevision((value) => value + 1); }} />
                        </div>
                        {catalogLoading && <p role="status">{t('vault_templates.loading_catalog')}</p>}
                        {!catalogLoading && !catalogError && visibleCatalog.length === 0 && <div style={{ color: 'var(--text-tertiary)', padding: 20 }}>{t(catalog.length ? 'vault_templates.no_matching_templates' : 'vault_templates.catalog_empty')}</div>}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
                            {visibleCatalog.map((item) => (
                                <button key={`${item.id}:${item.version}`} type="button" onClick={() => { setSelected(item); setNewName(localized(item, 'name')); }}
                                    style={{ textAlign: 'left', padding: 14, borderRadius: 12, cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: `1px solid ${selected?.id === item.id ? 'var(--gnosi-primary)' : 'var(--settings-border)'}` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 750 }}>
                                        <FileArchive size={17} /> {localized(item, 'name')}
                                        <ShieldCheck size={14} style={{ marginLeft: 'auto', color: '#16a34a' }} />
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 5 }}>{localized(item, 'description')}</div>
                                    {item.preview && <div className="template-card-preview" aria-label={t('vault_templates.contents_preview')}>{localized(item, 'preview').split(' · ').slice(0, 4).map((line) => <div key={line}><FileArchive size={12} aria-hidden="true" /><span>{line}</span></div>)}</div>}
                                    <div className="template-catalog-tags">{item.languages.map((language) => <span key={language}>{language.toUpperCase()}</span>)}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>v{item.version}{item.author ? ` · ${item.author}` : ''}</div>
                                </button>
                            ))}
                        </div>
                        {selected && (
                            <div className="template-selection">
                            {selected.preview && <div className="template-content-preview"><h3>{t('vault_templates.contents_preview')}</h3><p>{localized(selected, 'preview')}</p></div>}
                            <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 18 }}>
                                <label style={{ flex: 1 }}><span className="settings-label">{t('vault_templates.new_name')}</span><input style={inputStyle} value={newName} onChange={(event) => {
                                    setNewName(event.target.value);
                                }} /></label>
                                <button type="button" className="btn-gnosi btn-gnosi-primary" onClick={() => {
                                    void createFromTemplate();
                                }} disabled={!newName.trim() || busy === 'create'}>
                                    {busy === 'create' ? <Loader size={14} className="animate-spin" /> : <PackagePlus size={14} />} {t('vault_templates.create')}
                                </button>
                            </div>
                            </div>
                        )}
                    </div>
                )}

                {section === 'publish' && (
                    <div>
                        {!activeVault && <div className="vault-template-notice is-error">{t('vault_templates.no_active_vault')}</div>}
                        {activeVault && (
                            <>
                                <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>{t('vault_templates.publish_description', { name: activeVault.name })}</p>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10 }}>
                                    <label><span className="settings-label">{t('vault_templates.name')}</span><input style={inputStyle} value={form.name} onChange={(event) => {
                                        update('name', event.target.value);
                                    }} /></label>
                                    <label><span className="settings-label">{t('vault_templates.version')}</span><input style={inputStyle} value={form.version} onChange={(event) => {
                                        update('version', event.target.value);
                                    }} /></label>
                                    <label><span className="settings-label">{t('vault_templates.identifier')}</span><input style={inputStyle} value={form.id} onChange={(event) => {
                                        update('id', slugify(event.target.value));
                                    }} /></label>
                                    <label><span className="settings-label">{t('vault_templates.license')}</span><input style={inputStyle} value={form.license} onChange={(event) => {
                                        update('license', event.target.value);
                                    }} /></label>
                                    <label style={{ gridColumn: '1 / -1' }}><span className="settings-label">{t('vault_templates.author')}</span><input style={inputStyle} value={form.author} onChange={(event) => {
                                        update('author', event.target.value);
                                    }} /></label>
                                    <label style={{ gridColumn: '1 / -1' }}><span className="settings-label">{t('vault_templates.description')}</span><textarea style={{ ...inputStyle, minHeight: 72 }} value={form.description} onChange={(event) => {
                                        update('description', event.target.value);
                                    }} /></label>
                                </div>

                                <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--settings-border)', borderRadius: 10 }}>
                                    <div className="template-section-heading"><strong>{t('vault_templates.privacy_preview')}</strong><RefreshButton disabled={Boolean(busy)} onClick={() => { setPreview(null); setError(''); update('acknowledgeFindings', false); setPreviewRevision((value) => value + 1); }} /></div>
                                    {busy === 'preview' && <Loader size={16} className="animate-spin" />}
                                    {preview && (
                                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)' }}>
                                            <span>{t('vault_templates.included_count', { count: preview.included.length })}</span>
                                            <span>{t('vault_templates.excluded_count', { count: preview.excluded.length })}</span>
                                            <span>{t('vault_templates.size', { size: (preview.totalSize / 1024 / 1024).toFixed(1) })}</span>
                                        </div>
                                    )}
                                    {preview && <VaultTemplatePrivacyPreview key={`${activeVault.id}:${String(previewRevision)}`} preview={preview} />}
                                    {preview && preview.findings.length > 0 && (
                                        <div className="template-findings-ack">
                                            <GnosiToggle active={form.acknowledgeFindings} onChange={() => { update('acknowledgeFindings', !form.acknowledgeFindings); }} label={t('vault_templates.findings_ack', { count: preview.findings.length })} />
                                            <span>{t('vault_templates.findings_ack', { count: preview.findings.length })}</span>
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                                    <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => {
                                        void exportTemplate();
                                    }} disabled={!preview || Boolean(busy) || findingsBlocked}>
                                        {busy === 'export' ? <Loader size={14} className="animate-spin" /> : <Download size={14} />} {t('vault_templates.download_package')}
                                    </button>
                                    <button type="button" className="btn-gnosi btn-gnosi-primary" onClick={() => {
                                        void submitTemplate();
                                    }} disabled={!preview || Boolean(busy) || findingsBlocked || !submissionConfigured} title={!submissionConfigured ? t('vault_templates.submission_not_configured') : ''}>
                                        {busy === 'submit' ? <Loader size={14} className="animate-spin" /> : <Send size={14} />} {t('vault_templates.submit')}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
