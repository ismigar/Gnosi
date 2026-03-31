import React, { useState, useEffect } from 'react';
import { X, Globe, Palette, RefreshCw, Info, ExternalLink, Monitor, BookOpen, Save, Check, FolderOpen, Database, Cpu, Clock, Zap, Settings as SettingsIcon, Sliders, Calendar, Share2, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FolderPickerModal } from './FolderPickerModal';
import axios from 'axios';

const LANGUAGES = [
    { code: 'ca', label: 'Català', icon: '🏴󠁥󠁳󠁣󠁡󠁿' },
    { code: 'es', label: 'Español', icon: '🇪🇸' },
    { code: 'en', label: 'English', icon: '🇬🇧' },
    { code: 'fr', label: 'Français', icon: '🇫🇷' },
];

const THEME_OPTIONS = [
    { id: 'light', labelKey: 'theme_light', previewClass: 'settings-theme-preview--light', disabled: false },
    { id: 'dark', labelKey: 'theme_dark', previewClass: 'settings-theme-preview--dark', disabled: false },
    { id: 'system', labelKey: 'theme_system', icon: Monitor, disabled: false },
];


function getStoredTheme() {
    return localStorage.getItem('db-theme') || 'system';
}

export function GlobalSettingsModal({ isOpen, onClose, initialTab = 'general' }) {
    const { t, i18n } = useTranslation();
    const [syncing, setSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState('');
    const [theme, setTheme] = useState(getStoredTheme);
    const [zoteroConfig, setZoteroConfig] = useState(null);
    const [zoteroTables, setZoteroTables] = useState([]);
    const [zoteroFields, setZoteroFields] = useState([]);
    const [zoteroSyncing, setZoteroSyncing] = useState(false);
    const [zoteroSaveStatus, setZoteroSaveStatus] = useState('');
    const [databases, setDatabases] = useState([]);
    const [tables, setTables] = useState([]);

    const [integrations, setIntegrations] = useState({});
    const [integrationSaveStatus, setIntegrationSaveStatus] = useState('');
    const [googleAuthConfigured, setGoogleAuthConfigured] = useState(false);

    const [activeTab, setActiveTab] = useState(initialTab);
    const [fullConfig, setFullConfig] = useState(null);
    const [localSettings, setLocalSettings] = useState({
        language: '',
        timezone: '',
        currency: '',
        week_start: 1,
        use_system_defaults: true
    });
    const [calendarWizard, setCalendarWizard] = useState(null); // { step: 'ask_email' | 'configure', email: '', provider: 'google' | 'icloud' | 'custom' }
    const [emailWizard, setEmailWizard] = useState(null); // { step: 'ask_email' | 'configure', email: '', provider: 'google' | 'icloud' | 'pangea' | 'custom' }
    const [localPaths, setLocalPaths] = useState({
        vault: '',
        databases: '',
        newsletters: ''
    });
    const [graphConfig, setGraphConfig] = useState({
        visible_databases: [],
        visible_tables: [],
        visible_fields: [],
        graph_table_filters: [],
        show_arrows: true,
        label_threshold: 10,
        node_size: 1.0,
        edge_thickness: 1.0,
        physics: {
            gravity: 0.1,
            repulsion: 1000,
            friction: 10,
            edge_influence: 0,
            lin_log_mode: false
        }
    });
    const [schedulers, setSchedulers] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState('');

    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerField, setPickerField] = useState(null); // 'vault', 'databases', 'newsletters'

    // Theme application is now handled globally in App.jsx via db-theme-changed event
    const handleThemeChange = (newTheme) => {
        setTheme(newTheme);
        localStorage.setItem('db-theme', newTheme);
        window.dispatchEvent(new Event('db-theme-changed'));
    };

    useEffect(() => {
        if (isOpen) {
            loadConfig();
            loadZoteroData();
            loadSchedulers();
            loadIntegrations();

            // Check Google Auth Status
            fetch('/api/auth/google/status')
                .then(res => res.json())
                .then(data => setGoogleAuthConfigured(data.configured))
                .catch(err => console.error("Error checking Google Auth status:", err));
        }
    }, [isOpen]);

    useEffect(() => {
        setActiveTab(initialTab);
    }, [initialTab]);

    const loadIntegrations = async () => {
        try {
            const res = await fetch('/api/integrations');
            if (res.ok) {
                setIntegrations(await res.json());
            }
        } catch (err) {
            console.error("Error loading integrations:", err);
        }
    };

    const loadConfig = async () => {
        try {
            const res = await fetch('/api/config');
            if (res.ok) {
                const cfg = await res.json();
                console.log("Config carregada del búnquer:", cfg);
                setFullConfig(cfg);
                if (cfg.settings) setLocalSettings(prev => ({ ...prev, ...cfg.settings }));
                if (cfg.paths) {
                    console.log("Rutes detectades:", cfg.paths);
                    setLocalPaths(prev => ({ ...prev, ...cfg.paths }));
                }
                if (cfg.graph) setGraphConfig(prev => ({ ...prev, ...cfg.graph }));
            }
        } catch (err) {
            console.error("Error loading config:", err);
        }
    };

    const loadSchedulers = async () => {
        try {
            const res = await fetch('/api/schedulers');
            if (res.ok) {
                setSchedulers(await res.json());
            }
        } catch (err) {
            console.error("Error loading schedulers:", err);
        }
    };

    const loadZoteroData = async () => {
        try {
            const [cRes, tRes, fRes, dRes] = await Promise.all([
                fetch('/api/zotero/config'),
                fetch('/api/zotero/tables'),
                fetch('/api/zotero/fields'),
                fetch('/api/vault/databases')
            ]);
            if (cRes.ok) {
                const config = await cRes.json();
                if (!config.mapping) config.mapping = {};
                setZoteroConfig(config);
            }
            if (tRes.ok) setZoteroTables(await tRes.json());
            if (fRes.ok) setZoteroFields(await fRes.json());
            if (dRes.ok) setDatabases(await dRes.json());

            // Fetch all vault tables for calendar selection
            const vtRes = await fetch('/api/vault/tables');
            if (vtRes.ok) setTables(await vtRes.json());
        } catch (err) {
            console.error("Error loading Zotero data:", err);
        }
    };

    if (!isOpen) return null;

    const handleLanguageChange = (code) => {
        i18n.changeLanguage(code);
        setLocalSettings(prev => ({ ...prev, language: code }));
    };

    const handleSaveGlobal = async () => {
        setIsSaving(true);
        setSaveStatus(t('Saving...'));
        try {
            const updatedConfig = {
                ...fullConfig,
                settings: { ...localSettings },
                paths: { ...localPaths },
                graph: { ...graphConfig }
            };

            console.log("Configurant dades per desar:", updatedConfig);

            // preparem totes les promeses per guardar en paral·lel
            const savePromises = [
                // 1. Guardar configuració principal
                fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedConfig)
                }),
                // 2. Guardar totes les integracions en bloc
                fetch('/api/integrations/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(integrations)
                })
            ];

            // 3. Guardar configuració de Zotero si cal
            if (zoteroConfig) {
                savePromises.push(
                    fetch('/api/zotero/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(zoteroConfig)
                    })
                );
            }

            const results = await Promise.all(savePromises);
            const allOk = results.every(res => res.ok);

            if (!allOk) {
                setSaveStatus(t('Error saving settings'));
                setIsSaving(false);
                return;
            }

            setSaveStatus(t('Saved!'));
            setFullConfig(updatedConfig);

            setTimeout(() => {
                setSaveStatus('');
                window.location.reload();
            }, 1000);

        } catch (err) {
            console.error("Error al guardar:", err);
            setSaveStatus(t('Connection error'));
        } finally {
            setIsSaving(false);
        }
    };




    const handleSync = async () => {
        if (syncing) return;
        setSyncing(true);
        setSyncMessage('');
        try {
            const res = await fetch('/api/sync', { method: 'POST' });
            if (res.status === 429) {
                setSyncMessage(t('Syncing already in progress...'));
            } else if (res.ok) {
                setSyncMessage(t('Synchronization completed!'));
            } else {
                setSyncMessage(t('Error synchronizing'));
            }
        } catch {
            setSyncMessage(t('Could not connect'));
        } finally {
            setSyncing(false);
        }
    };

    // handleZoteroSave removed as part of save unification


    const handleZoteroSync = async () => {
        if (zoteroSyncing) return;
        setZoteroSyncing(true);
        try {
            const res = await fetch('/api/zotero/sync', { method: 'POST' });
            if (res.ok) {
                alert(t('Zotero sync started!'));
            } else {
                alert(t('Error starting sync'));
            }
        } catch (err) {
            alert(t('Connection error'));
        } finally {
            setZoteroSyncing(false);
        }
    };

    // handleIntegrationSave removed as part of save unification


    const handleAddIntegrationItem = (type) => {
        setIntegrations(prev => {
            const currentList = Array.isArray(prev[type]) ? prev[type] : [];
            return { ...prev, [type]: [...currentList, { id: 'new_' + Date.now().toString() + Math.random().toString(36).substring(2, 9) }] };
        });
    };

    const handleRemoveIntegrationItem = (type, index) => {
        setIntegrations(prev => {
            const currentList = Array.isArray(prev[type]) ? prev[type] : [];
            const newList = [...currentList];
            newList.splice(index, 1);
            return { ...prev, [type]: newList };
        });
    };

    const handleUpdateIntegrationItem = (type, index, field, value) => {
        setIntegrations(prev => {
            const list = [...(prev[type] || [])];
            list[index] = { ...list[index], [field]: value };
            return { ...prev, [type]: list };
        });
    };

    // Helper to get properties for the current selected table
    const getAvailableProperties = () => {
        if (!zoteroConfig?.target_table || !zoteroTables?.length) return [];
        const selectedTable = zoteroTables.find(t => t.id === zoteroConfig.target_table);
        return selectedTable?.properties || [];
    };

    const availableProperties = getAvailableProperties();

    if (!isOpen) return null;

    const tabs = [
        { id: 'general', label: t('General'), icon: Settings },
        { id: 'integrations', label: t('Integrations'), icon: Share2 },
        { id: 'calendar', label: t('Calendar'), icon: Calendar },
        { id: 'graph', label: t('Graph'), icon: Sliders },
        { id: 'notion', label: t('Notion'), icon: Database },
        { id: 'zotero', label: t('Zotero'), icon: BookOpen },
        { id: 'schedulers', label: t('Scheduled Tasks'), icon: Clock },
        { id: 'ai', label: t('AI'), icon: Cpu },
    ];

    return (
        <>
            <div className="settings-overlay" onClick={onClose} style={{ zIndex: 500 }}>
                <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ zIndex: 501 }}>
                    {/* Header */}
                    <div className="settings-modal__header" style={{
                        background: 'var(--settings-header-bg)',
                        borderBottom: '1px solid var(--settings-border)',
                        padding: '16px 20px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <h2 className="settings-modal__title" style={{ color: 'var(--settings-title)', margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <SettingsIcon size={20} />
                            {t('settings_title')}
                        </h2>
                        <button className="settings-modal__close" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                            <X size={20} />
                        </button>
                    </div>

                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                        {/* Sidebar Tabs */}
                        <div className="settings-sidebar" style={{
                            width: '220px',
                            borderRight: '1px solid var(--settings-border)',
                            padding: '20px 12px',
                            background: 'var(--settings-sidebar-bg)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px'
                        }}>
                            {tabs.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '12px 14px',
                                        border: 'none',
                                        borderRadius: '10px',
                                        background: activeTab === tab.id ? 'var(--settings-sidebar-active)' : 'transparent',
                                        color: activeTab === tab.id ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontWeight: activeTab === tab.id ? '600' : '500',
                                        fontSize: '0.9rem',
                                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                                    }}
                                >
                                    <tab.icon size={18} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Content Area */}
                        <div className="settings-modal__content" style={{ flex: 1, overflowY: 'auto', padding: '25px', background: 'var(--settings-bg)' }}>

                            {activeTab === 'general' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                    {/* Language */}
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                            <Globe size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('language_label')}</h3>
                                        </div>
                                        <div>
                                            <select
                                                value={i18n.language?.split('-')[0] || 'ca'}
                                                onChange={(e) => handleLanguageChange(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '12px',
                                                    borderRadius: '8px',
                                                    border: '1px solid var(--settings-border)',
                                                    background: 'var(--settings-input-bg)',
                                                    color: 'var(--text-primary)',
                                                    fontSize: '0.95rem',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                {LANGUAGES.map(({ code, label, icon }) => (
                                                    <option key={code} value={code}>
                                                        {icon} {label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </section>

                                    {/* Theme */}
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                            <Palette size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('theme_label')}</h3>
                                        </div>
                                        <div className="settings-theme-row" style={{ display: 'flex', gap: '15px' }}>
                                            {THEME_OPTIONS.map(({ id, labelKey, icon: Icon, previewClass, disabled }) => (
                                                <button
                                                    key={id}
                                                    onClick={() => !disabled && handleThemeChange(id)}
                                                    disabled={disabled}
                                                    style={{
                                                        flex: 1,
                                                        padding: '15px',
                                                        borderRadius: '12px',
                                                        border: '2px solid',
                                                        borderColor: theme === id ? 'var(--gnosi-blue)' : 'var(--settings-border)',
                                                        background: theme === id ? 'var(--settings-sidebar-active)' : 'var(--settings-btn-bg)',
                                                        cursor: disabled ? 'not-allowed' : 'pointer',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        opacity: disabled ? 0.5 : 1,
                                                        transition: 'all 0.2s',
                                                        color: theme === id ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)',
                                                        boxShadow: theme === id ? '0 0 0 1px var(--gnosi-blue)' : 'none'
                                                    }}
                                                >
                                                    {Icon ? <Icon size={24} /> : <div className={`theme-preview ${id}`} style={{ width: '40px', height: '24px', borderRadius: '4px', background: id === 'dark' ? '#1e293b' : '#f8fafc', border: '1px solid var(--settings-border)' }} />}
                                                    <span style={{ fontSize: '0.85rem', fontWeight: theme === id ? '600' : '400' }}>{t(labelKey)}</span>
                                                </button>
                                            ))}

                                        </div>
                                    </section>

                                    {/* Storage Paths */}
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                            <FolderOpen size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('storage_paths_title')}</h3>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                            {[
                                                { id: 'vault', label: t('vault_path_label') }
                                            ].map(field => (
                                                <div key={field.id}>
                                                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                                                        {field.label}
                                                    </label>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <input
                                                            type="text"
                                                            value={localPaths[field.id] || ''}
                                                            onChange={(e) => setLocalPaths(prev => ({ ...prev, [field.id]: e.target.value }))}
                                                            style={{
                                                                flex: 1,
                                                                padding: '10px 12px',
                                                                borderRadius: '8px',
                                                                border: '1px solid var(--settings-border)',
                                                                background: 'var(--settings-input-bg)',
                                                                color: 'var(--text-primary)',
                                                                fontSize: '0.9rem'
                                                            }}
                                                        />
                                                        <button
                                                            onClick={() => { setPickerField(field.id); setPickerOpen(true); }}
                                                            style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-btn-bg)', cursor: 'pointer', color: 'var(--text-primary)' }}
                                                        >
                                                            <FolderOpen size={18} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                </div>
                            )}

                            {activeTab === 'integrations' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '-10px' }}>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('integration_intro_desc')}</p>
                                        {integrationSaveStatus && <span style={{ fontSize: '0.85rem', color: integrationSaveStatus.includes('✅') ? '#10b981' : '#ef4444', fontWeight: '500' }}>{integrationSaveStatus}</span>}
                                    </div>

                                    {/* Email Settings */}
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <RefreshCw size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('email_accounts_title')}</h3>
                                            </div>
                                            {!emailWizard && (
                                                <button onClick={() => setEmailWizard({ step: 'ask_email', email: '' })} style={{ padding: '6px 12px', borderRadius: '8px', background: 'var(--settings-sidebar-bg)', color: 'var(--text-primary)', border: '1px solid var(--settings-border)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}>+ {t('Add Account')}</button>
                                            )}
                                        </div>

                                        {emailWizard && (
                                            <div style={{ background: 'rgba(59, 130, 246, 0.05)', padding: '20px', borderRadius: '12px', border: '1px solid var(--gnosi-blue)', marginBottom: '20px' }}>
                                                {emailWizard.step === 'ask_email' ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                        <label style={{ fontSize: '0.9rem', fontWeight: '600' }}>{t('Enter email address')}</label>
                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                            <input
                                                                type="email"
                                                                autoFocus
                                                                placeholder="exemple@gmail.com, usuari@pangea.org..."
                                                                value={emailWizard.email}
                                                                onChange={(e) => setEmailWizard({ ...emailWizard, email: e.target.value })}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        const email = emailWizard.email.toLowerCase();
                                                                        let provider = 'custom';
                                                                        if (email.includes('gmail.com')) provider = 'google';
                                                                        else if (email.includes('icloud.com') || email.includes('me.com')) provider = 'icloud';
                                                                        else if (email.includes('pangea.org') || email.includes('temenosismael.org')) provider = 'pangea';

                                                                        setEmailWizard({ ...emailWizard, step: 'configure', provider });
                                                                    }
                                                                }}
                                                                style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const email = emailWizard.email.toLowerCase();
                                                                    let provider = 'custom';
                                                                    if (email.includes('gmail.com')) provider = 'google';
                                                                    else if (email.includes('icloud.com') || email.includes('me.com')) provider = 'icloud';
                                                                    else if (email.includes('pangea.org') || email.includes('temenosismael.org')) provider = 'pangea';

                                                                    setEmailWizard({ ...emailWizard, step: 'configure', provider });
                                                                }}
                                                                disabled={!emailWizard.email}
                                                                style={{ padding: '10px 20px', borderRadius: '8px', background: 'var(--gnosi-blue)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: '600', opacity: emailWizard.email ? 1 : 0.5 }}
                                                            >
                                                                {t('Continue')}
                                                            </button>
                                                            <button onClick={() => setEmailWizard(null)} style={{ padding: '10px', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('Cancel')}</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ fontSize: '0.9rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                {emailWizard.provider === 'google' && <span style={{ fontSize: '1.2rem' }}>🌐</span>}
                                                                {emailWizard.provider === 'icloud' && <span style={{ fontSize: '1.2rem' }}>☁️</span>}
                                                                {emailWizard.provider === 'pangea' && <span style={{ fontSize: '1.2rem' }}>📧</span>}
                                                                {t('Configuring account')} {emailWizard.email}
                                                            </span>
                                                            <button onClick={() => setEmailWizard({ ...emailWizard, step: 'ask_email' })} style={{ fontSize: '0.8rem', color: 'var(--gnosi-blue)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('Change email')}</button>
                                                        </div>

                                                        {emailWizard.provider === 'google' && (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #4285F4' }}>
                                                                    <div style={{ fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <span style={{ fontSize: '1.2rem' }}>🌐</span> {t('Recommended: Connect directly')}
                                                                    </div>
                                                                    {t('Avoid manual configurations by connecting your account directly.')}
                                                                    {!googleAuthConfigured ? (
                                                                        <div style={{ marginTop: '12px', color: '#ef4444', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                                                            ⚠️ <strong>{t('Configuration required:')}</strong> {t('google_oauth_error_detailed')}
                                                                        </div>
                                                                    ) : (
                                                                        <div style={{ marginTop: '12px' }}>
                                                                            <button
                                                                                onClick={() => window.location.href = '/api/auth/google/login'}
                                                                                style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'white', color: '#3c4043', border: '1px solid #dadce0', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500', fontSize: '0.9rem' }}
                                                                            >
                                                                                <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84c-.21 1.12-.84 2.07-1.79 2.71v2.25h2.91c1.71-1.57 2.68-3.88 2.68-6.61z" fill="#4285F4" /><path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.25c-.81.54-1.85.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.92v2.33C2.41 16.03 5.46 18 9 18z" fill="#34A853" /><path d="M3.96 10.71c-.18-.54-.28-1.12-.28-1.71s.1-1.17.28-1.71V4.96H.92C.33 6.13 0 7.53 0 9s.33 2.87.92 4.04l3.04-2.33z" fill="#FBBC05" /><path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.8 11.43 0 9 0 5.46 0 2.41 1.97.92 4.96l3.04 2.33C4.67 5.16 6.66 3.58 9 3.58z" fill="#EA4335" /></svg>
                                                                                Sign in with Google
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                                                                    — {t('manual_or')} —
                                                                </div>
                                                            </div>
                                                        )}

                                                        {emailWizard.provider === 'icloud' && (
                                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)', padding: '10px', borderRadius: '8px', borderLeft: '4px solid #f59e0b', marginBottom: '15px', marginTop: '-5px' }}>
                                                                <strong>{t('Note:')}</strong> {t('icloud_app_password_note')}
                                                                <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noreferrer" style={{ color: 'var(--gnosi-blue)', marginLeft: '5px', textDecoration: 'underline' }}>{t('manage_apple_id')} <ExternalLink size={12} style={{ display: 'inline' }} /></a>
                                                            </div>
                                                        )}

                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t('IMAP Server')}</label>
                                                                <input
                                                                    type="text"
                                                                    id="email_wizard_imap"
                                                                    defaultValue={emailWizard.provider === 'google' ? 'imap.gmail.com' : (emailWizard.provider === 'icloud' ? 'imap.mail.me.com' : (emailWizard.provider === 'pangea' ? 'mail.pangea.org' : ''))}
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t('SMTP Server')}</label>
                                                                <input
                                                                    type="text"
                                                                    id="email_wizard_smtp"
                                                                    defaultValue={emailWizard.provider === 'google' ? 'smtp.gmail.com' : (emailWizard.provider === 'icloud' ? 'smtp.mail.me.com' : (emailWizard.provider === 'pangea' ? 'smtp.pangea.org' : ''))}
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </div>
                                                            <div style={{ gridColumn: 'span 2' }}>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t('Password / App Password')}</label>
                                                                <input
                                                                    type="password"
                                                                    id="email_wizard_password"
                                                                    placeholder="••••••••"
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </div>
                                                        </div>

                                                        <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                                                            <button
                                                                onClick={() => {
                                                                    const imap = document.getElementById('email_wizard_imap').value;
                                                                    const smtp = document.getElementById('email_wizard_smtp').value;
                                                                    const password = document.getElementById('email_wizard_password').value;

                                                                    if (!imap || !smtp || !password) {
                                                                        alert(t('all_fields_required'));
                                                                        return;
                                                                    }

                                                                    const newEmail = {
                                                                        id: 'new_mail_' + Date.now().toString(),
                                                                        username: emailWizard.email,
                                                                        imap_server: imap,
                                                                        smtp_server: smtp,
                                                                        password: password,
                                                                        provider: emailWizard.provider
                                                                    };

                                                                    setIntegrations(prev => ({
                                                                        ...prev,
                                                                        emails: [...(Array.isArray(prev.emails) ? prev.emails : []), newEmail]
                                                                    }));
                                                                    setEmailWizard(null);
                                                                }}
                                                                style={{ padding: '10px 20px', borderRadius: '8px', background: 'var(--gnosi-blue)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: '600' }}
                                                            >
                                                                {t('Add Account')}
                                                            </button>
                                                            <button onClick={() => setEmailWizard(null)} style={{ padding: '10px', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('Cancel')}</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                            {(integrations?.emails || []).map((account, index) => (
                                                <div key={account.id || index} style={{ background: 'rgba(0,0,0,0.02)', padding: '15px', borderRadius: '12px', border: '1px solid var(--settings-border)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                                        <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>{t('Account')} {index + 1} {account.password_status === 'connected' && <span style={{ fontSize: '0.75rem', background: '#10b98122', color: '#059669', padding: '2px 8px', borderRadius: '12px', marginLeft: '10px' }}>{t('Connected')} ✅</span>}</span>
                                                        <button onClick={() => handleRemoveIntegrationItem('emails', index)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>{t('Remove')}</button>
                                                    </div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('IMAP Server')}</label>
                                                            <input type="text" value={account.imap_server || ''} onChange={(e) => handleUpdateIntegrationItem('emails', index, 'imap_server', e.target.value)} placeholder="imap.gmail.com" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('SMTP Server')}</label>
                                                            <input type="text" value={account.smtp_server || ''} onChange={(e) => handleUpdateIntegrationItem('emails', index, 'smtp_server', e.target.value)} placeholder="smtp.gmail.com" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('Email Address')}</label>
                                                            <input type="email" value={account.username || ''} onChange={(e) => handleUpdateIntegrationItem('emails', index, 'username', e.target.value)} placeholder="nom@exemple.com" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('password_app_password')}</label>
                                                            <input type="password" placeholder={account.password_status === 'connected' ? t('password_hint_connected') : '••••••••'} onChange={(e) => handleUpdateIntegrationItem('emails', index, 'password', e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div style={{ gridColumn: 'span 2' }}>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('Signature (HTML)')}</label>
                                                            <textarea
                                                                value={account.html_signature || ''}
                                                                onChange={(e) => handleUpdateIntegrationItem('emails', index, 'html_signature', e.target.value)}
                                                                placeholder={t('signature_placeholder')}
                                                                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem', minHeight: '80px', fontFamily: 'monospace' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            {!(integrations?.emails?.length > 0) && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '10px' }}>{t('No email accounts configured. Click "Add Account" to start.')}</p>}
                                        </div>


                                    </section>

                                    {/* Calendar Settings */}
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ marginBottom: '15px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <Calendar size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('calendar_accounts_title')}</h3>
                                            </div>
                                        </div>
                                        {!calendarWizard && (
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '15px' }}>
                                                <button onClick={() => setCalendarWizard({ step: 'ask_email', email: '' })} style={{ padding: '6px 12px', borderRadius: '8px', background: 'var(--settings-sidebar-bg)', color: 'var(--text-primary)', border: '1px solid var(--settings-border)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}>+ {t('Add Calendar')}</button>
                                            </div>
                                        )}

                                        {calendarWizard && (
                                            <div style={{ background: 'rgba(59, 130, 246, 0.05)', padding: '20px', borderRadius: '12px', border: '1px solid var(--gnosi-blue)', marginBottom: '20px' }}>
                                                {calendarWizard.step === 'ask_email' ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                        <label style={{ fontSize: '0.9rem', fontWeight: '600' }}>{t('Enter email address or identifier')}</label>
                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                            <input
                                                                type="email"
                                                                autoFocus
                                                                placeholder="exemple@gmail.com, usuari@icloud.com..."
                                                                value={calendarWizard.email}
                                                                onChange={(e) => setCalendarWizard({ ...calendarWizard, email: e.target.value })}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        const email = calendarWizard.email.toLowerCase();
                                                                        let provider = 'custom';
                                                                        if (email.includes('gmail.com')) provider = 'google';
                                                                        else if (email.includes('icloud.com') || email.includes('me.com')) provider = 'icloud';

                                                                        setCalendarWizard({ ...calendarWizard, step: 'configure', provider });
                                                                    }
                                                                }}
                                                                style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const email = calendarWizard.email.toLowerCase();
                                                                    let provider = 'custom';
                                                                    if (email.includes('gmail.com')) provider = 'google';
                                                                    else if (email.includes('icloud.com') || email.includes('me.com')) provider = 'icloud';

                                                                    setCalendarWizard({ ...calendarWizard, step: 'configure', provider });
                                                                }}
                                                                disabled={!calendarWizard.email}
                                                                style={{ padding: '10px 20px', borderRadius: '8px', background: 'var(--gnosi-blue)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: '600', opacity: calendarWizard.email ? 1 : 0.5 }}
                                                            >
                                                                {t('Continue')}
                                                            </button>
                                                            <button onClick={() => setCalendarWizard(null)} style={{ padding: '10px', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('Cancel')}</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ fontSize: '0.9rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                {calendarWizard.provider === 'google' && <span style={{ fontSize: '1.2rem' }}>🌐</span>}
                                                                {calendarWizard.provider === 'icloud' && <span style={{ fontSize: '1.2rem' }}>☁️</span>}
                                                                {t('Configuring')} {calendarWizard.email} ({calendarWizard.provider})
                                                            </span>
                                                            <button onClick={() => setCalendarWizard({ ...calendarWizard, step: 'ask_email' })} style={{ fontSize: '0.8rem', color: 'var(--gnosi-blue)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('Change email')}</button>
                                                        </div>

                                                        {calendarWizard.provider === 'google' && (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #4285F4' }}>
                                                                    <div style={{ fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <span style={{ fontSize: '1.2rem' }}>🌐</span> {t('Recommended: Connect directly')}
                                                                    </div>
                                                                    {t('Avoid manual configurations calendars...')}
                                                                    {!googleAuthConfigured ? (
                                                                        <div style={{ marginTop: '12px', color: '#ef4444', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                                                            ⚠️ <strong>{t('Configuration required:')}</strong> {t('No Google OAuth credentials found.')}
                                                                        </div>
                                                                    ) : (
                                                                        <div style={{ marginTop: '12px' }}>
                                                                            <button
                                                                                onClick={() => window.location.href = '/api/auth/google/login'}
                                                                                style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'white', color: '#3c4043', border: '1px solid #dadce0', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500', fontSize: '0.9rem' }}
                                                                            >
                                                                                <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84c-.21 1.12-.84 2.07-1.79 2.71v2.25h2.91c1.71-1.57 2.68-3.88 2.68-6.61z" fill="#4285F4" /><path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.25c-.81.54-1.85.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.92v2.33C2.41 16.03 5.46 18 9 18z" fill="#34A853" /><path d="M3.96 10.71c-.18-.54-.28-1.12-.28-1.71s.1-1.17.28-1.71V4.96H.92C.33 6.13 0 7.53 0 9s.33 2.87.92 4.04l3.04-2.33z" fill="#FBBC05" /><path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.8 11.43 0 9 0 5.46 0 2.41 1.97.92 4.96l3.04 2.33C4.67 5.16 6.66 3.58 9 3.58z" fill="#EA4335" /></svg>
                                                                                Sign in with Google
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                                                                    — {t('or manually')} —
                                                                </div>
                                                            </div>
                                                        )}

                                                        {calendarWizard.provider === 'icloud' && (
                                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)', padding: '10px', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
                                                                <strong>{t('Note:')}</strong> {t('iCloud app password required')}
                                                                <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noreferrer" style={{ color: 'var(--gnosi-blue)', marginLeft: '5px', textDecoration: 'underline' }}>{t('Manage Apple ID')} <ExternalLink size={12} style={{ display: 'inline' }} /></a>
                                                            </div>
                                                        )}

                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t('Custom name (Ex: Work, Personal...)')}</label>
                                                                <input
                                                                    type="text"
                                                                    placeholder={t('personal_calendar_placeholder')}
                                                                    onChange={(e) => setCalendarWizard({ ...calendarWizard, name: e.target.value })}
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t('Server / CalDAV URL')}</label>
                                                                <input
                                                                    type="text"
                                                                    defaultValue={calendarWizard.provider === 'icloud' ? 'caldav.icloud.com' : (calendarWizard.provider === 'google' ? 'https://apidata.googleusercontent.com/caldav/v1/calendars/primary/events' : '')}
                                                                    placeholder="https://servidor.com/caldav"
                                                                    onChange={(e) => setCalendarWizard({ ...calendarWizard, url: e.target.value })}
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{t('Password / App Password')}</label>
                                                                <input
                                                                    type="password"
                                                                    placeholder="••••••••"
                                                                    onChange={(e) => setCalendarWizard({ ...calendarWizard, password: e.target.value })}
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </div>
                                                        </div>

                                                        <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                                                            <button
                                                                onClick={() => {
                                                                    if (!calendarWizard.url || !calendarWizard.password) {
                                                                        alert(t('url_password_required'));
                                                                        return;
                                                                    }

                                                                    const newCalendar = {
                                                                        id: 'new_' + Date.now().toString(),
                                                                        name: calendarWizard.name || calendarWizard.email,
                                                                        url: calendarWizard.url,
                                                                        token: calendarWizard.password,
                                                                        username: calendarWizard.email,
                                                                        provider: calendarWizard.provider
                                                                    };

                                                                    const updatedCalendars = [...(Array.isArray(integrations.calendars) ? integrations.calendars : []), newCalendar];
                                                                    handleIntegrationSave('calendars', updatedCalendars);
                                                                    setIntegrations(prev => ({
                                                                        ...prev,
                                                                        calendars: updatedCalendars
                                                                    }));
                                                                    setCalendarWizard(null);
                                                                }}
                                                                style={{ padding: '10px 20px', borderRadius: '8px', background: 'var(--gnosi-blue)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: '600' }}
                                                            >
                                                                {t('Add permanently')}
                                                            </button>
                                                            <button onClick={() => setCalendarWizard(null)} style={{ padding: '10px', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('Cancel')}</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                            {integrationSaveStatus && <div style={{ fontSize: '0.8rem', color: 'var(--gnosi-blue)', marginBottom: '5px' }}>{integrationSaveStatus}</div>}
                                            {(integrations?.calendars || []).map((account, index) => (
                                                <div key={account.id || index} style={{ background: 'rgba(0,0,0,0.02)', padding: '15px', borderRadius: '12px', border: '1px solid var(--settings-border)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                                        <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>{account.name || account.email || account.username || `Calendari ${index + 1}`} {account.token_status === 'connected' && <span style={{ fontSize: '0.75rem', background: '#10b98122', color: '#059669', padding: '2px 8px', borderRadius: '12px', marginLeft: '10px' }}>{t('Connected')} ✅</span>}</span>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={account.is_default || false}
                                                                    onChange={(e) => {
                                                                        const updated = (integrations?.calendars || []).map((c, i) => ({
                                                                            ...c,
                                                                            is_default: i === index ? e.target.checked : false
                                                                        }));
                                                                        setIntegrations(prev => ({ ...prev, calendars: updated }));
                                                                    }}
                                                                />
                                                                {t('Default')}
                                                            </label>
                                                            <input
                                                                type="color"
                                                                value={account.color || '#e5e7eb'}
                                                                onChange={(e) => handleUpdateIntegrationItem('calendars', index, 'color', e.target.value)}
                                                                style={{ width: '20px', height: '20px', padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: '4px' }}
                                                            />
                                                            <button onClick={() => handleRemoveIntegrationItem('calendars', index)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>{t('Remove')}</button>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px' }}>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('name_identifier')}</label>
                                                            <input type="text" value={account.name || ''} onChange={(e) => handleUpdateIntegrationItem('calendars', index, 'name', e.target.value)} placeholder="Personal" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('Server / CalDAV URL')}</label>
                                                            <input type="text" value={account.url || ''} onChange={(e) => handleUpdateIntegrationItem('calendars', index, 'url', e.target.value)} placeholder="https://..." style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('access_token_auth')}</label>
                                                            <input type="password" placeholder={account.token_status === 'connected' ? t('password_hint_connected') : '••••••••'} onChange={(e) => handleUpdateIntegrationItem('calendars', index, 'token', e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            {!(integrations?.calendars?.length > 0) && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '10px' }}>{t('No calendars configured. Click "+ Add Calendar" to start.')}</p>}
                                        </div>


                                    </section>

                                    {/* Vault Tables for Calendar */}
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <Database size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('Vault Tables on Calendar')}</h3>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t('Default color:')}</span>
                                                <input
                                                    type="color"
                                                    value={integrations?.vault_calendar?.color || '#e57373'}
                                                    onChange={(e) => {
                                                        const newVal = e.target.value;
                                                        const updated = { ...integrations.vault_calendar, color: newVal };
                                                        setIntegrations(prev => ({ ...prev, vault_calendar: updated }));
                                                        handleIntegrationSave('vault_calendar', updated);
                                                    }}
                                                    style={{ width: '20px', height: '20px', padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: '4px' }}
                                                />
                                            </div>
                                        </div>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '15px' }}>{t('vault_calendar_tables_desc')}</p>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', marginBottom: '15px' }}>
                                            {tables.map(table => (
                                                <label key={table.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', cursor: 'pointer' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={(integrations?.vault_calendar?.enabled_tables || []).includes(table.id)}
                                                        onChange={(e) => {
                                                            const enabled = integrations?.vault_calendar?.enabled_tables || [];
                                                            const newList = e.target.checked
                                                                ? [...enabled, table.id]
                                                                : enabled.filter(id => id !== table.id);
                                                            setIntegrations(prev => ({
                                                                ...prev,
                                                                vault_calendar: { ...prev.vault_calendar, enabled_tables: newList }
                                                            }));
                                                        }}
                                                    />
                                                    <span style={{ fontSize: '0.9rem' }}>{table.name}</span>
                                                </label>
                                            ))}
                                        </div>


                                    </section>
                                </div>
                            )}

                            {activeTab === 'graph' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                            <Sliders size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('visualization')}</h3>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            <div className="setting-control">
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={graphConfig.show_arrows}
                                                        onChange={e => setGraphConfig(prev => ({ ...prev, show_arrows: e.target.checked }))}
                                                    />
                                                    {t('show_arrows')}
                                                </label>
                                            </div>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>{t('node_size')} ({graphConfig.node_size.toFixed(1)})</label>
                                                <input
                                                    type="range" min="0.1" max="5" step="0.1"
                                                    value={graphConfig.node_size}
                                                    onChange={e => setGraphConfig(prev => ({ ...prev, node_size: parseFloat(e.target.value) }))}
                                                    style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }}
                                                />
                                            </div>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>{t('Edge thickness')} ({graphConfig.edge_thickness.toFixed(1)})</label>
                                                <input
                                                    type="range" min="0.1" max="5" step="0.1"
                                                    value={graphConfig.edge_thickness}
                                                    onChange={e => setGraphConfig(prev => ({ ...prev, edge_thickness: parseFloat(e.target.value) }))}
                                                    style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }}
                                                />
                                            </div>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>{t('Label threshold')} ({graphConfig.label_threshold})</label>
                                                <input
                                                    type="range" min="0" max="50" step="1"
                                                    value={graphConfig.label_threshold}
                                                    onChange={e => setGraphConfig(prev => ({ ...prev, label_threshold: parseInt(e.target.value) }))}
                                                    style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }}
                                                />
                                            </div>
                                        </div>
                                    </section>

                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                            <Zap size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('forces_physics')}</h3>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>{t('Gravity')} ({graphConfig.physics.gravity})</label>
                                                <input
                                                    type="range" min="0" max="2" step="0.05"
                                                    value={graphConfig.physics.gravity}
                                                    onChange={e => setGraphConfig(prev => ({ ...prev, physics: { ...prev.physics, gravity: parseFloat(e.target.value) } }))}
                                                    style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }}
                                                />
                                            </div>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>{t('Repulsion')} ({graphConfig.physics.repulsion})</label>
                                                <input
                                                    type="range" min="0" max="10000" step="100"
                                                    value={graphConfig.physics.repulsion}
                                                    onChange={e => setGraphConfig(prev => ({ ...prev, physics: { ...prev.physics, repulsion: parseInt(e.target.value) } }))}
                                                    style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }}
                                                />
                                            </div>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>{t('Friction')} ({graphConfig.physics.friction})</label>
                                                <input
                                                    type="range" min="1" max="20" step="1"
                                                    value={graphConfig.physics.friction}
                                                    onChange={e => setGraphConfig(prev => ({ ...prev, physics: { ...prev.physics, friction: parseInt(e.target.value) } }))}
                                                    style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }}
                                                />
                                            </div>
                                            <div className="setting-control">
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem', marginTop: '25px' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={graphConfig.physics.lin_log_mode}
                                                        onChange={e => setGraphConfig(prev => ({ ...prev, physics: { ...prev.physics, lin_log_mode: e.target.checked } }))}
                                                    />
                                                    {t('Lin-Log Mode')}
                                                </label>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                            <Database size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('visualization')}</h3>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                            <div>
                                                <h4 style={{ fontSize: '0.9rem', margin: '0 0 10px 0', color: 'var(--text-secondary)', borderBottom: '1px solid var(--settings-border)', paddingBottom: '5px' }}>{t('hierarchical_selection')}</h4>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                    {(databases || []).map(db => {
                                                        const dbTables = (tables || []).filter(t => t.database_id === db.id);
                                                        const isDbChecked = graphConfig.visible_databases.includes(db.id);

                                                        return (
                                                            <div key={db.id} className="hierarchical-db" style={{ border: '1px solid var(--settings-section-border)', borderRadius: '10px', padding: '10px', background: 'var(--settings-section-bg)' }}>
                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem', cursor: 'pointer', fontWeight: 'bold', marginBottom: dbTables.length > 0 && isDbChecked ? '10px' : 0 }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isDbChecked}
                                                                        onChange={e => {
                                                                            const checked = e.target.checked;
                                                                            setGraphConfig(prev => {
                                                                                let newDbs = checked ? [...prev.visible_databases, db.id] : prev.visible_databases.filter(id => id !== db.id);
                                                                                let newTables = [...prev.visible_tables];
                                                                                let newFields = [...prev.visible_fields];

                                                                                if (!checked) {
                                                                                    // Uncheck all tables and fields of this DB
                                                                                    const tableIds = dbTables.map(t => t.id);
                                                                                    newTables = newTables.filter(id => !tableIds.includes(id));
                                                                                    newFields = newFields.filter(f => !tableIds.some(tid => f.startsWith(`${tid}:`)));
                                                                                }

                                                                                return { ...prev, visible_databases: newDbs, visible_tables: newTables, visible_fields: newFields };
                                                                            });
                                                                        }}
                                                                    />
                                                                    <Database size={16} />
                                                                    <span>{db.name}</span>
                                                                </label>

                                                                {isDbChecked && dbTables.length > 0 && (
                                                                    <div style={{ marginLeft: '25px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                                        {dbTables.map(table => {
                                                                            const isTableChecked = graphConfig.visible_tables.includes(table.id);
                                                                            const properties = table.properties || [];

                                                                            return (
                                                                                <div key={table.id} className="hierarchical-table">
                                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer', marginBottom: isTableChecked && properties.length > 0 ? '5px' : 0 }}>
                                                                                        <input
                                                                                            type="checkbox"
                                                                                            checked={isTableChecked}
                                                                                            onChange={e => {
                                                                                                const checked = e.target.checked;
                                                                                                setGraphConfig(prev => {
                                                                                                    let newTables = checked ? [...prev.visible_tables, table.id] : prev.visible_tables.filter(id => id !== table.id);
                                                                                                    let newFields = [...prev.visible_fields];

                                                                                                    if (!checked) {
                                                                                                        // Uncheck all fields of this table
                                                                                                        newFields = newFields.filter(f => !f.startsWith(`${table.id}:`));
                                                                                                    }

                                                                                                    return { ...prev, visible_tables: newTables, visible_fields: newFields };
                                                                                                });
                                                                                            }}
                                                                                        />
                                                                                        <span>{table.name}</span>
                                                                                    </label>

                                                                                    {isTableChecked && properties.length > 0 && (
                                                                                        <div style={{ marginLeft: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '5px' }}>
                                                                                            {properties.map(prop => {
                                                                                                const fieldKey = `${table.id}:${prop.name}`;
                                                                                                const isFieldChecked = graphConfig.visible_fields.includes(fieldKey);

                                                                                                return (
                                                                                                    <label key={prop.name} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', background: 'var(--settings-btn-bg)', opacity: 0.9 }}>
                                                                                                        <input
                                                                                                            type="checkbox"
                                                                                                            checked={isFieldChecked}
                                                                                                            onChange={e => {
                                                                                                                const checked = e.target.checked;
                                                                                                                setGraphConfig(prev => ({
                                                                                                                    ...prev,
                                                                                                                    visible_fields: checked ? [...prev.visible_fields, fieldKey] : prev.visible_fields.filter(f => f !== fieldKey)
                                                                                                                }));
                                                                                                            }}
                                                                                                        />
                                                                                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prop.name}</span>
                                                                                                    </label>
                                                                                                );
                                                                                            })}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <div style={{ marginTop: '10px' }}>
                                                <h4 style={{ fontSize: '0.9rem', margin: '0 0 10px 0', color: 'var(--text-secondary)', borderBottom: '1px solid var(--settings-border)', paddingBottom: '5px' }}>{t('table_filters_sidebar')}</h4>
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>{t('table_filters_sidebar_desc')}</p>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
                                                    {(tables || []).filter(t => graphConfig.visible_tables.includes(t.id)).map(table => (
                                                        <label key={`filter-${table.id}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer', padding: '8px 10px', borderRadius: '8px', background: 'var(--settings-btn-bg)', border: '1px solid var(--settings-section-border)' }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={graphConfig.graph_table_filters?.includes(table.id)}
                                                                onChange={e => {
                                                                    const checked = e.target.checked;
                                                                    const current = graphConfig.graph_table_filters || [];
                                                                    setGraphConfig(prev => ({
                                                                        ...prev,
                                                                        graph_table_filters: checked ? [...current, table.id] : current.filter(id => id !== table.id)
                                                                    }));
                                                                }}
                                                            />
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{table.name}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </section>
                                </div>
                            )}

                            {activeTab === 'notion' && (
                                <section className="settings-section">
                                    <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                        <RefreshCw size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('Notion Sync')}</h3>
                                    </div>
                                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>{t('sync_desc')}</p>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('access_token_auth')}</label>
                                        <input type="password" value={localIntegrations.notion?.token || ''} onChange={(e) => handleUpdateIntegrationField('notion', 'token', e.target.value)} placeholder="secret_..." style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                    </div>
                                    <button
                                        onClick={handleSync}
                                        disabled={syncing}
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '10px',
                                            border: '1px solid var(--settings-border)',
                                            background: 'var(--settings-btn-bg)',
                                            color: 'var(--text-primary)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '10px',
                                            cursor: syncing ? 'not-allowed' : 'pointer',
                                            fontWeight: '600',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        <RefreshCw size={18} className={syncing ? 'spin-anim' : ''} />
                                        {syncing ? t('syncing_label') : t('sync_now_btn')}
                                    </button>
                                    {syncMessage && <p style={{ fontSize: '0.85rem', marginTop: '10px', textAlign: 'center', color: 'var(--gnosi-blue)', fontWeight: '500' }}>{syncMessage}</p>}
                                </section>
                            )}

                            {activeTab === 'zotero' && zoteroConfig && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                            <BookOpen size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('Zotero Sync')}</h3>
                                        </div>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '15px' }}>{t('Configure Zotero local library sync.')}</p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{t('Target Table')}</label>
                                                <select
                                                    value={zoteroConfig.target_table || ''}
                                                    onChange={e => setZoteroConfig(prev => ({ ...prev, target_table: e.target.value }))}
                                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                                                >
                                                    <option value="">{t('Select a table...')}</option>
                                                    {zoteroTables.map(t => (
                                                        <option key={t.id} value={t.id}>{t.name}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="settings-mapping-list" style={{ background: 'rgba(0,0,0,0.02)', padding: '15px', borderRadius: '12px', border: '1px solid var(--settings-border)', maxHeight: '300px', overflowY: 'auto' }}>
                                                <h4 style={{ fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '12px' }}>{t('Field Mapping')}</h4>
                                                {(zoteroFields || []).map(field => (
                                                    <div key={field.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', gap: '15px' }}>
                                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '500' }}>{field.label}</span>
                                                        <select
                                                            style={{ background: 'var(--settings-input-bg)', border: '1px solid var(--settings-border)', borderRadius: '6px', padding: '6px', color: 'var(--text-primary)', fontSize: '0.8rem', width: '180px' }}
                                                            value={zoteroConfig.mapping?.[field.id] || ''}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                setZoteroConfig(prev => ({
                                                                    ...prev,
                                                                    mapping: {
                                                                        ...(prev.mapping || {}),
                                                                        [field.id]: val
                                                                    }
                                                                }));
                                                            }}
                                                        >
                                                            <option value="">{t('-- Do not map --')}</option>
                                                            {availableProperties.map(prop => (
                                                                <option key={prop.name} value={prop.name}>{prop.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                ))}
                                            </div>

                                            <div style={{ display: 'flex', gap: '10px' }}>
                                                <button
                                                    onClick={handleZoteroSync}
                                                    disabled={zoteroSyncing}
                                                    style={{ flex: 1, padding: '10px', borderRadius: '8px', background: 'var(--settings-btn-bg)', color: 'var(--text-primary)', border: '1px solid var(--settings-border)', cursor: zoteroSyncing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                                >
                                                    <RefreshCw size={16} className={zoteroSyncing ? 'spin-anim' : ''} />
                                                    {t('Sync')}
                                                </button>
                                            </div>

                                            {zoteroSaveStatus && <p style={{ fontSize: '0.8rem', textAlign: 'center', color: zoteroSaveStatus.includes('✅') ? '#10b981' : '#ef4444' }}>{zoteroSaveStatus}</p>}
                                        </div>
                                    </section>
                                </div>
                            )}

                            {activeTab === 'schedulers' && (
                                <section className="settings-section">
                                    <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                        <Clock size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('scheduled_tasks')}</h3>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {schedulers.map(task => (
                                            <div key={task.name} style={{ background: 'rgba(0,0,0,0.03)', padding: '15px', borderRadius: '12px', border: '1px solid var(--settings-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <h4 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: '600' }}>{task.name.replace(/_/g, ' ')}</h4>
                                                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '400px' }}>{task.description}</p>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '20px' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={task.enabled}
                                                            onChange={async e => {
                                                                const res = await fetch(`/api/schedulers/${task.name}`, {
                                                                    method: 'PUT',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ ...task, enabled: e.target.checked })
                                                                });
                                                                if (res.ok) loadSchedulers();
                                                            }}
                                                            style={{ opacity: 0, width: 0, height: 0 }}
                                                        />
                                                        <span style={{
                                                            position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                                            backgroundColor: task.enabled ? 'var(--gnosi-blue)' : '#ccc',
                                                            transition: '.4s', borderRadius: '20px'
                                                        }}>
                                                            <span style={{
                                                                position: 'absolute', height: '14px', width: '14px', left: task.enabled ? '22px' : '4px', bottom: '3px',
                                                                backgroundColor: 'white', transition: '.4s', borderRadius: '50%'
                                                            }} />
                                                        </span>
                                                    </label>
                                                    <span style={{ fontSize: '0.8rem', fontWeight: '500', minWidth: '45px' }}>{task.enabled ? t('Active') : t('Inactive')}</span>
                                                </div>
                                            </div>
                                        ))}
                                        {schedulers.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '20px' }}>{t('No scheduled tasks found.')}</p>}
                                    </div>
                                </section>
                            )}

                            {activeTab === 'ai' && (
                                <section className="settings-section">
                                    <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                        <Cpu size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('ai_systems_title')}</h3>
                                        {integrations?.ai?.groq_api_key_status === 'connected' && <span style={{ fontSize: '0.75rem', background: '#10b98122', color: '#059669', padding: '2px 8px', borderRadius: '12px', fontWeight: '600' }}>{t('Connected')} ✅</span>}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Groq API Key</label>
                                            <input
                                                type="password"
                                                placeholder={integrations?.ai?.groq_api_key_status === 'connected' ? t('password_hint_connected') : 'gsk_...'}
                                                onChange={(e) => setIntegrations(prev => ({ ...prev, ai: { ...prev.ai, groq_api_key: e.target.value } }))}
                                                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ background: 'rgba(0,0,0,0.03)', padding: '20px', borderRadius: '12px', border: '1px solid var(--settings-border)', textAlign: 'center', marginTop: '30px' }}>
                                        <Cpu size={40} style={{ color: 'var(--gnosi-blue)', opacity: 0.5, marginBottom: '15px' }} />
                                        <p style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: '500', marginBottom: '5px' }}>{t('coming_soon')}</p>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('ai_params_desc')}</p>
                                    </div>
                                </section>
                            )}

                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="settings-modal__footer" style={{
                        padding: '16px 20px',
                        borderTop: '1px solid var(--settings-border)',
                        background: 'var(--settings-header-bg)',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        {saveStatus && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: saveStatus.includes('✅') ? '#10b981' : '#ef4444', fontSize: '0.9rem', marginRight: 'auto' }}>
                                {saveStatus.includes('✅') ? <Check size={16} /> : <Info size={16} />}
                                {saveStatus}
                            </div>
                        )}
                        <button
                            onClick={onClose}
                            className="btn-gnosi btn-gnosi-secondary"
                        >
                            {t('Close')}
                        </button>
                        <button
                            onClick={handleSaveGlobal}
                            className="btn-gnosi btn-gnosi-primary"
                        >
                            {isSaving ? <RefreshCw size={18} className="spin-anim" /> : <Save size={18} />}
                            {t('Save Changes')}
                        </button>
                    </div>
                </div>
            </div>
            <FolderPickerModal
                isOpen={pickerOpen}
                onClose={() => setPickerOpen(false)}
                initialPath={localPaths[pickerField] || ''}
                onSelect={(path) => {
                    setLocalPaths(prev => ({ ...prev, [pickerField]: path }));
                    setPickerOpen(false);
                }}
            />
        </>

    );
}
