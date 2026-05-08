import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    X, Globe, Palette, RefreshCw, Info, ExternalLink, Monitor, BookOpen,
    Save, Check, FolderOpen, Database, Cpu, Zap, Settings as SettingsIcon,
    Sliders, Calendar, Mail, Trash2, Plus, Users, Rss, Share2, Inbox,
    ChevronRight, Search, FileUp, Shield, Activity, Bot, FileText,
    PenTool, Image, Paperclip, Eye, EyeOff, User
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FolderPickerModal } from './FolderPickerModal';
import { IconPicker, VAULT_COLORS } from './Vault/IconPicker';
import axios from 'axios';
import { toast } from '../lib/toast';
import { ConfirmModal } from './ConfirmModal';
import * as LucideIcons from 'lucide-react';
import MailBlockEditor from './Mail/MailBlockEditor';
import IdentityProfile from './Vault/IdentityProfile';
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
export const Section = ({ title, icon: Icon, children, extra }) => (
    <div className="settings-section animate-in">
        <div className="settings-section-title-wrap">
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {Icon && <div className="settings-section-icon-wrap"><Icon size={20} /></div>}
                <h3 className="settings-section-title">{title}</h3>
            </div>
            {extra && <div style={{ flexShrink: 0 }}>{extra}</div>}
        </div>
        <div className="settings-section-content">
            {children}
        </div>
    </div>
);

export const FormGroup = ({ label, children, description, horizontal = false }) => (
    <div className="settings-form-group" style={{ 
        display: horizontal ? 'flex' : 'block', 
        alignItems: horizontal ? 'center' : 'stretch',
        justifyContent: horizontal ? 'space-between' : 'flex-start',
        gap: horizontal ? '20px' : '0'
    }}>
        <div style={{ flex: horizontal ? 1 : 'none' }}>
            <label className="settings-label">{label}</label>
            {description && <div className="settings-desc">{description}</div>}
        </div>
        <div style={{ flex: horizontal ? '0 0 auto' : 'none' }}>
            {children}
        </div>
    </div>
);

const PasswordInput = ({
    value,
    onChange,
    placeholder = '••••••••',
    className = 'gnosi-input',
    style,
    name,
    id,
    autoComplete = 'current-password',
}) => {
    const [show, setShow] = React.useState(false);
    const { t } = useTranslation();
    const labelShow = t('subs_news_password_show');
    const labelHide = t('subs_news_password_hide');
    return (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
                type={show ? 'text' : 'password'}
                className={className}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                name={name}
                id={id}
                autoComplete={autoComplete}
                style={{ paddingRight: '40px', width: '100%', boxSizing: 'border-box', ...style }}
            />
            <button
                type="button"
                onClick={() => setShow(s => !s)}
                aria-label={show ? labelHide : labelShow}
                title={show ? labelHide : labelShow}
                style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0', display: 'flex', alignItems: 'center' }}
            >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
        </div>
    );
};

const AliasEditor = ({ aliases, onChange }) => {
    const [expandedIdx, setExpandedIdx] = React.useState(null);
    const update = (i, patch) => {
        const updated = [...aliases];
        updated[i] = { ...updated[i], ...patch };
        onChange(updated);
    };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {aliases.map((alias, i) => (
                <div key={i} style={{ border: '1px solid var(--settings-border)', borderRadius: '10px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', padding: '6px 8px' }}>
                        <input
                            type="email"
                            className="gnosi-input"
                            style={{ flex: 2 }}
                            value={alias.email}
                            placeholder="alias@domini.org"
                            onChange={e => update(i, { email: e.target.value })}
                        />
                        <input
                            type="text"
                            className="gnosi-input"
                            style={{ flex: 2 }}
                            value={alias.display_name || ''}
                            placeholder="Nom (opcional)"
                            onChange={e => update(i, { display_name: e.target.value })}
                        />
                        <button
                            type="button"
                            title="Signatura"
                            onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                            style={{ padding: '6px 8px', border: '1px solid var(--settings-border)', borderRadius: '6px', background: expandedIdx === i ? 'var(--gnosi-blue)' : 'transparent', color: expandedIdx === i ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700' }}
                        >
                            Sig
                        </button>
                        <button
                            type="button"
                            onClick={() => { onChange(aliases.filter((_, j) => j !== i)); if (expandedIdx === i) setExpandedIdx(null); }}
                            style={{ padding: '6px', border: 'none', background: 'transparent', color: 'var(--status-error)', cursor: 'pointer', borderRadius: '6px' }}
                        >✕</button>
                    </div>
                    {expandedIdx === i && (
                        <div style={{ padding: '8px', borderTop: '1px solid var(--settings-border)', background: 'var(--settings-sidebar-bg)' }}>
                            <label style={{ fontSize: '0.72rem', fontWeight: '800', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
                                Signatura de l'àlies
                            </label>
                            <MailBlockEditor
                                initialContent={alias.signature || ''}
                                onChange={html => update(i, { signature: html })}
                                minHeight="80px"
                            />
                        </div>
                    )}
                </div>
            ))}
            <button
                type="button"
                onClick={() => onChange([...aliases, { email: '', display_name: '', signature: '' }])}
                style={{ alignSelf: 'flex-start', padding: '4px 12px', fontSize: '0.78rem', border: '1px dashed var(--settings-border)', borderRadius: '8px', background: 'transparent', color: 'var(--gnosi-blue)', cursor: 'pointer', fontWeight: '700' }}
            >
                + Afegir àlies
            </button>
        </div>
    );
};

const AccountRow = ({ name, description, status, type, provider, onSync, onEdit, onDelete, onToggleEnabled, enabled = true, color = '#3b82f6', isSyncing = false }) => (
    <div className="account-row hover-scale" style={{
        padding: '18px 24px', borderRadius: '20px', border: '1px solid var(--settings-border)',
        background: 'var(--settings-sidebar-bg)', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: '14px', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: enabled ? 1 : 0.5
    }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: 'rgba(59, 130, 246, 0.09)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gnosi-blue)' }}>
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
                {enabled && (
                    <span style={{
                        fontSize: '0.68rem', padding: '5px 14px', borderRadius: '20px',
                        background: status === 'connected' ? 'rgba(16, 185, 129, 0.12)' : status === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                        color: status === 'connected' ? '#10b981' : status === 'error' ? '#ef4444' : '#f59e0b', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '0.04em'
                    }}>
                        {status === 'connected' ? 'Connectat' : status === 'error' ? 'Error' : 'Pendent'}
                    </span>
                )}
                {enabled && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onSync && onSync(); }}
                        disabled={isSyncing}
                        className="icon-btn hover-bg"
                        title="Sincronitzar aquest compte"
                        style={{ padding: '8px', borderRadius: '10px', color: 'var(--gnosi-blue)' }}
                    >
                        <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                    </button>
                )}
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onToggleEnabled && onToggleEnabled(!enabled); }}
                className="icon-btn hover-bg"
                title={enabled ? 'Desactivar compte' : 'Activar compte'}
                style={{ padding: '8px', borderRadius: '10px', color: enabled ? 'var(--text-secondary)' : 'var(--gnosi-blue)' }}
            >
                {enabled ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button onClick={onEdit} className="icon-btn hover-bg" style={{ padding: '8px', borderRadius: '10px' }}><SettingsIcon size={18} /></button>
            <button onClick={onDelete} className="icon-btn hover-bg-danger" style={{ color: '#ef4444', padding: '8px', borderRadius: '10px' }}><Trash2 size={18} /></button>
        </div>
    </div>
);

const SidebarItem = ({ id, icon: Icon, label, active, onClick }) => (
    <button 
        className={`settings-sidebar__item ${active ? 'active' : ''}`} 
        onClick={onClick}
    >
        <Icon size={18} strokeWidth={active ? 2.5 : 2} />
        <span style={{ flex: 1 }}>{label}</span>
        {active && <ChevronRight size={14} style={{ opacity: 0.5 }} />}
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
        zotero: { enabled: false, zotero_db: '~/Zotero/zotero.sqlite', user: '', pwd: '', workspace: '', target_table: '', mapping: {} },
        identity: {
            full_name: '', first_name: '', last_name: '', email: '',
            phone: '', address: '', city: '', zip_code: '', dni_nie: '', notes: ''
        }
    });

    const [activeTab, setActiveTab] = useState(initialTab);
    const [integrations, setIntegrations] = useState({ calendars: [], contacts: [], mail_accounts: [] });
    const integrationsLoadedRef = useRef(false); // Evita que auto-save dispari amb dades buides
    const [googleSubCalendars, setGoogleSubCalendars] = useState([]);
    const [databases, setDatabases] = useState([]);
    const [tables, setTables] = useState([]);
    const [aiCatalog, setAiCatalog] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState('');
    const [zoteroSyncing, setZoteroSyncing] = useState(null);
    const [zoteroSyncMsg, setZoteroSyncMsg] = useState('');

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
    const [newsletterSourcesLoaded, setNewsletterSourcesLoaded] = useState(false);
    const [newsletterSourcesError, setNewsletterSourcesError] = useState('');
    const [newsletterSourcesLoading, setNewsletterSourcesLoading] = useState(false);
    const [newsletterName, setNewsletterName] = useState('');
    const [newsletterAddress, setNewsletterAddress] = useState('');
    const [newsletterType, setNewsletterType] = useState('rss');
    const [newsletterStatus, setNewsletterStatus] = useState('');
    const [newsletterOpmlLoading, setNewsletterOpmlLoading] = useState(false);
    const newsletterOpmlRef = useRef(null);
    // Compte POP3 newsletters
    const [newsletterAccount, setNewsletterAccount] = useState({ mail_server: '', mail_port: 110, mail_ssl: 'starttls', email: '', password: '', delete_after_ingest: true });
    const [newsletterAccountLoaded, setNewsletterAccountLoaded] = useState(false);
    const [newsletterAccountStatus, setNewsletterAccountStatus] = useState('');
    const [newsletterAccountTesting, setNewsletterAccountTesting] = useState(false);
    const [newsletterAccountSyncing, setNewsletterAccountSyncing] = useState(false);
    const [newsletterPasswordDirty, setNewsletterPasswordDirty] = useState(false);
    const newsletterAccountSaveTimerRef = useRef(null);
    const lastSavedNewsletterAccountRef = useRef(null);
    
    // Account Integration State
    const [addAccountType, setAddAccountType] = useState(null); // 'calendar' | 'contacts' | 'mail' | null
    const [addAccountEmail, setAddAccountEmail] = useState('');
    const [addAccountEmailBlurred, setAddAccountEmailBlurred] = useState(false);
    const [isManualGoogle, setIsManualGoogle] = useState(false);
    const [manualServer, setManualServer] = useState('');
    const [manualPassword, setManualPassword] = useState('');
    const [editingAccountId, setEditingAccountId] = useState(null); // ID del compte en edició
    const [syncingAccounts, setSyncingAccounts] = useState({}); // Tracking individual syncs
    const [syncErrorAccounts, setSyncErrorAccounts] = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem('gnosi_mail_sync_errors') || '[]')); } catch { return new Set(); }
    }); // Emails amb error de sync (persistit a localStorage)
    
    // Mail Snippets State
    const SNIPPETS_KEY = 'gnosi_mail_snippets';
    const DEFAULT_SNIPPETS = [
        { id: 'snip_default_1', title: 'Salutació formal',    content: 'Benvolgut/da,\n\nEspero que es trobi bé.' },
        { id: 'snip_default_2', title: 'Gràcies per la resposta', content: 'Moltes gràcies per la seva resposta.' },
        { id: 'snip_default_3', title: 'Comiat formal',        content: 'Atentament,\n\n' },
        { id: 'snip_default_4', title: 'Proposta reunió',      content: 'Li proposo una reunió per tractar aquest tema.' },
        { id: 'snip_default_5', title: 'Seguiment',            content: 'Em poso en contacte per fer seguiment del tema anterior.' },
    ];
    const [snippets, setSnippets] = useState(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(SNIPPETS_KEY) || 'null');
            return stored ?? DEFAULT_SNIPPETS;
        } catch { return DEFAULT_SNIPPETS; }
    });
    const [snippetDraft, setSnippetDraft] = useState({ title: '', content: '' });
    const [editingSnippetId, setEditingSnippetId] = useState(null);

    const saveSnippets = (list) => {
        setSnippets(list);
        localStorage.setItem(SNIPPETS_KEY, JSON.stringify(list));
    };

    const handleAddSnippet = () => {
        if (!snippetDraft.title.trim() || !snippetDraft.content.trim()) return;
        if (editingSnippetId) {
            saveSnippets(snippets.map(s => s.id === editingSnippetId ? { ...s, ...snippetDraft } : s));
            setEditingSnippetId(null);
        } else {
            saveSnippets([...snippets, { id: `snip_${Date.now()}`, ...snippetDraft }]);
        }
        setSnippetDraft({ title: '', content: '' });
    };

    const handleEditSnippet = (s) => {
        setEditingSnippetId(s.id);
        setSnippetDraft({ title: s.title, content: s.content });
    };

    const handleDeleteSnippet = (id) => {
        saveSnippets(snippets.filter(s => s.id !== id));
        if (editingSnippetId === id) { setEditingSnippetId(null); setSnippetDraft({ title: '', content: '' }); }
    };

    // Social State
    const SOCIAL_NETWORK_DEFAULTS = [
        { id: 'mastodon', name: 'Mastodon', icon: '🐘', enabled: true },
        { id: 'bluesky',  name: 'Bluesky',  icon: '🦋', enabled: true },
        { id: 'linkedin', name: 'LinkedIn', icon: '💼', enabled: true },
        { id: 'facebook', name: 'Facebook', icon: '📘', enabled: false },
        { id: 'telegram', name: 'Telegram', icon: '✈️', enabled: false },
    ];
    const [socialNetworks, setSocialNetworks] = useState(SOCIAL_NETWORK_DEFAULTS);
    const [socialStreams, setSocialStreams] = useState([]);
    const [newStreamForm, setNewStreamForm] = useState({ id: '', title: '', icon: '📡', network: 'mastodon' });
    const [showAddStream, setShowAddStream] = useState(false);

    const loadSocialSettings = async () => {
        try {
            const [nRes, sRes] = await Promise.all([
                fetch('/api/social/networks'),
                fetch('/api/social/streams'),
            ]);
            if (nRes.ok) setSocialNetworks(await nRes.json());
            if (sRes.ok) setSocialStreams(await sRes.json());
        } catch { /* silent */ }
    };

    const saveSocialNetworks = async (updated) => {
        // Update optimistic; rollback si la xarxa falla.
        const previous = socialNetworks;
        setSocialNetworks(updated);
        try {
            const res = await fetch('/api/social/networks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast.success('Xarxes desades');
        } catch (err) {
            // Sense aquesta restauració, l'UI mostrava els canvis com si
            // s'haguessin desat tot i que el backend tenia l'estat antic.
            setSocialNetworks(previous);
            toast.error('Error desant xarxes');
            console.error('[social] saveSocialNetworks failed', err);
        }
    };

    const saveSocialStreams = async (updated) => {
        const previous = socialStreams;
        setSocialStreams(updated);
        try {
            const res = await fetch('/api/social/streams', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast.success('Streams desats');
        } catch (err) {
            setSocialStreams(previous);
            toast.error('Error desant streams');
            console.error('[social] saveSocialStreams failed', err);
        }
    };

    const handleAddSocialStream = () => {
        if (!newStreamForm.id.trim() || !newStreamForm.title.trim()) return;
        const updated = [...socialStreams, { ...newStreamForm }];
        saveSocialStreams(updated);
        setNewStreamForm({ id: '', title: '', icon: '📡', network: 'mastodon' });
        setShowAddStream(false);
    };

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
    const [mailDisplayName, setMailDisplayName] = useState('');
    const [mailSubjectPrefix, setMailSubjectPrefix] = useState('');
    const [mailAliases, setMailAliases] = useState([]);
    const [mailTestStatus, setMailTestStatus] = useState(null); // null | 'testing' | 'ok' | 'error'
    const identityAutoSaveRef = useRef(null); // debounce timer
    const identityLoadedForRef = useRef(null); // tracks which account was last loaded (skip initial save)

    // Auto-save identity fields (signature, name, aliases, subject_prefix) when editing an account
    useEffect(() => {
        if (!editingAccountId) return;
        // Skip the first run right after handleEditAccount populates the fields
        if (identityLoadedForRef.current !== editingAccountId) {
            identityLoadedForRef.current = editingAccountId;
            return;
        }
        clearTimeout(identityAutoSaveRef.current);
        identityAutoSaveRef.current = setTimeout(async () => {
            const currentList = integrations.mail_accounts || [];
            const newList = currentList.map(a => a.id !== editingAccountId ? a : {
                ...a,
                display_name: mailDisplayName,
                subject_prefix: mailSubjectPrefix,
                signature: mailSignature,
                certificate: mailCertificate,
                aliases: mailAliases,
            });
            try {
                await axios.post('/api/integrations/bulk', { ...integrations, mail_accounts: newList });
                setIntegrations(prev => ({ ...prev, mail_accounts: newList }));
            } catch { /* silent */ }
        }, 1200);
        return () => clearTimeout(identityAutoSaveRef.current);
    }, [mailSignature, mailDisplayName, mailSubjectPrefix, mailAliases, mailCertificate, editingAccountId]);

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
            integrationsLoadedRef.current = false; // Reset al obrir el modal
            lastSavedData.current = null; // Reset baseline per evitar saves espuris
            loadConfig();
            loadAiCatalog();
            loadZoteroData();
            loadIntegrations();
            loadNewsletterSources();
            loadNewsletterAccount();
            checkGoogleAuth();
            loadIdentity();
            loadSocialSettings();
        }
    }, [isOpen]);

    const loadIdentity = async () => {
        try {
            const res = await axios.get('/api/identity');
            if (res.data) {
                setDraft(prev => ({ ...prev, identity: { ...prev.identity, ...res.data } }));
            }
        } catch (err) { console.error("Error loading identity:", err); }
    };

    useEffect(() => {
        if (activeTab === 'calendar' && isOpen) {
            fetch('/api/calendar/calendars')
                .then(r => r.ok ? r.json() : [])
                .then(setGoogleSubCalendars)
                .catch(() => {});
        }
    }, [activeTab, isOpen]);

    useEffect(() => {
        try { localStorage.setItem('gnosi_mail_sync_errors', JSON.stringify([...syncErrorAccounts])); } catch { /* quota */ }
    }, [syncErrorAccounts]);

    // Keyboard support - Escape/Enter to close
    useEffect(() => {
        const handleKeyPress = (e) => {
            if (!isOpen) return;
            
            if (e.key === 'Escape') {
                onClose();
            } else if (e.key === 'Enter') {
                if (document.activeElement.tagName === 'TEXTAREA') return;
                if (document.activeElement.isContentEditable) return;
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
            const res = await fetch(`/api/integrations?t=${Date.now()}`);
            if (res.ok) {
                const data = await res.json();
                setIntegrations(data);
                lastSavedData.current = JSON.stringify({
                    settings: draft.settings,
                    paths: draft.paths,
                    graph: draft.graph,
                    ai: { 
                        agents: draft.ai.agents, 
                        active_agent_id: draft.ai.active_agent_id,
                        providers: draft.ai.providers
                    },
                    integrations: data,
                    zotero: draft.zotero
                });
                // Marcar com a carregat només DESPRÉS de setIntegrations
                setTimeout(() => {
                    integrationsLoadedRef.current = true;
                }, 100);
            }
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
        setNewsletterSourcesLoading(true);
        setNewsletterSourcesError('');
        try {
            const res = await fetch('/api/reader/sources');
            if (!res.ok) {
                setNewsletterSourcesError(t('subs_sources_load_error_status', { status: res.status }));
                return;
            }
            const sources = await res.json();
            setNewsletterSources((sources || []).filter(s => ['rss', 'newsletter', 'youtube', 'newsletter_account'].includes(s.type)));
            setNewsletterSourcesLoaded(true);
        } catch (err) {
            console.error("Error loading newsletters:", err);
            setNewsletterSourcesError(t('subs_sources_load_error_conn'));
        } finally {
            setNewsletterSourcesLoading(false);
        }
    };

    const loadNewsletterAccount = async () => {
        try {
            const res = await fetch('/api/reader/newsletter-account');
            if (!res.ok) return;
            const data = await res.json();
            const next = {
                mail_server: data.mail_server || '',
                mail_port: data.mail_port || 110,
                mail_ssl: data.mail_ssl || 'starttls',
                email: data.email || '',
                password: data.password_set ? '••••••••' : '',
                delete_after_ingest: data.delete_after_ingest !== false
            };
            setNewsletterAccount(next);
            // Baseline per evitar autosave en falsos canvis (per ex. recàrrega post-save).
            lastSavedNewsletterAccountRef.current = JSON.stringify({ ...next, _passwordDirty: false });
            setNewsletterAccountLoaded(true);
            setNewsletterPasswordDirty(false);
        } catch (err) {
            console.error('Error loading newsletter account:', err);
        }
    };

    /**
     * Persisteix la config POP3. Silent per a l'autosave (només actualitza
     * l'indicador global "Desat / Al dia / Error" del modal). Si l'usuari
     * no ha tocat la contrasenya, no s'envia al payload — el backend manté
     * la guardada.
     */
    const saveNewsletterAccount = async () => {
        if (!newsletterAccountLoaded) return;
        setSavingStatus('saving');
        try {
            const payload = {
                mail_server: newsletterAccount.mail_server,
                mail_port: parseInt(newsletterAccount.mail_port, 10) || 110,
                mail_ssl: newsletterAccount.mail_ssl,
                email: newsletterAccount.email,
                delete_after_ingest: !!newsletterAccount.delete_after_ingest
            };
            if (newsletterPasswordDirty) {
                payload.password = newsletterAccount.password;
            }
            const res = await fetch('/api/reader/newsletter-account', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                setSavingStatus('error');
                return;
            }
            setSavingStatus('saved');
            setTimeout(() => setSavingStatus('idle'), 2000);
            setNewsletterPasswordDirty(false);
            await loadNewsletterAccount();
        } catch (err) {
            console.error('Error saving newsletter account:', err);
            setSavingStatus('error');
        }
    };

    const testNewsletterAccount = async () => {
        setNewsletterAccountTesting(true);
        setNewsletterAccountStatus(t('subs_news_status_testing'));
        try {
            // Enviem els valors actuals del form: així l'usuari pot provar abans de desar.
            // Si l'usuari no ha tocat la contrasenya (encara és '••••••••'), no l'enviem
            // perquè el backend usi la guardada a la BD.
            const payload = {
                mail_server: newsletterAccount.mail_server,
                mail_port: parseInt(newsletterAccount.mail_port, 10) || 110,
                mail_ssl: newsletterAccount.mail_ssl,
                email: newsletterAccount.email
            };
            if (newsletterPasswordDirty && newsletterAccount.password) {
                payload.password = newsletterAccount.password;
            }
            const res = await fetch('/api/reader/newsletter-account/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            setNewsletterAccountStatus(data.message || data.detail || (res.ok ? '' : t('subs_news_status_test_error')));
        } catch (err) {
            setNewsletterAccountStatus(t('subs_news_status_test_error'));
        } finally {
            setNewsletterAccountTesting(false);
        }
    };

    const syncNewsletterAccount = async () => {
        setNewsletterAccountSyncing(true);
        setNewsletterAccountStatus(t('subs_news_status_syncing'));
        try {
            const res = await fetch('/api/reader/newsletter-account/sync', { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            setNewsletterAccountStatus(data.message || (res.ok ? t('subs_news_status_sync_started') : t('subs_news_status_sync_error')));
            await loadNewsletterSources();
        } catch (err) {
            setNewsletterAccountStatus(t('subs_news_status_sync_conn_error'));
        } finally {
            setNewsletterAccountSyncing(false);
        }
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
            zotero: draft.zotero,
            identity: draft.identity
        });

        // Initialize baseline on first load
        if (lastSavedData.current === null) {
            lastSavedData.current = currentData;
            return;
        }

        // Protecció crítica: no desar integrations si encara no s'han carregat del servidor
        if (!integrationsLoadedRef.current) {
            console.warn('[AutoSave] Ignorant desa: integrations encara no carregades.');
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
                axios.post('/api/zotero/config', draft.zotero),
                axios.post('/api/identity', draft.identity)
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

    // Auto-save Effect for Newsletter POP3 account (debounced 800ms).
    // Skips the very first run (load) and any change that doesn't actually
    // differ from the last persisted state.
    useEffect(() => {
        if (!isOpen || !newsletterAccountLoaded) return;
        const current = JSON.stringify({ ...newsletterAccount, _passwordDirty: newsletterPasswordDirty });
        if (lastSavedNewsletterAccountRef.current === current) return;

        if (newsletterAccountSaveTimerRef.current) clearTimeout(newsletterAccountSaveTimerRef.current);
        newsletterAccountSaveTimerRef.current = setTimeout(() => {
            Promise.resolve(saveNewsletterAccount())
                .then(() => {
                    lastSavedNewsletterAccountRef.current = current;
                })
                .catch(() => {
                    // Keep the previous baseline so autosave can retry unchanged data.
                });
        }, 800);

        return () => {
            if (newsletterAccountSaveTimerRef.current) clearTimeout(newsletterAccountSaveTimerRef.current);
        };
    }, [newsletterAccount, newsletterPasswordDirty, newsletterAccountLoaded, isOpen]);

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
                const updatedIntegrations = { ...integrations };
                let changed = false;

                // Eliminació agressiva de TOTES les llistes de l'objecte
                Object.keys(updatedIntegrations).forEach(key => {
                    if (Array.isArray(updatedIntegrations[key])) {
                        const originalLen = updatedIntegrations[key].length;
                        updatedIntegrations[key] = updatedIntegrations[key].filter(a => (a.id !== accountId && a.email !== accountId));
                        if (updatedIntegrations[key].length !== originalLen) {
                            changed = true;
                        }
                    }
                });

                setSavingStatus('saving');
                try {
                    // Forcem el guardat fins i tot si 'changed' és false per netejar possibles inconsistències
                    await axios.post('/api/integrations/bulk', updatedIntegrations);
                    setIntegrations(updatedIntegrations);
                    setSavingStatus('saved');
                    setTimeout(() => setSavingStatus('idle'), 2000);
                } catch (e) {
                    setSavingStatus('error');
                    console.error("Error crític eliminant compte:", e);
                }
                setConfirmConfig(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleEditAccount = (category, account) => {
        setAddAccountType(category);
        setEditingAccountId(account.id);
        setAddAccountEmail(account.email || account.username || '');
        setAddAccountEmailBlurred(true);
        if (account.provider === 'manual') {
            setManualServer(account.server_url || '');
            setManualPassword(account.password || '');
        } else {
            setIsManualGoogle(false);
        }

        if (category === 'mail') {
            setMailSignature(account.signature || '');
            setMailCertificate(account.certificate || '');
            setMailDisplayName(account.display_name || '');
            setMailSubjectPrefix(account.subject_prefix || '');
            setMailAliases(account.aliases || []);
            if (account.provider === 'manual') {
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
            } else {
                setMailImapHost(''); setMailImapPort('993'); setMailImapUser(''); setMailImapPass(''); setMailImapEnc('ssl');
                setMailSmtpHost(''); setMailSmtpPort('465'); setMailSmtpUser(''); setMailSmtpPass(''); setMailSmtpEnc('ssl');
            }
        }
    };

    const handleSyncAccount = async (category, account) => {
        const accountId = account?.id || account;
        if (!accountId) return;
        const email = account?.email || account?.username || '';
        setSyncingAccounts(prev => ({ ...prev, [accountId]: true }));
        setSavingStatus('saving');
        try {
            let res;
            if (category === 'contacts') {
                const provider = account?.provider || 'manual';
                res = await axios.post('/api/contacts/sync', { provider, email, server_url: account?.server_url, password: account?.password, username: account?.username });
            } else if (category === 'calendar') {
                res = await axios.post(`/api/calendar/sync?email=${encodeURIComponent(email)}`);
            } else {
                res = await axios.post(`/api/mail/sync?email=${encodeURIComponent(email)}`);
            }

            const ok = res.data.status === 'success' || res.data.status === 'ok';
            const partial = res.data.status === 'partial';
            if (ok || partial) {
                const failedEmails = res.data.failed || [];
                setSyncErrorAccounts(prev => {
                    const next = new Set(prev);
                    if (email) failedEmails.includes(email) ? next.add(email) : next.delete(email);
                    return next;
                });
                setSavingStatus(partial ? 'error' : 'saved');
                loadIntegrations();
                if (partial && failedEmails.length) {
                    alert(`Alguns comptes no s'han pogut sincronitzar: ${failedEmails.join(', ')}. Comprova les credencials IMAP a Configuració.`);
                }
            } else {
                setSavingStatus('error');
                if (email) setSyncErrorAccounts(prev => new Set(prev).add(email));
                alert(`Error en la sincronització: ${res.data.error || res.data.detail || 'Error desconegut'}`);
            }
        } catch (e) {
            console.error("Sync error:", e);
            setSavingStatus('error');
            if (email) setSyncErrorAccounts(prev => new Set(prev).add(email));
            const detail = e?.response?.data?.detail || e?.message || 'Error desconegut';
            alert(`Error en la sincronització: ${detail}`);
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

    /**
     * Si l'usuari enganxa una URL de canal YouTube, la converteix al feed XML públic.
     * Patrons reconeguts:
     *   - youtube.com/channel/UC...        → youtube.com/feeds/videos.xml?channel_id=UC...
     *   - youtube.com/user/NAME            → youtube.com/feeds/videos.xml?user=NAME
     *   - youtube.com/playlist?list=PL...  → youtube.com/feeds/videos.xml?playlist_id=PL...
     * Pels handles (@nom) cal channel_id real → mostrem un avís perquè l'usuari el copiï manualment.
     * Si ja és una URL de feed XML o no és YouTube, retorna la URL tal qual.
     */
    const normalizeYoutubeUrl = (rawUrl) => {
        if (!rawUrl) return { url: rawUrl, warning: '' };
        const url = rawUrl.trim();
        if (url.includes('/feeds/videos.xml')) return { url, warning: '' };
        let m;
        m = url.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
        if (m) return { url: `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`, warning: '' };
        m = url.match(/youtube\.com\/user\/([\w.-]+)/i);
        if (m) return { url: `https://www.youtube.com/feeds/videos.xml?user=${m[1]}`, warning: '' };
        m = url.match(/youtube\.com\/playlist\?list=([\w-]+)/i);
        if (m) return { url: `https://www.youtube.com/feeds/videos.xml?playlist_id=${m[1]}`, warning: '' };
        m = url.match(/youtube\.com\/@([\w.-]+)/i);
        if (m) return {
            url,
            warning: `No es pot convertir automàticament un handle (@${m[1]}). Obre el canal, fes clic dret a la pàgina → "Veure codi font" i busca "channelId". Després enganxa: https://www.youtube.com/feeds/videos.xml?channel_id=UC...`
        };
        return { url, warning: '' };
    };

    const handleAddNewsletter = async () => {
        if (!newsletterAddress.trim()) return;
        setNewsletterStatus(t('subs_form_status_adding'));

        let finalUrl = newsletterAddress.trim();
        if (newsletterType === 'youtube') {
            const { url: converted, warning } = normalizeYoutubeUrl(finalUrl);
            if (warning) {
                // El warning ve de normalizeYoutubeUrl en català com a fallback;
                // si conté '@handle', el reformulem amb la clau i18n.
                const handleMatch = finalUrl.match(/youtube\.com\/@([\w.-]+)/i);
                if (handleMatch) {
                    setNewsletterStatus(t('subs_form_status_youtube_handle_warning', { handle: handleMatch[1] }));
                } else {
                    setNewsletterStatus(warning);
                }
                return;
            }
            finalUrl = converted;
        }

        try {
            const res = await fetch('/api/reader/sources', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newsletterName || finalUrl, url: finalUrl, type: newsletterType })
            });
            if (res.ok) {
                setNewsletterName(''); setNewsletterAddress(''); loadNewsletterSources();
                setNewsletterStatus(newsletterType === 'youtube' && finalUrl !== newsletterAddress.trim()
                    ? t('subs_form_status_youtube_converted', { url: finalUrl })
                    : t('subs_form_status_added'));
            } else {
                const j = await res.json().catch(() => ({}));
                setNewsletterStatus(j.detail || t('subs_form_status_error'));
            }
        } catch { setNewsletterStatus(t('subs_form_status_error')); }
    };

    const handleNewsletterOpmlUpload = async (file) => {
        if (!file) return;

        setNewsletterOpmlLoading(true);
        setNewsletterStatus(t('subs_opml_status_importing'));

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/api/reader/sources/opml', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                setNewsletterStatus(data?.detail || t('subs_opml_status_failed'));
                return;
            }

            setNewsletterStatus(data?.message || t('subs_opml_status_done'));
            await loadNewsletterSources();
        } catch (err) {
            console.error('Error importing OPML newsletters:', err);
            setNewsletterStatus(t('subs_opml_status_error'));
        } finally {
            setNewsletterOpmlLoading(false);
            if (newsletterOpmlRef.current) {
                newsletterOpmlRef.current.value = '';
            }
        }
    };

    // if (!draft.settings) return null; // Eliminar per evitar que el pare no renderitzi res

    return (
        <>
            <div className={`settings-overlay ${isOpen ? 'active' : ''}`} />
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
                                <div className="settings-section-icon-wrap">
                                    <SettingsIcon size={20} strokeWidth={2} />
                                </div>
                                <h2 className="settings-sidebar-title">Configuració</h2>
                            </div>
                            
                            {/* INDICADOR DE SAVING */}
                            <div className={`settings-status-indicator ${savingStatus}`} style={{ 
                                marginTop: '20px', padding: '10px 14px', borderRadius: '14px', 
                                background: 'rgba(59, 130, 246, 0.05)', border: '1px solid var(--settings-border)', 
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
                            <SidebarItem id="profile" icon={User} label={t('settings.tabs.profile') || 'Perfil'} active={activeTab === 'profile'} onClick={() => { setActiveTab('profile'); setAddAccountType(null); }} />
                            
                            <div className="settings-sidebar-hr" />

                            <SidebarItem id="general" icon={SettingsIcon} label={t('settings.tabs.general') || 'General'} active={activeTab === 'general'} onClick={() => { setActiveTab('general'); setAddAccountType(null); }} />
                            <SidebarItem id="language" icon={Globe} label={t('settings.tabs.language') || 'Idioma i Regió'} active={activeTab === 'language'} onClick={() => { setActiveTab('language'); setAddAccountType(null); }} />
                            <SidebarItem id="appearance" icon={Palette} label={t('settings.tabs.appearance') || 'Aparença'} active={activeTab === 'appearance'} onClick={() => { setActiveTab('appearance'); setAddAccountType(null); }} />
                            
                            <div className="settings-sidebar-hr" />
                            
                            <SidebarItem id="calendar" icon={Calendar} label={t('settings.tabs.calendar') || 'Calendari'} active={activeTab === 'calendar'} onClick={() => { setActiveTab('calendar'); setAddAccountType(null); }} />
                            <SidebarItem id="contacts" icon={Users} label={t('settings.tabs.contacts') || 'Contactes'} active={activeTab === 'contacts'} onClick={() => { setActiveTab('contacts'); setAddAccountType(null); }} />
                            <SidebarItem id="mail" icon={Mail} label={t('settings.tabs.mail_accounts') || 'Correu'} active={activeTab === 'mail'} onClick={() => { setActiveTab('mail'); setAddAccountType(null); }} />
                            
                            <div className="settings-sidebar-hr" />

                            <SidebarItem id="newsletters" icon={Rss} label={t('settings.tabs.newsletters') || 'Subscripcions'} active={activeTab === 'newsletters'} onClick={() => { setActiveTab('newsletters'); setAddAccountType(null); }} />
                            <SidebarItem id="social" icon={Share2} label="Social" active={activeTab === 'social'} onClick={() => { setActiveTab('social'); setAddAccountType(null); }} />
                            <SidebarItem id="graph" icon={Share2} label={t('settings.tabs.graph') || 'Grafe'} active={activeTab === 'graph'} onClick={() => { setActiveTab('graph'); setAddAccountType(null); }} />
                            <SidebarItem id="ai" icon={Cpu} label={t('settings.tabs.ai') || 'IA i Agents'} active={activeTab === 'ai'} onClick={() => { setActiveTab('ai'); setAddAccountType(null); }} />
                            <SidebarItem id="zotero" icon={BookOpen} label={t('settings.tabs.zotero') || 'Zotero'} active={activeTab === 'zotero'} onClick={() => { setActiveTab('zotero'); setAddAccountType(null); }} />
                        </div>

                    </aside>

                    {/* CONTENT AREA */}
                    <main className="settings-main">
                        <button onClick={onClose} className="gnosi-close-btn settings-close-btn" aria-label="Tancar configuració">
                            <X />
                        </button>

                        <div className="settings-content-wrap">
                            
                             {/* PERFIL D'IDENTITAT */}
                             {activeTab === 'profile' && (
                                <div className="animate-in">
                                    <IdentityProfile 
                                        userName={draft.settings.user_name} 
                                        setUserName={(val) => setDraft({...draft, settings: {...draft.settings, user_name: val}})}
                                        profile={draft.identity}
                                        setProfile={(val) => setDraft({...draft, identity: val})}
                                    />
                                </div>
                             )}

                             {/* GENERAL */}
                            {activeTab === 'general' && (
                                <Section title="Configuració del Sistema" icon={SettingsIcon}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '40px' }}>
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
                                                <FormGroup label="Password Admin"><PasswordInput value={draft.settings.org_password} onChange={e => setDraft({...draft, settings: {...draft.settings, org_password: e.target.value}})} name="org-admin-password" autoComplete="new-password" /></FormGroup>
                                            </div>
                                        </div>
                                    )}

                                    <div style={{ marginTop: '50px' }}>
                                        <Section title="Estructura de Fitxers" icon={FolderOpen}>
                                            <FormGroup label="Ruta del Vault" description="Carpeta principal on s'emmgatzemen totes les dades del sistema.">
                                                <div style={{ display: 'flex', gap: '14px' }}>
                                                    <input type="text" className="gnosi-input" value={draft.paths.vault || ''} readOnly style={{ flex: 1, opacity: 0.7, fontFamily: 'monospace', fontSize: '0.82rem', letterSpacing: '0' }} />
                                                    <button onClick={() => { setPickerField('vault'); setPickerOpen(true); }} className="btn-gnosi-secondary" style={{ padding: '0 24px', borderRadius: '14px', border: 'none', background: 'rgba(59, 130, 246, 0.12)', color: 'var(--gnosi-blue)', flexShrink: 0 }}>
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
                                        {/* Calendari per defecte */}
                                        {activeTab === 'contacts' && (() => {
                                            const allContactSources = [
                                                ...(integrations.contacts || []),
                                                ...(integrations.mail_accounts || []),
                                                ...(integrations.emails || []),
                                            ];
                                            const seenC = new Set();
                                            const opts = allContactSources
                                                .filter(c => { const id = c.email || c.username; if (!id || seenC.has(id)) return false; seenC.add(id); return true; })
                                                .map(c => ({ id: c.email || c.username, label: c.name || c.email || c.username }));
                                            if (opts.length === 0) return null;
                                            return (
                                                <div style={{ marginBottom: '24px', padding: '18px 20px', background: 'var(--settings-sidebar-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)' }}>
                                                    <label style={{ fontSize: '0.72rem', fontWeight: '800', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '10px' }}>
                                                        Compte per defecte
                                                    </label>
                                                    <select
                                                        value={integrations.default_contacts || ''}
                                                        onChange={(e) => {
                                                            const email = e.target.value;
                                                            const updated = { ...integrations, default_contacts: email };
                                                            setIntegrations(updated);
                                                            axios.put('/api/integrations/default_contacts', { email }).catch(console.error);
                                                        }}
                                                        className="gnosi-input"
                                                        style={{ width: '100%' }}
                                                    >
                                                        {opts.map(opt => (
                                                            <option key={opt.id} value={opt.id}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                    <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '8px', marginBottom: 0 }}>
                                                        S'usarà per sincronitzar i crear nous contactes.
                                                    </p>
                                                </div>
                                            );
                                        })()}
                                        {activeTab === 'mail' && (() => {
                                            const allMail = [...(integrations.mail_accounts || []), ...(integrations.emails || [])];
                                            const seen = new Set();
                                            const opts = allMail
                                                .filter(c => { const id = c.email || c.username; if (!id || seen.has(id)) return false; seen.add(id); return true; })
                                                .map(c => ({ id: c.email || c.username, label: c.name || c.email || c.username }));
                                            if (opts.length === 0) return null;
                                            return (
                                                <div style={{ marginBottom: '24px', padding: '18px 20px', background: 'var(--settings-sidebar-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)' }}>
                                                    <label style={{ fontSize: '0.72rem', fontWeight: '800', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '10px' }}>
                                                        Compte per defecte
                                                    </label>
                                                    <select
                                                        value={integrations.default_mail || ''}
                                                        onChange={(e) => {
                                                            const email = e.target.value;
                                                            const updated = { ...integrations, default_mail: email };
                                                            setIntegrations(updated);
                                                            axios.put('/api/integrations/default_mail', { email }).catch(console.error);
                                                        }}
                                                        className="gnosi-input"
                                                        style={{ width: '100%' }}
                                                    >
                                                        {opts.map(opt => (
                                                            <option key={opt.id} value={opt.id}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                    <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '8px', marginBottom: 0 }}>
                                                        S'usarà per enviar correus i com a remitent per defecte.
                                                    </p>
                                                </div>
                                            );
                                        })()}
                                        {activeTab === 'calendar' && (() => {
                                            const subCalOpts = googleSubCalendars
                                                .filter(c => c.id && c.name)
                                                .map(c => ({ id: c.id, label: c.name, account: c.account }));
                                            const seenIds = new Set(subCalOpts.map(o => o.id));
                                            const accountOpts = (integrations.calendars || [])
                                                .filter(c => {
                                                    const id = c.email || c.username || c.name;
                                                    return id && !seenIds.has(id);
                                                })
                                                .map(c => ({ id: c.email || c.username || c.name, label: c.name || c.email || c.username }));
                                            const allCalOpts = [
                                                ...(tables.filter(t => integrations.vault_calendar?.enabled_tables?.includes(t.id)).map(t => ({ id: t.id, label: t.name }))),
                                                ...subCalOpts,
                                                ...accountOpts,
                                            ];
                                            if (allCalOpts.length === 0) return null;
                                            return (
                                                <div style={{ marginBottom: '24px', padding: '18px 20px', background: 'var(--settings-sidebar-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)' }}>
                                                    <label style={{ fontSize: '0.72rem', fontWeight: '800', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '10px' }}>
                                                        Calendari per defecte
                                                    </label>
                                                    <select
                                                        value={integrations.default_calendar || ''}
                                                        onChange={async (e) => {
                                                            const source = e.target.value;
                                                            const updated = { ...integrations, default_calendar: source };
                                                            setIntegrations(updated);
                                                            axios.put('/api/integrations/default_calendar', { source }).catch(console.error);
                                                        }}
                                                        className="gnosi-input"
                                                        style={{ width: '100%' }}
                                                    >
                                                        {allCalOpts.map(opt => (
                                                            <option key={opt.id} value={opt.id}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                    <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '8px', marginBottom: 0 }}>
                                                        S'assignarà automàticament a les noves cites creades al calendari.
                                                    </p>
                                                </div>
                                            );
                                        })()}
                                        {isAddingTable && (
                                            <div className="animate-in" style={{ 
                                                marginBottom: '32px', padding: '28px', borderRadius: '28px', 
                                                background: 'var(--settings-sidebar-bg)', border: '1px solid rgba(59, 130, 246, 0.18)',
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
                                                background: 'var(--settings-sidebar-bg)', border: '1px solid rgba(59, 130, 246, 0.18)',
                                                boxShadow: '0 15px 40px rgba(59, 130, 246, 0.12)'
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                                    <span style={{ fontSize: '0.85rem', fontWeight: '1000', color: 'var(--gnosi-blue)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Configuració del Compte</span>
                                                    <button onClick={() => { setAddAccountType(null); setAddAccountEmail(''); setAddAccountEmailBlurred(false); setIsManualGoogle(false); setManualServer(''); setManualPassword(''); setEditingAccountId(null); }} className="icon-btn hover-bg-strong" style={{ padding: '8px', borderRadius: '12px' }}><X size={18} /></button>
                                                </div>
                                                
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                    <FormGroup label="Adreça de Correu">
                                                        <input
                                                            type="email"
                                                            className="gnosi-input"
                                                            value={addAccountEmail}
                                                            name="mail-account-username"
                                                            autoComplete="username"
                                                            onChange={e => {
                                                                setAddAccountEmail(e.target.value);
                                                                setAddAccountEmailBlurred(false);
                                                                setIsManualGoogle(false);
                                                            }}
                                                            onBlur={() => setAddAccountEmailBlurred(true)}
                                                            placeholder="exemple@pangea.org"
                                                            autoFocus
                                                        />
                                                    </FormGroup>

                                                    {(() => {
                                                        const emailLower = addAccountEmail.trim().toLowerCase();
                                                        const isComplete = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower);
                                                        if (!isComplete || (!addAccountEmailBlurred && !isManualGoogle)) return null;

                                                        const isGoogle   = emailLower.endsWith('@gmail.com') || emailLower.endsWith('@googlemail.com') || isManualGoogle;
                                                        const isMicrosoft = emailLower.endsWith('@outlook.com') || emailLower.endsWith('@hotmail.com') || emailLower.endsWith('@live.com') || emailLower.endsWith('@msn.com');
                                                        const isICloud   = emailLower.endsWith('@icloud.com') || emailLower.endsWith('@me.com') || emailLower.endsWith('@mac.com');
                                                        const isYahoo    = emailLower.endsWith('@yahoo.com') || emailLower.endsWith('@ymail.com') || emailLower.endsWith('@yahoo.es');
                                                        const isAol      = emailLower.endsWith('@aol.com');

                                                        const fillImap = (imap, smtp) => {
                                                            setMailImapHost(imap.host); setMailImapPort(imap.port); setMailImapEnc(imap.enc);
                                                            setMailSmtpHost(smtp.host); setMailSmtpPort(smtp.port); setMailSmtpEnc(smtp.enc);
                                                            setMailImapUser(addAccountEmail); setMailSmtpUser(addAccountEmail);
                                                        };

                                                        const btnStyle = (bg, shadow) => ({
                                                            width: '100%', background: bg, padding: '14px 16px',
                                                            borderRadius: '14px', fontWeight: '800', display: 'flex',
                                                            alignItems: 'center', gap: '12px',
                                                            boxShadow: shadow, border: 'none', cursor: 'pointer',
                                                            transition: 'all 0.2s', color: 'white', fontSize: '0.95rem'
                                                        });
                                                        const iconBox = (r) => ({ background: 'white', padding: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: r || '10px' });

                                                        const GoogleBtn = () => (
                                                            <button onClick={() => window.location.href = `/api/auth/google/login?type=${activeTab}`} style={btnStyle('#4285f4', '0 8px 16px rgba(66,133,244,0.25)')}>
                                                                <div style={iconBox()}><img src="https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png" style={{ width: '18px', height: '18px' }} alt="" /></div>
                                                                Continuar amb Google
                                                            </button>
                                                        );
                                                        const MicrosoftBtn = () => (
                                                            <button onClick={() => window.location.href = '/api/auth/microsoft/login'} style={btnStyle('#0078d4', '0 8px 16px rgba(0,120,212,0.25)')}>
                                                                <div style={iconBox()}><svg width="18" height="18" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg></div>
                                                                Continuar amb Microsoft
                                                            </button>
                                                        );
                                                        const ICloudBtn = () => (
                                                            <button onClick={() => fillImap({ host: 'imap.mail.me.com', port: '993', enc: 'ssl' }, { host: 'smtp.mail.me.com', port: '587', enc: 'starttls' })} style={btnStyle('#555', '0 8px 16px rgba(0,0,0,0.15)')}>
                                                                <div style={iconBox('8px')}><svg width="18" height="18" viewBox="0 0 24 24" fill="#555"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg></div>
                                                                Continuar amb iCloud
                                                            </button>
                                                        );
                                                        const YahooBtn = () => (
                                                            <button onClick={() => fillImap({ host: 'imap.mail.yahoo.com', port: '993', enc: 'ssl' }, { host: 'smtp.mail.yahoo.com', port: '465', enc: 'ssl' })} style={btnStyle('#6001d2', '0 8px 16px rgba(96,1,210,0.2)')}>
                                                                <div style={iconBox()}><svg width="18" height="18" viewBox="0 0 24 24" fill="#6001d2"><path d="M14.2 2.9L12 9.3 9.8 2.9H6L10.6 14v7.1h2.8V14L18 2.9zM19.6 9.5l-2 5.7-2.1-5.7h-2.8l3.5 9-.1.2c-.4.9-.8 1.2-1.6 1.2-.3 0-.7-.1-1-.2l-.3 2.2c.5.2 1.1.3 1.7.3 2 0 3-.9 3.9-3.4l3.3-9.3h-2.5z"/></svg></div>
                                                                Continuar amb Yahoo
                                                            </button>
                                                        );
                                                        const AolBtn = () => (
                                                            <button onClick={() => fillImap({ host: 'imap.aol.com', port: '993', enc: 'ssl' }, { host: 'smtp.aol.com', port: '465', enc: 'ssl' })} style={btnStyle('#ff0b00', '0 8px 16px rgba(255,11,0,0.2)')}>
                                                                <div style={iconBox()}><svg width="18" height="18" viewBox="0 0 24 24" fill="#ff0b00"><text x="0" y="16" fontSize="14" fontWeight="bold">AOL</text></svg></div>
                                                                Continuar amb AOL
                                                            </button>
                                                        );

                                                        // Domain clearly identified → single button
                                                        if (isGoogle)    return <div className="animate-in" style={{ marginTop: '8px' }}><GoogleBtn /></div>;
                                                        if (isMicrosoft) return <div className="animate-in" style={{ marginTop: '8px' }}><MicrosoftBtn /></div>;
                                                        if (isICloud)    return <div className="animate-in" style={{ marginTop: '8px' }}><ICloudBtn /></div>;
                                                        if (isYahoo)     return <div className="animate-in" style={{ marginTop: '8px' }}><YahooBtn /></div>;
                                                        if (isAol)       return <div className="animate-in" style={{ marginTop: '8px' }}><AolBtn /></div>;

                                                        // Unknown domain → show all options
                                                        return (
                                                            <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                                                                <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', margin: '0 0 4px', textAlign: 'center' }}>Selecciona el proveïdor</p>
                                                                <GoogleBtn />
                                                                <MicrosoftBtn />
                                                                <ICloudBtn />
                                                                <YahooBtn />
                                                                <AolBtn />
                                                                <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textAlign: 'center', margin: '4px 0 0' }}>
                                                                    O configura manualment amb el formulari de sota
                                                                </p>
                                                            </div>
                                                        );
                                                    })()}
                                                    {activeTab === 'mail' ? (
                                                        <form onSubmit={async (e) => {
                                                            e.preventDefault();
                                                            if (!addAccountEmail) return;

                                                            const mailAcc = {
                                                                id: editingAccountId || `mail_${Date.now()}`,
                                                                email: addAccountEmail,
                                                                provider: 'manual',
                                                                display_name: mailDisplayName,
                                                                subject_prefix: mailSubjectPrefix,
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
                                                                aliases: mailAliases,
                                                                type: 'mail'
                                                            };
                                                            const key = 'mail_accounts';
                                                            const currentList = integrations[key] || [];
                                                            const newList = editingAccountId
                                                                ? currentList.map(a => a.id === editingAccountId ? mailAcc : a)
                                                                : [...currentList, mailAcc];

                                                            if (editingAccountId && mailImapHost) {
                                                                // Mode edició: prova la connexió IMAP/SMTP
                                                                setMailTestStatus('testing');
                                                                try {
                                                                    await axios.post('/api/integrations/bulk', { ...integrations, [key]: newList });
                                                                    const res = await axios.post('/api/integrations/test-email', {
                                                                        imap_server: mailImapHost,
                                                                        smtp_server: mailSmtpHost,
                                                                        username: mailImapUser || addAccountEmail,
                                                                        password: mailImapPass,
                                                                    });
                                                                    const ok = res.data?.success;
                                                                    setMailTestStatus(ok ? 'ok' : 'error');
                                                                    toast[ok ? 'success' : 'error'](ok ? 'Connexió IMAP/SMTP correcta' : `Error: ${res.data?.error || 'No s\'ha pogut connectar'}`);
                                                                    if (ok) loadIntegrations();
                                                                } catch (err) {
                                                                    setMailTestStatus('error');
                                                                    toast.error(`Error provant connexió: ${err?.response?.data?.detail || err.message || 'Error desconegut'}`);
                                                                }
                                                            } else {
                                                                // Mode nou compte: guarda i tanca
                                                                setSavingStatus('saving');
                                                                try {
                                                                    await axios.post('/api/integrations/bulk', { ...integrations, [key]: newList });
                                                                    setSavingStatus('saved');
                                                                    toast.success('Compte connectat correctament');
                                                                    setAddAccountType(null);
                                                                    setAddAccountEmail('');
                                                                    setMailDisplayName(''); setMailSubjectPrefix(''); setMailAliases([]);
                                                                    setMailImapHost(''); setMailImapPort('993'); setMailImapUser(''); setMailImapPass(''); setMailImapEnc('ssl');
                                                                    setMailSmtpHost(''); setMailSmtpPort('465'); setMailSmtpUser(''); setMailSmtpPass(''); setMailSmtpEnc('ssl');
                                                                    setMailSignature(''); setMailCertificate('');
                                                                    setEditingAccountId(null);
                                                                    loadIntegrations();
                                                                    setTimeout(() => setSavingStatus('idle'), 2000);
                                                                } catch (err) {
                                                                    setSavingStatus('error');
                                                                    toast.error(`Error guardant: ${err?.response?.data?.detail || err.message || 'Error desconegut'}`);
                                                                }
                                                            }
                                                        }} className="animate-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                                            {/* NOM REMITENT + ÀLIES */}
                                                            <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '16px 20px', background: 'var(--settings-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)' }}>
                                                                <div>
                                                                    <FormGroup label="Nom del remitent" description="Com apareixerà al camp 'De' dels correus enviats.">
                                                                        <input
                                                                            type="text"
                                                                            className="gnosi-input"
                                                                            value={mailDisplayName}
                                                                            onChange={e => setMailDisplayName(e.target.value)}
                                                                            placeholder="Ismael García"
                                                                        />
                                                                    </FormGroup>
                                                                </div>
                                                                <div>
                                                                    <FormGroup label="Àlies (adreces addicionals)" description="Cada àlies envia via el mateix SMTP i pot tenir la seva pròpia signatura.">
                                                                        <AliasEditor aliases={mailAliases} onChange={setMailAliases} />
                                                                    </FormGroup>
                                                                </div>
                                                                <div style={{ gridColumn: 'span 2' }}>
                                                                    <FormGroup label="Assignatura per defecte" description="S'afegirà automàticament al camp 'Assumpte' en crear un correu nou.">
                                                                        <input
                                                                            type="text"
                                                                            className="gnosi-input"
                                                                            value={mailSubjectPrefix}
                                                                            onChange={e => setMailSubjectPrefix(e.target.value)}
                                                                            placeholder="Ex: [Departament TIC] "
                                                                        />
                                                                    </FormGroup>
                                                                </div>
                                                            </div>

                                                            {/* SECCIÓ IMAP */}
                                                            <form onSubmit={e => e.preventDefault()} autoComplete="on" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', background: 'var(--settings-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
                                                                <h4 style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--gnosi-blue)', fontWeight: '900', textTransform: 'uppercase' }}>Servidor IMAP (Recepció)</h4>
                                                                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
                                                                    <FormGroup label="Servidor"><input type="text" className="gnosi-input" value={mailImapHost} onChange={e => setMailImapHost(e.target.value)} placeholder="imap.pangea.org" /></FormGroup>
                                                                    <FormGroup label="Port"><input type="text" className="gnosi-input" value={mailImapPort} onChange={e => setMailImapPort(e.target.value)} placeholder="993" /></FormGroup>
                                                                </div>
                                                                <FormGroup label="Usuari"><input type="text" className="gnosi-input" value={mailImapUser} onChange={e => setMailImapUser(e.target.value)} name="imap-username" autoComplete="username" /></FormGroup>
                                                                <FormGroup label="Contrasenya"><PasswordInput value={mailImapPass} onChange={e => setMailImapPass(e.target.value)} name="imap-password" autoComplete="current-password" /></FormGroup>
                                                                <FormGroup label="Seguretat">
                                                                    <select className="gnosi-select" value={mailImapEnc} onChange={e => setMailImapEnc(e.target.value)}>
                                                                        <option value="ssl">SSL/TLS</option>
                                                                        <option value="starttls">STARTTLS</option>
                                                                        <option value="none">Cap</option>
                                                                    </select>
                                                                </FormGroup>
                                                            </form>

                                                            {/* SECCIÓ SMTP */}
                                                            <form onSubmit={e => e.preventDefault()} autoComplete="on" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', background: 'var(--settings-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
                                                                <h4 style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--gnosi-blue)', fontWeight: '900', textTransform: 'uppercase' }}>Servidor SMTP (Enviament)</h4>
                                                                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
                                                                    <FormGroup label="Servidor"><input type="text" className="gnosi-input" value={mailSmtpHost} onChange={e => setMailSmtpHost(e.target.value)} placeholder="smtp.pangea.org" /></FormGroup>
                                                                    <FormGroup label="Port"><input type="text" className="gnosi-input" value={mailSmtpPort} onChange={e => setMailSmtpPort(e.target.value)} placeholder="465" /></FormGroup>
                                                                </div>
                                                                <FormGroup label="Usuari"><input type="text" className="gnosi-input" value={mailSmtpUser} onChange={e => setMailSmtpUser(e.target.value)} name="smtp-username" autoComplete="username" /></FormGroup>
                                                                <FormGroup label="Contrasenya"><PasswordInput value={mailSmtpPass} onChange={e => setMailSmtpPass(e.target.value)} name="smtp-password" autoComplete="current-password" /></FormGroup>
                                                                <FormGroup label="Seguretat">
                                                                    <select className="gnosi-select" value={mailSmtpEnc} onChange={e => setMailSmtpEnc(e.target.value)}>
                                                                        <option value="ssl">SSL/TLS</option>
                                                                        <option value="starttls">STARTTLS</option>
                                                                        <option value="none">Cap</option>
                                                                    </select>
                                                                </FormGroup>
                                                            </form>

                                                            <div style={{ gridColumn: 'span 2' }}>
                                                                <FormGroup label="Signatura HTML (Opcional)" description="Aquesta signatura s'afegirà automàticament als correus que enviïs.">
                                                                    <div style={{ marginTop: '8px' }}>
                                                                        <MailBlockEditor
                                                                            key={editingAccountId || 'new'}
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
                                                            
                                                            <div style={{ gridColumn: 'span 2', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                                                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                                                    {editingAccountId
                                                                        ? '✓ Els canvis de signatura, nom i àlies es guarden automàticament.'
                                                                        : 'Omple el servidor IMAP/SMTP i clica per connectar.'}
                                                                </div>
                                                                <button
                                                                    type="submit"
                                                                    className="btn-gnosi-primary"
                                                                    style={{ padding: '12px 24px', fontSize: '0.9rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '8px' }}
                                                                    disabled={mailTestStatus === 'testing'}
                                                                >
                                                                    {mailTestStatus === 'testing' && <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} />}
                                                                    {mailTestStatus === 'ok' && <Check size={15} />}
                                                                    {editingAccountId
                                                                        ? (mailTestStatus === 'ok' ? 'Connexió OK' : mailTestStatus === 'error' ? 'Error connexió' : 'Provar connexió')
                                                                        : 'Connectar Compte'}
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
                                                                <PasswordInput value={manualPassword} onChange={e => setManualPassword(e.target.value)} name="mail-account-password" autoComplete="current-password" />
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
                                            // Get all possible accounts that could be mail accounts
                                            const currentAccounts = [
                                                ...(integrations.mail_accounts || []),
                                                ...(integrations.emails || []),
                                                ...(integrations.calendars || []),
                                                ...(integrations.contacts || [])
                                            ].filter(acc => acc.email || acc.username);
                                            
                                            // Deduplicate by Email/ID
                                            const seen = new Set();
                                            const uniqueAccounts = currentAccounts.filter(acc => {
                                                const email = acc.email || acc.username;
                                                if (!email) return false;
                                                const lowerEmail = email.toLowerCase();
                                                if (seen.has(lowerEmail)) return false;
                                                seen.add(lowerEmail);
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
                                                                status={syncErrorAccounts.has(acc.email || acc.username) ? 'error' : 'connected'}
                                                                type={activeTab}
                                                                provider={acc.provider}
                                                                enabled={acc.enabled !== false}
                                                                onToggleEnabled={activeTab === 'mail' ? async (val) => {
                                                                    const emailAddr = acc.email || acc.username;
                                                                    await axios.patch(`/api/mail/accounts/${encodeURIComponent(emailAddr)}/enabled`, { enabled: val });
                                                                    setIntegrations(prev => {
                                                                        const updated = { ...prev };
                                                                        for (const section of ['mail_accounts', 'emails']) {
                                                                            if (updated[section]) {
                                                                                updated[section] = updated[section].map(a =>
                                                                                    (a.email || a.username) === emailAddr ? { ...a, enabled: val } : a
                                                                                );
                                                                            }
                                                                        }
                                                                        return updated;
                                                                    });
                                                                } : undefined}
                                                                onSync={() => handleSyncAccount(activeTab, acc)}
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

                            {/* MAIL SNIPPETS */}
                            {activeTab === 'mail' && (
                                <Section title="Fragments de text" icon={FileText}>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                                        Textos predefinits que pots insertar ràpidament quan redactes o respons correus.
                                    </p>

                                    {/* Llista de fragments existents */}
                                    {snippets.length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
                                            {snippets.map(s => (
                                                <div key={s.id} style={{
                                                    display: 'flex', alignItems: 'flex-start', gap: '12px',
                                                    padding: '14px 16px', background: 'var(--settings-bg)',
                                                    borderRadius: '14px', border: `1px solid ${editingSnippetId === s.id ? 'var(--gnosi-blue)' : 'var(--settings-border)'}`
                                                }}>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '4px' }}>{s.title}</div>
                                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: '1.4', overflow: 'hidden', maxHeight: '3.6em' }}>{s.content}</div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                                        <button
                                                            onClick={() => handleEditSnippet(s)}
                                                            style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'transparent', color: 'var(--gnosi-blue)', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}
                                                        >
                                                            Editar
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteSnippet(s.id)}
                                                            style={{ padding: '6px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Formulari d'afegir/editar */}
                                    <div style={{
                                        padding: '20px', background: 'var(--settings-bg)',
                                        borderRadius: '16px', border: '1px solid var(--settings-border)',
                                        display: 'flex', flexDirection: 'column', gap: '14px'
                                    }}>
                                        <h4 style={{ margin: 0, fontSize: '0.82rem', fontWeight: '900', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                            {editingSnippetId ? 'Editar fragment' : 'Nou fragment'}
                                        </h4>
                                        <FormGroup label="Títol" description="Nom curt per identificar el fragment al menú.">
                                            <input
                                                type="text"
                                                className="gnosi-input"
                                                placeholder="Ex: Salutació formal"
                                                value={snippetDraft.title}
                                                onChange={e => setSnippetDraft(d => ({ ...d, title: e.target.value }))}
                                                onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                                            />
                                        </FormGroup>
                                        <FormGroup label="Contingut" description="Text que s'inserirà al correu.">
                                            <textarea
                                                className="gnosi-input"
                                                rows={4}
                                                placeholder="Escriu el text del fragment..."
                                                value={snippetDraft.content}
                                                onChange={e => setSnippetDraft(d => ({ ...d, content: e.target.value }))}
                                                style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5' }}
                                            />
                                        </FormGroup>
                                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                            {editingSnippetId && (
                                                <button
                                                    onClick={() => { setEditingSnippetId(null); setSnippetDraft({ title: '', content: '' }); }}
                                                    style={{ padding: '10px 20px', borderRadius: '12px', border: '1px solid var(--settings-border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
                                                >
                                                    Cancel·lar
                                                </button>
                                            )}
                                            <button
                                                onClick={handleAddSnippet}
                                                disabled={!snippetDraft.title.trim() || !snippetDraft.content.trim()}
                                                style={{ padding: '10px 24px', borderRadius: '12px', border: 'none', background: 'var(--gnosi-blue)', color: 'white', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', opacity: (!snippetDraft.title.trim() || !snippetDraft.content.trim()) ? 0.5 : 1 }}
                                            >
                                                <Plus size={16} />
                                                {editingSnippetId ? 'Actualitzar' : 'Afegir fragment'}
                                            </button>
                                        </div>
                                    </div>
                                </Section>
                            )}

                            {/* SOCIAL */}
                            {activeTab === 'social' && (
                                <>
                                    <Section title="Xarxes Socials" icon={Share2}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            {socialNetworks.map(net => (
                                                <div key={net.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'var(--settings-sidebar-bg)', borderRadius: '14px', border: '1px solid var(--settings-border)' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <span style={{ fontSize: '1.4rem' }}>{net.icon}</span>
                                                        <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{net.name}</span>
                                                    </div>
                                                    <div
                                                        className={`gnosi-toggle ${net.enabled ? 'active' : ''}`}
                                                        onClick={() => {
                                                            const updated = socialNetworks.map(n => n.id === net.id ? { ...n, enabled: !n.enabled } : n);
                                                            saveSocialNetworks(updated);
                                                        }}
                                                    >
                                                        <div className="gnosi-toggle-handle" />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </Section>

                                    <Section title="Streams del Dashboard" icon={Rss} extra={
                                        <button onClick={() => setShowAddStream(v => !v)} className="btn-gnosi-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', fontSize: '0.85rem', borderRadius: '10px' }}>
                                            {showAddStream ? <X size={15} /> : <Plus size={15} />}
                                            {showAddStream ? 'Cancel·lar' : 'Afegir stream'}
                                        </button>
                                    }>
                                        {showAddStream && (
                                            <div style={{ padding: '16px', background: 'var(--settings-sidebar-bg)', borderRadius: '14px', border: '1px solid var(--settings-border)', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                                    <div>
                                                        <label className="settings-label">ID intern</label>
                                                        <input className="gnosi-input" placeholder="ex: mastodon-hashtag" value={newStreamForm.id} onChange={e => setNewStreamForm(f => ({ ...f, id: e.target.value }))} />
                                                    </div>
                                                    <div>
                                                        <label className="settings-label">Títol</label>
                                                        <input className="gnosi-input" placeholder="ex: #tech" value={newStreamForm.title} onChange={e => setNewStreamForm(f => ({ ...f, title: e.target.value }))} />
                                                    </div>
                                                    <div>
                                                        <label className="settings-label">Icona (emoji)</label>
                                                        <input className="gnosi-input" placeholder="📡" value={newStreamForm.icon} onChange={e => setNewStreamForm(f => ({ ...f, icon: e.target.value }))} />
                                                    </div>
                                                    <div>
                                                        <label className="settings-label">Xarxa</label>
                                                        <select className="gnosi-input" value={newStreamForm.network} onChange={e => setNewStreamForm(f => ({ ...f, network: e.target.value }))}>
                                                            {socialNetworks.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                                                            <option value="scheduled">Programats</option>
                                                        </select>
                                                    </div>
                                                </div>
                                                <button onClick={handleAddSocialStream} className="btn-gnosi-primary" style={{ alignSelf: 'flex-end', padding: '8px 20px', borderRadius: '10px', fontSize: '0.85rem' }}>
                                                    Afegir
                                                </button>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {socialStreams.length === 0 && (
                                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', padding: '20px', textAlign: 'center' }}>
                                                    No hi ha streams configurats.
                                                </div>
                                            )}
                                            {socialStreams.map(stream => (
                                                <div key={stream.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--settings-sidebar-bg)', borderRadius: '12px', border: '1px solid var(--settings-border)' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <span style={{ fontSize: '1.2rem' }}>{stream.icon}</span>
                                                        <div>
                                                            <div style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '0.9rem' }}>{stream.title}</div>
                                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{stream.network} · {stream.id}</div>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => {
                                                            const updated = socialStreams.filter(s => s.id !== stream.id);
                                                            saveSocialStreams(updated);
                                                        }}
                                                        style={{ padding: '6px', borderRadius: '8px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                                                        className="hover-bg"
                                                        title="Eliminar"
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </Section>
                                </>
                            )}

                            {/* NEWSLETTERS — formulari dinàmic + llista */}
                            {activeTab === 'newsletters' && (
                                <Section title={t('subs_section_title')} icon={Rss} extra={
                                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                                        <button onClick={() => loadNewsletterSources()} disabled={newsletterSourcesLoading} className="btn-gnosi-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px', fontSize: '0.85rem', borderRadius: '12px', whiteSpace: 'nowrap', opacity: newsletterSourcesLoading ? 0.6 : 1, cursor: newsletterSourcesLoading ? 'wait' : 'pointer' }}>{newsletterSourcesLoading ? t('subs_btn_reload_loading') : t('subs_btn_reload')}</button>
                                        <button onClick={() => newsletterOpmlRef.current?.click()} disabled={newsletterOpmlLoading} className="btn-gnosi-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.85rem', borderRadius: '12px', whiteSpace: 'nowrap', opacity: newsletterOpmlLoading ? 0.6 : 1, cursor: newsletterOpmlLoading ? 'wait' : 'pointer' }}><FileUp size={16} /> {newsletterOpmlLoading ? t('subs_btn_import_opml_loading') : t('subs_btn_import_opml')}</button>
                                    </div>
                                }>
                                    <input ref={newsletterOpmlRef} type="file" accept=".opml,.xml" onChange={(e) => handleNewsletterOpmlUpload(e.target.files?.[0])} style={{ display: 'none' }} />
                                    {newsletterSourcesError && (
                                        <div style={{ marginBottom: '20px', padding: '14px 20px', borderRadius: '14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#dc2626', fontSize: '0.9rem' }}>{newsletterSourcesError}</div>
                                    )}

                                    {/* FORMULARI DINÀMIC ÚNIC */}
                                    <div className="animate-in" style={{ background: 'var(--settings-sidebar-bg)', padding: '32px', borderRadius: '28px', border: '1px solid var(--settings-border)', marginBottom: '40px', boxShadow: '0 12px 40px rgba(0,0,0,0.05)' }}>
                                        {/* Toggle 3-way */}
                                        <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
                                            {[
                                                { v: 'rss', icon: '📰' },
                                                { v: 'youtube', icon: '📺' },
                                                { v: 'newsletter', icon: '📧' }
                                            ].map(({ v, icon }) => (
                                                <button key={v} onClick={() => { setNewsletterType(v); setNewsletterStatus(''); setNewsletterAccountStatus(''); }} style={{
                                                    padding: '10px 20px', borderRadius: '12px', border: '1px solid var(--settings-border)',
                                                    background: newsletterType === v ? 'var(--gnosi-blue)' : 'transparent',
                                                    color: newsletterType === v ? 'white' : 'var(--text-secondary)',
                                                    fontSize: '0.85rem', fontWeight: '900', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em',
                                                    display: 'inline-flex', alignItems: 'center', gap: '8px'
                                                }}>
                                                    <span>{icon}</span>
                                                    <span>{v}</span>
                                                </button>
                                            ))}
                                        </div>

                                        {/* Subtítol del formulari (canvia segons el tipus) */}
                                        <h4 style={{ margin: '0 0 18px 0', fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 900 }}>
                                            {newsletterType === 'rss' && t('subs_form_title_rss')}
                                            {newsletterType === 'youtube' && t('subs_form_title_youtube')}
                                            {newsletterType === 'newsletter' && t('subs_form_title_newsletter')}
                                        </h4>

                                        {/* Camps RSS / YOUTUBE */}
                                        {(newsletterType === 'rss' || newsletterType === 'youtube') && (
                                            <>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                                    <FormGroup label={t('subs_form_field_name')}>
                                                        <input type="text" className="gnosi-input" value={newsletterName} onChange={e => setNewsletterName(e.target.value)} placeholder={t('subs_form_field_name_placeholder')} />
                                                    </FormGroup>
                                                    <FormGroup label={newsletterType === 'youtube' ? t('subs_form_youtube_url_label') : t('subs_form_rss_url_label')}>
                                                        <input type="text" className="gnosi-input" value={newsletterAddress} onChange={e => setNewsletterAddress(e.target.value)} placeholder={newsletterType === 'youtube' ? t('subs_form_youtube_url_placeholder') : t('subs_form_rss_url_placeholder')} />
                                                    </FormGroup>
                                                </div>
                                                {newsletterType === 'youtube' && (
                                                    <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '10px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.4 }}>
                                                        {t('subs_form_youtube_help')}
                                                    </div>
                                                )}
                                                {newsletterStatus && (
                                                    <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '10px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{newsletterStatus}</div>
                                                )}
                                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                    <button onClick={handleAddNewsletter} className="btn-gnosi-primary" style={{ padding: '12px 32px', borderRadius: '14px' }}>{t('subs_form_btn_add')}</button>
                                                </div>
                                            </>
                                        )}

                                        {/* Camps NEWSLETTER (config POP3) */}
                                        {newsletterType === 'newsletter' && (
                                            <>
                                                <div style={{ marginBottom: '18px', padding: '14px 18px', borderRadius: '12px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                                                    {t('subs_news_warning')}
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                                    <FormGroup label={t('subs_news_field_server')}>
                                                        <input type="text" className="gnosi-input" value={newsletterAccount.mail_server} onChange={e => setNewsletterAccount(a => ({ ...a, mail_server: e.target.value }))} placeholder={t('subs_news_field_server_placeholder')} />
                                                    </FormGroup>
                                                    <FormGroup label={t('subs_news_field_port')}>
                                                        <input type="number" className="gnosi-input" value={newsletterAccount.mail_port} onChange={e => setNewsletterAccount(a => ({ ...a, mail_port: e.target.value }))} placeholder="110" />
                                                    </FormGroup>
                                                    <FormGroup label={t('subs_news_field_ssl')}>
                                                        <select className="gnosi-input" value={newsletterAccount.mail_ssl} onChange={e => setNewsletterAccount(a => ({ ...a, mail_ssl: e.target.value }))}>
                                                            <option value="starttls">{t('subs_news_ssl_starttls')}</option>
                                                            <option value="ssl">{t('subs_news_ssl_ssl')}</option>
                                                            <option value="none">{t('subs_news_ssl_none')}</option>
                                                        </select>
                                                    </FormGroup>
                                                </div>
                                                {/* Form wrapper perquè el gestor de contrasenyes del navegador associï user+password */}
                                                <form onSubmit={e => e.preventDefault()} autoComplete="on" style={{ marginBottom: '20px' }}>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                                        <FormGroup label={t('subs_news_field_email')}>
                                                            <input
                                                                type="email"
                                                                className="gnosi-input"
                                                                value={newsletterAccount.email}
                                                                onChange={e => setNewsletterAccount(a => ({ ...a, email: e.target.value }))}
                                                                placeholder={t('subs_news_field_email_placeholder')}
                                                                name="newsletter-pop3-username"
                                                                autoComplete="username"
                                                            />
                                                        </FormGroup>
                                                        <FormGroup label={t('subs_news_field_password')}>
                                                            <PasswordInput
                                                                value={newsletterAccount.password}
                                                                onChange={e => { setNewsletterAccount(a => ({ ...a, password: e.target.value })); setNewsletterPasswordDirty(true); }}
                                                                name="newsletter-pop3-password"
                                                                autoComplete="current-password"
                                                            />
                                                        </FormGroup>
                                                    </div>
                                                </form>
                                                {newsletterAccountStatus && (
                                                    <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '10px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{newsletterAccountStatus}</div>
                                                )}
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                                                    <FormGroup label={t('subs_news_field_delete')} horizontal>
                                                        <div className={`gnosi-toggle ${newsletterAccount.delete_after_ingest ? 'active' : ''}`} onClick={() => setNewsletterAccount(a => ({ ...a, delete_after_ingest: !a.delete_after_ingest }))}>
                                                            <div className="gnosi-toggle-handle" />
                                                        </div>
                                                    </FormGroup>
                                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                                        <button onClick={testNewsletterAccount} disabled={newsletterAccountTesting} className="btn-gnosi-secondary" style={{ padding: '10px 18px', borderRadius: '12px', fontSize: '0.85rem', opacity: newsletterAccountTesting ? 0.6 : 1 }}>{newsletterAccountTesting ? t('subs_news_btn_test_loading') : t('subs_news_btn_test')}</button>
                                                        <button onClick={syncNewsletterAccount} disabled={newsletterAccountSyncing} className="btn-gnosi-secondary" style={{ padding: '10px 18px', borderRadius: '12px', fontSize: '0.85rem', opacity: newsletterAccountSyncing ? 0.6 : 1 }}>{newsletterAccountSyncing ? t('subs_news_btn_sync_loading') : t('subs_news_btn_sync')}</button>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* COMPTADOR + LLISTA DE FONTS */}
                                    <div style={{ marginBottom: '14px', color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>
                                        {newsletterSourcesLoading ? t('subs_count_loading', { count: newsletterSources.length }) : t('subs_count', { count: newsletterSources.length })}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                        {!newsletterSourcesLoading && newsletterSourcesLoaded && newsletterSources.length === 0 && (
                                            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem', background: 'var(--settings-sidebar-bg)', border: '1px dashed var(--settings-border)', borderRadius: '16px' }}>
                                                {t('subs_empty_state')}
                                            </div>
                                        )}
                                        {newsletterSources.map(s => (
                                            <div key={s.id} className="account-row hover-scale" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 30px', borderRadius: '24px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '22px', minWidth: 0, flex: 1 }}>
                                                    <div style={{ width: '56px', height: '56px', background: 'rgba(59,130,246,0.12)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', flexShrink: 0 }}>
                                                        {s.type === 'rss' ? '📰' : (s.type === 'youtube' ? '📺' : '📧')}
                                                    </div>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontWeight: '900', color: 'var(--text-primary)', fontSize: '1.05rem' }}>{s.name}</div>
                                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.url}</div>
                                                        {s.category && s.category !== 'Uncategorized' && (
                                                            <div style={{ display: 'inline-block', marginTop: '6px', padding: '3px 10px', borderRadius: '8px', background: 'rgba(59,130,246,0.1)', color: 'var(--gnosi-blue)', fontSize: '0.72rem', fontWeight: 700 }}>{s.category}</div>
                                                        )}
                                                    </div>
                                                </div>
                                                <button onClick={() => {
                                                    setConfirmConfig({
                                                        isOpen: true,
                                                        title: t('subs_delete_modal_title'),
                                                        message: t('subs_delete_modal_message', { name: s.name }),
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

                                                                    {dbTables.length > 0 && (
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
                            {activeTab === 'zotero' && (() => {
                                const runZoteroSync = async (direction) => {
                                    setZoteroSyncing(direction);
                                    setZoteroSyncMsg('');
                                    try {
                                        if (direction === 'z-to-g' || direction === 'both') {
                                            const r = await fetch('/api/zotero/sync', { method: 'POST' });
                                            if (!r.ok) {
                                                const err = await r.json().catch(() => ({}));
                                                setZoteroSyncMsg(err.detail || 'Error en Z→G');
                                                setZoteroSyncing(null); return;
                                            }
                                        }
                                        if (direction === 'g-to-z' || direction === 'both') {
                                            const r = await fetch('/api/zotero/sync-back', { method: 'POST' });
                                            const data = await r.json().catch(() => ({}));
                                            if (!r.ok) { setZoteroSyncMsg(data.detail || 'Error en G→Z'); setZoteroSyncing(null); return; }
                                            if (data.status === 'zotero_open') { setZoteroSyncMsg(data.message); setZoteroSyncing(null); return; }
                                        }
                                        setZoteroSyncMsg(direction === 'both' ? 'Sincronització bidireccional iniciada en segon pla.' : direction === 'z-to-g' ? 'Importació Z→G iniciada en segon pla.' : 'Exportació G→Z iniciada en segon pla.');
                                    } catch (e) {
                                        setZoteroSyncMsg(`Error: ${e.message}`);
                                    }
                                    setZoteroSyncing(null);
                                };
                                const btnStyle = { padding: '8px 14px', fontSize: '0.85rem', borderRadius: '12px', opacity: zoteroSyncing ? 0.6 : 1 };
                                return (
                                <Section title="Integració Zotero" icon={BookOpen} extra={draft.zotero.enabled && (
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        {zoteroSyncMsg && <span style={{ fontSize: '0.8rem', color: zoteroSyncMsg.startsWith('Error') || zoteroSyncMsg.includes('Tanca') ? 'var(--color-error, #ef4444)' : 'var(--text-secondary)', maxWidth: '200px' }}>{zoteroSyncMsg}</span>}
                                        <button title="Zotero → Gnosi" disabled={!!zoteroSyncing} onClick={() => runZoteroSync('z-to-g')} className="btn-gnosi-secondary" style={btnStyle}>
                                            {zoteroSyncing === 'z-to-g' ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null} Z → G
                                        </button>
                                        <button title="Gnosi → Zotero" disabled={!!zoteroSyncing} onClick={() => runZoteroSync('g-to-z')} className="btn-gnosi-secondary" style={btnStyle}>
                                            {zoteroSyncing === 'g-to-z' ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null} G → Z
                                        </button>
                                        <button title="Bidireccional G ↔ Z" disabled={!!zoteroSyncing} onClick={() => runZoteroSync('both')} className="btn-gnosi-secondary" style={btnStyle}>
                                            {zoteroSyncing === 'both' ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />} G ↔ Z
                                        </button>
                                    </div>
                                )}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>

                                        {/* Toggle activació */}
                                        <div style={{ background: 'var(--settings-sidebar-bg)', padding: '28px 36px', borderRadius: '32px', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '1rem' }}>Activar integració Zotero</div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Sincronitza la teva biblioteca local de Zotero amb el Vault de Gnosi.</div>
                                            </div>
                                            <div
                                                className={`gnosi-toggle ${draft.zotero.enabled ? 'active' : ''}`}
                                                style={{ transform: 'scale(1.2)', flexShrink: 0 }}
                                                onClick={async () => {
                                                    const newEnabled = !draft.zotero.enabled;
                                                    const newZotero = { ...draft.zotero, enabled: newEnabled };
                                                    setDraft(prev => ({ ...prev, zotero: newZotero }));
                                                    // Desar immediatament sense esperar el debounce
                                                    await fetch('/api/zotero/config', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify(newZotero),
                                                    }).catch(() => {});
                                                    if (newEnabled && !draft.zotero.target_table) {
                                                        try {
                                                            const res = await fetch('/api/zotero/setup', { method: 'POST' });
                                                            if (res.ok) {
                                                                const data = await res.json();
                                                                setDraft(prev => ({ ...prev, zotero: { ...prev.zotero, enabled: true, target_table: data.table_id } }));
                                                                fetch('/api/vault/tables').then(async r => { if (r.ok) setTables(await r.json()); });
                                                            }
                                                        } catch (e) { console.error('Zotero setup error:', e); }
                                                    }
                                                }}
                                            >
                                                <div className="gnosi-toggle-handle" />
                                            </div>
                                        </div>

                                        {/* Configuració (només si activat) */}
                                        {draft.zotero.enabled && (
                                            <div style={{ background: 'var(--settings-sidebar-bg)', padding: '36px', borderRadius: '32px', border: '1px solid var(--settings-border)', boxShadow: '0 10px 40px rgba(0,0,0,0.03)' }}>
                                                <FormGroup label="Ruta de la BD Zotero" description="Camí absolut a la base de dades local de Zotero (zotero.sqlite).">
                                                    <input type="text" className="gnosi-input" value={draft.zotero.zotero_db || ''} onChange={e => setDraft({...draft, zotero: {...draft.zotero, zotero_db: e.target.value}})} placeholder="~/Zotero/zotero.sqlite" />
                                                </FormGroup>
                                                <div style={{ marginTop: '28px' }}>
                                                    <FormGroup label="Taula de Destí del Vault" description="Taula on s'emmagatzemaran les referències. Es pot reanomenar lliurement.">
                                                        <select className="gnosi-select" value={draft.zotero.target_table} onChange={e => setDraft({...draft, zotero: {...draft.zotero, target_table: e.target.value}})}>
                                                            <option value="">Selecciona una taula del Vault...</option>
                                                            {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                                        </select>
                                                    </FormGroup>
                                                </div>
                                            </div>
                                        )}

                                        {draft.zotero.enabled && (
                                            <div style={{ padding: '20px', borderRadius: '20px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.1)', display: 'flex', alignItems: 'center', gap: '20px' }}>
                                                <div style={{ width: '40px', height: '40px', background: 'var(--gnosi-blue)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}><Info size={20} /></div>
                                                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>El sync és bidireccional: Zotero → Gnosi importa els ítems de Zotero, i Gnosi → Zotero exporta els canvis fets des de Gnosi. Zotero ha d'estar tancat per al sync de tornada.</div>
                                            </div>
                                        )}
                                    </div>
                                </Section>
                                );
                            })()}

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

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'Enter') {
                if (document.activeElement.tagName === 'TEXTAREA') return;
                onSave(selectedId, { api_key: apiKey, base_url: baseUrl });
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, onSave, selectedId, apiKey, baseUrl]);

    if (!isOpen) return null;

    return (
        <div className={`modal-overlay ${isOpen ? 'active' : ''}`} style={{ 
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
                                    <PasswordInput value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." name="ai-api-key" autoComplete="off" />
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

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'Enter') {
                if (document.activeElement.tagName === 'TEXTAREA') return;
                onSave({ ...agent, name, provider, model, icon });
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, onSave, agent, name, provider, model, icon]);

    if (!isOpen) return null;

    return (
        <div className={`modal-overlay ${isOpen ? 'active' : ''}`} style={{ 
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
