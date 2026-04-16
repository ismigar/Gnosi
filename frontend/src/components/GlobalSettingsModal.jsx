import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
    X, Globe, Palette, RefreshCw, Info, ExternalLink, Monitor, BookOpen, 
    Save, Check, FolderOpen, Database, Cpu, Zap, Settings as SettingsIcon, 
    Sliders, Calendar, Mail, Trash2, Plus, Users, Rss, Share2, Inbox, 
    ChevronRight, Search, FileUp, Shield, Activity, Bot, FileText, 
    PenTool, Image, Paperclip
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FolderPickerModal } from './FolderPickerModal';
import { IconPicker, VAULT_COLORS } from './Vault/IconPicker';
import axios from 'axios';
import { ConfirmModal } from './ConfirmModal';
import * as LucideIcons from 'lucide-react';
import MailBlockEditor from './Mail/MailBlockEditor';
import './GlobalSettingsModal.css';

const LANGUAGES = [
    { code: 'ca', label: 'Català', icon: '🏴󠁥󠁳󠁣󠁡󠁿' },
    { code: 'es', label: 'Español', icon: '🇪🇸' },
    { code: 'en', label: 'English', icon: '🇬🇧' },
];

const CURRENCIES = ['EUR (€)', 'USD ($)', 'GBP (£)', 'JPY (¥)', 'CHF (₣)'];
const DECIMAL_SYMBOLS = [',', '.'];

const NOTION_COLORS = [
    { name: 'default', color: 'currentColor' },
    { name: 'gray', color: '#9b9a97' },
    { name: 'brown', color: '#64473a' },
    { name: 'orange', color: '#d9730d' },
    { name: 'yellow', color: '#dfab01' },
    { name: 'green', color: '#0f7b6c' },
    { name: 'blue', color: '#0b6e99' },
    { name: 'purple', color: '#6940a5' },
    { name: 'pink', color: '#ad1a72' },
    { name: 'red', color: '#e03e3e' }
];

// -- REUSABLE UI COMPONENTS --
const Section = ({ title, icon: Icon, children, extra }) => (
    <div className="settings-section animate-in">
        <div className="settings-section-title-wrap">
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {Icon && <div className="settings-section-icon-wrap"><Icon size={20} /></div>}
                <h3 className="settings-section-title">{title}</h3>
            </div>
            <div style={{ flexShrink: 0 }}>
                {extra}
            </div>
        </div>
        <div className="settings-section-content">
            {children}
        </div>
    </div>
);

const FormGroup = ({ label, children, description, horizontal = false }) => (
    <div className="settings-form-group" style={{ 
        display: horizontal ? 'flex' : 'block', 
        alignItems: horizontal ? 'center' : 'stretch',
        justifyContent: horizontal ? 'space-between' : 'flex-start',
        gap: horizontal ? '20px' : '0'
    }}>
        <div style={{ marginBottom: horizontal ? '0' : '10px', flex: horizontal ? 1 : 'none' }}>
            <label className="settings-label">{label}</label>
            {description && <div className="settings-desc">{description}</div>}
        </div>
        <div style={{ flex: horizontal ? '0 0 auto' : 'none' }}>
            {children}
        </div>
    </div>
);

const AccountRow = ({ name, description, status, type, provider, onSync, onEdit, onDelete, color = '#3b82f6', isSyncing = false }) => (
    <div className="account-row hover-scale" style={{ 
        padding: '18px 24px', borderRadius: '20px', border: '1px solid var(--settings-border)', 
        background: 'var(--settings-sidebar-bg)', display: 'flex', justifyContent: 'space-between', 
        alignItems: 'center', marginBottom: '14px', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
    }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: `var(--gnosi-blue)15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gnosi-blue)' }}>
                {type === 'calendar' ? <Calendar size={22} /> : (type === 'mail' ? <Mail size={22} /> : <Users size={22} />)}
            </div>
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ fontWeight: '800', fontSize: '1.05rem', color: 'var(--text-primary)' }}>{name || description}</div>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', opacity: 0.8 }}>{(name && name !== description) ? description : (provider === 'manual' ? 'Configuració manual' : 'Compte connectat')}</div>
            </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '10px' }}>
                <span style={{ 
                    fontSize: '0.68rem', padding: '5px 14px', borderRadius: '20px', 
                    background: status === 'connected' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)', 
                    color: status === 'connected' ? '#10b981' : '#f59e0b', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '0.04em'
                }}>
                    {status === 'connected' ? 'Connectat' : 'Pendent'}
                </span>
                
                <button 
                    onClick={(e) => { e.stopPropagation(); onSync && onSync(); }} 
                    disabled={isSyncing}
                    className="icon-btn hover-bg" 
                    title="Sincronitzar aquest compte"
                    style={{ padding: '8px', borderRadius: '10px', color: 'var(--gnosi-blue)' }}
                >
                    <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                </button>
            </div>
            <button onClick={onEdit} className="icon-btn hover-bg" style={{ padding: '8px', borderRadius: '10px' }}><SettingsIcon size={18} /></button>
            <button onClick={onDelete} className="icon-btn hover-bg-danger" style={{ color: '#ef4444', padding: '8px', borderRadius: '10px' }}><Trash2 size={18} /></button>
        </div>
    </div>
);

const SidebarItem = ({ id, icon: Icon, label, active, onClick }) => (
    <button className={`settings-sidebar__item ${active ? 'active' : ''}`} onClick={onClick} style={{
        display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', border: 'none', borderRadius: '16px',
        background: active ? 'var(--settings-sidebar-active)' : 'transparent',
        color: active ? 'var(--settings-sidebar-active-text)' : 'var(--text-secondary)',
        cursor: 'pointer', textAlign: 'left', fontWeight: active ? '800' : '600', 
        fontSize: '0.96rem', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)', width: '100%',
        boxShadow: active ? '0 10px 15px -3px rgba(59, 130, 246, 0.15)' : 'none'
    }}>
        <Icon size={20} style={{ opacity: active ? 1 : 0.6 }} />
        <span style={{ flex: 1 }}>{label}</span>
        {active && <ChevronRight size={16} style={{ opacity: 0.4 }} />}
    </button>
);

export function GlobalSettingsModal({ isOpen, onClose, initialTab = 'general' }) {
    const { t, i18n } = useTranslation();
    
    // -- UNIFIED DRAFT STATE --
    const [draft, setDraft] = useState({
        settings: {
            user_name: '', workspace_name: '', gnosi_mode: 'personal',
            org_user: '', org_password: '', org_workspace: '',
            language: 'ca', week_start: 1, currency: 'EUR (€)', decimal_symbol: ',',
            theme: 'system', reduce_animations: false
        },
        paths: { vault: '', databases: '', newsletters: '' },
        graph: {
            visible_databases: [], visible_tables: [], visible_fields: [],
            show_arrows: true, label_threshold: 10, node_size: 1.0, edge_thickness: 1.0,
            physics: { gravity: 0.1, repulsion: 1000, friction: 10 }
        },
        ai: { agents: [], providers: {}, active_agent_id: '' },
        zotero: { user: '', pwd: '', workspace: '', target_table: '', mapping: {} }
    });

    const [activeTab, setActiveTab] = useState(initialTab);
    const [integrations, setIntegrations] = useState({ calendars: [], contacts: [], mail_accounts: [] });
    const [databases, setDatabases] = useState([]);
    const [tables, setTables] = useState([]);
    const [aiCatalog, setAiCatalog] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState('');

    const language = draft.settings.language || 'ca';

    const translations = useMemo(() => ({
        ca: {
            databases: "Bases de dades",
            systemEntities: "Entitats del Sistema",
            filter_exposed: "Filtre exposat"
        },
        es: {
            databases: "Bases de datos",
            systemEntities: "Entidades del Sistema",
            filter_exposed: "Filtro expuesto"
        },
        en: {
            databases: "Databases",
            systemEntities: "System Entities",
            filter_exposed: "Exposed Filter"
        }
    }), []);

    const systemEntities = useMemo(() => [
        { 
            id: 'attachments', 
            name: 'Adjunts', 
            icon: Paperclip, 
            color: '#6366f1', 
            fields: [
                { name: 'mimetype', type: 'select' }, 
                { name: 'extension', type: 'text' }
            ] 
        },
        { 
            id: 'calendars', 
            name: 'Calendaris', 
            icon: LucideIcons.Calendar, 
            color: '#ef4444', 
            subItems: (integrations.calendars || []).map(c => ({ id: c.id, name: c.name })), 
            fields: [
                { name: 'status', type: 'select' }, 
                { name: 'location', type: 'text' }
            ] 
        },
        { 
            id: 'contacts', 
            name: 'Contactes', 
            icon: LucideIcons.Users, 
            color: '#10b981', 
            subItems: (integrations.contacts || []).map(c => ({ id: c.id, name: c.name })), 
            fields: [
                { name: 'company', type: 'text' }, 
                { name: 'job_title', type: 'text' }
            ] 
        },
        { 
            id: 'drawings', 
            name: 'Dibuixos', 
            icon: PenTool, 
            color: '#f59e0b', 
            fields: [{ name: 'tool', type: 'select' }] 
        },
        { 
            id: 'images', 
            name: 'Imatges', 
            icon: Image, 
            color: '#ec4899', 
            fields: [{ name: 'dimensions', type: 'text' }] 
        },
        { 
            id: 'mails', 
            name: 'Mails', 
            icon: LucideIcons.Mail, 
            color: '#3b82f6', 
            subItems: (integrations.mail_accounts || []).map(m => ({ id: m.id, name: m.email })), 
            fields: [
                { name: 'subject', type: 'text' }, 
                { name: 'is_read', type: 'checkbox' }
            ] 
        },
        { 
            id: 'wiki', 
            name: 'Wiki', 
            icon: FileText, 
            color: '#8b5cf6', 
            fields: [
                { name: 'category', type: 'text' }, 
                { name: 'priority', type: 'number' }
            ] 
        }
    ], [integrations]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerField, setPickerField] = useState(null);
    const [aiValidationStatus, setAiValidationStatus] = useState({});
    const [googleAuthConfigured, setGoogleAuthConfigured] = useState(false);

    // AI Editing Modals
    const [editingAgent, setEditingAgent] = useState(null);
    const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
    const [providerToEdit, setProviderToEdit] = useState(null);

    // Newsletter State
    const [newsletterSources, setNewsletterSources] = useState([]);
    const [newsletterName, setNewsletterName] = useState('');
    const [newsletterAddress, setNewsletterAddress] = useState('');
    const [newsletterType, setNewsletterType] = useState('rss');
    const [newsletterStatus, setNewsletterStatus] = useState('');
    const newsletterOpmlRef = useRef(null);
    
    // Account Integration State
    const [addAccountType, setAddAccountType] = useState(null); // 'calendar' | 'contacts' | 'mail' | null
    const [addAccountEmail, setAddAccountEmail] = useState('');
    const [isManualGoogle, setIsManualGoogle] = useState(false);
    const [manualServer, setManualServer] = useState('');
    const [manualPassword, setManualPassword] = useState('');
    const [editingAccountId, setEditingAccountId] = useState(null); // ID del compte en edició
    const [syncingAccounts, setSyncingAccounts] = useState({}); // Tracking individual syncs
    
    // Mail Specialized State
    const [mailImapHost, setMailImapHost] = useState('');
    const [mailImapPort, setMailImapPort] = useState('993');
    const [mailImapUser, setMailImapUser] = useState('');
    const [mailImapPass, setMailImapPass] = useState('');
    const [mailImapEnc, setMailImapEnc] = useState('ssl');
    const [mailSmtpHost, setMailSmtpHost] = useState('');
    const [mailSmtpPort, setMailSmtpPort] = useState('465');
    const [mailSmtpUser, setMailSmtpUser] = useState('');
    const [mailSmtpPass, setMailSmtpPass] = useState('');
    const [mailSmtpEnc, setMailSmtpEnc] = useState('ssl');
    const [mailSignature, setMailSignature] = useState('');
    const [mailCertificate, setMailCertificate] = useState('');

    // -- AUTO-SAVE CONTROLS --
    const autoSaveTimeoutRef = useRef(null);
    const lastSavedData = useRef(null);
    const [savingStatus, setSavingStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
    const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });
    const [isAddingTable, setIsAddingTable] = useState(false);
    const [editingTableColor, setEditingTableColor] = useState(null); // { id, name, color }
    const [isDatabasesExpanded, setIsDatabasesExpanded] = useState(true);
    const [isSystemEntitiesExpanded, setIsSystemEntitiesExpanded] = useState(true);

    useEffect(() => {
        if (isOpen) {
            loadConfig();
            loadAiCatalog();
            loadZoteroData();
            loadIntegrations();
            loadNewsletterSources();
            checkGoogleAuth();
        }
    }, [isOpen]);

    // Keyboard support - Escape to close
    useEffect(() => {
        const handleKeyPress = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [isOpen, onClose]);

    const checkGoogleAuth = async () => {
        try {
            const res = await fetch('/api/auth/google/status');
            if (res.ok) {
                const data = await res.json();
                setGoogleAuthConfigured(data.configured);
            }
        } catch (err) { console.error("Error checking Google Auth:", err); }
    };

    const loadConfig = async () => {
        try {
            const res = await fetch('/api/config');
            if (res.ok) {
                const cfg = await res.json();
                setDraft(prev => ({
                    ...prev,
                    settings: { ...prev.settings, ...(cfg.settings || {}) },
                    paths: { ...prev.paths, ...(cfg.paths || {}) },
                    graph: { ...prev.graph, ...(cfg.graph || {}) },
                    ai: { 
                        ...prev.ai, 
                        agents: cfg.ai?.agents || [], 
                        active_agent_id: cfg.ai?.active_agent_id || '' 
                    }
                }));
            }
        } catch (err) { console.error("Error loading config:", err); }
    };

    const loadIntegrations = async () => {
        try {
            const res = await fetch('/api/integrations');
            if (res.ok) setIntegrations(await res.json());
        } catch (err) { console.error("Error loading integrations:", err); }
    };

    const loadAiCatalog = async () => {
        try {
            const res = await fetch('/api/ai/catalog');
            if (res.ok) {
                const payload = await res.json();
                const providers = payload?.catalog?.providers || [];
                setAiCatalog(providers.reduce((acc, p) => ({ ...acc, [p.id]: p }), {}));
                if (payload?.config?.providers) {
                    setDraft(prev => ({
                        ...prev,
                        ai: { ...prev.ai, providers: payload.config.providers }
                    }));
                }
            }
        } catch (err) { console.error("Error loading AI catalog:", err); }
    };

    const loadZoteroData = async () => {
        try {
            // Fetch Zotero configuració de manera independent
            fetch('/api/zotero/config').then(async res => {
                if (res.ok) {
                    const cfg = await res.json();
                    setDraft(prev => ({ ...prev, zotero: { ...prev.zotero, ...cfg } }));
                }
            }).catch(e => console.error("Zotero fetch error:", e));

            // Fetch Tables de manera independent
            fetch('/api/vault/tables').then(async res => {
                if (res.ok) setTables(await res.json());
            }).catch(e => console.error("Tables fetch error:", e));

            // Fetch Databases de manera independent
            fetch('/api/vault/databases').then(async res => {
                if (res.ok) setDatabases(await res.json());
            }).catch(e => console.error("Databases fetch error:", e));

        } catch (err) { console.error("General loading error:", err); }
    };

    const loadNewsletterSources = async () => {
        try {
            const res = await fetch('/api/reader/sources');
            if (res.ok) {
                const sources = await res.json();
                setNewsletterSources((sources || []).filter(s => ['rss', 'newsletter', 'youtube', 'newsletter_account'].includes(s.type)));
            }
        } catch (err) { console.error("Error loading newsletters:", err); }
    };


    // -- UNIFIED SAVE LOGIC --
    const triggerAutoSave = async (silent = true) => {
        if (isSaving) return;
        
        const currentData = JSON.stringify({
            settings: draft.settings,
            paths: draft.paths,
            graph: draft.graph,
            ai: { 
                agents: draft.ai.agents, 
                active_agent_id: draft.ai.active_agent_id,
                providers: draft.ai.providers
            },
            integrations,
            zotero: draft.zotero
        });

        // Initialize baseline on first load
        if (lastSavedData.current === null) {
            lastSavedData.current = currentData;
            return;
        }

        // Prevent redundant saves
        if (lastSavedData.current === currentData) return;

        setSavingStatus('saving');
        setIsSaving(true);
        
        try {
            await Promise.all([
                axios.post('/api/config', {
                    settings: draft.settings,
                    paths: draft.paths,
                    graph: draft.graph,
                    ai: { 
                        agents: draft.ai.agents, 
                        active_agent_id: draft.ai.active_agent_id,
                        providers: draft.ai.providers
                    }
                }),
                axios.post('/api/integrations/bulk', integrations),
                axios.post('/api/zotero/config', draft.zotero)
            ]);
            
            lastSavedData.current = currentData;
            setSavingStatus('saved');
            setTimeout(() => setSavingStatus('idle'), 3000);
        } catch (err) { 
            console.error("Auto-save error:", err);
            setSavingStatus('error');
        } finally {
            setIsSaving(false);
        }
    };

    // Auto-save Effect
    useEffect(() => {
        if (!isOpen) return;
        
        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
        
        autoSaveTimeoutRef.current = setTimeout(() => {
            triggerAutoSave();
        }, 800); // 800ms debounce

        return () => {
            if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
        };
    }, [draft, integrations]);

    const handleDeleteAccount = (category, accountId) => {
        setConfirmConfig({
            isOpen: true,
            title: 'Eliminar Compte',
            message: 'Estàs segur que vols eliminar aquest compte? Es deixarà de sincronitzar immediatament.',
            onConfirm: async () => {
                const key = category === 'calendar' ? 'calendars' : (category === 'contacts' ? 'contacts' : 'mail_accounts');
                const newList = integrations[key].filter(a => a.id !== accountId);
                const updatedIntegrations = { ...integrations, [key]: newList };
                
                setSavingStatus('saving');
                try {
                    await axios.post('/api/integrations/bulk', updatedIntegrations);
                    setIntegrations(updatedIntegrations);
                    setSavingStatus('saved');
                    setTimeout(() => setSavingStatus('idle'), 2000);
                } catch (e) {
                    setSavingStatus('error');
                }
                setConfirmConfig(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleEditAccount = (category, account) => {
        setAddAccountType(category);
        setEditingAccountId(account.id);
        setAddAccountEmail(account.email || account.username || '');
        if (account.provider === 'manual') {
            setManualServer(account.server_url || '');
            setManualPassword(account.password || '');
        } else {
            setIsManualGoogle(false);
        }

        if (category === 'mail' && account.provider === 'manual') {
            setMailImapHost(account.imap_host || '');
            setMailImapPort(account.imap_port || '993');
            setMailImapUser(account.imap_user || '');
            setMailImapPass(account.imap_password || '');
            setMailImapEnc(account.imap_encryption || 'ssl');
            setMailSmtpHost(account.smtp_host || '');
            setMailSmtpPort(account.smtp_port || '465');
            setMailSmtpUser(account.smtp_user || '');
            setMailSmtpPass(account.smtp_password || '');
            setMailSmtpEnc(account.smtp_encryption || 'ssl');
            setMailSignature(account.signature || '');
            setMailCertificate(account.certificate || '');
        }
    };

    const handleSyncAccount = async (category, accountId) => {
        if (!accountId) return;
        setSyncingAccounts(prev => ({ ...prev, [accountId]: true }));
        setSavingStatus('saving');
        try {
            // Mapping category to correct sync endpoint
            const base = category === 'calendar' ? 'calendar' : (category === 'contacts' ? 'contacts' : 'mail');
            const res = await axios.post(`/api/${base}/sync`, { account_id: accountId });
            
            if (res.data.success) {
                setSavingStatus('saved');
                loadIntegrations(); // Refresh status if needed
            } else {
                setSavingStatus('error');
                alert(`Error en la sincronització: ${res.data.error || 'Error desconegut'}`);
            }
        } catch (e) {
            console.error("Sync error:", e);
            setSavingStatus('error');
        } finally {
            setSyncingAccounts(prev => ({ ...prev, [accountId]: false }));
            setTimeout(() => setSavingStatus('idle'), 3000);
        }
    };

    const validateAIProvider = async (id, manualKey = null) => {
        setAiValidationStatus(prev => ({ ...prev, [id]: 'validating' }));
        try {
            const providerCfg = draft.ai.providers[id] || {};
            const res = await axios.post(`/api/ai/providers/${id}/validate`, {
                api_key: manualKey || '',
                base_url: providerCfg.base_url || ''
            });
            setAiValidationStatus(prev => ({ ...prev, [id]: res.data.success ? 'success' : 'error' }));
            if (!res.data.success) {
                console.warn(`Validation failed for ${id}:`, res.data.error);
            }
        } catch (e) {
            console.error("AI Validation error:", e);
            setAiValidationStatus(prev => ({ ...prev, [id]: 'error' }));
        }
    };

    const handleToggleAIProvider = async (pId, enabled) => {
        try {
            await axios.patch(`/api/ai/providers/${pId}/status`, { enabled });
            setDraft(prev => ({
                ...prev,
                ai: {
                    ...prev.ai,
                    providers: {
                        ...prev.ai.providers,
                        [pId]: { ...prev.ai.providers[pId], enabled }
                    }
                }
            }));
        } catch (e) {
            console.error("Error toggling provider:", e);
        }
    };

    const handleDeleteAIProvider = async (pId) => {
        setConfirmConfig({
            isOpen: true,
            title: "Eliminar Proveïdor",
            message: `Estàs segur que vols eliminar la configuració de ${pId.toUpperCase()}? Aquesta acció no es pot desfer.`,
            onConfirm: async () => {
                try {
                    await axios.delete(`/api/ai/providers/${pId}`);
                    setDraft(prev => {
                        const newProviders = { ...prev.ai.providers };
                        delete newProviders[pId];
                        return {
                            ...prev,
                            ai: { ...prev.ai, providers: newProviders }
                        };
                    });
                    setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                } catch (e) {
                    console.error("Error deleting provider:", e);
                }
            }
        });
    };

    const handleAddNewsletter = async () => {
        if (!newsletterAddress.trim()) return;
        setNewsletterStatus('Afegint...');
        try {
            const res = await fetch('/api/reader/sources', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newsletterName || newsletterAddress, url: newsletterAddress, type: newsletterType })
            });
            if (res.ok) {
                setNewsletterName(''); setNewsletterAddress(''); loadNewsletterSources();
                setNewsletterStatus('Fet!');
            } else { setNewsletterStatus('Error'); }
        } catch { setNewsletterStatus('Error'); }
    };

    // if (!draft.settings) return null; // Eliminar per evitar que el pare no renderitzi res

    return (
        <>
            <div className={`settings-overlay ${isOpen ? 'active' : ''}`} onClick={onClose} />
            <div className={`settings-modal ${isOpen ? 'active' : ''}`}>
                {!draft.settings ? (
                    <div className="flex items-center justify-center h-full">
                        <RefreshCw size={32} className="animate-spin text-[var(--gnosi-blue)]" />
                    </div>
                ) : (
                    <div className="settings-inner">
                    
                    {/* SIDEBAR */}
                    <aside className="settings-sidebar">
                        <div className="settings-sidebar-header">
                            <div className="settings-sidebar-brand">
                                <div className="settings-brand-icon-wrap">
                                    <SettingsIcon size={18} />
                                </div>
                                <h2 className="settings-sidebar-title">{t('settings.title') || 'Configuració'}</h2>
                            </div>
                            
                            {/* INDICADOR DE SAVING (Mogut aquí per visibilitat) */}
                            <div style={{ 
                                marginTop: '15px', padding: '10px 14px', borderRadius: '14px', 
                                background: 'var(--settings-sidebar-active)', border: '1px solid var(--settings-border)', 
                                display: 'flex', alignItems: 'center', gap: '10px', transition: 'all 0.3s'
                            }}>
                                {savingStatus === 'saving' ? (
                                    <RefreshCw size={14} className="animate-spin text-[var(--gnosi-blue)]" />
                                ) : (
                                    <Check size={14} style={{ color: savingStatus === 'error' ? '#ef4444' : '#10b981', opacity: savingStatus === 'idle' ? 0.4 : 1 }} />
                                )}
                                <span style={{ 
                                    fontSize: '0.72rem', fontWeight: '800', 
                                    color: savingStatus === 'error' ? '#ef4444' : 'var(--text-secondary)',
                                    opacity: savingStatus === 'idle' ? 0.6 : 1
                                }}>
                                    {savingStatus === 'saving' ? 'Desant...' : 
                                     (savingStatus === 'error' ? 'Error' : 
                                     (savingStatus === 'saved' ? 'Desat' : 'Al dia'))}
                                </span>
                            </div>
                        </div>

                        <div className="settings-sidebar-nav">
                            <SidebarItem id="general" icon={SettingsIcon} label={t('settings.tabs.general') || 'General'} active={activeTab === 'general'} onClick={() => { setActiveTab('general'); setAddAccountType(null); }} />
                            <SidebarItem id="language" icon={Globe} label={t('settings.tabs.language') || 'Idioma i Regió'} active={activeTab === 'language'} onClick={() => { setActiveTab('language'); setAddAccountType(null); }} />
                            <SidebarItem id="appearance" icon={Palette} label={t('settings.tabs.appearance') || 'Aparença'} active={activeTab === 'appearance'} onClick={() => { setActiveTab('appearance'); setAddAccountType(null); }} />
                            
                            <div style={{ height: '1px', background: 'var(--settings-border)', margin: '18px 14px', opacity: 0.6 }} />
                            
                            <SidebarItem id="calendar" icon={Calendar} label={t('settings.tabs.calendar') || 'Calendari'} active={activeTab === 'calendar'} onClick={() => { setActiveTab('calendar'); setAddAccountType(null); }} />
                            <SidebarItem id="contacts" icon={Users} label={t('settings.tabs.contacts') || 'Contactes'} active={activeTab === 'contacts'} onClick={() => { setActiveTab('contacts'); setAddAccountType(null); }} />
                            <SidebarItem id="mail" icon={Mail} label={t('settings.tabs.mail_accounts') || 'Correu Electrònic'} active={activeTab === 'mail'} onClick={() => { setActiveTab('mail'); setAddAccountType(null); }} />
                            
                            <div style={{ height: '1px', background: 'var(--settings-border)', margin: '18px 14px', opacity: 0.6 }} />

                            <SidebarItem id="newsletters" icon={Rss} label={t('settings.tabs.newsletters') || 'Subscripcions'} active={activeTab === 'newsletters'} onClick={() => { setActiveTab('newsletters'); setAddAccountType(null); }} />
                            <SidebarItem id="graph" icon={Share2} label={t('settings.tabs.graph') || 'Grafe'} active={activeTab === 'graph'} onClick={() => { setActiveTab('graph'); setAddAccountType(null); }} />
                            <SidebarItem id="ai" icon={Cpu} label={t('settings.tabs.ai') || 'IA i Agents'} active={activeTab === 'ai'} onClick={() => { setActiveTab('ai'); setAddAccountType(null); }} />
                            <SidebarItem id="zotero" icon={BookOpen} label={t('settings.tabs.zotero') || 'Zotero'} active={activeTab === 'zotero'} onClick={() => { setActiveTab('zotero'); setAddAccountType(null); }} />
                        </div>

                    </aside>

                    {/* CONTENT AREA */}
                    <main className="settings-main">
                        <button onClick={onClose} className="settings-close-btn" aria-label="Tancar configuració">
                            <X size={22} />
                        </button>

                        <div className="settings-content-wrap">
                            
                            {/* GENERAL */}
                            {activeTab === 'general' && (
                                <Section title="Configuració del Sistema" icon={SettingsIcon}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
                                        <FormGroup label="Nom d'usuari" description="Com et diran els agents d'IA.">
                                            <input type="text" className="gnosi-input" value={draft.settings.user_name} onChange={e => setDraft({...draft, settings: {...draft.settings, user_name: e.target.value}})} placeholder="Ismael Garcia" />
                                        </FormGroup>
                                        <FormGroup label="Nom del Workspace" description="Identificador del teu cervell digital.">
                                            <input type="text" className="gnosi-input" value={draft.settings.workspace_name} onChange={e => setDraft({...draft, settings: {...draft.settings, workspace_name: e.target.value}})} placeholder="Meu Cervell Digital" />
                                        </FormGroup>
                                    </div>

                                    <FormGroup label="Tipus de Workspace" description="El mode organització permet configurar múltiples usuaris i polítiques de dades.">
                                        <div className="segmented-control" style={{ display: 'flex', background: 'var(--settings-sidebar-bg)', padding: '6px', borderRadius: '18px', border: '1px solid var(--settings-border)' }}>
                                            {['personal', 'org'].map(m => (
                                                <button key={m} onClick={() => setDraft({...draft, settings: {...draft.settings, gnosi_mode: m}})} style={{
                                                    flex: 1, padding: '12px', borderRadius: '14px', border: 'none', cursor: 'pointer',
                                                    background: draft.settings.gnosi_mode === m ? 'var(--gnosi-blue)' : 'transparent',
                                                    color: draft.settings.gnosi_mode === m ? 'white' : 'var(--text-secondary)',
                                                    fontWeight: '800', fontSize: '0.95rem', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                                                }}>{m === 'personal' ? 'Ús Personal' : 'Organització'}</button>
                                            ))}
                                        </div>
                                    </FormGroup>

                                    {draft.settings.gnosi_mode === 'org' && (
                                        <div className="animate-in" style={{ marginTop: '30px', padding: '30px', borderRadius: '24px', background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.1)' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                                                <FormGroup label="Usuari Admin Org"><input type="text" className="gnosi-input" value={draft.settings.org_user} onChange={e => setDraft({...draft, settings: {...draft.settings, org_user: e.target.value}})} /></FormGroup>
                                                <FormGroup label="Pasword Admin"><input type="password" icon={Shield} className="gnosi-input" value={draft.settings.org_password} onChange={e => setDraft({...draft, settings: {...draft.settings, org_password: e.target.value}})} /></FormGroup>
                                            </div>
                                        </div>
                                    )}

                                    <div style={{ marginTop: '50px' }}>
                                        <Section title="Estructura de Fitxers" icon={FolderOpen}>
                                            <FormGroup label="Ruta del Vault" description="Carpeta principal on s'emmgatzemen totes les dades del sistema.">
                                                <div style={{ display: 'flex', gap: '14px' }}>
                                                    <input type="text" className="gnosi-input" value={draft.paths.vault || ''} readOnly style={{ flex: 1, opacity: 0.7, fontFamily: 'monospace', fontSize: '0.82rem', letterSpacing: '0' }} />
                                                    <button onClick={() => { setPickerField('vault'); setPickerOpen(true); }} className="btn-gnosi-secondary" style={{ padding: '0 24px', borderRadius: '14px', border: 'none', background: 'var(--gnosi-blue)20', color: 'var(--gnosi-blue)', flexShrink: 0 }}>
                                                        <FolderOpen size={18} />
                                                    </button>
                                                </div>
                                            </FormGroup>
                                        </Section>
                                    </div>
                                </Section>
                            )}

                            {/* IDIOMA I REGIÓ */}
                            {activeTab === 'language' && (
                                <Section title="Idioma i Localització" icon={Globe}>
                                    <FormGroup label="Seleccionar Idioma" description="L'idioma general de la interfície i dels agents d'IA.">
                                        <select className="gnosi-select" value={draft.settings.language} onChange={e => {
                                            const code = e.target.value;
                                            setDraft({...draft, settings: {...draft.settings, language: code}});
                                            i18n.changeLanguage(code);
                                        }}>
                                            {LANGUAGES.map(lang => (
                                                <option key={lang.code} value={lang.code}>{lang.icon} {lang.label}</option>
                                            ))}
                                        </select>
                                    </FormGroup>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', borderTop: '1px solid var(--settings-border)', paddingTop: '44px' }}>
                                        <FormGroup label="Primer dia de la setmana">
                                            <select className="gnosi-select" value={draft.settings.week_start} onChange={e => setDraft({...draft, settings: {...draft.settings, week_start: parseInt(e.target.value)}})}>
                                                <option value={1}>Dilluns (ISO)</option>
                                                <option value={0}>Diumenge (US)</option>
                                            </select>
                                        </FormGroup>
                                        <FormGroup label="Moneda de referència">
                                            <select className="gnosi-select" value={draft.settings.currency} onChange={e => setDraft({...draft, settings: {...draft.settings, currency: e.target.value}})}>
                                                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </FormGroup>
                                        <FormGroup label="Símbol decimal">
                                            <select className="gnosi-select" value={draft.settings.decimal_symbol} onChange={e => setDraft({...draft, settings: {...draft.settings, decimal_symbol: e.target.value}})}>
                                                {DECIMAL_SYMBOLS.map(s => <option key={s} value={s}>{s === ',' ? 'Coma (,)' : 'Punt (.)'}</option>)}
                                            </select>
                                        </FormGroup>
                                    </div>
                                </Section>
                            )}

                            {/* APARENÇA */}
                            {activeTab === 'appearance' && (
                                <Section title="Aparença i Estil" icon={Palette}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '56px' }}>
                                        {[
                                            { id: 'light', label: 'Clar', icon: Monitor, bg: '#ffffff' },
                                            { id: 'dark', label: 'Fosc', icon: Monitor, bg: '#000000' },
                                            { id: 'system', label: 'Sistema', icon: Monitor, bg: 'linear-gradient(135deg, #fff 50%, #000 50%)' }
                                        ].map(opt => (
                                            <button key={opt.id} onClick={() => setDraft({...draft, settings: {...draft.settings, theme: opt.id}})} style={{
                                                padding: '12px', borderRadius: '24px', border: `2px solid ${draft.settings.theme === opt.id ? 'var(--gnosi-blue)' : 'var(--settings-border)'}`,
                                                background: draft.settings.theme === opt.id ? 'rgba(59, 130, 246, 0.05)' : 'transparent', cursor: 'pointer', transition: 'all 0.3s'
                                            }}>
                                                <div style={{ height: '80px', borderRadius: '16px', background: opt.bg, border: '1px solid var(--settings-border)', marginBottom: '12px', boxShadow: '0 8px 20px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <Monitor size={24} color={opt.id === 'light' ? '#ccc' : (opt.id === 'dark' ? '#444' : '#888')} />
                                                </div>
                                                <div style={{ fontWeight: '800', fontSize: '0.9rem', color: 'var(--text-primary)', textAlign: 'center' }}>{opt.label}</div>
                                            </button>
                                        ))}
                                    </div>

                                    <div style={{ background: 'var(--settings-sidebar-bg)', padding: '32px', borderRadius: '28px', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 10px 30px rgba(0,0,0,0.03)' }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: '900', color: 'var(--text-primary)', fontSize: '1.15rem' }}>Efectes i Animacions Neutres</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '6px', opacity: 0.8, maxWidth: '420px' }}>Redueix la càrrega visual eliminant transicions innecessàries i optimitzant el rendiment.</div>
                                        </div>
                                        <div className={`gnosi-toggle ${draft.settings.reduce_animations ? 'active' : ''}`} onClick={() => setDraft({...draft, settings: {...draft.settings, reduce_animations: !draft.settings.reduce_animations}})} style={{ transform: 'scale(1.2)' }}>
                                            <div className="gnosi-toggle-handle" />
                                        </div>
                                    </div>
                                </Section>
                            )}

                            {/* CALENDAR, CONTACTS, MAIL */}
                            {(activeTab === 'calendar' || activeTab === 'contacts' || activeTab === 'mail') && (
                                <Section 
                                    title={activeTab === 'calendar' ? 'Gestió de Calendaris' : (activeTab === 'contacts' ? 'Sincronització de Contactes' : 'Comptes de Correu')} 
                                    icon={activeTab === 'calendar' ? Calendar : (activeTab === 'contacts' ? Users : Mail)}
                                    extra={
                                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                            <div style={{ position: 'relative' }}>
                                                <button 
                                                    onClick={() => {
                                                        if (activeTab === 'calendar') {
                                                            if (!addAccountType && !isAddingTable) {
                                                                setAddAccountType('menu');
                                                            } else {
                                                                setAddAccountType(null);
                                                                setIsAddingTable(false);
                                                            }
                                                        } else {
                                                            setAddAccountType(addAccountType === activeTab ? null : activeTab);
                                                        }
                                                        setIsManualGoogle(false);
                                                    }}
                                                    className="btn-gnosi-primary" 
                                                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.85rem', borderRadius: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                                                >
                                                    {(addAccountType || isAddingTable) ? <X size={16} /> : <Plus size={16} />}
                                                    {(addAccountType || isAddingTable) ? 'Cancel·lar' : 'Afegir Compte'}
                                                </button>
                                                
                                                {addAccountType === 'menu' && (
                                                    <div className="animate-in" style={{ 
                                                        position: 'absolute', top: '100%', right: 0, marginTop: '10px', 
                                                        background: 'var(--settings-bg)', border: '1px solid var(--settings-border)',
                                                        borderRadius: '16px', boxShadow: '0 15px 40px rgba(0,0,0,0.2)', 
                                                        zIndex: 1000, width: '220px', overflow: 'hidden', padding: '6px'
                                                    }}>
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); setIsAddingTable(true); setAddAccountType(null); }}
                                                            className="hover-bg"
                                                            style={{ width: '100%', padding: '12px 16px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-primary)', fontWeight: '700' }}
                                                        >
                                                            <Database size={16} color="var(--gnosi-blue)" /> Taula del Vault
                                                        </button>
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); setAddAccountType('calendar'); }}
                                                            className="hover-bg"
                                                            style={{ width: '100%', padding: '12px 16px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-primary)', fontWeight: '700' }}
                                                        >
                                                            <Globe size={16} color="var(--gnosi-blue)" /> Compte Extern
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    }
                                >
                                    <div style={{ minHeight: '340px', marginTop: '20px' }}>
                                        {isAddingTable && (
                                            <div className="animate-in" style={{ 
                                                marginBottom: '32px', padding: '28px', borderRadius: '28px', 
                                                background: 'var(--settings-sidebar-bg)', border: '1px solid var(--gnosi-blue)30',
                                                boxShadow: '0 15px 40px rgba(59, 130, 246, 0.12)'
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                                    <span style={{ fontSize: '0.85rem', fontWeight: '1000', color: 'var(--gnosi-blue)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Selecciona una taula del Vault</span>
                                                    <button onClick={() => setIsAddingTable(false)} className="icon-btn hover-bg-strong" style={{ padding: '8px', borderRadius: '12px' }}><X size={18} /></button>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', maxHeight: '400px', overflowY: 'auto', padding: '4px' }}>
                                                    {tables.filter(t => !integrations.vault_calendar?.enabled_tables?.includes(t.id)).map(tbl => (
                                                        <button 
                                                            key={tbl.id}
                                                            onClick={async () => {
                                                                const newList = [...(integrations.vault_calendar?.enabled_tables || []), tbl.id];
                                                                const updated = { ...integrations, vault_calendar: { ...integrations.vault_calendar, enabled_tables: newList } };
                                                                setIntegrations(updated);
                                                                axios.post('/api/integrations/bulk', updated).catch(console.error);
                                                                setIsAddingTable(false);
                                                            }}
                                                            style={{ 
                                                                display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', 
                                                                border: '1px solid var(--settings-border)', borderRadius: '16px', 
                                                                background: 'var(--settings-bg)', cursor: 'pointer', fontWeight: '800', 
                                                                color: 'var(--text-primary)', transition: 'all 0.2s', textAlign: 'left'
                                                            }}
                                                            className="hover-bg-strong"
                                                        >
                                                            <div style={{ background: 'var(--settings-sidebar-bg)', padding: '8px', borderRadius: '10px' }}>
                                                                <Database size={16} color="var(--gnosi-blue)" />
                                                            </div>
                                                            {tbl.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {addAccountType === activeTab && (
                                            <div className="animate-in" style={{ 
                                                marginBottom: '32px', padding: '28px', borderRadius: '28px', 
                                                background: 'var(--settings-sidebar-bg)', border: '1px solid var(--gnosi-blue)30',
                                                boxShadow: '0 15px 40px rgba(59, 130, 246, 0.12)'
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                                    <span style={{ fontSize: '0.85rem', fontWeight: '1000', color: 'var(--gnosi-blue)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Configuració del Compte</span>
                                                    <button onClick={() => { setAddAccountType(null); setAddAccountEmail(''); setIsManualGoogle(false); setManualServer(''); setManualPassword(''); setEditingAccountId(null); }} className="icon-btn hover-bg-strong" style={{ padding: '8px', borderRadius: '12px' }}><X size={18} /></button>
                                                </div>
                                                
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                    <FormGroup label="Adreça de Correu">
                                                        <input 
                                                            type="email" 
                                                            className="gnosi-input" 
                                                            value={addAccountEmail} 
                                                            onChange={e => {
                                                                setAddAccountEmail(e.target.value);
                                                                setIsManualGoogle(false);
                                                            }}
                                                            placeholder="exemple@pangea.org"
                                                            autoFocus
                                                        />
                                                    </FormGroup>

                                                    {(addAccountEmail.trim().toLowerCase().endsWith('@gmail.com') || addAccountEmail.trim().toLowerCase().endsWith('@googlemail.com') || isManualGoogle) ? (
                                                        <button 
                                                            onClick={() => window.location.href = `/api/auth/google/login?type=${activeTab}`}
                                                            className="btn-gnosi-primary animate-in" 
                                                            style={{ 
                                                                width: '100%', background: '#4285f4', padding: '16px', 
                                                                borderRadius: '16px', fontWeight: '900', display: 'flex', 
                                                                alignItems: 'center', justifyContent: 'center', gap: '14px',
                                                                boxShadow: '0 10px 20px rgba(66,133,244,0.2)', marginTop: '8px',
                                                                border: 'none', cursor: 'pointer', transition: 'all 0.2s'
                                                            }}
                                                        >
                                                            <div style={{ background: 'white', padding: '8px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                                                                <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_Logo.svg" style={{ width: '18px', height: '18px' }} alt="Google logo" />
                                                            </div>
                                                            <span style={{ color: 'white' }}>Continuar amb Google</span>
                                                        </button>
                                                    ) : activeTab === 'mail' ? (
                                                        <form onSubmit={async (e) => {
                                                            e.preventDefault();
                                                            if (!addAccountEmail) return;
                                                            
                                                            setSavingStatus('saving');
                                                            try {
                                                                const key = 'mail_accounts';
                                                                const currentList = integrations[key] || [];
                                                                let newList;
                                                                const mailAcc = {
                                                                    id: editingAccountId || `mail_${Date.now()}`,
                                                                    email: addAccountEmail,
                                                                    provider: 'manual',
                                                                    imap_host: mailImapHost,
                                                                    imap_port: mailImapPort,
                                                                    imap_user: mailImapUser,
                                                                    imap_password: mailImapPass,
                                                                    imap_encryption: mailImapEnc,
                                                                    smtp_host: mailSmtpHost,
                                                                    smtp_port: mailSmtpPort,
                                                                    smtp_user: mailSmtpUser,
                                                                    smtp_password: mailSmtpPass,
                                                                    smtp_encryption: mailSmtpEnc,
                                                                    signature: mailSignature,
                                                                    certificate: mailCertificate,
                                                                    type: 'mail'
                                                                };
                                                                
                                                                if (editingAccountId) {
                                                                    newList = currentList.map(a => a.id === editingAccountId ? mailAcc : a);
                                                                } else {
                                                                    newList = [...currentList, mailAcc];
                                                                }
                                                                
                                                                await axios.post('/api/integrations/bulk', {
                                                                    ...integrations,
                                                                    [key]: newList
                                                                });
                                                                
                                                                setSavingStatus('saved');
                                                                setAddAccountType(null);
                                                                setAddAccountEmail('');
                                                                setMailImapHost(''); setMailImapPort('993'); setMailImapUser(''); setMailImapPass(''); setMailImapEnc('ssl');
                                                                setMailSmtpHost(''); setMailSmtpPort('465'); setMailSmtpUser(''); setMailSmtpPass(''); setMailSmtpEnc('ssl');
                                                                setMailSignature(''); setMailCertificate('');
                                                                setEditingAccountId(null);
                                                                
                                                                loadIntegrations();
                                                                setTimeout(() => setSavingStatus('idle'), 2000);
                                                            } catch (err) {
                                                                console.error(err);
                                                                setSavingStatus('error');
                                                            }
                                                        }} className="animate-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                                            {/* SECCIÓ IMAP */}
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', background: 'var(--settings-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
                                                                <h4 style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--gnosi-blue)', fontWeight: '900', textTransform: 'uppercase' }}>Servidor IMAP (Recepció)</h4>
                                                                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
                                                                    <FormGroup label="Servidor"><input type="text" className="gnosi-input" value={mailImapHost} onChange={e => setMailImapHost(e.target.value)} placeholder="imap.pangea.org" /></FormGroup>
                                                                    <FormGroup label="Port"><input type="text" className="gnosi-input" value={mailImapPort} onChange={e => setMailImapPort(e.target.value)} placeholder="993" /></FormGroup>
                                                                </div>
                                                                <FormGroup label="Usuari"><input type="text" className="gnosi-input" value={mailImapUser} onChange={e => setMailImapUser(e.target.value)} /></FormGroup>
                                                                <FormGroup label="Contrasenya"><input type="password" className="gnosi-input" value={mailImapPass} onChange={e => setMailImapPass(e.target.value)} placeholder="••••••••" /></FormGroup>
                                                                <FormGroup label="Seguretat">
                                                                    <select className="gnosi-select" value={mailImapEnc} onChange={e => setMailImapEnc(e.target.value)}>
                                                                        <option value="ssl">SSL/TLS</option>
                                                                        <option value="starttls">STARTTLS</option>
                                                                        <option value="none">Cap</option>
                                                                    </select>
                                                                </FormGroup>
                                                            </div>

                                                            {/* SECCIÓ SMTP */}
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', background: 'var(--settings-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
                                                                <h4 style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--gnosi-blue)', fontWeight: '900', textTransform: 'uppercase' }}>Servidor SMTP (Enviament)</h4>
                                                                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
                                                                    <FormGroup label="Servidor"><input type="text" className="gnosi-input" value={mailSmtpHost} onChange={e => setMailSmtpHost(e.target.value)} placeholder="smtp.pangea.org" /></FormGroup>
                                                                    <FormGroup label="Port"><input type="text" className="gnosi-input" value={mailSmtpPort} onChange={e => setMailSmtpPort(e.target.value)} placeholder="465" /></FormGroup>
                                                                </div>
                                                                <FormGroup label="Usuari"><input type="text" className="gnosi-input" value={mailSmtpUser} onChange={e => setMailSmtpUser(e.target.value)} /></FormGroup>
                                                                <FormGroup label="Contrasenya"><input type="password" className="gnosi-input" value={mailSmtpPass} onChange={e => setMailSmtpPass(e.target.value)} placeholder="••••••••" /></FormGroup>
                                                                <FormGroup label="Seguretat">
                                                                    <select className="gnosi-select" value={mailSmtpEnc} onChange={e => setMailSmtpEnc(e.target.value)}>
                                                                        <option value="ssl">SSL/TLS</option>
                                                                        <option value="starttls">STARTTLS</option>
                                                                        <option value="none">Cap</option>
                                                                    </select>
                                                                </FormGroup>
                                                            </div>

                                                            <div style={{ gridColumn: 'span 2' }}>
                                                                <FormGroup label="Signatura HTML (Opcional)" description="Aquesta signatura s'afegirà automàticament als correus que enviïs.">
                                                                    <div style={{ marginTop: '8px' }}>
                                                                        <MailBlockEditor 
                                                                            initialContent={mailSignature} 
                                                                            onChange={setMailSignature} 
                                                                            minHeight="120px" 
                                                                        />
                                                                    </div>
                                                                </FormGroup>
                                                            </div>
                                                            <div style={{ gridColumn: 'span 2' }}>
                                                                <FormGroup label="Certificat / Ruta Clau (Opcional)">
                                                                    <input type="text" className="gnosi-input" value={mailCertificate} onChange={e => setMailCertificate(e.target.value)} placeholder="/ruta/al/certificat.crt" />
                                                                </FormGroup>
                                                            </div>
                                                            
                                                            <div style={{ gridColumn: 'span 2', marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
                                                                <button type="submit" className="btn-gnosi-primary" style={{ padding: '12px 24px', fontSize: '0.9rem' }}>
                                                                    Connectar Compte
                                                                </button>
                                                            </div>
                                                        </form>
                                                    ) : (
                                                        <form onSubmit={async (e) => {
                                                            e.preventDefault();
                                                            if (!addAccountEmail) return;
                                                            if (activeTab !== 'mail' && (!manualServer || !manualPassword)) return;
                                                            
                                                            setSavingStatus('saving');
                                                            try {
                                                                const key = activeTab === 'calendar' ? 'calendars' : (activeTab === 'contacts' ? 'contacts' : 'mail_accounts');
                                                                const currentList = integrations[key] || [];
                                                                let newList;
                                                                const newAcc = {
                                                                    id: editingAccountId || `manual_${Date.now()}`,
                                                                    email: addAccountEmail,
                                                                    username: addAccountEmail,
                                                                    provider: 'manual',
                                                                    server_url: manualServer,
                                                                    password: manualPassword,
                                                                    type: activeTab
                                                                };
                                                                if (editingAccountId) {
                                                                    newList = currentList.map(a => a.id === editingAccountId ? { ...a, ...newAcc } : a);
                                                                } else {
                                                                    newList = [...currentList, newAcc];
                                                                }

                                                                await axios.post('/api/integrations/bulk', {
                                                                    ...integrations,
                                                                    [key]: newList
                                                                });

                                                                setSavingStatus('saved');
                                                                setAddAccountType(null);
                                                                setAddAccountEmail('');
                                                                setIsManualGoogle(false);
                                                                setManualServer('');
                                                                setManualPassword('');
                                                                setEditingAccountId(null);
                                                                
                                                                loadIntegrations();
                                                                setTimeout(() => setSavingStatus('idle'), 2000);
                                                            } catch (err) {
                                                                console.error(err);
                                                                setSavingStatus('error');
                                                            }
                                                        }} className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                            <FormGroup label="Servidor URL" description="Ex: caldav.pangea.org o imap.pangea.org">
                                                                <input 
                                                                    type="text" 
                                                                    className="gnosi-input" 
                                                                    value={manualServer} 
                                                                    onChange={e => setManualServer(e.target.value)} 
                                                                    placeholder="https://..." 
                                                                />
                                                            </FormGroup>
                                                            <FormGroup label="Contrasenya">
                                                                <input 
                                                                    type="password" 
                                                                    className="gnosi-input" 
                                                                    value={manualPassword} 
                                                                    onChange={e => setManualPassword(e.target.value)} 
                                                                    placeholder="••••••••" 
                                                                />
                                                            </FormGroup>
                                                            
                                                            <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                                                                <button type="submit" className="btn-gnosi-primary" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '14px 24px', flex: 1, fontWeight: '900', border: 'none', borderRadius: '16px', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 10px 20px rgba(59, 130, 246, 0.2)' }}>
                                                                    <Check size={18} />
                                                                    {editingAccountId ? 'Actualitzar Compte' : 'Connectar Compte'}
                                                                </button>

                                                                {addAccountEmail.includes('@') && (
                                                                    <button 
                                                                        onClick={() => setIsManualGoogle(true)}
                                                                        className="btn-gnosi-secondary"
                                                                        style={{ padding: '14px', borderRadius: '14px', fontSize: '0.8rem' }}
                                                                    >
                                                                        És de Google?
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </form>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {(() => {
                                            const currentAccounts = [
                                                ...(activeTab === 'calendar' ? (integrations.calendars || []) : (activeTab === 'contacts' ? (integrations.contacts || []) : (integrations.mail_accounts || []))),
                                                ...(integrations.emails || []).filter(e => {
                                                    if (activeTab === 'calendar') return e.provider === 'google' || e.auth_type === 'oauth2';
                                                    if (activeTab === 'contacts') return e.provider === 'google';
                                                    if (activeTab === 'mail') return true;
                                                    return false;
                                                })
                                            ];
                                            
                                            // Deduplicate by ID or Email
                                            const seen = new Set();
                                            const uniqueAccounts = currentAccounts.filter(acc => {
                                                const id = acc.id || acc.email;
                                                if (seen.has(id)) return false;
                                                seen.add(id);
                                                return true;
                                            });

                                            const vaultCalendars = activeTab === 'calendar' ? (tables.filter(t => integrations.vault_calendar?.enabled_tables?.includes(t.id))) : [];
                                            const hasAny = (uniqueAccounts.length > 0) || (vaultCalendars.length > 0);
                                            
                                            if (hasAny) {
                                                return (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                        {/* Comptes Externs / Integracions */}
                                                        {uniqueAccounts.map((acc, idx) => (
                                                            <AccountRow 
                                                                key={`acc-${idx}`} 
                                                                name={acc.name || acc.email} 
                                                                description={acc.username || acc.email} 
                                                                status="connected" 
                                                                type={activeTab} 
                                                                provider={acc.provider}
                                                                onSync={() => handleSyncAccount(activeTab, acc.id)}
                                                                isSyncing={syncingAccounts[acc.id]}
                                                                onEdit={() => handleEditAccount(activeTab, acc)}
                                                                onDelete={() => handleDeleteAccount(activeTab, acc.id)}
                                                                color={activeTab === 'calendar' ? '#3b82f6' : (activeTab === 'contacts' ? '#10b981' : '#f59e0b')} 
                                                            />
                                                        ))}
                                                        
                                                        {/* Taules del Vault (només per a Calendari) */}
                                                        {vaultCalendars.map((tbl, idx) => {
                                                            const tblColor = integrations.calendar_colors?.[tbl.id] || integrations.calendar_colors?.[`${tbl.name}`] || '#6366f1';
                                                            return (
                                                                <AccountRow 
                                                                    key={`vault-${idx}`} 
                                                                    name={tbl.name} 
                                                                    description="Taula del Vault" 
                                                                    status="connected" 
                                                                    type="calendar" 
                                                                    provider="vault"
                                                                    onEdit={() => setEditingTableColor({ id: tbl.id, name: tbl.name, color: tblColor })}
                                                                    onDelete={() => {
                                                                        const newList = integrations.vault_calendar?.enabled_tables?.filter(id => id !== tbl.id) || [];
                                                                        const updated = { ...integrations, vault_calendar: { ...integrations.vault_calendar, enabled_tables: newList } };
                                                                        setIntegrations(updated);
                                                                        axios.post('/api/integrations/bulk', updated).catch(console.error);
                                                                    }}
                                                                    color={tblColor} 
                                                                />
                                                            );
                                                        })}

                                                        {/* Sub-modal per a canviar el color de la taula */}
                                                        {editingTableColor && (
                                                            <div className="account-edit-overlay" style={{
                                                                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', 
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000
                                                            }}>
                                                                <div style={{ background: 'var(--settings-bg)', padding: '30px', borderRadius: '24px', width: '400px', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
                                                                    <h3 style={{ margin: '0 0 20px 0', fontSize: '1.2rem', fontWeight: 800 }}>Color de {editingTableColor.name}</h3>
                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '25px' }}>
                                                                        {['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#6366f1', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#71717a'].map(c => (
                                                                            <button 
                                                                                key={c} 
                                                                                onClick={() => setEditingTableColor({ ...editingTableColor, color: c })}
                                                                                style={{ 
                                                                                    height: '40px', borderRadius: '10px', border: editingTableColor.color === c ? '3px solid var(--text-primary)' : 'none',
                                                                                    background: c, cursor: 'pointer' 
                                                                                }}
                                                                            />
                                                                        ))}
                                                                    </div>
                                                                    <div style={{ display: 'flex', gap: '10px' }}>
                                                                        <button 
                                                                            onClick={() => {
                                                                                const updatedColors = { ...(integrations.calendar_colors || {}), [editingTableColor.id]: editingTableColor.color };
                                                                                const updated = { ...integrations, calendar_colors: updatedColors };
                                                                                setIntegrations(updated);
                                                                                axios.post('/api/integrations/bulk', updated).catch(console.error);
                                                                                setEditingTableColor(null);
                                                                            }}
                                                                            className="btn-gnosi-primary" style={{ flex: 1, padding: '12px' }}
                                                                        >Guardar</button>
                                                                        <button onClick={() => setEditingTableColor(null)} className="btn-gnosi-secondary" style={{ flex: 1, padding: '12px' }}>Cancel·lar</button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            } else {
                                                return !addAccountType && !isAddingTable && (
                                                    <div style={{ textAlign: 'center', padding: '100px 40px', background: 'var(--settings-sidebar-bg)', borderRadius: '28px', border: '2px dashed var(--settings-border)', opacity: 0.6 }}>
                                                        <div style={{ width: '80px', height: '80px', background: 'var(--settings-bg)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 28px auto', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
                                                            {activeTab === 'calendar' ? <Calendar size={40} strokeWidth={1.5} /> : (activeTab === 'contacts' ? <Users size={40} strokeWidth={1.5} /> : <Mail size={40} strokeWidth={1.5} />)}
                                                        </div>
                                                        <div style={{ fontWeight: '900', fontSize: '1.3rem', color: 'var(--text-primary)' }}>No hi ha comptes connectats</div>
                                                        <p style={{ fontSize: '0.95rem', marginTop: '12px', maxWidth: '300px', margin: '12px auto 0' }}>Connecta un servei per automatitzar el teu flux d'informació.</p>
                                                    </div>
                                                );
                                            }
                                        })()}
                                    </div>
                                </Section>
                            )}

                            {/* NEWSLETTERS */}
                            {activeTab === 'newsletters' && (
                                <Section title="Fonts d'Informació" icon={Rss} extra={
                                    <button onClick={() => newsletterOpmlRef.current?.click()} className="btn-gnosi-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.85rem', borderRadius: '12px', whiteSpace: 'nowrap' }}><FileUp size={16} /> Importar OPML</button>
                                }>
                                    <input ref={newsletterOpmlRef} type="file" accept=".opml,.xml" style={{ display: 'none' }} />
                                    
                                    <div className="animate-in" style={{ background: 'var(--settings-sidebar-bg)', padding: '36px', borderRadius: '28px', border: '1px solid var(--settings-border)', marginBottom: '40px', boxShadow: '0 12px 40px rgba(0,0,0,0.05)' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '28px' }}>
                                            <FormGroup label="Nom de la Font"><input type="text" className="gnosi-input" value={newsletterName} onChange={e => setNewsletterName(e.target.value)} placeholder="Ej: TechCrunch / Perplexity" /></FormGroup>
                                            <FormGroup label="URL del Feed"><input type="text" className="gnosi-input" value={newsletterAddress} onChange={e => setNewsletterAddress(e.target.value)} placeholder="https://..." /></FormGroup>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', gap: '10px' }}>
                                                {['rss', 'youtube', 'newsletter'].map(t => (
                                                    <button key={t} onClick={() => setNewsletterType(t)} style={{
                                                        padding: '10px 20px', borderRadius: '12px', border: '1px solid var(--settings-border)',
                                                        background: newsletterType === t ? 'var(--gnosi-blue)' : 'transparent',
                                                        color: newsletterType === t ? 'white' : 'var(--text-secondary)',
                                                        fontSize: '0.85rem', fontWeight: '900', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em'
                                                    }}>{t}</button>
                                                ))}
                                            </div>
                                            <button onClick={handleAddNewsletter} className="btn-gnosi-primary" style={{ padding: '12px 32px', borderRadius: '14px' }}>Afegir Font</button>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                        {newsletterSources.map(s => (
                                            <div key={s.id} className="account-row hover-scale" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 30px', borderRadius: '24px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '22px' }}>
                                                    <div style={{ width: '56px', height: '56px', background: 'rgba(59,130,246,0.12)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem' }}>
                                                        {s.type === 'rss' ? '📰' : (s.type === 'youtube' ? '📺' : '📧')}
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: '900', color: 'var(--text-primary)', fontSize: '1.15rem' }}>{s.name}</div>
                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', opacity: 0.7, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.url}</div>
                                                    </div>
                                                </div>
                                                <button onClick={() => {
                                                    setConfirmConfig({
                                                        isOpen: true,
                                                        title: 'Eliminar Subscripció',
                                                        message: `Estàs segur que vols eliminar la font "${s.name}"?`,
                                                        onConfirm: async () => {
                                                            try {
                                                                await fetch(`/api/reader/sources/${s.id}`, { method: 'DELETE' });
                                                                loadNewsletterSources();
                                                                setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                                                            } catch (e) {
                                                                console.error("Error deleting source:", e);
                                                            }
                                                        }
                                                    });
                                                }} style={{ color: '#ef4444', border: 'none', background: 'transparent', cursor: 'pointer', padding: '12px', borderRadius: '12px' }} className="hover-bg-danger"><Trash2 size={24} /></button>
                                            </div>
                                        ))}
                                    </div>
                                </Section>
                            )}

                            {/* GRAF */}
                            {activeTab === 'graph' && (
                                <Section title="Motor Visual del Grafe" icon={Share2}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '50px', marginBottom: '50px' }}>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
                                                <Palette size={18} color="var(--gnosi-blue)" />
                                                <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--gnosi-blue)', fontWeight: '1000', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Estètica</h4>
                                            </div>
                                            <FormGroup label={`Mida del Node: ${draft.graph.node_size.toFixed(1)}`}>
                                                <input type="range" className="gnosi-range" min="0.1" max="5" step="0.1" value={draft.graph.node_size} onChange={e => setDraft({...draft, graph: {...draft.graph, node_size: parseFloat(e.target.value)}})} />
                                            </FormGroup>
                                            <FormGroup label={`Gruix de l'Arc: ${draft.graph.edge_thickness.toFixed(1)}`}>
                                                <input type="range" className="gnosi-range" min="0.1" max="5" step="0.1" value={draft.graph.edge_thickness} onChange={e => setDraft({...draft, graph: {...draft.graph, edge_thickness: parseFloat(e.target.value)}})} />
                                            </FormGroup>
                                            <div style={{ marginTop: '20px', padding: '20px', background: 'var(--settings-sidebar-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
                                                <FormGroup label="Direccionalitat" description="Mostra fletxes per indicar relacions pare-fill." horizontal>
                                                    <div className={`gnosi-toggle ${draft.graph.show_arrows ? 'active' : ''}`} onClick={() => setDraft({...draft, graph: {...draft.graph, show_arrows: !draft.graph.show_arrows}})}>
                                                        <div className="gnosi-toggle-handle" />
                                                    </div>
                                                </FormGroup>
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
                                                <Zap size={18} color="var(--gnosi-blue)" />
                                                <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--gnosi-blue)', fontWeight: '1000', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Física Real-Time</h4>
                                            </div>
                                            <FormGroup label={`Gravetat: ${draft.graph.physics.gravity}`}>
                                                <input type="range" className="gnosi-range" min="0" max="2" step="0.05" value={draft.graph.physics.gravity} onChange={e => setDraft({...draft, graph: {...draft.graph, physics: {...draft.graph.physics, gravity: parseFloat(e.target.value)}}})} />
                                            </FormGroup>
                                            <FormGroup label={`Repulsió: ${draft.graph.physics.repulsion}`}>
                                                <input type="range" className="gnosi-range" min="0" max="10000" step="100" value={draft.graph.physics.repulsion} onChange={e => setDraft({...draft, graph: {...draft.graph, physics: {...draft.graph.physics, repulsion: parseInt(e.target.value)}}})} />
                                            </FormGroup>
                                            <FormGroup label={`Fricció: ${draft.graph.physics.friction}`}>
                                                <input type="range" className="gnosi-range" min="1" max="20" step="1" value={draft.graph.physics.friction} onChange={e => setDraft({...draft, graph: {...draft.graph, physics: {...draft.graph.physics, friction: parseInt(e.target.value)}}})} />
                                            </FormGroup>
                                        </div>
                                    </div>

                                    <Section title="Estructures Visibles" icon={Database}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                                            {/* Bases de dades i Taules */}
                                            <div style={{ background: 'var(--settings-bg)', borderRadius: '24px', border: '1px solid var(--settings-border)', overflow: 'hidden' }}>
                                                <div 
                                                    onClick={() => setIsDatabasesExpanded(!isDatabasesExpanded)}
                                                    className="hover-bg"
                                                    style={{ 
                                                        padding: '16px 24px', 
                                                        cursor: 'pointer', 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        justifyContent: 'space-between',
                                                        borderBottom: isDatabasesExpanded ? '1px solid var(--settings-border)' : 'none',
                                                        transition: 'all 0.3s ease',
                                                        background: isDatabasesExpanded ? 'var(--settings-sidebar-bg)' : 'transparent'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <Database size={18} color="var(--gnosi-blue)" />
                                                        <h5 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '800' }}>
                                                            {translations[language].databases || "Bases de dades"}
                                                        </h5>
                                                    </div>
                                                    <ChevronRight 
                                                        size={18} 
                                                        color="var(--text-secondary)" 
                                                        style={{ 
                                                            transform: isDatabasesExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                                            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                            opacity: 0.6
                                                        }} 
                                                    />
                                                </div>

                                                {isDatabasesExpanded && (
                                                    <div className="animate-in" style={{ padding: '24px' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                            {/* Render formal databases */}
                                                            {databases.map(db => {
                                                                const isDbVisible = draft.graph.visible_databases?.includes(db.id);
                                                                const dbTables = tables.filter(t => t.database_id === db.id);
                                                                
                                                                return (
                                                                <div key={db.id} style={{ marginBottom: isDbVisible ? '12px' : '0' }}>
                                                                    <div className="hover-scale" style={{ padding: '16px 20px', borderRadius: '18px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', gap: '16px', transition: 'all 0.2s' }}>
                                                                        <div className={`gnosi-toggle ${isDbVisible ? 'active' : ''}`} onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const checked = !isDbVisible;
                                                                            setDraft(prev => ({
                                                                                ...prev,
                                                                                graph: { ...prev.graph, visible_databases: checked ? [...(prev.graph.visible_databases||[]), db.id] : (prev.graph.visible_databases||[]).filter(id => id !== db.id) }
                                                                            }));
                                                                        }} style={{ transform: 'scale(0.8)' }}>
                                                                            <div className="gnosi-toggle-handle" />
                                                                        </div>
                                                                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: `${db.color || '#3b82f6'}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                            <Database size={16} color={db.color || '#3b82f6'} />
                                                                        </div>
                                                                        <span style={{ fontWeight: '900', fontSize: '0.9rem', color: 'var(--text-primary)' }}>{db.name}</span>
                                                                    </div>

                                                                    {isDbVisible && dbTables.length > 0 && (
                                                                        <div style={{ marginLeft: '40px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                                            {dbTables.map(table => {
                                                                                const isTableVisible = draft.graph.visible_tables?.includes(table.id);
                                                                                const tableFields = table.properties || [];
                                                                                
                                                                                return (
                                                                                    <div key={table.id}>
                                                                                        <div className="hover-scale" style={{ padding: '12px 16px', borderRadius: '14px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.2s' }}>
                                                                                            <div className={`gnosi-toggle ${isTableVisible ? 'active' : ''}`} onClick={(e) => {
                                                                                                e.stopPropagation();
                                                                                                const checked = !isTableVisible;
                                                                                                setDraft(prev => ({
                                                                                                    ...prev,
                                                                                                    graph: { ...prev.graph, visible_tables: checked ? [...(prev.graph.visible_tables||[]), table.id] : (prev.graph.visible_tables||[]).filter(id => id !== table.id) }
                                                                                                }));
                                                                                            }} style={{ transform: 'scale(0.7)' }}>
                                                                                                <div className="gnosi-toggle-handle" />
                                                                                            </div>
                                                                                            <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{table.name}</span>
                                                                                        </div>

                                                                                        {isTableVisible && tableFields.length > 0 && (
                                                                                            <div style={{ marginLeft: '30px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                                                {tableFields.map(field => {
                                                                                                    const fieldKey = `${table.id}:${field.name}`;
                                                                                                    const isExposed = draft.graph.visible_fields?.includes(fieldKey);
                                                                                                    const defaultVal = draft.graph.field_defaults?.[fieldKey] || '';
                                                                                                    return (
                                                                                                        <div key={field.name} style={{ padding: '10px 14px', borderRadius: '12px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                                                                                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>{field.name}</span>
                                                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => {
                                                                                                                    const checked = !isExposed;
                                                                                                                    setDraft(p => ({ ...p, graph: { ...p.graph, visible_fields: checked ? [...(p.graph.visible_fields||[]), fieldKey] : (p.graph.visible_fields||[]).filter(f => f !== fieldKey) } }));
                                                                                                                }}>
                                                                                                                    <div className={`gnosi-toggle ${isExposed ? 'active' : ''}`} style={{ transform: 'scale(0.6)', pointerEvents: 'none' }}><div className="gnosi-toggle-handle" /></div>
                                                                                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{translations[language]?.filter_exposed || "Filtre exposat"}</span>
                                                                                                                </div>
                                                                                                                <input type="text" className="gnosi-input" style={{ fontSize: '0.75rem', padding: '6px 10px', height: 'auto', width: '130px' }} placeholder="Valor fix / defecte" value={defaultVal} onChange={e => {
                                                                                                                    const v = e.target.value;
                                                                                                                    setDraft(p => ({ ...p, graph: { ...p.graph, field_defaults: { ...(p.graph.field_defaults||{}), [fieldKey]: v } } }));
                                                                                                                }} />
                                                                                                            </div>
                                                                                                        </div>
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

                                                            {/* Orphan Tables / Altres Estructures */}
                                                            {(() => {
                                                                const orphanTables = (tables || []).filter(t => !databases.some(db => db.id === t.database_id));
                                                                if (orphanTables.length === 0) return null;
                                                                
                                                                return (
                                                                    <div style={{ marginTop: '24px', borderTop: '1px dashed var(--settings-border)', paddingTop: '24px' }}>
                                                                        <h6 style={{ fontSize: '0.75rem', fontWeight: '800', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px' }}>
                                                                            {translations[language].other_structures || "Altres Taules i Estructures"}
                                                                        </h6>
                                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr)', gap: '14px' }}>
                                                                            {orphanTables.map(table => {
                                                                                const isTableVisible = draft.graph.visible_tables?.includes(table.id);
                                                                                const tableFields = table.properties || [];
                                                                                return (
                                                                                    <div key={table.id}>
                                                                                        <div className="hover-scale" style={{ padding: '14px 18px', borderRadius: '16px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                                            <div className={`gnosi-toggle ${isTableVisible ? 'active' : ''}`} onClick={() => {
                                                                                                const checked = !isTableVisible;
                                                                                                setDraft(p => ({ ...p, graph: { ...p.graph, visible_tables: checked ? [...(p.graph.visible_tables||[]), table.id] : (p.graph.visible_tables||[]).filter(id => id !== table.id) } }));
                                                                                            }} style={{ transform: 'scale(0.75)' }}><div className="gnosi-toggle-handle" /></div>
                                                                                            <div style={{ flex: 1 }}>
                                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                                    <Database size={14} color="var(--text-secondary)" opacity={0.5} />
                                                                                                    <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{table.name}</span>
                                                                                                </div>
                                                                                                {table.folder && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', opacity: 0.6, marginLeft: '22px' }}>{table.folder}</span>}
                                                                                            </div>
                                                                                        </div>
                                                                                        {isTableVisible && tableFields.length > 0 && (
                                                                                            <div style={{ marginLeft: '30px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                                                {tableFields.map(field => {
                                                                                                    const key = `${table.id}:${field.name}`;
                                                                                                    const exposed = draft.graph.visible_fields?.includes(key);
                                                                                                    return (
                                                                                                        <div key={field.name} style={{ padding: '8px 12px', borderRadius: '10px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                                                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{field.name}</span>
                                                                                                            <div onClick={() => {
                                                                                                                const chk = !exposed;
                                                                                                                setDraft(p => ({ ...p, graph: { ...p.graph, visible_fields: chk ? [...(p.graph.visible_fields||[]), key] : (p.graph.visible_fields||[]).filter(f => f !== key) } }));
                                                                                                            }} className={`gnosi-toggle ${exposed ? 'active' : ''}`} style={{ transform: 'scale(0.5)' }}><div className="gnosi-toggle-handle" /></div>
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
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Entitats del Sistema */}
                                            <div style={{ background: 'var(--settings-bg)', borderRadius: '24px', border: '1px solid var(--settings-border)', overflow: 'hidden' }}>
                                                <div 
                                                    onClick={() => setIsSystemEntitiesExpanded(!isSystemEntitiesExpanded)}
                                                    className="hover-bg"
                                                    style={{ 
                                                        padding: '16px 24px', 
                                                        cursor: 'pointer', 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        justifyContent: 'space-between',
                                                        borderBottom: isSystemEntitiesExpanded ? '1px solid var(--settings-border)' : 'none',
                                                        transition: 'all 0.3s ease',
                                                        background: isSystemEntitiesExpanded ? 'var(--settings-sidebar-bg)' : 'transparent'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <PenTool size={18} color="var(--gnosi-blue)" />
                                                        <h5 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '800' }}>
                                                            {translations[language].systemEntities || "Entitats del Sistema"}
                                                        </h5>
                                                    </div>
                                                    <ChevronRight 
                                                        size={18} 
                                                        color="var(--text-secondary)" 
                                                        style={{ 
                                                            transform: isSystemEntitiesExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                                            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                            opacity: 0.6
                                                        }} 
                                                    />
                                                </div>

                                                {isSystemEntitiesExpanded && (
                                                    <div className="animate-in" style={{ padding: '24px' }}>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr)', gap: '14px' }}>
                                                            {systemEntities.map(entity => {
                                                                const isEntityVisible = draft.graph.visible_databases?.includes(entity.id);
                                                                const subItems = entity.subItems || [];
                                                                const entityFields = entity.fields || [];

                                                                return (
                                                                    <div key={entity.id} style={{ marginBottom: isEntityVisible ? '12px' : '0' }}>
                                                                        <div className="hover-scale" style={{ padding: '16px 20px', borderRadius: '18px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', gap: '16px', transition: 'all 0.2s' }}>
                                                                            <div className={`gnosi-toggle ${isEntityVisible ? 'active' : ''}`} onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                const checked = !isEntityVisible;
                                                                                setDraft(prev => ({
                                                                                    ...prev,
                                                                                    graph: { ...prev.graph, visible_databases: checked ? [...(prev.graph.visible_databases||[]), entity.id] : (prev.graph.visible_databases||[]).filter(id => id !== entity.id) }
                                                                                }));
                                                                            }} style={{ transform: 'scale(0.8)' }}>
                                                                                <div className="gnosi-toggle-handle" />
                                                                            </div>
                                                                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: `${entity.color || '#3b82f6'}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                <entity.icon size={16} color={entity.color || '#3b82f6'} />
                                                                            </div>
                                                                            <span style={{ fontWeight: '900', fontSize: '0.9rem', color: 'var(--text-primary)' }}>{entity.name}</span>
                                                                        </div>

                                                                        {/* Sub-items (like Calendars or Mail accounts) */}
                                                                        {isEntityVisible && (subItems.length > 0 || entityFields.length > 0) && (
                                                                            <div style={{ marginLeft: '40px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                                                {subItems.map(item => {
                                                                                    const isItemVisible = draft.graph.visible_tables?.includes(item.id);
                                                                                    
                                                                                    return (
                                                                                        <div key={item.id}>
                                                                                            <div className="hover-scale" style={{ padding: '12px 16px', borderRadius: '14px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.2s' }}>
                                                                                                <div className={`gnosi-toggle ${isItemVisible ? 'active' : ''}`} onClick={(e) => {
                                                                                                    e.stopPropagation();
                                                                                                    const checked = !isItemVisible;
                                                                                                    setDraft(prev => ({
                                                                                                        ...prev,
                                                                                                        graph: { ...prev.graph, visible_tables: checked ? [...(prev.graph.visible_tables||[]), item.id] : (prev.graph.visible_tables||[]).filter(id => id !== item.id) }
                                                                                                    }));
                                                                                                }} style={{ transform: 'scale(0.7)' }}>
                                                                                                    <div className="gnosi-toggle-handle" />
                                                                                                </div>
                                                                                                <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{item.name}</span>
                                                                                            </div>
                                                                                            
                                                                                            {/* Nested Fields for sub-item */}
                                                                                            {isItemVisible && entityFields.length > 0 && (
                                                                                                <div style={{ marginLeft: '30px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                                                    {entityFields.map(field => {
                                                                                                        const fieldKey = `${item.id}:${field.name}`;
                                                                                                        const isExposed = draft.graph.visible_fields?.includes(fieldKey);
                                                                                                        const defaultVal = draft.graph.field_defaults?.[fieldKey] || '';

                                                                                                        return (
                                                                                                            <div key={field.name} style={{ padding: '10px 14px', borderRadius: '12px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                                                                                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>{field.name}</span>
                                                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => {
                                                                                                                        const checked = !isExposed;
                                                                                                                        setDraft(prev => ({
                                                                                                                            ...prev,
                                                                                                                            graph: { ...prev.graph, visible_fields: checked ? [...(prev.graph.visible_fields||[]), fieldKey] : (prev.graph.visible_fields||[]).filter(f => f !== fieldKey) }
                                                                                                                        }));
                                                                                                                    }}>
                                                                                                                        <div className={`gnosi-toggle ${isExposed ? 'active' : ''}`} style={{ transform: 'scale(0.6)', pointerEvents: 'none' }}>
                                                                                                                            <div className="gnosi-toggle-handle" />
                                                                                                                        </div>
                                                                                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{translations[language]?.filter_exposed || "Filtre exposat"}</span>
                                                                                                                    </div>
                                                                                                                    <input type="text" className="gnosi-input" style={{ fontSize: '0.75rem', padding: '6px 10px', height: 'auto', width: '130px' }} placeholder="Valor defecte" value={defaultVal} onChange={(e) => {
                                                                                                                        const val = e.target.value;
                                                                                                                        setDraft(prev => ({ ...prev, graph: { ...prev.graph, field_defaults: { ...(prev.graph.field_defaults || {}), [fieldKey]: val } } }));
                                                                                                                    }} />
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        );
                                                                                                    })}
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    );
                                                                                })}

                                                                                {/* Fields for categories without sub-items (like Wiki) */}
                                                                                {subItems.length === 0 && entityFields.length > 0 && (
                                                                                    <div style={{ marginLeft: '30px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                                        {entityFields.map(field => {
                                                                                            const fieldKey = `${entity.id}:${field.name}`;
                                                                                            const isExposed = draft.graph.visible_fields?.includes(fieldKey);
                                                                                            const defaultVal = draft.graph.field_defaults?.[fieldKey] || '';

                                                                                            return (
                                                                                                <div key={field.name} style={{ padding: '10px 14px', borderRadius: '12px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                                                                                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>{field.name}</span>
                                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => {
                                                                                                            const checked = !isExposed;
                                                                                                            setDraft(prev => ({
                                                                                                                ...prev,
                                                                                                                graph: { ...prev.graph, visible_fields: checked ? [...(prev.graph.visible_fields||[]), fieldKey] : (prev.graph.visible_fields||[]).filter(f => f !== fieldKey) }
                                                                                                            }));
                                                                                                        }}>
                                                                                                            <div className={`gnosi-toggle ${isExposed ? 'active' : ''}`} style={{ transform: 'scale(0.6)', pointerEvents: 'none' }}>
                                                                                                                <div className="gnosi-toggle-handle" />
                                                                                                            </div>
                                                                                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{translations[language]?.filter_exposed || "Filtre exposat"}</span>
                                                                                                        </div>
                                                                                                        <input type="text" className="gnosi-input" style={{ fontSize: '0.75rem', padding: '6px 10px', height: 'auto', width: '130px' }} placeholder="Valor defecte" value={defaultVal} onChange={(e) => {
                                                                                                            const val = e.target.value;
                                                                                                            setDraft(prev => ({ ...prev, graph: { ...prev.graph, field_defaults: { ...(prev.graph.field_defaults || {}), [fieldKey]: val } } }));
                                                                                                        }} />
                                                                                                    </div>
                                                                                                </div>
                                                                                            );
                                                                                        })}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </Section>
                                </Section>
                            )}

                            {/* IA */}
                            {activeTab === 'ai' && (
                                <>
                                    <Section 
                                        title="Proveïdors de Models" 
                                        icon={Database} 
                                        extra={
                                            <button 
                                                className="btn-gnosi-primary" 
                                                onClick={() => { setProviderToEdit(null); setIsConnectModalOpen(true); }} 
                                                style={{ 
                                                    padding: '10px 20px', fontSize: '0.9rem', borderRadius: '14px',
                                                    display: 'flex', alignItems: 'center', gap: '10px'
                                                }}
                                            >
                                                <Plus size={18} /> Connectar Model
                                            </button>
                                        }
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                            {Object.entries(draft.ai.providers).map(([pId, p]) => {
                                                const catalogItem = aiCatalog[pId] || {};
                                                const pName = catalogItem.name || pId.toUpperCase();
                                                const pIcon = catalogItem.icon || p.icon;
                                                return (
                                                    <div key={pId} className="hover-scale" style={{ 
                                                        padding: '24px', borderRadius: '24px', border: '1px solid var(--settings-border)', 
                                                        background: 'var(--settings-sidebar-bg)', display: 'flex', justifyContent: 'space-between', 
                                                        alignItems: 'center', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                        opacity: p.enabled === false ? 0.6 : 1
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                                                            <div 
                                                                className={`gnosi-toggle ${p.enabled !== false ? 'active' : ''}`} 
                                                                onClick={() => handleToggleAIProvider(pId, p.enabled === false)}
                                                                style={{ transform: 'scale(1.1)', marginRight: '10px' }}
                                                            >
                                                                <div className="gnosi-toggle-handle" />
                                                            </div>
                                                            <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'var(--settings-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gnosi-blue)', boxShadow: '0 5px 15px rgba(0,0,0,0.05)' }}>
                                                                {pIcon ? <img src={pIcon} style={{ width: '28px', height: '28px' }} alt="" /> : <Cpu size={28} />}
                                                            </div>
                                                            <div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <div style={{ fontWeight: '900', fontSize: '1.2rem', color: 'var(--text-primary)' }}>{pName}</div>
                                                                    {p.enabled === false && <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '10px', background: 'var(--settings-border)', color: 'var(--text-secondary)', fontWeight: '800' }}>INACTIU</span>}
                                                                </div>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px', opacity: 0.8 }}>
                                                                    {p.has_api_key ? '✓ Credencials configurades' : '⚠ Falta clau API'} 
                                                                    {p.base_url && ` • ${p.base_url}`}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '14px' }}>
                                                            <button 
                                                                onClick={() => validateAIProvider(pId)} 
                                                                disabled={aiValidationStatus[pId] === 'validating' || p.enabled === false}
                                                                className={`btn-gnosi-secondary ${aiValidationStatus[pId] || ''}`} 
                                                                style={{ 
                                                                    padding: '14px 28px', borderRadius: '18px', fontWeight: '900', border: 'none',
                                                                    background: aiValidationStatus[pId] === 'success' ? '#10b98120' : (aiValidationStatus[pId] === 'error' ? '#ef444420' : 'var(--settings-border)'),
                                                                    color: aiValidationStatus[pId] === 'success' ? '#10b981' : (aiValidationStatus[pId] === 'error' ? '#ef4444' : 'var(--text-primary)'),
                                                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                    opacity: p.enabled === false ? 0.5 : 1,
                                                                    whiteSpace: 'nowrap'
                                                                }}
                                                            >
                                                                {aiValidationStatus[pId] === 'validating' ? <div className="spinner-small" style={{ borderTopColor: 'var(--gnosi-blue)' }} /> : (aiValidationStatus[pId] === 'success' ? 'Vàlid!' : (aiValidationStatus[pId] === 'error' ? 'Error' : 'Test Ping'))}
                                                            </button>
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setProviderToEdit(catalogItem);
                                                                    setIsConnectModalOpen(true);
                                                                }}
                                                                className="icon-btn hover-bg-strong" 
                                                                style={{ padding: '14px', borderRadius: '16px' }}
                                                            >
                                                                <SettingsIcon size={22} />
                                                            </button>
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDeleteAIProvider(pId);
                                                                }}
                                                                className="icon-btn hover-bg-strong" 
                                                                style={{ padding: '14px', borderRadius: '16px', color: '#ef4444' }}
                                                            >
                                                                <Trash2 size={22} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </Section>

                                    <div style={{ height: '30px' }} />

                                    <Section 
                                        title="Agents de Cognició" 
                                        icon={Bot} 
                                        extra={
                                            <button 
                                                className="btn-gnosi-primary" 
                                                onClick={() => setEditingAgent({})} 
                                                style={{ 
                                                    padding: '10px 20px', fontSize: '0.85rem', borderRadius: '14px',
                                                    display: 'flex', alignItems: 'center', gap: '10px'
                                                }}
                                            >
                                                <Plus size={16} /> Crear Agent
                                            </button>
                                        }
                                    >
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                                            {draft.ai.agents.map(agent => (
                                                <div key={agent.id} className="hover-scale" style={{ padding: '24px', borderRadius: '24px', border: '1px solid var(--settings-border)', background: 'var(--settings-sidebar-bg)', display: 'flex', alignItems: 'center', gap: '20px', transition: 'all 0.2s' }}>
                                                    <div style={{ fontSize: '2.5rem', filter: 'drop-shadow(0 5px 10px rgba(0,0,0,0.1))' }}>{agent.icon || '🤖'}</div>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontWeight: '900', fontSize: '1.1rem', color: 'var(--text-primary)' }}>{agent.name}</div>
                                                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{agent.provider} • {agent.model}</div>
                                                    </div>
                                                    <div className={`gnosi-toggle ${agent.enabled ? 'active' : ''}`} onClick={() => {
                                                        const newList = draft.ai.agents.map(a => a.id === agent.id ? {...a, enabled: !a.enabled} : a);
                                                        setDraft({...draft, ai: {...draft.ai, agents: newList}});
                                                    }} style={{ transform: 'scale(1.1)' }}>
                                                        <div className="gnosi-toggle-handle" />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </Section>
                                </>
                            )}

                            {/* ZOTERO */}
                            {activeTab === 'zotero' && (
                                <Section title="Integració Zotero" icon={BookOpen} extra={<button onClick={async () => { await fetch('/api/zotero/sync', {method:'POST'}); alert('Sincronització en marxa...'); }} className="btn-gnosi-secondary" style={{ padding: '10px 20px', fontSize: '0.9rem', borderRadius: '14px' }}><RefreshCw size={18} /> Acció Ràpida</button>}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                        <div style={{ background: 'var(--settings-sidebar-bg)', padding: '36px', borderRadius: '32px', border: '1px solid var(--settings-border)', boxShadow: '0 10px 40px rgba(0,0,0,0.03)' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginBottom: '32px' }}>
                                                <FormGroup label="Zotero User ID" description="Identificador públic de la teva llibreria."><input type="text" className="gnosi-input" value={draft.zotero.user} onChange={e => setDraft({...draft, zotero: {...draft.zotero, user: e.target.value}})} placeholder="1234567" /></FormGroup>
                                                <FormGroup label="API Key / Secret" description="Token d'accés amb permisos de lectura."><input type="password" className="gnosi-input" value={draft.zotero.pwd} onChange={e => setDraft({...draft, zotero: {...draft.zotero, pwd: e.target.value}})} placeholder="sk-..." /></FormGroup>
                                            </div>
                                            <FormGroup label="Taula de Destí del Vault" description="Base de dades on s'emmgatzemaran les referències sincronitzades.">
                                                <select className="gnosi-select" value={draft.zotero.target_table} onChange={e => setDraft({...draft, zotero: {...draft.zotero, target_table: e.target.value}})}>
                                                    <option value="">Selecciona una taula del Vault...</option>
                                                    {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                                </select>
                                            </FormGroup>
                                        </div>
                                        
                                        <div style={{ padding: '20px', borderRadius: '20px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.1)', display: 'flex', alignItems: 'center', gap: '20px' }}>
                                            <div style={{ width: '40px', height: '40px', background: 'var(--gnosi-blue)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}><Info size={20} /></div>
                                            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>Gnosi sincronitzarà automàticament els teus ítems residencials i PDF adjunts cada vegada que s'actualitzi el Vault.</div>
                                        </div>
                                    </div>
                                </Section>
                            )}

                        </div>
                    </main>
                </div>
              )}
            </div>

            {/* FOLDER PICKER MODAL */}
            <FolderPickerModal 
                isOpen={pickerOpen} 
                onClose={() => setPickerOpen(false)} 
                initialPath={draft.paths[pickerField] || ''}
                onSelect={(path) => {
                    setDraft(prev => ({
                        ...prev,
                        paths: { ...prev.paths, [pickerField]: path }
                    }));
                    setPickerOpen(false);
                }} 
            />

            <ConfirmModal 
                isOpen={confirmConfig.isOpen}
                onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmConfig.onConfirm}
                title={confirmConfig.title}
                message={confirmConfig.message}
                isDestructive={true}
            />


            {/* AI AGENT MODAL */}
            {editingAgent && (
                <AIAgentModal 
                    isOpen={!!editingAgent}
                    onClose={() => setEditingAgent(null)}
                    agent={editingAgent}
                    onSave={(newAgent) => {
                        const isNew = !newAgent.id;
                        const id = isNew ? `agent_${Date.now()}` : newAgent.id;
                        const agentToSave = { ...newAgent, id };
                        
                        let newList;
                        if (isNew) {
                            newList = [...draft.ai.agents, agentToSave];
                        } else {
                            newList = draft.ai.agents.map(a => a.id === id ? agentToSave : a);
                        }
                        
                        setDraft(prev => ({
                            ...prev,
                            ai: { ...prev.ai, agents: newList }
                        }));
                    }}
                    aiCatalog={aiCatalog}
                />
            )}
            <UnifiedAIProviderModal 
                isOpen={isConnectModalOpen}
                onClose={() => setIsConnectModalOpen(false)}
                aiCatalog={aiCatalog}
                editingProvider={providerToEdit}
                aiValidationStatus={aiValidationStatus}
                onValidate={validateAIProvider}
                onSave={(pId, data) => {
                    setDraft(prev => ({
                        ...prev,
                        ai: {
                            ...prev.ai,
                            providers: {
                                ...prev.ai.providers,
                                [pId]: { ...data, enabled: true }
                            }
                        }
                    }));
                    triggerAutoSave(false);
                    setIsConnectModalOpen(false);
                }}
            />
        </>
    );
}

// --- SUB-COMPONENTS FOR AI ---

function UnifiedAIProviderModal({ isOpen, onClose, aiCatalog, onSave, onValidate, aiValidationStatus, editingProvider = null }) {
    const [selectedId, setSelectedId] = useState(editingProvider?.id || '');
    const [apiKey, setApiKey] = useState('');
    const [baseUrl, setBaseUrl] = useState(editingProvider?.base_url || '');
    
    useEffect(() => {
        if (selectedId && aiCatalog[selectedId]) {
            setBaseUrl(aiCatalog[selectedId].base_url || '');
        }
    }, [selectedId]);

    const provider = aiCatalog[selectedId];
    const isValidating = selectedId ? aiValidationStatus[selectedId] === 'validating' : false;

    if (!isOpen) return null;

    return (
        <div className={`modal-overlay ${isOpen ? 'active' : ''}`} onClick={onClose} style={{ 
            zIndex: 99999, backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh'
        }}>
            <div className="modal-content animate-pop" onClick={e => e.stopPropagation()} style={{ 
                width: '500px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: '40px', 
                borderRadius: '32px', boxShadow: '0 30px 80px rgba(0,0,0,0.15)', border: '1px solid var(--settings-border)',
                background: 'var(--settings-bg)', overflow: 'hidden', position: 'relative'
            }}>
                <button onClick={onClose} className="icon-btn hover-bg" style={{ 
                    position: 'absolute', top: '24px', right: '24px', padding: '10px', borderRadius: '50%', 
                    color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)',
                    width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}><X size={18} /></button>

                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '12px', marginRight: '-12px' }}>
                    <h3 style={{ margin: '0 0 30px 0', fontSize: '1.4rem', fontWeight: '900' }}>
                        {editingProvider ? `Configurar ${editingProvider.name}` : 'Connectar Proveïdor d\'IA'}
                    </h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <FormGroup label="Proveïdor d'IA" description="Selecciona el servei que vols utilitzar.">
                            <select 
                                className="gnosi-select" 
                                value={selectedId} 
                                onChange={e => setSelectedId(e.target.value)}
                                disabled={!!editingProvider}
                            >
                                <option value="">Tria un proveïdor...</option>
                                {Object.values(aiCatalog).map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </FormGroup>

                        {selectedId && (
                            <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '24px', borderRadius: '20px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '10px' }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--settings-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {provider.icon ? <img src={provider.icon} style={{ width: '24px', height: '24px' }} alt="" /> : <Cpu size={20} />}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: '800', fontSize: '1rem' }}>{provider.name}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{provider.models?.length || 0} models disponibles</div>
                                    </div>
                                </div>

                                <FormGroup label="API Key / Token" description="La teva clau secreta d'accés.">
                                    <input type="password" className="gnosi-input" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
                                </FormGroup>

                                <FormGroup label="Base URL (Opcional)" description="Només si cal sobrescriure l'endpoint per defecte.">
                                    <input type="text" className="gnosi-input" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={provider.base_url || "https://api.openai.com/v1"} />
                                </FormGroup>
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ marginTop: '40px', display: 'flex', gap: '14px', flexShrink: 0 }}>
                    <button 
                        className="btn-gnosi-secondary" 
                        onClick={() => onValidate(selectedId, apiKey)} 
                        disabled={isValidating || !selectedId}
                        style={{ flex: 1, padding: '14px', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', whiteSpace: 'nowrap' }}
                    >
                        {isValidating ? <div className="spinner-small" /> : <Activity size={18} />} Test Ping
                    </button>
                    <button 
                        className="btn-gnosi-primary" 
                        disabled={!selectedId || (!apiKey && !editingProvider)}
                        onClick={() => onSave(selectedId, { api_key: apiKey, base_url: baseUrl })} 
                        style={{ flex: 1, padding: '14px', borderRadius: '18px' }}
                    >Desar</button>
                </div>
            </div>
        </div>
    );
}

function AIAgentModal({ isOpen, onClose, agent, onSave, aiCatalog }) {
    const [name, setName] = useState(agent.name || '');
    const [provider, setProvider] = useState(agent.provider || '');
    const [model, setModel] = useState(agent.model || '');
    const [icon, setIcon] = useState(agent.icon || '🤖');

    const availableModels = aiCatalog[provider]?.models || [];

    if (!isOpen) return null;

    return (
        <div className={`modal-overlay ${isOpen ? 'active' : ''}`} onClick={onClose} style={{ 
            zIndex: 99999, 
            backdropFilter: 'blur(8px)', 
            background: 'rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh'
        }}>
            <div className="modal-content animate-pop" onClick={e => e.stopPropagation()} style={{ 
                width: '500px', 
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                padding: '40px', 
                borderRadius: '32px', 
                boxShadow: '0 30px 80px rgba(0,0,0,0.15)', 
                border: '1px solid var(--settings-border)',
                background: 'var(--settings-bg)',
                overflow: 'hidden',
                position: 'relative'
            }}>
                <button 
                    onClick={onClose} 
                    className="icon-btn hover-bg" 
                    style={{ 
                        position: 'absolute', top: '24px', right: '24px', padding: '10px', borderRadius: '50%', 
                        color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)',
                        width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.2s'
                    }}
                >
                    <X size={18} />
                </button>
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '12px', marginRight: '-12px' }}>
                    <h3 style={{ margin: '0 0 30px 0', fontSize: '1.4rem', fontWeight: '900' }}>{agent.id ? 'Editar Agent' : 'Nou Agent de Cognició'}</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end' }}>
                            <div style={{ flex: 1 }}>
                                <FormGroup label="Nom de l'Agent">
                                    <input type="text" className="gnosi-input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Analista de Dades" />
                                </FormGroup>
                            </div>
                            <div style={{ width: '80px' }}>
                                <FormGroup label="Icona">
                                    <input type="text" className="gnosi-input" value={icon} onChange={e => setIcon(e.target.value)} style={{ textAlign: 'center', fontSize: '1.5rem' }} />
                                </FormGroup>
                            </div>
                        </div>

                        <FormGroup label="Proveïdor d'IA">
                            <select className="gnosi-select" value={provider} onChange={e => { setProvider(e.target.value); setModel(''); }}>
                                <option value="">Selecciona un proveïdor...</option>
                                {Object.values(aiCatalog).map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </FormGroup>

                        <FormGroup label="Model Específic">
                            <select className="gnosi-select" value={model} onChange={e => setModel(e.target.value)} disabled={!provider}>
                                <option value="">Selecciona un model...</option>
                                {availableModels.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </FormGroup>
                    </div>
                </div>

                <div style={{ marginTop: '40px', display: 'flex', gap: '14px' }}>
                    <button className="btn-gnosi-secondary" onClick={onClose} style={{ flex: 1, padding: '14px', borderRadius: '18px' }}>Cancel·lar</button>
                    <button 
                        className="btn-gnosi-primary" 
                        disabled={!name || !provider || !model}
                        onClick={() => {
                            onSave({ ...agent, name, provider, model, icon });
                            onClose();
                        }} 
                        style={{ flex: 1, padding: '14px', borderRadius: '18px' }}
                    >Desar Agent</button>
                </div>
            </div>
        </div>
    );
}
