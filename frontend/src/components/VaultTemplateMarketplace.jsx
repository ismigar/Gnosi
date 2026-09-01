import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './VaultTemplateMarketplace.css';
import {
    AlertTriangle, CheckCircle2, Download, FileArchive, Loader,
    PackagePlus, Send, ShieldCheck, Store, X,
} from 'lucide-react';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import {
    createVaultFromTemplate,
    downloadVaultTemplate,
    fetchVaultTemplateCatalog,
    fetchVaultTemplateExportPreview,
    submitVaultTemplate,
} from '../shared/api/vault-templates';

const inputStyle = {
    width: '100%', padding: '9px 11px', borderRadius: 9,
    border: '1px solid var(--settings-border)',
    background: 'var(--bg-primary)', color: 'var(--text-primary)',
};

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function slugify(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'vault-template';
}

function requestErrorMessage(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
}

export default function VaultTemplateMarketplace({ vaults, initialSection = 'catalog', onClose, onCreated }) {
    const { t } = useTranslation();
    const [section, setSection] = useState(initialSection);
    const [catalog, setCatalog] = useState([]);
    const [catalogError, setCatalogError] = useState('');
    const [submissionConfigured, setSubmissionConfigured] = useState(false);
    const [selected, setSelected] = useState(null);
    const [newName, setNewName] = useState('');
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const dialogRef = useRef(null);
    const activeVault = useMemo(() => vaults.find((vault) => vault.active), [vaults]);
    const [form, setForm] = useState(() => ({
        id: slugify(activeVault?.name),
        version: '1.0.0',
        name: activeVault?.name || '',
        description: '',
        author: '',
        license: 'CC-BY-4.0',
        categories: [],
        languages: [],
        recommendedPlugins: [],
        acknowledgeFindings: false,
    }));

    useModalKeyboard({ isOpen: true, onClose, containerRef: dialogRef, trapFocus: true });

    useEffect(() => {
        let cancelled = false;
        fetchVaultTemplateCatalog().then((data) => {
            if (cancelled) return;
            setCatalog(data?.templates || []);
            setCatalogError(data?.unavailable || '');
            setSubmissionConfigured(Boolean(data?.submissionConfigured));
        }).catch((requestError) => {
            if (!cancelled) setCatalogError(requestErrorMessage(requestError, t('vault_templates.catalog_unavailable')));
        });
        return () => { cancelled = true; };
    }, [t]);

    useEffect(() => {
        if (section !== 'publish' || !activeVault || preview) return;
        setBusy('preview');
        fetchVaultTemplateExportPreview(activeVault.id)
            .then((data) => setPreview(data))
            .catch((requestError) => setError(requestErrorMessage(requestError, t('vault_templates.preview_error'))))
            .finally(() => setBusy(''));
    }, [activeVault, preview, section, t]);

    const createFromTemplate = async () => {
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

    const exportTemplate = async () => {
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

    const submitTemplate = async () => {
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

    const findingsBlocked = Boolean(preview?.findings?.length) && !form.acknowledgeFindings;
    const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

    return (
        <div className="vault-template-modal" role="presentation">
            <div ref={dialogRef} className="vault-template-modal__content" role="dialog" aria-modal="true" aria-labelledby="vault-template-title">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <Store size={20} />
                    <h2 id="vault-template-title" style={{ margin: 0, flex: 1 }}>{t('vault_templates.title')}</h2>
                    <button type="button" onClick={onClose} aria-label={t('common.close')} className="vault-template-modal__close" data-autofocus><X size={18} /></button>
                </div>

                <div className="settings-filter-tabs" role="tablist" style={{ marginBottom: 18 }}>
                    <button type="button" role="tab" aria-selected={section === 'catalog'} className={section === 'catalog' ? 'is-active' : ''} onClick={() => setSection('catalog')}>
                        <Store size={14} /> {t('vault_templates.catalog_tab')}
                    </button>
                    <button type="button" role="tab" aria-selected={section === 'publish'} className={section === 'publish' ? 'is-active' : ''} onClick={() => setSection('publish')}>
                        <PackagePlus size={14} /> {t('vault_templates.publish_tab')}
                    </button>
                </div>

                {error && <div className="vault-template-notice is-error">{error}</div>}
                {success && <div className="vault-template-notice is-success"><CheckCircle2 size={15} /> {success}</div>}

                {section === 'catalog' && (
                    <div>
                        <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>{t('vault_templates.catalog_description')}</p>
                        {catalogError && <div className="vault-template-notice"><AlertTriangle size={15} /> {catalogError}</div>}
                        {!catalogError && catalog.length === 0 && <div style={{ color: 'var(--text-tertiary)', padding: 20 }}>{t('vault_templates.catalog_empty')}</div>}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
                            {catalog.map((item) => (
                                <button key={`${item.id}:${item.version}`} type="button" onClick={() => { setSelected(item); setNewName(item.name); }}
                                    style={{ textAlign: 'left', padding: 14, borderRadius: 12, cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: `1px solid ${selected?.id === item.id ? 'var(--gnosi-primary)' : 'var(--settings-border)'}` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 750 }}>
                                        <FileArchive size={17} /> {item.name}
                                        <ShieldCheck size={14} style={{ marginLeft: 'auto', color: '#16a34a' }} />
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 5 }}>{item.description}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>v{item.version}{item.author ? ` · ${item.author}` : ''}</div>
                                </button>
                            ))}
                        </div>
                        {selected && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 18 }}>
                                <label style={{ flex: 1 }}><span className="settings-label">{t('vault_templates.new_name')}</span><input style={inputStyle} value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
                                <button type="button" className="btn-gnosi-primary" onClick={createFromTemplate} disabled={!newName.trim() || busy === 'create'}>
                                    {busy === 'create' ? <Loader size={14} className="animate-spin" /> : <PackagePlus size={14} />} {t('vault_templates.create')}
                                </button>
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
                                    <label><span className="settings-label">{t('vault_templates.name')}</span><input style={inputStyle} value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
                                    <label><span className="settings-label">{t('vault_templates.version')}</span><input style={inputStyle} value={form.version} onChange={(event) => update('version', event.target.value)} /></label>
                                    <label><span className="settings-label">{t('vault_templates.identifier')}</span><input style={inputStyle} value={form.id} onChange={(event) => update('id', slugify(event.target.value))} /></label>
                                    <label><span className="settings-label">{t('vault_templates.license')}</span><input style={inputStyle} value={form.license} onChange={(event) => update('license', event.target.value)} /></label>
                                    <label style={{ gridColumn: '1 / -1' }}><span className="settings-label">{t('vault_templates.author')}</span><input style={inputStyle} value={form.author} onChange={(event) => update('author', event.target.value)} /></label>
                                    <label style={{ gridColumn: '1 / -1' }}><span className="settings-label">{t('vault_templates.description')}</span><textarea style={{ ...inputStyle, minHeight: 72 }} value={form.description} onChange={(event) => update('description', event.target.value)} /></label>
                                </div>

                                <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--settings-border)', borderRadius: 10 }}>
                                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('vault_templates.privacy_preview')}</div>
                                    {busy === 'preview' && <Loader size={16} className="animate-spin" />}
                                    {preview && (
                                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)' }}>
                                            <span>{t('vault_templates.included_count', { count: preview.included?.length || 0 })}</span>
                                            <span>{t('vault_templates.excluded_count', { count: preview.excluded?.length || 0 })}</span>
                                            <span>{t('vault_templates.size', { size: ((preview.totalSize || 0) / 1024 / 1024).toFixed(1) })}</span>
                                        </div>
                                    )}
                                    {preview?.findings?.length > 0 && (
                                        <label style={{ display: 'flex', alignItems: 'start', gap: 8, marginTop: 10, color: '#b45309', fontSize: 12 }}>
                                            <input type="checkbox" checked={form.acknowledgeFindings} onChange={(event) => update('acknowledgeFindings', event.target.checked)} />
                                            <span>{t('vault_templates.findings_ack', { count: preview.findings.length })}</span>
                                        </label>
                                    )}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                                    <button type="button" className="btn-gnosi-secondary" onClick={exportTemplate} disabled={!preview || busy || findingsBlocked}>
                                        {busy === 'export' ? <Loader size={14} className="animate-spin" /> : <Download size={14} />} {t('vault_templates.download_package')}
                                    </button>
                                    <button type="button" className="btn-gnosi-primary" onClick={submitTemplate} disabled={!preview || busy || findingsBlocked || !submissionConfigured} title={!submissionConfigured ? t('vault_templates.submission_not_configured') : ''}>
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
