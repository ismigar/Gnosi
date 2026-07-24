import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    X, Globe, Palette, RefreshCw, Info, ExternalLink, Monitor, BookOpen,
    Check, FolderOpen, Database, Cpu, Zap, Settings as SettingsIcon,
    Sliders, Calendar, Mail, Trash2, Plus, Users, Rss, Share2, Inbox,
    ChevronRight, Search, FileUp, Shield, Activity, Bot, FileText,
    PenTool, Image, Paperclip, Eye, EyeOff, User, Languages, Loader2
} from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { useApi } from '../hooks/use-api';
import { FolderPickerModal } from './FolderPickerModal';
import { IconPicker, VAULT_COLORS } from './Vault/IconPicker';
import axios from 'axios';
import { toast } from '../lib/toast';
import { emitConfigChanged } from '../lib/configEvents';
import { setInterfaceLanguage } from '../lib/interfaceLanguage';
import { getEffectiveTableId, toValueStrings } from '../utils/graphFilters';
import { ConfirmModal } from './ConfirmModal';
import * as LucideIcons from 'lucide-react';
import MailBlockEditor from './Mail/MailBlockEditor';
import IdentityProfile from './Vault/IdentityProfile';
import AccountSettings from './Auth/AccountSettings';
import { WorkspaceMembersPanel } from './Workspace/WorkspaceMembersPanel';
import ApiTokensSettings from './ApiTokensSettings';
import { PluginsSettings } from './PluginsSettings';
import ModelRegistrySettings from './ModelRegistrySettings';
import NotionImportSettings from './NotionImportSettings';
import VaultSwitcher from './VaultSwitcher';
import AgentContextSources from './AgentContextSources';
import { useModelReliability, findModelFault, MODEL_FAULT_REASONS } from '../lib/modelReliability';
import './GlobalSettingsModal.css';

const LANGUAGES = [
    { code: 'en', label: 'English', icon: '🇬🇧' },
    { code: 'fr', label: 'Français', icon: '🇫🇷' },
    { code: 'ca', label: 'Català', icon: '🏴󠁥󠁳󠁣󠁡󠁿' },
    { code: 'es', label: 'Español', icon: '🇪🇸' },
];

const CURRENCIES = ['EUR (€)', 'USD ($)', 'GBP (£)', 'JPY (¥)', 'CHF (₣)'];
const DECIMAL_SYMBOLS = [',', '.'];
const DATE_FORMATS = [
    { value: 'locale', labelKey: 'settings.language.date_format_locale' },
    { value: 'DD/MM/YYYY', labelKey: 'settings.language.date_format_dmy' },
    { value: 'MM/DD/YYYY', labelKey: 'settings.language.date_format_mdy' },
    { value: 'YYYY-MM-DD', labelKey: 'settings.language.date_format_iso' },
];

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

/**
 * Accessible switch (role="switch") with keyboard support.
 * Replaces the non-focusable `<div className="gnosi-toggle">`: it is now
 * focusable with Tab and activatable with Enter/Space. The `onChange` handler receives
 * the event (click or keyboard) so the caller can do stopPropagation.
 * `display` leaves it visual-only (no role or keyboard) when the actual
 * interactive control is a parent container.
 */
export const GnosiToggle = ({ active, onChange, label, style, scale, display = false }) => {
    const mergedStyle = scale != null ? { ...style, transform: `scale(${scale})` } : style;
    if (display) {
        return (
            <div className={`gnosi-toggle ${active ? 'active' : ''}`} aria-hidden="true" style={{ pointerEvents: 'none', ...mergedStyle }}>
                <div className="gnosi-toggle-handle" />
            </div>
        );
    }
    const handleKeyDown = (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onChange && onChange(e);
        }
    };
    return (
        <div
            role="switch"
            tabIndex={0}
            aria-checked={!!active}
            aria-label={label}
            className={`gnosi-toggle ${active ? 'active' : ''}`}
            onClick={(e) => onChange && onChange(e)}
            onKeyDown={handleKeyDown}
            style={mergedStyle}
        >
            <div className="gnosi-toggle-handle" />
        </div>
    );
};

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

// Inline autosave status for the Translate tab inputs: a spinner while a
// debounced save is in flight, a transient check once it lands, nothing idle.
// Fixed width so the input doesn't shift as the indicator appears.
const TranslateSaveIndicator = ({ saving, saved, t }) => (
    <div
        aria-live="polite"
        style={{
            width: '86px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px',
            fontSize: '0.78rem', fontWeight: 600,
            color: saved ? 'var(--status-success)' : 'var(--text-secondary)',
        }}
    >
        {saving && <Loader2 size={14} className="animate-spin" />}
        {!saving && saved && <Check size={14} />}
        {saving
            ? (t('translate_settings.autosaving') || 'Desant…')
            : (saved ? (t('translate_settings.autosaved') || 'Desat') : null)}
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
    const { t } = useTranslation();
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
                            placeholder={t('settings.accounts.alias_email_placeholder')}
                            onChange={e => update(i, { email: e.target.value })}
                        />
                        <input
                            type="text"
                            className="gnosi-input"
                            style={{ flex: 2 }}
                            value={alias.display_name || ''}
                            placeholder={t('settings.accounts.alias_name_placeholder')}
                            onChange={e => update(i, { display_name: e.target.value })}
                        />
                        <button
                            type="button"
                            title={t('settings.accounts.signature')}
                            onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                            style={{ padding: '6px 8px', border: '1px solid var(--settings-border)', borderRadius: '6px', background: expandedIdx === i ? 'var(--gnosi-blue)' : 'transparent', color: expandedIdx === i ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700' }}
                        >
                            {t('settings.accounts.sig_abbr')}
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
                                {t('settings.accounts.alias_signature')}
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
                {t('settings.accounts.add_alias')}
            </button>
        </div>
    );
};

const AccountRow = ({ name, description, status, type, provider, onSync, onEdit, onDelete, onToggleEnabled, enabled = true, color = '#3b82f6', isSyncing = false }) => {
    const { t } = useTranslation();
    const ta = (k, opts) => t('settings.accounts.' + k, opts);
    return (
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
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', opacity: 0.8 }}>{(name && name !== description) ? description : (provider === 'manual' ? ta('manual_config') : ta('connected_account'))}</div>
            </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '10px' }}>
                {enabled && (
                    <span style={{
                        fontSize: '0.68rem', padding: '5px 14px', borderRadius: '20px',
                        background: status === 'connected' ? 'rgba(16, 185, 129, 0.12)' : status === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                        color: status === 'connected' ? 'var(--status-success)' : status === 'error' ? 'var(--status-error)' : 'var(--status-warning)', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '0.04em'
                    }}>
                        {status === 'connected' ? ta('status_connected') : status === 'error' ? ta('status_error') : ta('status_pending')}
                    </span>
                )}
                {enabled && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onSync && onSync(); }}
                        disabled={isSyncing}
                        className="icon-btn hover-bg"
                        title={ta('sync_tip')}
                        style={{ padding: '8px', borderRadius: '10px', color: 'var(--gnosi-blue)' }}
                    >
                        <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                    </button>
                )}
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onToggleEnabled && onToggleEnabled(!enabled); }}
                className="icon-btn hover-bg"
                title={enabled ? ta('disable_account') : ta('enable_account')}
                style={{ padding: '8px', borderRadius: '10px', color: enabled ? 'var(--text-secondary)' : 'var(--gnosi-blue)' }}
            >
                {enabled ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button onClick={onEdit} aria-label={ta('edit_account')} title={ta('edit_account')} className="icon-btn hover-bg" style={{ padding: '8px', borderRadius: '10px' }}><SettingsIcon size={18} /></button>
            <button onClick={onDelete} aria-label={ta('delete_account')} title={ta('delete_account')} className="icon-btn hover-bg-danger" style={{ color: 'var(--status-error)', padding: '8px', borderRadius: '10px' }}><Trash2 size={18} /></button>
        </div>
    </div>
    );
};

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
    const { role } = useApi();
    const tn = useCallback((k, opts) => t('settings.' + k, opts), [t]);
    
    // -- UNIFIED DRAFT STATE --
    const [draft, setDraft] = useState({
        settings: {
            user_name: '', workspace_name: '', gnosi_mode: 'personal',
            org_user: '', org_password: '', org_workspace: '',
            language: 'en', week_start: 1, currency: 'EUR (€)', decimal_symbol: ',', date_format: 'locale',
            theme: 'system', reduce_animations: false
        },
        paths: { vault: '', databases: '', newsletters: '' },
        graph: {
            visible_databases: [], visible_tables: [], visible_fields: [],
            show_arrows: true, label_threshold: 10, node_size: 1.0, edge_thickness: 1.0,
            physics: { gravity: 0.1, repulsion: 1000, friction: 10 }
        },
        ai: { agents: [], providers: {}, active_agent_id: '' },
        identity: {
            full_name: '', first_name: '', last_name: '', email: '',
            phone: '', address: '', city: '', zip_code: '', dni_nie: '', notes: ''
        }
    });

    const [activeTab, setActiveTab] = useState(initialTab);
    const [integrations, setIntegrations] = useState({ calendars: [], contacts: [], mail_accounts: [] });
    const integrationsLoadedRef = useRef(false); // Prevents auto-save from firing with empty data
    const [googleSubCalendars, setGoogleSubCalendars] = useState([]);
    const [databases, setDatabases] = useState([]);
    const [tables, setTables] = useState([]);
    // Graph nodes (lazy-loaded) to derive the actual options for the fields
    // of list type in the "Fixed value / default" control on the graph tab.
    const [graphNodes, setGraphNodes] = useState(null);
    const [graphNodesLoading, setGraphNodesLoading] = useState(false);
    const graphNodesFetchedRef = useRef(false);
    // Designated reference table (Settings → backend get_reference_table_id).
    const [referenceTable, setReferenceTable] = useState({ table_id: null, configured: false, name: null });
    const [refBusy, setRefBusy] = useState(false);
    const [aiCatalog, setAiCatalog] = useState({});
    // Configured model registry (GET /api/ai/models) — the enabled models the
    // user picked in ModelRegistrySettings. Agent creation chooses from this,
    // NOT the full catalog: an agent runs on a model that is actually set up.
    const [aiRegistry, setAiRegistry] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState('');

    // Translate-row skill: DeepL key lives in the Keychain (`/api/credentials/`),
    // the Softcatalà URL in `.env_shared` (it's not secret). The bind is
    // separate because they use different endpoints with different semantics.
    const [translateState, setTranslateState] = useState({
        deepl_has_value: false,    // GET /api/credentials/deepl_api_key.has_value
        deepl_input: '',           // new value pending save (never pre-populated)
        softcatala_url: '',        // current value of SOFTCATALA_API_URL in .env_shared
        loading: false,
        saving_deepl: false,
        saving_softcatala: false,
        saved_deepl: false,        // transient "saved" indicator after a successful autosave
        saved_softcatala: false,
    });
    // Autosave plumbing for the Translate tab: debounce timers + the last
    // persisted Softcatalà URL (so loading the tab never triggers a save).
    const deeplAutoSaveRef = useRef(null);
    const softcatalaAutoSaveRef = useRef(null);
    const softcatalaBaselineRef = useRef(null); // null = not loaded yet

    const systemEntities = useMemo(() => [
        { 
            id: 'attachments', 
            name: tn('graph.entity_attachments'), 
            icon: Paperclip, 
            color: '#6366f1', 
            fields: [
                { name: 'mimetype', type: 'select' }, 
                { name: 'extension', type: 'text' }
            ] 
        },
        { 
            id: 'calendars', 
            name: tn('graph.entity_calendars'), 
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
            name: tn('graph.entity_contacts'), 
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
            name: tn('graph.entity_drawings'), 
            icon: PenTool, 
            color: '#f59e0b', 
            fields: [{ name: 'tool', type: 'select' }] 
        },
        { 
            id: 'images', 
            name: tn('graph.entity_images'), 
            icon: Image, 
            color: '#ec4899', 
            fields: [{ name: 'dimensions', type: 'text' }] 
        },
        { 
            id: 'mails', 
            name: tn('graph.entity_mails'), 
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
            name: tn('graph.entity_wiki'), 
            icon: FileText, 
            color: '#8b5cf6', 
            fields: [
                { name: 'category', type: 'text' }, 
                { name: 'priority', type: 'number' }
            ] 
        }
    ], [integrations, tn]);

    // Loads the graph nodes once when entering the graph tab, to
    // populate the "Fixed value / default" dropdowns for list-type fields.
    // Reuses the graph endpoint: this way the chosen value matches the
    // actual values shown by the graph filter.
    useEffect(() => {
        if (!isOpen || activeTab !== 'graph' || graphNodesFetchedRef.current) return;
        graphNodesFetchedRef.current = true;
        setGraphNodesLoading(true);
        fetch('/api/graph')
            .then(r => (r.ok ? r.json() : { nodes: [] }))
            .then(g => setGraphNodes(Array.isArray(g?.nodes) ? g.nodes : []))
            .catch(() => setGraphNodes([]))
            .finally(() => setGraphNodesLoading(false));
    }, [isOpen, activeTab]);

    // Index tableId → field (lowercase) → set of values, derived from the nodes.
    // getEffectiveTableId unifies DB tables and system entities the same way the
    // graph filter does, so the fieldKey's id matches.
    const graphFieldValues = useMemo(() => {
        const idx = new Map();
        for (const node of (graphNodes || [])) {
            const tid = getEffectiveTableId(node);
            if (!tid) continue;
            const meta = node.metadata || {};
            let fm = idx.get(tid);
            if (!fm) { fm = new Map(); idx.set(tid, fm); }
            for (const k of Object.keys(meta)) {
                const vals = toValueStrings(meta[k]);
                if (vals.length === 0) continue;
                const kl = k.toLowerCase();
                let set = fm.get(kl);
                if (!set) { set = new Set(); fm.set(kl, set); }
                for (const v of vals) set.add(v);
            }
        }
        return idx;
    }, [graphNodes]);

    const getFieldOptions = (tableId, fieldName) => {
        const fm = graphFieldValues.get(tableId);
        if (!fm) return [];
        const set = fm.get(String(fieldName).toLowerCase());
        return set ? Array.from(set).sort((a, b) => a.localeCompare(b)) : [];
    };

    // Renders the "Fixed value / default" control based on the field type: list →
    // dropdown with the actual options; checkbox → checkbox; date/date-time/number →
    // native input; everything else → text. It's a function (not a component) so as not to lose
    // input focus on every re-render of the draft.
    const renderFieldDefaultInput = (field, fieldKey, placeholder) => {
        const ftype = (field?.type || 'text').toLowerCase();
        const defaultVal = draft.graph.field_defaults?.[fieldKey] || '';
        const setVal = (v) => setDraft(p => ({
            ...p,
            graph: { ...p.graph, field_defaults: { ...(p.graph.field_defaults || {}), [fieldKey]: v } }
        }));
        const baseStyle = { fontSize: '0.75rem', padding: '6px 10px', height: 'auto', width: '130px' };

        // List (select / multi_select / status) → dropdown with real options.
        if (ftype === 'select' || ftype === 'multi_select' || ftype === 'status') {
            const [tableId, fieldName] = fieldKey.split(':');
            const opts = getFieldOptions(tableId, fieldName);
            if (opts.length === 0) {
                if (graphNodesLoading) {
                    return <span style={{ ...baseStyle, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center' }}>{t('common.loading', "Loading...")}</span>;
                }
                // Without known values: free text so the user can set one.
                return <input type="text" className="gnosi-input" style={baseStyle} placeholder={placeholder} value={defaultVal} onChange={e => setVal(e.target.value)} />;
            }
            const withCurrent = (defaultVal && !opts.includes(defaultVal)) ? [defaultVal, ...opts] : opts;
            return (
                <select className="gnosi-input" style={baseStyle} value={defaultVal} onChange={e => setVal(e.target.value)}>
                    <option value="">—</option>
                    {withCurrent.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
            );
        }

        // Checkbox (checkbox) → real checkbox. Checked = 'true'; unchecked = no value.
        if (ftype === 'checkbox') {
            const checked = defaultVal === 'true';
            return (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', width: '130px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={e => setVal(e.target.checked ? 'true' : '')} style={{ accentColor: 'var(--gnosi-blue)', width: '16px', height: '16px' }} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{checked ? t('common.yes', "Yes") : '—'}</span>
                </label>
            );
        }

        // Date / Date and time / Number → native inputs of the corresponding type.
        if (ftype === 'date') return <input type="date" className="gnosi-input" style={baseStyle} value={defaultVal} onChange={e => setVal(e.target.value)} />;
        if (ftype === 'datetime') return <input type="datetime-local" className="gnosi-input" style={baseStyle} value={defaultVal} onChange={e => setVal(e.target.value)} />;
        if (ftype === 'number') return <input type="number" className="gnosi-input" style={baseStyle} placeholder={placeholder} value={defaultVal} onChange={e => setVal(e.target.value)} />;

        // By default → text.
        return <input type="text" className="gnosi-input" style={baseStyle} placeholder={placeholder} value={defaultVal} onChange={e => setVal(e.target.value)} />;
    };

    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerField, setPickerField] = useState(null);
    const [aiValidationStatus, setAiValidationStatus] = useState({});
    const [googleAuthConfigured, setGoogleAuthConfigured] = useState(false);
    // True if /api/calendar/calendars returns the X-Calendar-Auth-Error header
    // (Google token expired/revoked) → we show a reconnection warning.
    const [googleCalAuthError, setGoogleCalAuthError] = useState(false);

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
    const [editingAccountId, setEditingAccountId] = useState(null); // ID of the account being edited
    const [syncingAccounts, setSyncingAccounts] = useState({}); // Tracking individual syncs
    const [syncErrorAccounts, setSyncErrorAccounts] = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem('gnosi_mail_sync_errors') || '[]')); } catch { return new Set(); }
    }); // Emails with MAIL sync error (persisted in localStorage). Must NOT be
        // used to render Calendar/Contacts: each service has its own signal.
    // Calendar authentication errors: derived from the
    // X-Calendar-Auth-Error header on every tab open (live signal, not persisted).
    const [calendarAuthErrors, setCalendarAuthErrors] = useState(() => new Set());
    // Contacts sync errors: result of the manual sync (not persisted).
    const [contactsSyncErrors, setContactsSyncErrors] = useState(() => new Set());
    const [mailDarkBody, setMailDarkBody] = useState(() => {
        try { return localStorage.getItem('gnosi_mail_dark_body') === '1'; } catch { return false; }
    });
    
    // Mail Snippets State
    const SNIPPETS_KEY = 'gnosi_mail_snippets';
    const DEFAULT_SNIPPETS = [
        { id: 'snip_default_1', title: 'Formal greeting', content: 'Dear Sir or Madam,\n\nI hope you are well.' },
        { id: 'snip_default_2', title: 'Thank you for your reply', content: 'Thank you very much for your reply.' },
        { id: 'snip_default_3', title: 'Formal sign-off', content: 'Kind regards,\n\n' },
        { id: 'snip_default_4', title: 'Meeting proposal', content: 'I would like to propose a meeting to discuss this matter.' },
        { id: 'snip_default_5', title: 'Follow-up', content: 'I am writing to follow up on the previous matter.' },
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
        } catch (err) {
            // Without this restoration, the UI showed the changes as if
            // would have been saved even though the backend had the old state.
            setSocialNetworks(previous);
            toast.error(tn('social.save_networks_error'));
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
        } catch (err) {
            setSocialStreams(previous);
            toast.error(tn('social.save_streams_error'));
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

    // Fresh references to avoid stale closures in the setTimeout/cleanup callbacks
    const integrationsRef = useRef(integrations);
    useEffect(() => {
        integrationsRef.current = integrations;
    }, [integrations]);

    const mailFieldsRef = useRef({
        display_name: mailDisplayName,
        subject_prefix: mailSubjectPrefix,
        signature: mailSignature,
        certificate: mailCertificate,
        aliases: mailAliases,
        editingAccountId: editingAccountId,
    });
    useEffect(() => {
        mailFieldsRef.current = {
            display_name: mailDisplayName,
            subject_prefix: mailSubjectPrefix,
            signature: mailSignature,
            certificate: mailCertificate,
            aliases: mailAliases,
            editingAccountId: editingAccountId,
        };
    }, [mailDisplayName, mailSubjectPrefix, mailSignature, mailCertificate, mailAliases, editingAccountId]);

    // Auto-save identity fields (signature, name, aliases, subject_prefix) when editing an account
    useEffect(() => {
        if (!editingAccountId) return;
        // Skip the first run right after handleEditAccount populates the fields
        if (identityLoadedForRef.current !== editingAccountId) {
            identityLoadedForRef.current = editingAccountId;
            return;
        }

        const saveChanges = async () => {
            const fields = mailFieldsRef.current;
            if (!fields.editingAccountId) return;
            const currentList = integrationsRef.current.mail_accounts || [];
            const newList = currentList.map(a => a.id !== fields.editingAccountId ? a : {
                ...a,
                display_name: fields.display_name,
                subject_prefix: fields.subject_prefix,
                signature: fields.signature,
                certificate: fields.certificate,
                aliases: fields.aliases,
            });
            try {
                await axios.post('/api/integrations/bulk', { ...integrationsRef.current, mail_accounts: newList });
                setIntegrations(prev => ({ ...prev, mail_accounts: newList }));
            } catch (err) {
                console.error("Error saving pending mail identity:", err);
            }
        };

        clearTimeout(identityAutoSaveRef.current);
        identityAutoSaveRef.current = setTimeout(saveChanges, 800); // 800ms debounce is more interactive

        return () => {
            clearTimeout(identityAutoSaveRef.current);
            // If the component unmounts or the account changes while there are pending changes, we save them immediately
            saveChanges();
        };
    }, [mailSignature, mailDisplayName, mailSubjectPrefix, mailAliases, mailCertificate, editingAccountId]);

    // -- AUTO-SAVE CONTROLS --
    const autoSaveTimeoutRef = useRef(null);
    const lastSavedData = useRef(null);
    // Ref to the modal panel (.settings-modal): delimits the keyboard focus-trap.
    const panelRef = useRef(null);
    const [savingStatus, setSavingStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
    const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });
    const [isAddingTable, setIsAddingTable] = useState(false);
    const [editingTableColor, setEditingTableColor] = useState(null); // { id, name, color }
    const [isDatabasesExpanded, setIsDatabasesExpanded] = useState(true);
    const [isSystemEntitiesExpanded, setIsSystemEntitiesExpanded] = useState(true);

    useEffect(() => {
        if (isOpen) {
            integrationsLoadedRef.current = false; // Reset when opening the modal
            lastSavedData.current = null; // Reset baseline to avoid spurious saves
            loadConfig();
            loadAiCatalog();
            loadAiRegistry();
            loadTablesAndDatabases();
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
                .then(r => {
                    const authErr = r.headers.get('X-Calendar-Auth-Error') || '';
                    setGoogleCalAuthError(Boolean(authErr));
                    // Specific emails with an expired token → paint the ERROR badge
                    // ONLY for this tab (not inherited from the Mail state).
                    setCalendarAuthErrors(new Set(authErr.split(',').map(e => e.trim()).filter(Boolean)));
                    return r.ok ? r.json() : [];
                })
                .then(setGoogleSubCalendars)
                .catch(() => {});
        }
    }, [activeTab, isOpen]);

    // Translate tab: loads the state of the DeepL key (Keychain) and the URL of
    // Softcatalà (env). It's called on every tab open to
    // reflect changes made through /api/credentials/migrate or external edits
    // to .env_shared.
    useEffect(() => {
        if (activeTab !== 'translate' || !isOpen) return;
        let cancelled = false;
        setTranslateState(s => ({ ...s, loading: true }));
        Promise.all([
            axios.get('/api/credentials/deepl_api_key').then(r => r.data).catch(() => ({ has_value: false })),
            axios.get('/api/env').then(r => r.data || {}).catch(() => ({})),
        ]).then(([cred, env]) => {
            if (cancelled) return;
            // Baseline BEFORE state so the autosave effect triggered by this
            // setState sees the loaded value as already persisted.
            softcatalaBaselineRef.current = env?.SOFTCATALA_API_URL || '';
            setTranslateState(s => ({
                ...s,
                deepl_has_value: !!cred?.has_value,
                softcatala_url: env?.SOFTCATALA_API_URL || '',
                deepl_input: '',
                loading: false,
            }));
        });
        return () => { cancelled = true; };
    }, [activeTab, isOpen]);

    // Autosave the DeepL key: debounced after the user types/pastes it. On
    // success the input is cleared (the key is never echoed back) — but only
    // if the user hasn't typed more in the meantime.
    const saveDeeplKey = useCallback(async (value) => {
        setTranslateState(s => ({ ...s, saving_deepl: true, saved_deepl: false }));
        try {
            await axios.post('/api/credentials/', { key: 'deepl_api_key', value });
            setTranslateState(s => (
                s.deepl_input.trim() === value
                    ? { ...s, deepl_has_value: true, deepl_input: '', saving_deepl: false, saved_deepl: true }
                    : { ...s, deepl_has_value: true, saving_deepl: false } // user kept typing: the next debounce will re-save
            ));
        } catch (err) {
            console.error('Error saving DeepL API key:', err);
            toast.error(t('translate_settings.deepl_save_error', "Couldn't save the DeepL key."));
            setTranslateState(s => ({ ...s, saving_deepl: false }));
        }
    }, [t]);

    useEffect(() => {
        if (activeTab !== 'translate' || !isOpen) return;
        const value = translateState.deepl_input.trim();
        if (!value) return; // empty input never saves (deletion has its own button)
        clearTimeout(deeplAutoSaveRef.current);
        deeplAutoSaveRef.current = setTimeout(() => saveDeeplKey(value), 1200);
        return () => clearTimeout(deeplAutoSaveRef.current);
    }, [translateState.deepl_input, activeTab, isOpen, saveDeeplKey]);

    const handleDeleteDeeplKey = async () => {
        setTranslateState(s => ({ ...s, saving_deepl: true }));
        try {
            await axios.delete('/api/credentials/deepl_api_key');
            setTranslateState(s => ({ ...s, deepl_has_value: false, deepl_input: '', saving_deepl: false }));
        } catch (err) {
            console.error('Error deleting DeepL API key:', err);
            toast.error(t('translate_settings.deepl_delete_error', "Couldn't remove the DeepL key."));
            setTranslateState(s => ({ ...s, saving_deepl: false }));
        }
    };

    // Autosave the Softcatalà URL: debounced, skipped until the initial load
    // sets the baseline and whenever the value matches what's persisted.
    const saveSoftcatalaUrl = useCallback(async (value) => {
        setTranslateState(s => ({ ...s, saving_softcatala: true, saved_softcatala: false }));
        try {
            // Empty string → reset to default. We send an empty string to
            // overwrite, and if the user wanted to remove it, the backend
            // persists as `SOFTCATALA_API_URL=` (the skill falls back to the default).
            await axios.post('/api/env', { SOFTCATALA_API_URL: value });
            softcatalaBaselineRef.current = value;
            setTranslateState(s => ({ ...s, saving_softcatala: false, saved_softcatala: true }));
        } catch (err) {
            console.error('Error saving Softcatalà URL:', err);
            toast.error(t('translate_settings.softcatala_save_error', "Couldn't save the Softcatalà URL."));
            setTranslateState(s => ({ ...s, saving_softcatala: false }));
        }
    }, [t]);

    useEffect(() => {
        if (activeTab !== 'translate' || !isOpen) return;
        if (softcatalaBaselineRef.current === null) return; // initial load not done yet
        const value = translateState.softcatala_url.trim();
        if (value === softcatalaBaselineRef.current) return; // nothing new to persist
        clearTimeout(softcatalaAutoSaveRef.current);
        softcatalaAutoSaveRef.current = setTimeout(() => saveSoftcatalaUrl(value), 800);
        return () => clearTimeout(softcatalaAutoSaveRef.current);
    }, [translateState.softcatala_url, activeTab, isOpen, saveSoftcatalaUrl]);

    useEffect(() => {
        try { localStorage.setItem('gnosi_mail_sync_errors', JSON.stringify([...syncErrorAccounts])); } catch { /* quota */ }
    }, [syncErrorAccounts]);

    // When the Mail tab opens, perform a passive health check calling
    // /api/mail/counts for each account. If it returns {} (authentication or
    // IMAP connection failed), marks the account as error; if it returns
    // data, removes it from the Set. This corrects the persisted ERROR state
    // to localStorage for accounts that are already working correctly.
    useEffect(() => {
        if (activeTab !== 'mail' || !isOpen) return;
        const accs = [
            ...(integrations.mail_accounts || []),
            ...(integrations.emails || []),
        ];
        const seen = new Set();
        const emails = accs
            .map(a => a.email || a.username)
            .filter(e => {
                if (!e) return false;
                const k = e.toLowerCase();
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
            });
        if (emails.length === 0) return;
        let cancelled = false;
        Promise.all(emails.map(async email => {
            try {
                const r = await fetch(`/api/mail/counts?email=${encodeURIComponent(email)}`);
                if (!r.ok) return { email, ok: false };
                const data = await r.json();
                return { email, ok: data && Object.keys(data).length > 0 };
            } catch {
                return { email, ok: false };
            }
        })).then(results => {
            if (cancelled) return;
            setSyncErrorAccounts(prev => {
                const next = new Set(prev);
                results.forEach(({ email, ok }) => {
                    if (ok) next.delete(email);
                    else next.add(email);
                });
                return next;
            });
        });
        return () => { cancelled = true; };
    }, [activeTab, isOpen, integrations.mail_accounts, integrations.emails]);

    // Canonical keyboard: Esc closes and Tab does a focus-trap inside the panel (with
    // focus restoration). WITHOUT onConfirm: it's a settings panel
    // with tabs and autosave, with no single primary action; previously Enter
    // also closed the modal, but that was odd behavior (pressing
    // Enter in an input closed Settings), so now Enter is left free.
    //
    // The sub-modals (AI provider, agent, folder picker, confirmation)
    // render as siblings OUTSIDE `.settings-modal` and have their own
    // have their own focus-trap. While one is open, we disable this trap
    // so it doesn't steal their focus (Tab would get trapped in the background panel).
    const childModalOpen = isConnectModalOpen || !!editingAgent || pickerOpen || confirmConfig.isOpen;

    const handleClose = async () => {
        try {
            // 1. We cancel the auto-save timeouts to prevent them from firing again in duplicate
            clearTimeout(autoSaveTimeoutRef.current);
            clearTimeout(identityAutoSaveRef.current);
            if (newsletterAccountSaveTimerRef.current) clearTimeout(newsletterAccountSaveTimerRef.current);

            // 2. We determine whether there are pending changes in the mail identity
            let updatedIntegrations = { ...integrations };
            let hasIdentityChanges = false;
            if (editingAccountId) {
                const fields = mailFieldsRef.current;
                const currentList = integrations.mail_accounts || [];
                const accountIndex = currentList.findIndex(a => a.id === fields.editingAccountId);
                if (accountIndex !== -1) {
                    const a = currentList[accountIndex];
                    if (
                        a.display_name !== fields.display_name ||
                        a.subject_prefix !== fields.subject_prefix ||
                        a.signature !== fields.signature ||
                        a.certificate !== fields.certificate ||
                        JSON.stringify(a.aliases) !== JSON.stringify(fields.aliases)
                    ) {
                        const newList = currentList.map(acc => acc.id !== fields.editingAccountId ? acc : {
                            ...acc,
                            display_name: fields.display_name,
                            subject_prefix: fields.subject_prefix,
                            signature: fields.signature,
                            certificate: fields.certificate,
                            aliases: fields.aliases,
                        });
                        updatedIntegrations = { ...integrations, mail_accounts: newList };
                        hasIdentityChanges = true;
                    }
                }
            }

            // 3. We determine whether there are pending changes in the general settings or integrations
            const currentData = JSON.stringify({
                settings: draft.settings,
                paths: draft.paths,
                graph: draft.graph,
                ai: { 
                    agents: draft.ai.agents, 
                    active_agent_id: draft.ai.active_agent_id,
                    providers: draft.ai.providers
                },
                integrations: updatedIntegrations,
                identity: draft.identity
            });

            const hasConfigChanges = lastSavedData.current !== null && lastSavedData.current !== currentData;

            // POP3 newsletter changes.
            let hasNewsletterChanges = false;
            if (newsletterAccountLoaded) {
                const currentNewsletter = JSON.stringify({ ...newsletterAccount, _passwordDirty: newsletterPasswordDirty });
                hasNewsletterChanges = lastSavedNewsletterAccountRef.current !== currentNewsletter;
            }

            // 4. If there is any pending change, we save them sequentially/synchronously (awaiting Promise.all)
            if (hasIdentityChanges || hasConfigChanges || hasNewsletterChanges) {
                setSavingStatus('saving');
                setIsSaving(true);
                try {
                    const promises = [];
                    
                    // Save general config, integrations, and identity
                    if (hasConfigChanges || hasIdentityChanges) {
                        promises.push(
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
                            axios.post('/api/integrations/bulk', updatedIntegrations),
                            axios.post('/api/identity', draft.identity)
                        );
                    }

                    // Save newsletter
                    if (hasNewsletterChanges) {
                        const next = { ...newsletterAccount };
                        if (!newsletterPasswordDirty) delete next.password;
                        promises.push(
                            axios.post('/api/newsletter/account', next)
                        );
                    }

                    await Promise.all(promises);
                    setSavingStatus('saved');
                } catch (err) {
                    console.error("Error saving while closing settings:", err);
                    setSavingStatus('error');
                } finally {
                    setIsSaving(false);
                }
            }
        } catch (globalErr) {
            console.error("Critical global error in handleClose:", globalErr);
        } finally {
            // 5. We call the original onClose to close the modal ALWAYS, even if there are errors
            onClose();
        }
    };

    useModalKeyboard({
        isOpen,
        onClose: handleClose,
        containerRef: panelRef,
        trapFocus: !childModalOpen,
    });

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
                // Sync the backend-persisted theme into the localStorage channel the
                // theme engine reads, so the saved preference survives a reload.
                if (cfg.settings?.theme && cfg.settings.theme !== localStorage.getItem('db-theme')) {
                    localStorage.setItem('db-theme', cfg.settings.theme);
                    window.dispatchEvent(new Event('db-theme-changed'));
                }
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
                });
                // Mark as loaded only AFTER setIntegrations
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

    const loadAiRegistry = async () => {
        // Feeds the agent-creation model dropdown. Only enabled rows: a disabled
        // model in the registry is not a valid target for a new agent.
        try {
            const res = await fetch('/api/ai/models');
            if (res.ok) {
                const payload = await res.json();
                setAiRegistry((payload?.models || []).filter(m => m.enabled !== false));
            }
        } catch (err) { console.error("Error loading AI model registry:", err); }
    };

    const loadTablesAndDatabases = async () => {
        // Vault Tables and Databases — used by the Calendar
        // (table selection) and Databases tabs. They used to be loaded inside
        // loadZoteroData, removed when the Zotero integration was taken out of Settings.
        try {
            const res = await fetch('/api/vault/tables');
            if (res.ok) setTables(await res.json());
        } catch (e) { console.error("Tables fetch error:", e); }
        try {
            const res = await fetch('/api/vault/databases');
            if (res.ok) setDatabases(await res.json());
        } catch (e) { console.error("Databases fetch error:", e); }
    };

    // --- Reference table (Zotero style) ------------------------------
    const loadReferenceTable = async () => {
        try {
            const res = await fetch('/api/vault/reference-table');
            if (res.ok) setReferenceTable(await res.json());
        } catch (e) { console.error("Reference table fetch error:", e); }
    };

    // Designates an existing table as the reference table (or disables it
    // with an empty id). The backend guarantees the citable schema for it.
    const handleSetReferenceTable = async (tableId) => {
        setRefBusy(true);
        try {
            if (!tableId) {
                await fetch('/api/vault/reference-table', { method: 'DELETE' });
            } else {
                await fetch('/api/vault/reference-table', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table_id: tableId }),
                });
            }
            await loadReferenceTable();
        } catch (e) {
            console.error("Set reference table error:", e);
        } finally { setRefBusy(false); }
    };

    // Creates a new table that's already citable and designates it.
    const handleCreateReferenceTable = async () => {
        setRefBusy(true);
        try {
            await fetch('/api/vault/reference-table/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            await Promise.all([loadReferenceTable(), loadTablesAndDatabases()]);
        } catch (e) {
            console.error("Create reference table error:", e);
        } finally { setRefBusy(false); }
    };

    useEffect(() => {
        if (activeTab === 'references' && isOpen) {
            loadReferenceTable();
            loadTablesAndDatabases();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, isOpen]);


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
            // Baseline to prevent autosave on false changes (e.g. reload after save).
            lastSavedNewsletterAccountRef.current = JSON.stringify({ ...next, _passwordDirty: false });
            setNewsletterAccountLoaded(true);
            setNewsletterPasswordDirty(false);
        } catch (err) {
            console.error('Error loading newsletter account:', err);
        }
    };

    /**
     * Persists the POP3 config. Silent for autosave (only updates
     * the modal's global "Saved / Up to date / Error" indicator). If the user
     * hasn't touched the password, it isn't sent in the payload — the backend keeps
     * the saved one.
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
            // We send the current form values: this way the user can test before saving.
            // If the user hasn't touched the password (it's still '••••••••'), we don't send it
            // so the backend uses the one saved in the DB.
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
            identity: draft.identity
        });

        // Initialize baseline on first load
        if (lastSavedData.current === null) {
            lastSavedData.current = currentData;
            return;
        }

        // Critical safeguard: don't save integrations if they haven't been loaded from the server yet
        if (!integrationsLoadedRef.current) {
            console.warn('[AutoSave] Ignoring save: integrations not loaded yet.');
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
                axios.post('/api/identity', draft.identity)
            ]);
            
            lastSavedData.current = currentData;
            setSavingStatus('saved');
            setTimeout(() => setSavingStatus('idle'), 3000);
            // Notifies consumers of `/api/config` so they refetch without a reload.
            emitConfigChanged();
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

    // Fix scroll: on Mac+Chrome, native <select>/<input>/<textarea> can absorb
    // the wheel and prevent .settings-main/sidebar from scrolling. We also support
    // scrolling with keyboard keys (up/down arrows, space, page up, page down, home, end)
    // when focus is not on an editable text field.
    useEffect(() => {
        if (!isOpen) return;

        const wheelHandler = (e) => {
            if (e.ctrlKey || e.metaKey) return;
            // There is a nested modal on top (e.g. SchemaConfigModal, ported to the
            // body): defer scrolling to it, don't steal the event toward .settings-main.
            if (document.body.classList.contains('gnosi-modal-open')) return;
            const t = e.target;
            if (!t || !t.closest) return;
            const main = t.closest('.settings-main');
            if (!main) return;
            const tag = t.tagName;
            if (tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'TEXTAREA') return;
            if (tag === 'TEXTAREA' && t.scrollHeight > t.clientHeight + 1) return;
            if (main.scrollHeight > main.clientHeight) {
                main.scrollTop += e.deltaY;
                e.preventDefault();
            }
        };

        const keyScrollHandler = (e) => {
            const scrollKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '];
            if (!scrollKeys.includes(e.key)) return;
            // Nested modal open on top: let it handle keyboard scroll itself. Otherwise,
            // this handler (on window, in capture phase) scrolls the background .settings-main
            // and calls preventDefault → the nested modal's handler bails out due to defaultPrevented.
            if (document.body.classList.contains('gnosi-modal-open')) return;

            const ae = document.activeElement;
            if (ae) {
                const tag = ae.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable) {
                    return;
                }
            }

            const main = document.querySelector('.settings-main');
            const sidebar = document.querySelector('.settings-sidebar');
            if (!main) return;

            let scrollTarget = main;
            if (sidebar && sidebar.contains(ae)) {
                scrollTarget = sidebar;
            }

            const step = 40;
            const pageStep = scrollTarget.clientHeight - 40;

            if (e.key === 'ArrowDown') {
                scrollTarget.scrollTop += step;
                e.preventDefault();
            } else if (e.key === 'ArrowUp') {
                scrollTarget.scrollTop -= step;
                e.preventDefault();
            } else if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
                scrollTarget.scrollTop += pageStep;
                e.preventDefault();
            } else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
                scrollTarget.scrollTop -= pageStep;
                e.preventDefault();
            } else if (e.key === 'Home') {
                scrollTarget.scrollTop = 0;
                e.preventDefault();
            } else if (e.key === 'End') {
                scrollTarget.scrollTop = scrollTarget.scrollHeight;
                e.preventDefault();
            }
        };

        document.addEventListener('wheel', wheelHandler, { passive: false, capture: true });
        window.addEventListener('keydown', keyScrollHandler, { capture: true });

        return () => {
            document.removeEventListener('wheel', wheelHandler, { capture: true });
            window.removeEventListener('keydown', keyScrollHandler, { capture: true });
        };
    }, [isOpen]);

    const handleDeleteAccount = (category, accountId) => {
        setConfirmConfig({
            isOpen: true,
            title: tn('accounts.delete_title'),
            message: tn('accounts.delete_msg'),
            onConfirm: async () => {
                const updatedIntegrations = { ...integrations };
                let changed = false;

                // Aggressive removal of ALL lists from the object
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
                    // We force the save even if 'changed' is false to clean up possible inconsistencies
                    await axios.post('/api/integrations/bulk', updatedIntegrations);
                    setIntegrations(updatedIntegrations);
                    setSavingStatus('saved');
                    setTimeout(() => setSavingStatus('idle'), 2000);
                } catch (e) {
                    setSavingStatus('error');
                    console.error("Critical error deleting account:", e);
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
        // Each service keeps its own set of errors: a failed sync of
        // Contacts/Calendar must not mark the account as errored in Mail.
        const markError = category === 'contacts' ? setContactsSyncErrors
                        : category === 'calendar' ? setCalendarAuthErrors
                        : setSyncErrorAccounts;
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
                markError(prev => {
                    const next = new Set(prev);
                    if (email) failedEmails.includes(email) ? next.add(email) : next.delete(email);
                    return next;
                });
                setSavingStatus(partial ? 'error' : 'saved');
                loadIntegrations();
                if (partial && failedEmails.length) {
                    toast.error(tn('accounts.sync_partial_error', { emails: failedEmails.join(', ') }));
                }
            } else {
                setSavingStatus('error');
                if (email) markError(prev => new Set(prev).add(email));
                toast.error(tn('accounts.sync_error', { detail: res.data.error || res.data.detail || tn('accounts.unknown_error') }));
            }
        } catch (e) {
            console.error("Sync error:", e);
            setSavingStatus('error');
            if (email) markError(prev => new Set(prev).add(email));
            const detail = e?.response?.data?.detail || e?.message || tn('accounts.unknown_error');
            toast.error(tn('accounts.sync_error', { detail }));
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
            // A disabled provider counts as NOT connected (the router skips
            // it): refresh the registry so its grouping/badges follow suit.
            window.dispatchEvent(new CustomEvent('gnosi-ai-models-changed', {
                detail: { provider: pId, enabled },
            }));
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
            title: tn('ai.delete_provider_title'),
            message: tn('ai.delete_provider_msg', { name: pId.toUpperCase() }),
            onConfirm: async () => {
                try {
                    const { data } = await axios.delete(`/api/ai/providers/${pId}`);
                    setDraft(prev => {
                        const newProviders = { ...prev.ai.providers };
                        delete newProviders[pId];
                        return {
                            ...prev,
                            ai: { ...prev.ai, providers: newProviders }
                        };
                    });
                    // The cascade also removed the provider's rows from the
                    // router registry: tell ModelRegistrySettings (a sibling
                    // component with its own state) to reload from the API.
                    window.dispatchEvent(new CustomEvent('gnosi-ai-models-changed', {
                        detail: { provider: pId, removedModels: data?.removed_models || 0 },
                    }));
                    setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                } catch (e) {
                    console.error("Error deleting provider:", e);
                }
            }
        });
    };

    /**
     * If the user pastes a YouTube channel URL, it converts it to the public XML feed.
     * Recognized patterns:
     *   - youtube.com/channel/UC...        → youtube.com/feeds/videos.xml?channel_id=UC...
     *   - youtube.com/user/NAME            → youtube.com/feeds/videos.xml?user=NAME
     *   - youtube.com/playlist?list=PL...  → youtube.com/feeds/videos.xml?playlist_id=PL...
     * For handles (@name) a real channel_id is needed → we show a notice for the user to copy it manually.
     * If it's already an XML feed URL or not YouTube, returns the URL as-is.
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
            warning: t('subs_form_status_youtube_handle_warning', { handle: m[1] })
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
                // normalizeYoutubeUrl already returns the warning via the same i18n key;
                // this branch just re-derives the handle to interpolate it explicitly.
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

    // if (!draft.settings) return null; // Remove to avoid the parent rendering nothing

    return (
        <>
            <div className={`settings-overlay ${isOpen ? 'active' : ''}`} />
            <div ref={panelRef} className={`settings-modal ${isOpen ? 'active' : ''}`}>
                {/* X button outside .settings-main so it anchors to the modal and doesn't
                    disappear when the content scrolls. */}
                <button onClick={handleClose} className="gnosi-close-btn settings-close-btn" aria-label={tn('close_settings')}>
                    <X />
                </button>
                {!draft.settings ? (
                    <div className="flex items-center justify-center h-full">
                        <RefreshCw size={32} className="animate-spin text-[var(--gnosi-blue)]" />
                    </div>
                ) : (
                    <div className="settings-inner">
                    
                    {/* SIDEBAR */}
                    <aside className="settings-sidebar gnosi-modal-scroll">
                        <div className="settings-sidebar-header">
                            <div className="settings-sidebar-brand">
                                <div className="settings-section-icon-wrap">
                                    <SettingsIcon size={20} strokeWidth={2} />
                                </div>
                                <h2 className="settings-sidebar-title">{t('settings.title')}</h2>
                            </div>
                            
                        </div>

                        <div className="settings-sidebar-nav">
                            <SidebarItem id="profile" icon={User} label={t('settings.tabs.profile') || 'Perfil'} active={activeTab === 'profile'} onClick={() => { setActiveTab('profile'); setAddAccountType(null); }} />
                            <SidebarItem id="account" icon={LucideIcons.UserCog} label={t('settings.tabs.account', "Account")} active={activeTab === 'account'} onClick={() => { setActiveTab('account'); setAddAccountType(null); }} />

                            <div className="settings-sidebar-hr" />

                            <SidebarItem id="general" icon={SettingsIcon} label={t('settings.tabs.general') || 'General'} active={activeTab === 'general'} onClick={() => { setActiveTab('general'); setAddAccountType(null); }} />
                            <SidebarItem id="workspace" icon={Users} label={t('settings.tabs.workspace') || 'Workspace'} active={activeTab === 'workspace'} onClick={() => { setActiveTab('workspace'); setAddAccountType(null); }} />
                            <SidebarItem id="language" icon={Globe} label={t('settings.tabs.language') || 'Idioma i Regió'} active={activeTab === 'language'} onClick={() => { setActiveTab('language'); setAddAccountType(null); }} />
                            <SidebarItem id="appearance" icon={Palette} label={t('settings.tabs.appearance') || 'Aparença'} active={activeTab === 'appearance'} onClick={() => { setActiveTab('appearance'); setAddAccountType(null); }} />

                            <div className="settings-sidebar-hr" />
                            
                            <SidebarItem id="calendar" icon={Calendar} label={t('settings.tabs.calendar') || 'Calendari'} active={activeTab === 'calendar'} onClick={() => { setActiveTab('calendar'); setAddAccountType(null); }} />
                            <SidebarItem id="contacts" icon={Users} label={t('settings.tabs.contacts') || 'Contactes'} active={activeTab === 'contacts'} onClick={() => { setActiveTab('contacts'); setAddAccountType(null); }} />
                            <SidebarItem id="references" icon={BookOpen} label={t('settings.tabs.references') || 'Referències'} active={activeTab === 'references'} onClick={() => { setActiveTab('references'); setAddAccountType(null); }} />
                            <SidebarItem id="mail" icon={Mail} label={t('settings.tabs.mail_accounts') || 'Correu'} active={activeTab === 'mail'} onClick={() => { setActiveTab('mail'); setAddAccountType(null); }} />
                            
                            <div className="settings-sidebar-hr" />

                            <SidebarItem id="newsletters" icon={Rss} label={t('settings.tabs.newsletters') || 'Subscripcions'} active={activeTab === 'newsletters'} onClick={() => { setActiveTab('newsletters'); setAddAccountType(null); }} />
                            <SidebarItem id="social" icon={Share2} label={t('settings.tabs.social') || 'Social'} active={activeTab === 'social'} onClick={() => { setActiveTab('social'); setAddAccountType(null); }} />
                            <SidebarItem id="graph" icon={Share2} label={t('settings.tabs.graph') || 'Grafe'} active={activeTab === 'graph'} onClick={() => { setActiveTab('graph'); setAddAccountType(null); }} />
                            <SidebarItem id="ai" icon={Cpu} label={t('settings.tabs.ai') || 'IA i Agents'} active={activeTab === 'ai'} onClick={() => { setActiveTab('ai'); setAddAccountType(null); }} />
                            <SidebarItem id="notion" icon={Database} label={t('settings.tabs.notion') || 'Importar Notion'} active={activeTab === 'notion'} onClick={() => { setActiveTab('notion'); setAddAccountType(null); }} />
                            <SidebarItem id="translate" icon={Languages} label={t('settings.tabs.translate') || 'Traducció'} active={activeTab === 'translate'} onClick={() => { setActiveTab('translate'); setAddAccountType(null); }} />
                            <SidebarItem id="api" icon={LucideIcons.KeyRound} label={t('settings.tabs.api', { defaultValue: "API & tokens" })} active={activeTab === 'api'} onClick={() => { setActiveTab('api'); setAddAccountType(null); }} />
                            <SidebarItem id="plugins" icon={LucideIcons.Puzzle} label={t('settings.tabs.plugins', 'Plugins')} active={activeTab === 'plugins'} onClick={() => { setActiveTab('plugins'); setAddAccountType(null); }} />
                        </div>

                    </aside>

                    {/* CONTENT AREA */}
                    <main className="settings-main gnosi-modal-scroll">
                        <div className="settings-content-wrap">
                            
                             {/* API I TOKENS (PAT) */}
                             {activeTab === 'api' && (
                                <div className="animate-in">
                                    <ApiTokensSettings />
                                </div>
                             )}

                             {/* IDENTITY PROFILE */}
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

                             {/* ACCOUNT (credentials) */}
                             {activeTab === 'account' && <AccountSettings />}

                             {/* GENERAL */}
                            {activeTab === 'general' && (
                                <Section title={tn('general.system_title')} icon={SettingsIcon}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '40px' }}>
                                        <FormGroup label={tn('general.workspace_name')} description={tn('general.workspace_name_desc')}>
                                            <input type="text" className="gnosi-input" value={draft.settings.workspace_name} onChange={e => setDraft({...draft, settings: {...draft.settings, workspace_name: e.target.value}})} placeholder={tn('general.workspace_name_placeholder')} />
                                        </FormGroup>
                                    </div>

                                    <FormGroup label={tn('general.workspace_type')} description={tn('general.workspace_type_desc')}>
                                        <div className="segmented-control" style={{ display: 'flex', background: 'var(--settings-sidebar-bg)', padding: '6px', borderRadius: '18px', border: '1px solid var(--settings-border)' }}>
                                            {['personal', 'org'].map(m => (
                                                <button key={m} onClick={() => setDraft({...draft, settings: {...draft.settings, gnosi_mode: m}})} style={{
                                                    flex: 1, padding: '12px', borderRadius: '14px', border: 'none', cursor: 'pointer',
                                                    background: draft.settings.gnosi_mode === m ? 'var(--gnosi-blue)' : 'transparent',
                                                    color: draft.settings.gnosi_mode === m ? 'white' : 'var(--text-secondary)',
                                                    fontWeight: '800', fontSize: '0.95rem', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                                                }}>{m === 'personal' ? tn('general.personal_use') : tn('general.organization')}</button>
                                            ))}
                                        </div>
                                    </FormGroup>

                                    {draft.settings.gnosi_mode === 'org' && (
                                        <div className="animate-in" style={{ marginTop: '30px', padding: '30px', borderRadius: '24px', background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.1)' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                                                <FormGroup label={tn('general.org_admin_user')}><input type="text" className="gnosi-input" value={draft.settings.org_user} onChange={e => setDraft({...draft, settings: {...draft.settings, org_user: e.target.value}})} /></FormGroup>
                                                <FormGroup label={tn('general.org_admin_password')}><PasswordInput value={draft.settings.org_password} onChange={e => setDraft({...draft, settings: {...draft.settings, org_password: e.target.value}})} name="org-admin-password" autoComplete="new-password" /></FormGroup>
                                            </div>
                                        </div>
                                    )}

                                    <div style={{ marginTop: '50px' }}>
                                        <Section title={tn('general.files_structure')} icon={FolderOpen}>
                                            <FormGroup label={tn('general.root_folder')} description={tn('general.root_folder_desc')}>
                                                <div style={{ display: 'flex', gap: '14px' }}>
                                                    {/* Show the CONTAINER folder (parent of the active vault), not the vault: vaults live inside this root. */}
                                                    <input type="text" className="gnosi-input" value={(draft.paths.vault || '').replace(/[/\\][^/\\]+[/\\]?$/, '') || draft.paths.vault || ''} readOnly style={{ flex: 1, opacity: 0.7, fontFamily: 'monospace', fontSize: '0.82rem', letterSpacing: '0' }} />
                                                    <button onClick={() => { setPickerField('vault'); setPickerOpen(true); }} className="btn-gnosi-secondary" style={{ padding: '0 24px', borderRadius: '14px', border: 'none', background: 'rgba(59, 130, 246, 0.12)', color: 'var(--gnosi-blue)', flexShrink: 0 }}>
                                                        <FolderOpen size={18} />
                                                    </button>
                                                </div>
                                            </FormGroup>
                                            {draft.settings.gnosi_mode === 'personal' && (
                                                <FormGroup label={tn('general.vaults_label')} description={tn('general.vaults_desc')}>
                                                    <VaultSwitcher />
                                                </FormGroup>
                                            )}
                                        </Section>
                                    </div>
                                </Section>
                            )}

                            {/* WORKSPACE — member management and vault access */}
                            {activeTab === 'workspace' && (
                                <Section
                                    title={t('settings.tabs.workspace') || 'Workspace'}
                                    icon={Users}
                                >
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '16px', lineHeight: 1.5 }}>
                                        {t('settings.workspace.intro', {
                                            defaultValue: "Manage members, roles and vault access for the active workspace. This section exists for cooperatives, research teams and collectives sharing a single Gnosi instance. Real-time collaboration is under development — see the collaboration_proposal.md directive.",
                                        })}
                                    </p>
                                    <WorkspaceMembersPanel
                                        workspaceId={draft.settings.active_workspace_id || draft.settings.workspace_id || null}
                                        isAdmin={role === 'admin' || role === 'owner'}
                                        currentUserId={draft.settings.user_id || null}
                                    />
                                </Section>
                            )}

                            {/* REFERENCES (Zotero style) */}
                            {activeTab === 'references' && (
                                <Section title={t('settings.tabs.references') || 'Referències'} icon={BookOpen}>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '16px', lineHeight: 1.5 }}>
                                        <Trans i18nKey="settings.references.intro" components={{ b: <strong /> }} />
                                    </p>
                                    <div style={{ marginBottom: '16px', padding: '18px 20px', background: 'var(--settings-sidebar-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)' }}>
                                        <label style={{ fontSize: '0.72rem', fontWeight: '800', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '10px' }}>
                                            {tn('references.table_label')}
                                        </label>
                                        <select
                                            value={referenceTable?.table_id || ''}
                                            disabled={refBusy}
                                            onChange={(e) => handleSetReferenceTable(e.target.value)}
                                            className="gnosi-input"
                                            style={{ width: '100%' }}
                                        >
                                            <option value="">{tn('references.none_option')}</option>
                                            {tables.map(tbl => (
                                                <option key={tbl.id} value={tbl.id}>{tbl.name}</option>
                                            ))}
                                        </select>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
                                            <button
                                                type="button"
                                                onClick={handleCreateReferenceTable}
                                                disabled={refBusy}
                                                style={{ padding: '8px 14px', border: '1px solid var(--settings-border)', borderRadius: '12px', background: 'var(--settings-bg)', cursor: refBusy ? 'default' : 'pointer', fontWeight: '700', color: 'var(--text-primary)', fontSize: '0.8rem', opacity: refBusy ? 0.6 : 1 }}
                                            >
                                                {tn('references.create_table')}
                                            </button>
                                            {refBusy && <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{tn('references.saving')}</span>}
                                        </div>
                                        <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '10px', marginBottom: 0 }}>
                                            {referenceTable?.configured
                                                ? tn('references.active_at', { name: referenceTable.name })
                                                : tn('references.none_hint')}
                                        </p>
                                    </div>
                                </Section>
                            )}

                            {/* LANGUAGE AND REGION */}
                            {activeTab === 'language' && (
                                <Section title={tn('language.section_title')} icon={Globe}>
                                    <FormGroup label={tn('language.select_language')} description={tn('language.select_language_desc')}>
                                        <select className="gnosi-select" value={draft.settings.language} onChange={e => {
                                            const code = e.target.value;
                                            setDraft({...draft, settings: {...draft.settings, language: code}});
                                            void setInterfaceLanguage(i18n, code);
                                        }}>
                                            {LANGUAGES.map(lang => (
                                                <option key={lang.code} value={lang.code}>{lang.icon} {lang.label}</option>
                                            ))}
                                        </select>
                                    </FormGroup>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', borderTop: '1px solid var(--settings-border)', paddingTop: '44px' }}>
                                        <FormGroup label={tn('language.first_day')}>
                                            <select className="gnosi-select" value={draft.settings.week_start} onChange={e => setDraft({...draft, settings: {...draft.settings, week_start: parseInt(e.target.value)}})}>
                                                <option value={1}>{tn('language.monday_iso')}</option>
                                                <option value={0}>{tn('language.sunday_us')}</option>
                                            </select>
                                        </FormGroup>
                                        <FormGroup label={tn('language.currency_ref')}>
                                            <select className="gnosi-select" value={draft.settings.currency} onChange={e => setDraft({...draft, settings: {...draft.settings, currency: e.target.value}})}>
                                                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </FormGroup>
                                        <FormGroup label={tn('language.decimal_symbol_label')}>
                                            <select className="gnosi-select" value={draft.settings.decimal_symbol} onChange={e => setDraft({...draft, settings: {...draft.settings, decimal_symbol: e.target.value}})}>
                                                {DECIMAL_SYMBOLS.map(s => <option key={s} value={s}>{s === ',' ? tn('language.decimal_comma') : tn('language.decimal_point')}</option>)}
                                            </select>
                                        </FormGroup>
                                        <FormGroup label={tn('language.date_format_label')} description={tn('language.date_format_desc')}>
                                            <select className="gnosi-select" value={draft.settings.date_format || 'locale'} onChange={e => setDraft({...draft, settings: {...draft.settings, date_format: e.target.value}})}>
                                                {DATE_FORMATS.map(f => <option key={f.value} value={f.value}>{t(f.labelKey)}</option>)}
                                            </select>
                                        </FormGroup>
                                    </div>
                                </Section>
                            )}

                            {/* APPEARANCE */}
                            {activeTab === 'appearance' && (
                                <Section title={tn('appearance.section_title')} icon={Palette}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '56px' }}>
                                        {[
                                            { id: 'light', label: tn('appearance.theme_light'), icon: Monitor, bg: '#ffffff' },
                                            { id: 'dark', label: tn('appearance.theme_dark'), icon: Monitor, bg: '#000000' },
                                            { id: 'system', label: tn('appearance.theme_system'), icon: Monitor, bg: 'linear-gradient(135deg, #fff 50%, #000 50%)' }
                                        ].map(opt => (
                                            <button key={opt.id} onClick={() => {
                                                setDraft({...draft, settings: {...draft.settings, theme: opt.id}});
                                                // Wire the selector into the theme engine (useTheme / index.html bootstrap
                                                // read localStorage['db-theme'] and react to the 'db-theme-changed' event).
                                                localStorage.setItem('db-theme', opt.id);
                                                window.dispatchEvent(new Event('db-theme-changed'));
                                            }} style={{
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
                                            <div style={{ fontWeight: '900', color: 'var(--text-primary)', fontSize: '1.15rem' }}>{tn('appearance.reduce_fx_title')}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '6px', opacity: 0.8, maxWidth: '420px' }}>{tn('appearance.reduce_fx_desc')}</div>
                                        </div>
                                        <GnosiToggle
                                            active={draft.settings.reduce_animations}
                                            label={tn('appearance.reduce_fx_title')}
                                            scale={1.2}
                                            onChange={() => setDraft({...draft, settings: {...draft.settings, reduce_animations: !draft.settings.reduce_animations}})}
                                        />
                                    </div>

                                    <div style={{ background: 'var(--settings-sidebar-bg)', padding: '32px', borderRadius: '28px', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 10px 30px rgba(0,0,0,0.03)', marginTop: '20px' }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: '900', color: 'var(--text-primary)', fontSize: '1.15rem' }}>{tn('appearance.mail_dark_title')}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '6px', opacity: 0.8, maxWidth: '480px' }}>{tn('appearance.mail_dark_desc')}</div>
                                        </div>
                                        <GnosiToggle
                                            active={mailDarkBody}
                                            label={tn('appearance.mail_dark_title')}
                                            scale={1.2}
                                            onChange={() => {
                                                const next = !mailDarkBody;
                                                setMailDarkBody(next);
                                                try { localStorage.setItem('gnosi_mail_dark_body', next ? '1' : '0'); } catch {}
                                                try { window.dispatchEvent(new Event('gnosi-mail-dark-body-changed')); } catch {}
                                            }}
                                        />
                                    </div>
                                </Section>
                            )}

                            {/* Warning: Google token expired (calendars won't load) */}
                            {activeTab === 'calendar' && googleCalAuthError && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', marginBottom: '16px', borderRadius: '14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', flex: 1 }}>
                                        {t('settings.calendar.google_token_expired', "Your Google token has expired or been revoked. Reconnect the account to load calendars again.")}
                                    </div>
                                    <button
                                        onClick={() => { window.location.href = '/api/auth/google/login?type=calendar'; }}
                                        style={{ padding: '8px 16px', fontSize: '0.82rem', borderRadius: '10px', border: 'none', background: '#4285f4', color: 'white', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                                    >
                                        {t('settings.calendar.reconnect_google', 'Reconnect Google')}
                                    </button>
                                </div>
                            )}

                            {/* CALENDAR, CONTACTS, MAIL */}
                            {(activeTab === 'calendar' || activeTab === 'contacts' || activeTab === 'mail') && (
                                <Section 
                                    title={activeTab === 'calendar' ? tn('calendar.manage_title') : (activeTab === 'contacts' ? tn('contacts.sync_section_title') : tn('mail_accounts.title'))} 
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
                                                    {(addAccountType || isAddingTable) ? t('common.cancel') : tn('accounts.add_account')}
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
                                                            <Database size={16} color="var(--gnosi-blue)" /> {tn('accounts.vault_table')}
                                                        </button>
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); setAddAccountType('calendar'); }}
                                                            className="hover-bg"
                                                            style={{ width: '100%', padding: '12px 16px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-primary)', fontWeight: '700' }}
                                                        >
                                                            <Globe size={16} color="var(--gnosi-blue)" /> {tn('accounts.external_account')}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    }
                                >
                                    <div style={{ minHeight: '340px', marginTop: '20px' }}>
                                        {/* Default calendar */}
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
                                                        {tn('accounts.default_account')}
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
                                                        {tn('accounts.default_contacts_hint')}
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
                                                        {tn('accounts.default_account')}
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
                                                        {tn('accounts.default_mail_hint')}
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
                                                        {tn('accounts.default_calendar')}
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
                                                        {tn('accounts.default_calendar_hint')}
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
                                                    <span style={{ fontSize: '0.85rem', fontWeight: '1000', color: 'var(--gnosi-blue)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{tn('accounts.select_vault_table')}</span>
                                                    <button onClick={() => setIsAddingTable(false)} aria-label={t('settings.footer.close')} title={t('settings.footer.close')} className="icon-btn hover-bg-strong" style={{ padding: '8px', borderRadius: '12px' }}><X size={18} /></button>
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
                                                    <span style={{ fontSize: '0.85rem', fontWeight: '1000', color: 'var(--gnosi-blue)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{tn('accounts.account_config')}</span>
                                                    <button onClick={() => { setAddAccountType(null); setAddAccountEmail(''); setAddAccountEmailBlurred(false); setIsManualGoogle(false); setManualServer(''); setManualPassword(''); setEditingAccountId(null); }} aria-label={t('settings.footer.close')} title={t('settings.footer.close')} className="icon-btn hover-bg-strong" style={{ padding: '8px', borderRadius: '12px' }}><X size={18} /></button>
                                                </div>
                                                
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                    <FormGroup label={tn('accounts.email_address')}>
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
                                                            placeholder={tn('accounts.email_placeholder')}
                                                            data-autofocus="true"
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
                                                                {tn('accounts.continue_with', { provider: 'Google' })}
                                                            </button>
                                                        );
                                                        const MicrosoftBtn = () => (
                                                            <button onClick={() => window.location.href = '/api/auth/microsoft/login'} style={btnStyle('#0078d4', '0 8px 16px rgba(0,120,212,0.25)')}>
                                                                <div style={iconBox()}><svg width="18" height="18" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg></div>
                                                                {tn('accounts.continue_with', { provider: 'Microsoft' })}
                                                            </button>
                                                        );
                                                        const ICloudBtn = () => (
                                                            <button onClick={() => fillImap({ host: 'imap.mail.me.com', port: '993', enc: 'ssl' }, { host: 'smtp.mail.me.com', port: '587', enc: 'starttls' })} style={btnStyle('#555', '0 8px 16px rgba(0,0,0,0.15)')}>
                                                                <div style={iconBox('8px')}><svg width="18" height="18" viewBox="0 0 24 24" fill="#555"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg></div>
                                                                {tn('accounts.continue_with', { provider: 'iCloud' })}
                                                            </button>
                                                        );
                                                        const YahooBtn = () => (
                                                            <button onClick={() => fillImap({ host: 'imap.mail.yahoo.com', port: '993', enc: 'ssl' }, { host: 'smtp.mail.yahoo.com', port: '465', enc: 'ssl' })} style={btnStyle('#6001d2', '0 8px 16px rgba(96,1,210,0.2)')}>
                                                                <div style={iconBox()}><svg width="18" height="18" viewBox="0 0 24 24" fill="#6001d2"><path d="M14.2 2.9L12 9.3 9.8 2.9H6L10.6 14v7.1h2.8V14L18 2.9zM19.6 9.5l-2 5.7-2.1-5.7h-2.8l3.5 9-.1.2c-.4.9-.8 1.2-1.6 1.2-.3 0-.7-.1-1-.2l-.3 2.2c.5.2 1.1.3 1.7.3 2 0 3-.9 3.9-3.4l3.3-9.3h-2.5z"/></svg></div>
                                                                {tn('accounts.continue_with', { provider: 'Yahoo' })}
                                                            </button>
                                                        );
                                                        const AolBtn = () => (
                                                            <button onClick={() => fillImap({ host: 'imap.aol.com', port: '993', enc: 'ssl' }, { host: 'smtp.aol.com', port: '465', enc: 'ssl' })} style={btnStyle('#ff0b00', '0 8px 16px rgba(255,11,0,0.2)')}>
                                                                <div style={iconBox()}><svg width="18" height="18" viewBox="0 0 24 24" fill="#ff0b00"><text x="0" y="16" fontSize="14" fontWeight="bold">AOL</text></svg></div>
                                                                {tn('accounts.continue_with', { provider: 'AOL' })}
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
                                                                <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', margin: '0 0 4px', textAlign: 'center' }}>{tn('accounts.select_provider')}</p>
                                                                <GoogleBtn />
                                                                <MicrosoftBtn />
                                                                <ICloudBtn />
                                                                <YahooBtn />
                                                                <AolBtn />
                                                                <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textAlign: 'center', margin: '4px 0 0' }}>
                                                                    {tn('accounts.manual_below')}
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
                                                                // Edit mode: test the IMAP/SMTP connection
                                                                setMailTestStatus('testing');
                                                                try {
                                                                    await axios.post('/api/integrations/bulk', { ...integrations, [key]: newList });
                                                                    const res = await axios.post('/api/integrations/test-email', {
                                                                        imap_server: mailImapHost,
                                                                        imap_port: mailImapPort,
                                                                        imap_encryption: mailImapEnc,
                                                                        smtp_server: mailSmtpHost,
                                                                        smtp_port: mailSmtpPort,
                                                                        smtp_encryption: mailSmtpEnc,
                                                                        username: mailImapUser || addAccountEmail,
                                                                        password: mailImapPass,
                                                                    });
                                                                    const ok = res.data?.success;
                                                                    setMailTestStatus(ok ? 'ok' : 'error');
                                                                    toast[ok ? 'success' : 'error'](ok ? tn('accounts.test_ok') : tn('accounts.test_error', { error: res.data?.error || tn('accounts.could_not_connect') }));
                                                                    if (ok) loadIntegrations();
                                                                } catch (err) {
                                                                    setMailTestStatus('error');
                                                                    toast.error(tn('accounts.test_conn_error', { detail: err?.response?.data?.detail || err.message || tn('accounts.unknown_error') }));
                                                                }
                                                            } else {
                                                                // New account mode: saves and closes
                                                                setSavingStatus('saving');
                                                                try {
                                                                    await axios.post('/api/integrations/bulk', { ...integrations, [key]: newList });
                                                                    setSavingStatus('saved');
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
                                                                    toast.error(tn('accounts.save_error', { detail: err?.response?.data?.detail || err.message || tn('accounts.unknown_error') }));
                                                                }
                                                            }
                                                        }} className="animate-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                                            {/* SENDER NAME + ALIASES */}
                                                            <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '16px 20px', background: 'var(--settings-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)' }}>
                                                                <div>
                                                                    <FormGroup label={tn('accounts.sender_name')} description={tn('accounts.sender_name_desc')}>
                                                                        <input
                                                                            type="text"
                                                                            className="gnosi-input"
                                                                            value={mailDisplayName}
                                                                            onChange={e => setMailDisplayName(e.target.value)}
                                                                            placeholder={tn('accounts.sender_name_placeholder')}
                                                                        />
                                                                    </FormGroup>
                                                                </div>
                                                                <div>
                                                                    <FormGroup label={tn('accounts.aliases_label')} description={tn('accounts.aliases_desc')}>
                                                                        <AliasEditor aliases={mailAliases} onChange={setMailAliases} />
                                                                    </FormGroup>
                                                                </div>
                                                                <div style={{ gridColumn: 'span 2' }}>
                                                                    <FormGroup label={tn('accounts.subject_prefix')} description={tn('accounts.subject_prefix_desc')}>
                                                                        <input
                                                                            type="text"
                                                                            className="gnosi-input"
                                                                            value={mailSubjectPrefix}
                                                                            onChange={e => setMailSubjectPrefix(e.target.value)}
                                                                            placeholder={tn('accounts.subject_prefix_placeholder')}
                                                                        />
                                                                    </FormGroup>
                                                                </div>
                                                            </div>

                                                            {/* IMAP SECTION */}
                                                            <form onSubmit={e => e.preventDefault()} autoComplete="on" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', background: 'var(--settings-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
                                                                <h4 style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--gnosi-blue)', fontWeight: '900', textTransform: 'uppercase' }}>{tn('accounts.imap_section')}</h4>
                                                                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
                                                                    <FormGroup label={tn('accounts.server')}><input type="text" className="gnosi-input" value={mailImapHost} onChange={e => setMailImapHost(e.target.value)} placeholder="imap.pangea.org" /></FormGroup>
                                                                    <FormGroup label={tn('accounts.port')}><input type="text" className="gnosi-input" value={mailImapPort} onChange={e => setMailImapPort(e.target.value)} placeholder="993" /></FormGroup>
                                                                </div>
                                                                <FormGroup label={tn('accounts.user')}><input type="text" className="gnosi-input" value={mailImapUser} onChange={e => setMailImapUser(e.target.value)} name="imap-username" autoComplete="username" /></FormGroup>
                                                                <FormGroup label={tn('accounts.password')}><PasswordInput value={mailImapPass} onChange={e => setMailImapPass(e.target.value)} name="imap-password" autoComplete="current-password" /></FormGroup>
                                                                <FormGroup label={tn('accounts.security')}>
                                                                    <select className="gnosi-select" value={mailImapEnc} onChange={e => setMailImapEnc(e.target.value)}>
                                                                        <option value="ssl">SSL/TLS</option>
                                                                        <option value="starttls">STARTTLS</option>
                                                                        <option value="none">{tn('accounts.security_none')}</option>
                                                                    </select>
                                                                </FormGroup>
                                                            </form>

                                                            {/* SMTP SECTION */}
                                                            <form onSubmit={e => e.preventDefault()} autoComplete="on" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', background: 'var(--settings-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
                                                                <h4 style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--gnosi-blue)', fontWeight: '900', textTransform: 'uppercase' }}>{tn('accounts.smtp_section')}</h4>
                                                                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
                                                                    <FormGroup label={tn('accounts.server')}><input type="text" className="gnosi-input" value={mailSmtpHost} onChange={e => setMailSmtpHost(e.target.value)} placeholder="smtp.pangea.org" /></FormGroup>
                                                                    <FormGroup label={tn('accounts.port')}><input type="text" className="gnosi-input" value={mailSmtpPort} onChange={e => setMailSmtpPort(e.target.value)} placeholder="465" /></FormGroup>
                                                                </div>
                                                                <FormGroup label={tn('accounts.user')}><input type="text" className="gnosi-input" value={mailSmtpUser} onChange={e => setMailSmtpUser(e.target.value)} name="smtp-username" autoComplete="username" /></FormGroup>
                                                                <FormGroup label={tn('accounts.password')}><PasswordInput value={mailSmtpPass} onChange={e => setMailSmtpPass(e.target.value)} name="smtp-password" autoComplete="current-password" /></FormGroup>
                                                                <FormGroup label={tn('accounts.security')}>
                                                                    <select className="gnosi-select" value={mailSmtpEnc} onChange={e => setMailSmtpEnc(e.target.value)}>
                                                                        <option value="ssl">SSL/TLS</option>
                                                                        <option value="starttls">STARTTLS</option>
                                                                        <option value="none">{tn('accounts.security_none')}</option>
                                                                    </select>
                                                                </FormGroup>
                                                            </form>

                                                            <div style={{ gridColumn: 'span 2' }}>
                                                                <FormGroup label={tn('accounts.signature_label')} description={tn('accounts.signature_desc')}>
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
                                                                <FormGroup label={tn('accounts.certificate_label')}>
                                                                    <input type="text" className="gnosi-input" value={mailCertificate} onChange={e => setMailCertificate(e.target.value)} placeholder={t('settings.accounts.certificate_placeholder', "/path/to/certificate.crt")} />
                                                                </FormGroup>
                                                            </div>
                                                            
                                                            <div style={{ gridColumn: 'span 2', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                                                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                                                    {editingAccountId
                                                                        ? tn('accounts.identity_autosave_hint')
                                                                        : tn('accounts.fill_and_connect')}
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
                                                                        ? (mailTestStatus === 'ok' ? tn('accounts.connection_ok') : mailTestStatus === 'error' ? tn('accounts.connection_error') : tn('accounts.test_connection'))
                                                                        : tn('accounts.connect_account')}
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
                                                            <FormGroup label={tn('accounts.server_url')} description={tn('accounts.server_url_desc')}>
                                                                <input 
                                                                    type="text" 
                                                                    className="gnosi-input" 
                                                                    value={manualServer} 
                                                                    onChange={e => setManualServer(e.target.value)} 
                                                                    placeholder="https://..." 
                                                                />
                                                            </FormGroup>
                                                            <FormGroup label={tn('accounts.password')}>
                                                                <PasswordInput value={manualPassword} onChange={e => setManualPassword(e.target.value)} name="mail-account-password" autoComplete="current-password" />
                                                            </FormGroup>
                                                            
                                                            <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                                                                <button type="submit" className="btn-gnosi-primary" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '14px 24px', flex: 1, fontWeight: '900', border: 'none', borderRadius: '16px', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 10px 20px rgba(59, 130, 246, 0.2)' }}>
                                                                    <Check size={18} />
                                                                    {editingAccountId ? tn('accounts.update_account') : tn('accounts.connect_account')}
                                                                </button>

                                                                {addAccountEmail.includes('@') && (
                                                                    <button 
                                                                        onClick={() => setIsManualGoogle(true)}
                                                                        className="btn-gnosi-secondary"
                                                                        style={{ padding: '14px', borderRadius: '14px', fontSize: '0.8rem' }}
                                                                    >
                                                                        {tn('accounts.is_google')}
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
                                                        {/* External Accounts / Integrations */}
                                                        {uniqueAccounts.map((acc, idx) => (
                                                            <AccountRow
                                                                key={`acc-${idx}`}
                                                                name={acc.name || acc.email}
                                                                description={acc.username || acc.email}
                                                                status={(activeTab === 'calendar' ? calendarAuthErrors : activeTab === 'contacts' ? contactsSyncErrors : syncErrorAccounts).has(acc.email || acc.username) ? 'error' : 'connected'}
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
                                                        
                                                        {/* Vault tables (Calendar only) */}
                                                        {vaultCalendars.map((tbl, idx) => {
                                                            const tblColor = integrations.calendar_colors?.[tbl.id] || integrations.calendar_colors?.[`${tbl.name}`] || '#6366f1';
                                                            return (
                                                                <AccountRow 
                                                                    key={`vault-${idx}`} 
                                                                    name={tbl.name} 
                                                                    description={tn('accounts.vault_table')} 
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

                                                        {/* Sub-modal for changing the table's color */}
                                                        {editingTableColor && (
                                                            <div className="account-edit-overlay" style={{
                                                                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', 
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000
                                                            }}>
                                                                <div style={{ background: 'var(--settings-bg)', padding: '30px', borderRadius: '24px', width: '400px', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
                                                                    <h3 style={{ margin: '0 0 20px 0', fontSize: '1.2rem', fontWeight: 800 }}>{tn('accounts.table_color_title', { name: editingTableColor.name })}</h3>
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
                                                                        >{t('common.save')}</button>
                                                                        <button onClick={() => setEditingTableColor(null)} className="btn-gnosi-secondary" style={{ flex: 1, padding: '12px' }}>{t('common.cancel')}</button>
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
                                                        <div style={{ fontWeight: '900', fontSize: '1.3rem', color: 'var(--text-primary)' }}>{tn('accounts.no_accounts')}</div>
                                                        <p style={{ fontSize: '0.95rem', marginTop: '12px', maxWidth: '300px', margin: '12px auto 0' }}>{tn('accounts.no_accounts_hint')}</p>
                                                    </div>
                                                );
                                            }
                                        })()}
                                    </div>
                                </Section>
                            )}

                            {/* MAIL SNIPPETS */}
                            {activeTab === 'mail' && (
                                <Section title={tn('snippets.title')} icon={FileText}>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                                        {tn('snippets.intro')}
                                    </p>

                                    {/* List of existing fragments */}
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
                                                            {t('common.edit')}
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

                                    {/* Add/edit form */}
                                    <div style={{
                                        padding: '20px', background: 'var(--settings-bg)',
                                        borderRadius: '16px', border: '1px solid var(--settings-border)',
                                        display: 'flex', flexDirection: 'column', gap: '14px'
                                    }}>
                                        <h4 style={{ margin: 0, fontSize: '0.82rem', fontWeight: '900', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                            {editingSnippetId ? tn('snippets.edit_snippet') : tn('snippets.new_snippet')}
                                        </h4>
                                        <FormGroup label={tn('snippets.title_label')} description={tn('snippets.title_desc')}>
                                            <input
                                                type="text"
                                                className="gnosi-input"
                                                placeholder={tn('snippets.title_placeholder')}
                                                value={snippetDraft.title}
                                                onChange={e => setSnippetDraft(d => ({ ...d, title: e.target.value }))}
                                                onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                                            />
                                        </FormGroup>
                                        <FormGroup label={tn('snippets.content_label')} description={tn('snippets.content_desc')}>
                                            <textarea
                                                className="gnosi-input"
                                                rows={4}
                                                placeholder={tn('snippets.content_placeholder')}
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
                                                    {t('common.cancel')}
                                                </button>
                                            )}
                                            <button
                                                onClick={handleAddSnippet}
                                                disabled={!snippetDraft.title.trim() || !snippetDraft.content.trim()}
                                                style={{ padding: '10px 24px', borderRadius: '12px', border: 'none', background: 'var(--gnosi-blue)', color: 'white', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', opacity: (!snippetDraft.title.trim() || !snippetDraft.content.trim()) ? 0.5 : 1 }}
                                            >
                                                <Plus size={16} />
                                                {editingSnippetId ? tn('snippets.update') : tn('snippets.add')}
                                            </button>
                                        </div>
                                    </div>
                                </Section>
                            )}

                            {/* SOCIAL */}
                            {activeTab === 'social' && (
                                <>
                                    <Section title={tn('social.networks_title')} icon={Share2}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            {socialNetworks.map(net => (
                                                <div key={net.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'var(--settings-sidebar-bg)', borderRadius: '14px', border: '1px solid var(--settings-border)' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <span style={{ fontSize: '1.4rem' }}>{net.icon}</span>
                                                        <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{net.name}</span>
                                                    </div>
                                                    <GnosiToggle
                                                        active={net.enabled}
                                                        label={tn('social.enable_network', { name: net.name })}
                                                        onChange={() => {
                                                            const updated = socialNetworks.map(n => n.id === net.id ? { ...n, enabled: !n.enabled } : n);
                                                            saveSocialNetworks(updated);
                                                        }}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </Section>

                                    <Section title={tn('social.streams_title')} icon={Rss} extra={
                                        <button onClick={() => setShowAddStream(v => !v)} className="btn-gnosi-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', fontSize: '0.85rem', borderRadius: '10px' }}>
                                            {showAddStream ? <X size={15} /> : <Plus size={15} />}
                                            {showAddStream ? t('common.cancel') : tn('social.add_stream')}
                                        </button>
                                    }>
                                        {showAddStream && (
                                            <div style={{ padding: '16px', background: 'var(--settings-sidebar-bg)', borderRadius: '14px', border: '1px solid var(--settings-border)', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                                    <div>
                                                        <label className="settings-label">{tn('social.internal_id')}</label>
                                                        <input className="gnosi-input" placeholder={tn('social.internal_id_placeholder')} value={newStreamForm.id} onChange={e => setNewStreamForm(f => ({ ...f, id: e.target.value }))} />
                                                    </div>
                                                    <div>
                                                        <label className="settings-label">{tn('social.title_label')}</label>
                                                        <input className="gnosi-input" placeholder={tn('social.title_placeholder')} value={newStreamForm.title} onChange={e => setNewStreamForm(f => ({ ...f, title: e.target.value }))} />
                                                    </div>
                                                    <div>
                                                        <label className="settings-label">{tn('social.icon_label')}</label>
                                                        <input className="gnosi-input" placeholder="📡" value={newStreamForm.icon} onChange={e => setNewStreamForm(f => ({ ...f, icon: e.target.value }))} />
                                                    </div>
                                                    <div>
                                                        <label className="settings-label">{tn('social.network_label')}</label>
                                                        <select className="gnosi-input" value={newStreamForm.network} onChange={e => setNewStreamForm(f => ({ ...f, network: e.target.value }))}>
                                                            {socialNetworks.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                                                            <option value="scheduled">{tn('social.scheduled')}</option>
                                                        </select>
                                                    </div>
                                                </div>
                                                <button onClick={handleAddSocialStream} className="btn-gnosi-primary" style={{ alignSelf: 'flex-end', padding: '8px 20px', borderRadius: '10px', fontSize: '0.85rem' }}>
                                                    {tn('social.add')}
                                                </button>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {socialStreams.length === 0 && (
                                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', padding: '20px', textAlign: 'center' }}>
                                                    {tn('social.no_streams')}
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
                                                        title={t('common.delete')}
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </Section>
                                </>
                            )}

                            {/* NEWSLETTERS — dynamic form + list */}
                            {activeTab === 'newsletters' && (
                                <Section title={t('subs_section_title')} icon={Rss} extra={
                                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                                        <button onClick={() => loadNewsletterSources()} disabled={newsletterSourcesLoading} className="btn-gnosi-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px', fontSize: '0.85rem', borderRadius: '12px', whiteSpace: 'nowrap', opacity: newsletterSourcesLoading ? 0.6 : 1, cursor: newsletterSourcesLoading ? 'wait' : 'pointer' }}>{newsletterSourcesLoading ? t('subs_btn_reload_loading') : t('subs_btn_reload')}</button>
                                        <button onClick={() => newsletterOpmlRef.current?.click()} disabled={newsletterOpmlLoading} className="btn-gnosi-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.85rem', borderRadius: '12px', whiteSpace: 'nowrap', opacity: newsletterOpmlLoading ? 0.6 : 1, cursor: newsletterOpmlLoading ? 'wait' : 'pointer' }}><FileUp size={16} /> {newsletterOpmlLoading ? t('subs_btn_import_opml_loading') : t('subs_btn_import_opml')}</button>
                                    </div>
                                }>
                                    <input ref={newsletterOpmlRef} type="file" accept=".opml,.xml" onChange={(e) => handleNewsletterOpmlUpload(e.target.files?.[0])} style={{ display: 'none' }} />
                                    {newsletterSourcesError && (
                                        <div style={{ marginBottom: '20px', padding: '14px 20px', borderRadius: '14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--status-error)', fontSize: '0.9rem' }}>{newsletterSourcesError}</div>
                                    )}

                                    {/* SINGLE DYNAMIC FORM */}
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

                                        {/* Form subtitle (changes depending on type) */}
                                        <h4 style={{ margin: '0 0 18px 0', fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 900 }}>
                                            {newsletterType === 'rss' && t('subs_form_title_rss')}
                                            {newsletterType === 'youtube' && t('subs_form_title_youtube')}
                                            {newsletterType === 'newsletter' && t('subs_form_title_newsletter')}
                                        </h4>

                                        {/* RSS / YOUTUBE fields */}
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

                                        {/* NEWSLETTER fields (POP3 config) */}
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
                                                {/* Form wrapper so the browser's password manager associates user+password */}
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
                                                        <GnosiToggle
                                                            active={newsletterAccount.delete_after_ingest}
                                                            label={t('subs_news_field_delete')}
                                                            onChange={() => setNewsletterAccount(a => ({ ...a, delete_after_ingest: !a.delete_after_ingest }))}
                                                        />
                                                    </FormGroup>
                                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                                        <button onClick={testNewsletterAccount} disabled={newsletterAccountTesting} className="btn-gnosi-secondary" style={{ padding: '10px 18px', borderRadius: '12px', fontSize: '0.85rem', opacity: newsletterAccountTesting ? 0.6 : 1 }}>{newsletterAccountTesting ? t('subs_news_btn_test_loading') : t('subs_news_btn_test')}</button>
                                                        <button onClick={syncNewsletterAccount} disabled={newsletterAccountSyncing} className="btn-gnosi-secondary" style={{ padding: '10px 18px', borderRadius: '12px', fontSize: '0.85rem', opacity: newsletterAccountSyncing ? 0.6 : 1 }}>{newsletterAccountSyncing ? t('subs_news_btn_sync_loading') : t('subs_news_btn_sync')}</button>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* COUNTER + SOURCE LIST */}
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
                                                }} style={{ color: 'var(--status-error)', border: 'none', background: 'transparent', cursor: 'pointer', padding: '12px', borderRadius: '12px' }} className="hover-bg-danger"><Trash2 size={24} /></button>
                                            </div>
                                        ))}
                                    </div>
                                </Section>
                            )}

                            {/* GRAF */}
                            {activeTab === 'graph' && (
                                <Section title={tn('graph.section_title')} icon={Share2}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '50px', marginBottom: '50px' }}>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
                                                <Palette size={18} color="var(--gnosi-blue)" />
                                                <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--gnosi-blue)', fontWeight: '1000', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{tn('graph.aesthetics')}</h4>
                                            </div>
                                            <FormGroup label={tn('graph.node_size_value', { value: draft.graph.node_size.toFixed(1) })}>
                                                <input type="range" className="gnosi-range" min="0.1" max="5" step="0.1" value={draft.graph.node_size} onChange={e => setDraft({...draft, graph: {...draft.graph, node_size: parseFloat(e.target.value)}})} />
                                            </FormGroup>
                                            <FormGroup label={tn('graph.edge_thickness_value', { value: draft.graph.edge_thickness.toFixed(1) })}>
                                                <input type="range" className="gnosi-range" min="0.1" max="5" step="0.1" value={draft.graph.edge_thickness} onChange={e => setDraft({...draft, graph: {...draft.graph, edge_thickness: parseFloat(e.target.value)}})} />
                                            </FormGroup>
                                            <div style={{ marginTop: '20px', padding: '20px', background: 'var(--settings-sidebar-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
                                                <FormGroup label={tn('graph.directionality')} description={tn('graph.directionality_desc')} horizontal>
                                                    <GnosiToggle
                                                        active={draft.graph.show_arrows}
                                                        label={tn('graph.directionality')}
                                                        onChange={() => setDraft({...draft, graph: {...draft.graph, show_arrows: !draft.graph.show_arrows}})}
                                                    />
                                                </FormGroup>
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
                                                <Zap size={18} color="var(--gnosi-blue)" />
                                                <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--gnosi-blue)', fontWeight: '1000', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{tn('graph.physics_realtime')}</h4>
                                            </div>
                                            <FormGroup label={tn('graph.gravity_value', { value: draft.graph.physics.gravity })}>
                                                <input type="range" className="gnosi-range" min="0" max="2" step="0.05" value={draft.graph.physics.gravity} onChange={e => setDraft({...draft, graph: {...draft.graph, physics: {...draft.graph.physics, gravity: parseFloat(e.target.value)}}})} />
                                            </FormGroup>
                                            <FormGroup label={tn('graph.repulsion_value', { value: draft.graph.physics.repulsion })}>
                                                <input type="range" className="gnosi-range" min="0" max="10000" step="100" value={draft.graph.physics.repulsion} onChange={e => setDraft({...draft, graph: {...draft.graph, physics: {...draft.graph.physics, repulsion: parseInt(e.target.value)}}})} />
                                            </FormGroup>
                                            <FormGroup label={tn('graph.friction_value', { value: draft.graph.physics.friction })}>
                                                <input type="range" className="gnosi-range" min="1" max="20" step="1" value={draft.graph.physics.friction} onChange={e => setDraft({...draft, graph: {...draft.graph, physics: {...draft.graph.physics, friction: parseInt(e.target.value)}}})} />
                                            </FormGroup>
                                        </div>
                                    </div>

                                    <Section title={tn('graph.visible_structures')} icon={Database}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                                            {/* Databases and Tables */}
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
                                                            {tn('graph.databases')}
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
                                                                        <GnosiToggle
                                                                            active={isDbVisible}
                                                                            label={tn('graph.show_in_graph', { name: db.name })}
                                                                            scale={0.8}
                                                                            onChange={(e) => {
                                                                                e.stopPropagation();
                                                                                const checked = !isDbVisible;
                                                                                setDraft(prev => ({
                                                                                    ...prev,
                                                                                    graph: { ...prev.graph, visible_databases: checked ? [...(prev.graph.visible_databases||[]), db.id] : (prev.graph.visible_databases||[]).filter(id => id !== db.id) }
                                                                                }));
                                                                            }}
                                                                        />
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
                                                                                            <GnosiToggle
                                                                                                active={isTableVisible}
                                                                                                label={tn('graph.show_in_graph', { name: table.name })}
                                                                                                scale={0.7}
                                                                                                onChange={(e) => {
                                                                                                    e.stopPropagation();
                                                                                                    const checked = !isTableVisible;
                                                                                                    setDraft(prev => ({
                                                                                                        ...prev,
                                                                                                        graph: { ...prev.graph, visible_tables: checked ? [...(prev.graph.visible_tables||[]), table.id] : (prev.graph.visible_tables||[]).filter(id => id !== table.id) }
                                                                                                    }));
                                                                                                }}
                                                                                            />
                                                                                            <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{table.name}</span>
                                                                                        </div>

                                                                                        {isTableVisible && tableFields.length > 0 && (
                                                                                            <div style={{ marginLeft: '30px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                                                {tableFields.map(field => {
                                                                                                    const fieldKey = `${table.id}:${field.name}`;
                                                                                                    const isExposed = draft.graph.visible_fields?.includes(fieldKey);
                                                                                                    return (
                                                                                                        <div key={field.name} style={{ padding: '10px 14px', borderRadius: '12px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                                                                                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>{field.name}</span>
                                                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                                                                                {(() => {
                                                                                                                    const toggleExposed = () => {
                                                                                                                        const checked = !isExposed;
                                                                                                                        setDraft(p => ({ ...p, graph: { ...p.graph, visible_fields: checked ? [...(p.graph.visible_fields||[]), fieldKey] : (p.graph.visible_fields||[]).filter(f => f !== fieldKey) } }));
                                                                                                                    };
                                                                                                                    return (
                                                                                                                    <div role="switch" tabIndex={0} aria-checked={!!isExposed} aria-label={tn('graph.exposed_filter_field', { name: field.name })} className="gnosi-switch-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={toggleExposed} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleExposed(); } }}>
                                                                                                                        <GnosiToggle display active={isExposed} scale={0.6} />
                                                                                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{tn('graph.exposed_filter')}</span>
                                                                                                                    </div>
                                                                                                                    );
                                                                                                                })()}
                                                                                                                {renderFieldDefaultInput(field, fieldKey, tn('graph.default_value_placeholder'))}
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

                                                            {/* Orphan Tables / Other Structures */}
                                                            {(() => {
                                                                const orphanTables = (tables || []).filter(t => !databases.some(db => db.id === t.database_id));
                                                                if (orphanTables.length === 0) return null;
                                                                
                                                                return (
                                                                    <div style={{ marginTop: '24px', borderTop: '1px dashed var(--settings-border)', paddingTop: '24px' }}>
                                                                        <h6 style={{ fontSize: '0.75rem', fontWeight: '800', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px' }}>
                                                                            {tn('graph.other_structures')}
                                                                        </h6>
                                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr)', gap: '14px' }}>
                                                                            {orphanTables.map(table => {
                                                                                const isTableVisible = draft.graph.visible_tables?.includes(table.id);
                                                                                const tableFields = table.properties || [];
                                                                                return (
                                                                                    <div key={table.id}>
                                                                                        <div className="hover-scale" style={{ padding: '14px 18px', borderRadius: '16px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                                            <GnosiToggle
                                                                                                active={isTableVisible}
                                                                                                label={tn('graph.show_in_graph', { name: table.name })}
                                                                                                scale={0.75}
                                                                                                onChange={() => {
                                                                                                    const checked = !isTableVisible;
                                                                                                    setDraft(p => ({ ...p, graph: { ...p.graph, visible_tables: checked ? [...(p.graph.visible_tables||[]), table.id] : (p.graph.visible_tables||[]).filter(id => id !== table.id) } }));
                                                                                                }}
                                                                                            />
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
                                                                                                            <GnosiToggle
                                                                                                                active={exposed}
                                                                                                                label={tn('graph.exposed_filter_field', { name: field.name })}
                                                                                                                scale={0.5}
                                                                                                                onChange={() => {
                                                                                                                    const chk = !exposed;
                                                                                                                    setDraft(p => ({ ...p, graph: { ...p.graph, visible_fields: chk ? [...(p.graph.visible_fields||[]), key] : (p.graph.visible_fields||[]).filter(f => f !== key) } }));
                                                                                                                }}
                                                                                                            />
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

                                            {/* System Entities */}
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
                                                            {tn('graph.system_entities')}
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
                                                                            <GnosiToggle
                                                                                active={isEntityVisible}
                                                                                label={tn('graph.show_in_graph', { name: entity.name })}
                                                                                scale={0.8}
                                                                                onChange={(e) => {
                                                                                    e.stopPropagation();
                                                                                    const checked = !isEntityVisible;
                                                                                    setDraft(prev => ({
                                                                                        ...prev,
                                                                                        graph: { ...prev.graph, visible_databases: checked ? [...(prev.graph.visible_databases||[]), entity.id] : (prev.graph.visible_databases||[]).filter(id => id !== entity.id) }
                                                                                    }));
                                                                                }}
                                                                            />
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
                                                                                                <GnosiToggle
                                                                                                    active={isItemVisible}
                                                                                                    label={tn('graph.show_in_graph', { name: item.name })}
                                                                                                    scale={0.7}
                                                                                                    onChange={(e) => {
                                                                                                        e.stopPropagation();
                                                                                                        const checked = !isItemVisible;
                                                                                                        setDraft(prev => ({
                                                                                                            ...prev,
                                                                                                            graph: { ...prev.graph, visible_tables: checked ? [...(prev.graph.visible_tables||[]), item.id] : (prev.graph.visible_tables||[]).filter(id => id !== item.id) }
                                                                                                        }));
                                                                                                    }}
                                                                                                />
                                                                                                <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{item.name}</span>
                                                                                            </div>
                                                                                            
                                                                                            {/* Nested Fields for sub-item */}
                                                                                            {isItemVisible && entityFields.length > 0 && (
                                                                                                <div style={{ marginLeft: '30px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                                                    {entityFields.map(field => {
                                                                                                        const fieldKey = `${item.id}:${field.name}`;
                                                                                                        const isExposed = draft.graph.visible_fields?.includes(fieldKey);
                                                                                                        return (
                                                                                                            <div key={field.name} style={{ padding: '10px 14px', borderRadius: '12px', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                                                                                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>{field.name}</span>
                                                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                                                                                    {(() => {
                                                                                                                        const toggleExposed = () => {
                                                                                                                            const checked = !isExposed;
                                                                                                                            setDraft(prev => ({
                                                                                                                                ...prev,
                                                                                                                                graph: { ...prev.graph, visible_fields: checked ? [...(prev.graph.visible_fields||[]), fieldKey] : (prev.graph.visible_fields||[]).filter(f => f !== fieldKey) }
                                                                                                                            }));
                                                                                                                        };
                                                                                                                        return (
                                                                                                                        <div role="switch" tabIndex={0} aria-checked={!!isExposed} aria-label={tn('graph.exposed_filter_field', { name: field.name })} className="gnosi-switch-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={toggleExposed} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleExposed(); } }}>
                                                                                                                            <GnosiToggle display active={isExposed} scale={0.6} />
                                                                                                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{tn('graph.exposed_filter')}</span>
                                                                                                                        </div>
                                                                                                                        );
                                                                                                                    })()}
                                                                                                                    {renderFieldDefaultInput(field, fieldKey, tn('graph.default_value_short'))}
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
                                                                                            return (
                                                                                                <div key={field.name} style={{ padding: '10px 14px', borderRadius: '12px', background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                                                                                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>{field.name}</span>
                                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                                                                        {(() => {
                                                                                                            const toggleExposed = () => {
                                                                                                                const checked = !isExposed;
                                                                                                                setDraft(prev => ({
                                                                                                                    ...prev,
                                                                                                                    graph: { ...prev.graph, visible_fields: checked ? [...(prev.graph.visible_fields||[]), fieldKey] : (prev.graph.visible_fields||[]).filter(f => f !== fieldKey) }
                                                                                                                }));
                                                                                                            };
                                                                                                            return (
                                                                                                            <div role="switch" tabIndex={0} aria-checked={!!isExposed} aria-label={tn('graph.exposed_filter_field', { name: field.name })} className="gnosi-switch-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={toggleExposed} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleExposed(); } }}>
                                                                                                                <GnosiToggle display active={isExposed} scale={0.6} />
                                                                                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{tn('graph.exposed_filter')}</span>
                                                                                                            </div>
                                                                                                            );
                                                                                                        })()}
                                                                                                        {renderFieldDefaultInput(field, fieldKey, tn('graph.default_value_short'))}
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
                                        title={tn('ai.providers_section')} 
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
                                                <Plus size={18} /> {tn('ai.connect_provider')}
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
                                                            <GnosiToggle
                                                                active={p.enabled !== false}
                                                                label={tn('ai.enable_provider', { name: pName })}
                                                                scale={1.1}
                                                                style={{ marginRight: '10px' }}
                                                                onChange={() => handleToggleAIProvider(pId, p.enabled === false)}
                                                            />
                                                            <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'var(--settings-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gnosi-blue)', boxShadow: '0 5px 15px rgba(0,0,0,0.05)' }}>
                                                                {pIcon ? <img src={pIcon} style={{ width: '28px', height: '28px' }} alt="" /> : <Cpu size={28} />}
                                                            </div>
                                                            <div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <div style={{ fontWeight: '900', fontSize: '1.2rem', color: 'var(--text-primary)' }}>{pName}</div>
                                                                    {p.enabled === false && <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '10px', background: 'var(--settings-border)', color: 'var(--text-secondary)', fontWeight: '800' }}>{tn('ai.inactive')}</span>}
                                                                </div>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px', opacity: 0.8 }}>
                                                                    {p.has_api_key ? tn('ai.credentials_ok')
                                                                        : (catalogItem.is_local ? tn('ai.local_no_key') : tn('ai.missing_api_key'))}
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
                                                                    color: aiValidationStatus[pId] === 'success' ? 'var(--status-success)' : (aiValidationStatus[pId] === 'error' ? 'var(--status-error)' : 'var(--text-primary)'),
                                                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                    opacity: p.enabled === false ? 0.5 : 1,
                                                                    whiteSpace: 'nowrap'
                                                                }}
                                                            >
                                                                {aiValidationStatus[pId] === 'validating' ? <div className="spinner-small" style={{ borderTopColor: 'var(--gnosi-blue)' }} /> : (aiValidationStatus[pId] === 'success' ? tn('ai.valid') : (aiValidationStatus[pId] === 'error' ? tn('ai.error') : tn('ai.test_ping')))}
                                                            </button>
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setProviderToEdit(catalogItem);
                                                                    setIsConnectModalOpen(true);
                                                                }}
                                                                aria-label={tn('ai.configure_name', { name: pName })}
                                                                title={tn('ai.configure_name', { name: pName })}
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
                                                                aria-label={tn('ai.delete_name', { name: pName })}
                                                                title={tn('ai.delete_name', { name: pName })}
                                                                className="icon-btn hover-bg-strong"
                                                                style={{ padding: '14px', borderRadius: '16px', color: 'var(--status-error)' }}
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

                                    {/* Order: Providers → Models → Agents. The registry sits
                                        right under the providers it depends on; agents (which
                                        pick provider+model) come last. */}
                                    <Section title={tn('ai.model_registry.title')} icon={Cpu}>
                                        <ModelRegistrySettings />
                                    </Section>

                                    <div style={{ height: '30px' }} />

                                    <Section
                                        title={tn('ai.agents_section')}
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
                                                <Plus size={16} /> {tn('ai.create_agent_btn')}
                                            </button>
                                        }
                                    >
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                                            {draft.ai.agents.map(agent => (
                                                <div key={agent.id} className="hover-scale" onClick={() => setEditingAgent(agent)} title={tn('ai.edit_agent_title')} style={{ padding: '24px', borderRadius: '24px', border: '1px solid var(--settings-border)', background: 'var(--settings-sidebar-bg)', display: 'flex', alignItems: 'center', gap: '20px', transition: 'all 0.2s', cursor: 'pointer' }}>
                                                    <div style={{ fontSize: '2.5rem', filter: 'drop-shadow(0 5px 10px rgba(0,0,0,0.1))' }}>{agent.icon || '🤖'}</div>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontWeight: '900', fontSize: '1.1rem', color: 'var(--text-primary)' }}>{agent.name}</div>
                                                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{agent.model}</div>
                                                    </div>
                                                    <GnosiToggle
                                                        active={agent.enabled}
                                                        label={tn('ai.enable_agent', { name: agent.name })}
                                                        scale={1.1}
                                                        onChange={() => {
                                                            const newList = draft.ai.agents.map(a => a.id === agent.id ? {...a, enabled: !a.enabled} : a);
                                                            setDraft({...draft, ai: {...draft.ai, agents: newList}});
                                                        }}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </Section>
                                </>
                            )}


                            {/* NOTION IMPORT */}
                            {activeTab === 'notion' && (
                                <NotionImportSettings />
                            )}

                            {/* PLUGINS */}
                            {activeTab === 'plugins' && (
                                <PluginsSettings />
                            )}

                            {/* TRANSLATION */}
                            {activeTab === 'translate' && (
                                <Section
                                    title={t('translate_settings.section_title', 'Translation services')}
                                    icon={Languages}
                                >
                                    <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '24px' }}>
                                        {t('translate_settings.intro', "Configure the providers used by the \"Translate row\" button. DeepL covers most languages; Softcatalà handles Catalan (DeepL doesn't support it).")}
                                    </div>

                                    {/* DeepL */}
                                    <FormGroup
                                        label={t('translate_settings.deepl_label')}
                                        description={t('translate_settings.deepl_desc', "Stored in the macOS Keychain, not in .env_shared. Get one at deepl.com/pro-api.")}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            {translateState.deepl_has_value && !translateState.deepl_input && (
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                    padding: '10px 14px', borderRadius: '12px',
                                                    background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)',
                                                    fontSize: '0.85rem', color: 'var(--text-primary)'
                                                }}>
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                                                        <Check size={16} style={{ color: 'var(--status-success)' }} />
                                                        {t('translate_settings.deepl_configured', 'API key configured in Keychain')}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={handleDeleteDeeplKey}
                                                        disabled={translateState.saving_deepl}
                                                        style={{
                                                            padding: '4px 12px', fontSize: '0.78rem', fontWeight: 700,
                                                            border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
                                                            background: 'transparent', color: 'var(--status-error)', cursor: 'pointer',
                                                            opacity: translateState.saving_deepl ? 0.5 : 1,
                                                        }}
                                                    >
                                                        {t('common.delete', 'Delete')}
                                                    </button>
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                <div style={{ flex: 1 }}>
                                                    <PasswordInput
                                                        value={translateState.deepl_input}
                                                        onChange={e => setTranslateState(s => ({ ...s, deepl_input: e.target.value, saved_deepl: false }))}
                                                        placeholder={translateState.deepl_has_value
                                                            ? t('translate_settings.deepl_placeholder_replace', "Enter a new key to replace it")
                                                            : t('translate_settings.deepl_placeholder', 'Paste your DeepL API key…')}
                                                        name="deepl-api-key"
                                                        autoComplete="new-password"
                                                    />
                                                </div>
                                                <TranslateSaveIndicator saving={translateState.saving_deepl} saved={translateState.saved_deepl} t={t} />
                                            </div>
                                        </div>
                                    </FormGroup>

                                    {/* Softcatalà */}
                                    <FormGroup
                                        label={t('translate_settings.softcatala_label')}
                                        description={t('translate_settings.softcatala_desc', "Endpoint for Softcatalà's translator (Catalan). Stored in .env_shared. Empty = use default.")}
                                    >
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                            <input
                                                type="text"
                                                className="gnosi-input"
                                                value={translateState.softcatala_url}
                                                onChange={e => setTranslateState(s => ({ ...s, softcatala_url: e.target.value, saved_softcatala: false }))}
                                                placeholder="https://www.softcatala.org/api/traductor/traduir"
                                                style={{ flex: 1 }}
                                            />
                                            <TranslateSaveIndicator saving={translateState.saving_softcatala} saved={translateState.saved_softcatala} t={t} />
                                        </div>
                                    </FormGroup>

                                    <div style={{
                                        marginTop: '20px', padding: '16px 20px', borderRadius: '14px',
                                        background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)',
                                        display: 'flex', gap: '14px', alignItems: 'flex-start'
                                    }}>
                                        <Info size={18} style={{ color: 'var(--gnosi-blue)', flexShrink: 0, marginTop: '2px' }} />
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                            {t('translate_settings.usage_hint', "These values are consumed by the /api/vault/skills/translate-row endpoint. After saving the DeepL key you may need to restart the backend so the Keychain reloads.")}
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
                    aiRegistry={aiRegistry}
                />
            )}
            {/* Mount-on-open: the modal seeds selectedId/baseUrl from
                editingProvider via useState INITIAL values, so a permanently
                mounted instance kept the state from its very first render —
                the per-provider ⚙️ opened "Configurar X" with an empty,
                disabled select and no API-key field. Remounting on each open
                also clears the previous api_key from the password input. */}
            {isConnectModalOpen && <UnifiedAIProviderModal
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
                                // Merge over the existing entry: replacing it
                                // dropped fields like model_name/credential_ref
                                // every time someone edited just the base URL.
                                [pId]: { ...(prev.ai.providers?.[pId] || {}), ...data, enabled: true }
                            }
                        }
                    }));
                    triggerAutoSave(false);
                    setIsConnectModalOpen(false);
                }}
            />}
        </>
    );
}

// --- SUB-COMPONENTS FOR AI ---

function UnifiedAIProviderModal({ isOpen, onClose, aiCatalog, onSave, onValidate, aiValidationStatus, editingProvider = null }) {
    const { t } = useTranslation();
    const [selectedId, setSelectedId] = useState(editingProvider?.id || '');
    const [apiKey, setApiKey] = useState('');
    const [baseUrl, setBaseUrl] = useState(editingProvider?.base_url || '');
    // The catalog now lists EVERY models.dev provider (~167): a text filter
    // keeps the dropdown navigable.
    const [providerFilter, setProviderFilter] = useState('');
    // Ref to the panel: delimits the focus-trap and the scope of Enter.
    const panelRef = useRef(null);

    useEffect(() => {
        if (selectedId && aiCatalog[selectedId]) {
            setBaseUrl(aiCatalog[selectedId].base_url || '');
        }
    }, [selectedId]);

    const provider = aiCatalog[selectedId];
    const allProviders = Object.values(aiCatalog);
    const normalizedFilter = providerFilter.trim().toLowerCase();
    const filteredProviders = normalizedFilter
        ? allProviders.filter(p =>
            (p.name || '').toLowerCase().includes(normalizedFilter)
            || (p.id || '').toLowerCase().includes(normalizedFilter))
        : allProviders;
    // Keep the selected provider visible even when the filter excludes it
    const visibleProviders = provider && !filteredProviders.some(p => p.id === selectedId)
        ? [provider, ...filteredProviders]
        : filteredProviders;
    const isValidating = selectedId ? aiValidationStatus[selectedId] === 'validating' : false;

    // Canonical keyboard: Esc just closes (consistent with the rest of Config), Tab does
    // focus-trap. No Enter→save: saving is done with the "Save" button.
    useModalKeyboard({
        isOpen,
        onClose,
        containerRef: panelRef,
        trapFocus: true,
    });

    if (!isOpen) return null;

    return (
        <div className={`modal-overlay ${isOpen ? 'active' : ''}`} style={{ 
            zIndex: 99999, backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh'
        }}>
            <div ref={panelRef} className="modal-content animate-pop" onClick={e => e.stopPropagation()} style={{
                width: '500px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: '40px',
                borderRadius: '32px', boxShadow: '0 30px 80px rgba(0,0,0,0.15)', border: '1px solid var(--settings-border)',
                background: 'var(--settings-bg)', overflow: 'hidden', position: 'relative'
            }}>
                <button onClick={onClose} aria-label={t('settings.footer.close')} title={t('settings.footer.close')} className="icon-btn hover-bg" style={{
                    position: 'absolute', top: '24px', right: '24px', padding: '10px', borderRadius: '50%',
                    color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)', border: '1px solid var(--settings-border)',
                    width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}><X size={18} /></button>

                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '12px', marginRight: '-12px' }}>
                    <h3 style={{ margin: '0 0 30px 0', fontSize: '1.4rem', fontWeight: '900' }}>
                        {editingProvider ? t('settings.ai.configure_name', { name: editingProvider.name }) : t('settings.ai.connect_provider_title')}
                    </h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <FormGroup label={t('settings.ai.provider_ai_label')} description={t('settings.ai.provider_select_desc')}>
                            {!editingProvider && (
                                <input
                                    type="text"
                                    className="gnosi-input"
                                    style={{ marginBottom: '10px' }}
                                    value={providerFilter}
                                    onChange={e => setProviderFilter(e.target.value)}
                                    placeholder={t('settings.ai.provider_search_placeholder', { count: allProviders.length })}
                                />
                            )}
                            <select
                                className="gnosi-select"
                                value={selectedId}
                                onChange={e => setSelectedId(e.target.value)}
                                disabled={!!editingProvider}
                            >
                                <option value="">{t('settings.ai.choose_provider')}</option>
                                {visibleProviders.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}{p.connected ? ' ✓' : ''}</option>
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
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                            {t('settings.ai.models_available', { count: provider.models?.length || 0 })}
                                            {provider.doc && (
                                                <>
                                                    {' · '}
                                                    <a href={provider.doc} target="_blank" rel="noreferrer"
                                                        style={{ color: 'var(--gnosi-blue)', textDecoration: 'none' }}>
                                                        {t('settings.ai.provider_doc_link', "Documentation ↗")}
                                                    </a>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <FormGroup label={t('settings.ai.api_key_label')} description={t('settings.ai.api_key_desc')}>
                                    <PasswordInput value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." name="ai-api-key" autoComplete="off" />
                                    {(provider.env?.length || 0) > 0 && (
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '6px', opacity: 0.8 }}>
                                            {t('settings.ai.env_hint', { defaultValue: "Alternative: set {{vars}} in the backend environment.", vars: provider.env.join(' / ') })}
                                        </div>
                                    )}
                                </FormGroup>

                                <FormGroup label={t('settings.ai.base_url_label')} description={t('settings.ai.base_url_desc')}>
                                    <input type="text" className="gnosi-input" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={provider.base_url_hint || provider.base_url || "https://api.openai.com/v1"} />
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
                        {isValidating ? <div className="spinner-small" /> : <Activity size={18} />} {t('settings.ai.test_ping')}
                    </button>
                    <button 
                        className="btn-gnosi-primary" 
                        disabled={!selectedId || (!apiKey && !editingProvider)}
                        onClick={() => onSave(selectedId, { api_key: apiKey, base_url: baseUrl })} 
                        style={{ flex: 1, padding: '14px', borderRadius: '18px' }}
                    >{t('common.save')}</button>
                </div>
            </div>
        </div>
    );
}

function AIAgentModal({ isOpen, onClose, agent, onSave, aiRegistry }) {
    const { t } = useTranslation();
    const [name, setName] = useState(agent.name || '');
    const [provider, setProvider] = useState(agent.provider || '');
    const [model, setModel] = useState(agent.model || '');
    const [icon, setIcon] = useState(agent.icon || '🤖');
    // Instructions (system prompt → agent.persona) and reference context
    // (knowledge/notes → agent.context). Distinct concerns: "who you are" vs
    // "data you must consider". Both optional; backend appends context to the
    // system message under a "## Context" heading (see factory.py).
    const [persona, setPersona] = useState(agent.persona || '');
    const [context, setContext] = useState(agent.context || '');
    // Attached sources: references (files, pages, databases, the vault), never
    // their content — the agent reads them on demand through its scoped tools
    // (directive `agent_context_sources.md`).
    const [contextRefs, setContextRefs] = useState(agent.context_refs || []);
    // Ref to the panel: delimits the focus-trap and the scope of Enter.
    const panelRef = useRef(null);

    // Group registry rows by provider for the <select> optgroups. Rows carry
    // {provider, model_id, ...}; we keep first-seen order of providers.
    const grouped = useMemo(() => {
        const map = new Map();
        for (const row of (aiRegistry || [])) {
            if (!row || !row.provider || !row.model_id) continue;
            if (!map.has(row.provider)) map.set(row.provider, []);
            map.get(row.provider).push(row.model_id);
        }
        return map;
    }, [aiRegistry]);
    // Composite value for the single select: "provider||model". The "||" is
    // safe — neither provider ids nor model ids contain that pattern.
    const selectedKey = (provider && model) ? `${provider}||${model}` : '';
    const registryEmpty = grouped.size === 0;

    // Evidence about the chosen model, recorded from its own past failures.
    // Only reasons the backend attributes to the MODEL land here: a rate limit
    // or an exhausted account says nothing about the model itself.
    const reliability = useModelReliability();
    const modelFault = findModelFault(reliability, provider, model);
    const faultReason = modelFault && MODEL_FAULT_REASONS[modelFault.top_model_reason];

    // Canonical keyboard: Esc just closes (consistent with the rest of Config), Tab does
    // focus-trap. No Enter→save: saving is done with the "Save Agent" button.
    useModalKeyboard({
        isOpen,
        onClose,
        containerRef: panelRef,
        trapFocus: true,
    });

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
            <div ref={panelRef} className="modal-content animate-pop" onClick={e => e.stopPropagation()} style={{
                width: '560px',
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
                    <h3 style={{ margin: '0 0 30px 0', fontSize: '1.4rem', fontWeight: '900' }}>{agent.id ? t('settings.ai.edit_agent_title') : t('settings.ai.new_agent_title')}</h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end' }}>
                            <div style={{ flex: 1 }}>
                                <FormGroup label={t('settings.ai.agent_name')}>
                                    <input type="text" className="gnosi-input" value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.ai.agent_name_placeholder')} />
                                </FormGroup>
                            </div>
                            <div style={{ width: '80px' }}>
                                <FormGroup label={t('settings.ai.icon_label')}>
                                    <input type="text" className="gnosi-input" value={icon} onChange={e => setIcon(e.target.value)} style={{ textAlign: 'center', fontSize: '1.5rem' }} />
                                </FormGroup>
                            </div>
                        </div>

                        {/* Single grouped select: provider is derived from the
                            chosen model (registry rows are provider+model pairs).
                            Only enabled registry models are valid agent targets;
                            an agent whose provider/model is no longer in the
                            registry shows blank and must be re-picked. */}
                        <FormGroup label={t('settings.ai.model_specific')}>
                            <select className="gnosi-select" value={selectedKey}
                                onChange={e => {
                                    const [p, m] = e.target.value.split('||');
                                    setProvider(p || '');
                                    setModel(m || '');
                                }}>
                                <option value="">{t('settings.ai.select_model_option')}</option>
                                {[...grouped.entries()].map(([prov, modelIds]) => (
                                    <optgroup key={prov} label={prov}>
                                        {modelIds.map(mid => (
                                            <option key={mid} value={`${prov}||${mid}`}>{mid}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                            {registryEmpty && (
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 6 }}>
                                    {t('settings.ai.model_registry_empty')}
                                </div>
                            )}
                            {faultReason && (
                                <div style={{
                                    fontSize: '0.78rem', marginTop: 8, padding: '8px 10px',
                                    borderRadius: 10, background: 'rgba(245, 158, 11, 0.12)',
                                    color: '#b45309', display: 'flex', gap: 6, alignItems: 'flex-start',
                                }}>
                                    <Activity size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                                    <span>
                                        {t('settings.ai.model_fault_warning', {
                                            defaultValue: "This model {{reason}} {{count}} times in the last {{days}} days.",
                                            reason: t(faultReason.key, faultReason.fallback),
                                            count: modelFault.reasons[modelFault.top_model_reason],
                                            days: modelFault.window_days,
                                        })}
                                    </span>
                                </div>
                            )}
                        </FormGroup>

                        <FormGroup label={t('settings.ai.instructions_label')}
                            description={t('settings.ai.instructions_desc')}>
                            <textarea className="gnosi-input" value={persona} onChange={e => setPersona(e.target.value)}
                                placeholder={t('settings.ai.instructions_placeholder')} rows={4}
                                style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
                        </FormGroup>

                        <FormGroup label={t('settings.ai.context_label')}
                            description={t('settings.ai.context_desc')}>
                            <textarea className="gnosi-input" value={context} onChange={e => setContext(e.target.value)}
                                placeholder={t('settings.ai.context_placeholder')} rows={4}
                                style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
                        </FormGroup>

                        <FormGroup label={t('settings.ai.context_sources_label')}
                            description={t('settings.ai.context_sources_desc')}>
                            <AgentContextSources value={contextRefs} onChange={setContextRefs} />
                        </FormGroup>
                    </div>
                </div>

                <div style={{ marginTop: '40px', display: 'flex', gap: '14px' }}>
                    <button className="btn-gnosi-secondary" onClick={onClose} style={{ flex: 1, padding: '14px', borderRadius: '18px' }}>{t('common.cancel')}</button>
                    <button
                        className="btn-gnosi-primary"
                        disabled={!name || !provider || !model}
                        onClick={() => {
                            onSave({ ...agent, name, provider, model, icon, persona, context, context_refs: contextRefs });
                            onClose();
                        }}
                        style={{ flex: 1, padding: '14px', borderRadius: '18px' }}
                    >{t('settings.ai.save_agent')}</button>
                </div>
            </div>
        </div>
    );
}
