import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Globe, Palette, RefreshCw, Info, ExternalLink, Monitor, BookOpen,
    Check, FolderOpen, Database, Cpu, Zap, Settings as SettingsIcon,
    Sliders, Calendar, Mail, Trash2, Plus, Users, Rss, Share2, Inbox,
    ChevronRight, ChevronDown, Search, FileUp, Shield, Activity, Bot, FileText,
    PenTool, Image, Paperclip, Eye, EyeOff, User, Languages, Loader2, Newspaper,
    Clock3, History
} from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { useApi } from '../hooks/use-api';
import { FolderPickerModal } from './FolderPickerModal';
import { IconPicker, VAULT_COLORS } from './Vault/IconPicker';
import { IconRenderer } from './Vault/IconRenderer';
import axios from '../shared/api/legacy-http';
import { toast } from '../lib/toast';
import { emitConfigChanged } from '../lib/configEvents';
import { getEffectiveTableId, toValueStrings } from '../utils/graphFilters';
import { ConfirmModal } from './ConfirmModal';
import * as LucideIcons from 'lucide-react';
import MailBlockEditor from './Mail/MailBlockEditor';
import IdentityProfile from './Vault/IdentityProfile';
import AccountSettings from './Auth/AccountSettings';
import { WorkspaceMembersPanel } from './Workspace/WorkspaceMembersPanel';
import ApiTokensSettings from './ApiTokensSettings';
import { PluginsSettings } from './PluginsSettings';
import { AppSidebarSettings } from './AppSidebarSettings';
import AIModelComparisonModal from './AIModelComparisonModal';
import AIUsageHistoryModal from './AIUsageHistoryModal';
import { registryEntryMatchesModel } from '../lib/modelComparisonRegistry';
import NotionImportSettings from './NotionImportSettings';
import VaultSwitcher from './VaultSwitcher';
import AgentContextSources from './AgentContextSources';
import {
    AgentSkillsField,
    SkillsSettingsPanel,
    ToolsSettingsPanel,
} from './AI/AIResourcesSettings';
import { useAIResources } from './AI/useAIResources';
import {
    AutomationsSettingsPanel,
    OperationsHistoryPanel,
} from './AI/AIOperationsSettings';
import { groupEnabledModelRoutes, parseModelRouteKey } from './AI/aiSettingsUtils';
import { useModelReliability, findModelFault, MODEL_FAULT_REASONS } from '../lib/modelReliability';
import { availableLocales, resolveLocale } from '../locales/registry';
import { sortFieldItems } from '../utils/fieldOrdering';
import { SettingsSectionTabs } from './SettingsSectionTabs';
import { SocialNetworkIcon, isKnownSocialNetwork } from './social/SocialNetworkIcon';
import './GlobalSettingsModal.css';
import './AI/AIResourcesSettings.css';
import { transportFetch } from '../shared/api/transports';
import {
    fetchSocialNetworks,
    fetchSocialStreams,
    updateSocialNetworks,
    updateSocialStreams,
} from '../shared/api/social';
import {
    createReaderSource,
    deleteReaderSource,
    fetchNewsletterAccount,
    fetchReaderSources,
    importReaderOpml,
    syncNewsletterAccount as requestNewsletterSync,
    testNewsletterAccount as requestNewsletterTest,
    updateNewsletterAccount,
} from '../shared/api/reader';

const formatCost = (value, symbol, decimals = 2) => {
    const num = Number(value);
    const formatted = Number.isFinite(num) 
        ? num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) 
        : '0.00';
    return symbol === '€' ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
};

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

const AGENT_ICON_FAVORITES = [
    'Brain', 'Bot', 'Sparkles', 'Lightbulb', 'BookOpen', 'Search', 'PenTool',
    'MessageCircle', 'Heart', 'Rocket', 'Shield', 'Workflow', 'Activity',
    'AlarmClock', 'Archive', 'Atom', 'BadgeCheck', 'BarChart3', 'Bell', 'Binary',
    'Blocks', 'BookMarked', 'Bookmark', 'BriefcaseBusiness', 'Calculator',
    'CalendarDays', 'Camera', 'ChartNoAxesCombined', 'CheckCircle2', 'CircleHelp',
    'ClipboardCheck', 'Cloud', 'Code2', 'Compass', 'Cpu', 'Database', 'FileText',
    'Fingerprint', 'Flame', 'FolderOpen', 'Gamepad2', 'Gem', 'Globe2',
    'GraduationCap', 'HandHeart', 'Headphones', 'House', 'Image', 'KeyRound',
    'Languages', 'Laptop', 'Layers3', 'Leaf', 'Library', 'Link2', 'ListChecks',
    'LockKeyhole', 'Mail', 'Map', 'MapPin', 'Megaphone', 'MessageSquareText',
    'Mic', 'Monitor', 'Moon', 'Music', 'Network', 'NotebookPen', 'Palette',
    'Phone', 'PieChart', 'Puzzle', 'Radio', 'Route', 'Scale', 'Send', 'Server',
    'Settings2', 'ShoppingBag', 'Star', 'Sun', 'Target', 'Telescope', 'Timer',
    'UserRound', 'UsersRound', 'WandSparkles', 'Wrench', 'Zap',
];
const AGENT_ICON_REGISTRY = LucideIcons.icons || {};
const AVAILABLE_AGENT_ICONS = Object.keys(AGENT_ICON_REGISTRY)
    .filter(name => /^[A-Z]/.test(name))
    .sort();
const AVAILABLE_AGENT_ICON_SET = new Set(AVAILABLE_AGENT_ICONS);
const AGENT_ICON_BROWSE_OPTIONS = AGENT_ICON_FAVORITES
    .filter(name => AVAILABLE_AGENT_ICON_SET.has(name));

const getAgentIconValue = (name, color = 'blue') => `lucide:${name}:${color}`;

const AgentIconSelect = ({ value, onChange, label, searchPlaceholder, noResultsLabel }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const rootRef = useRef(null);
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const visibleIcons = useMemo(
        () => normalizedSearch
            ? AVAILABLE_AGENT_ICONS.filter(name => name.toLowerCase().includes(normalizedSearch))
            : AGENT_ICON_BROWSE_OPTIONS,
        [normalizedSearch]
    );
    const currentIconName = typeof value === 'string' && value.startsWith('lucide:')
        ? value.split(':')[1]
        : '';
    const CurrentIcon = AGENT_ICON_REGISTRY[currentIconName];
    const closePicker = useCallback(() => {
        setIsOpen(false);
        setSearchTerm('');
    }, []);

    useModalKeyboard({
        isOpen,
        onClose: closePicker,
    });

    useEffect(() => {
        if (!isOpen) return undefined;

        const handlePointerDown = event => {
            if (!rootRef.current?.contains(event.target)) closePicker();
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
        };
    }, [closePicker, isOpen]);

    const toggleOpen = () => {
        if (isOpen) closePicker();
        else setIsOpen(true);
    };

    return (
        <div
            ref={rootRef}
            style={{ position: 'relative', width: '72px' }}
        >
            <button
                type="button"
                aria-label={label}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                onClick={toggleOpen}
                style={{
                    width: '72px', height: '48px', padding: '0 10px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    borderRadius: '14px', border: '1px solid var(--gnosi-blue)',
                    background: 'var(--gnosi-blue)', color: '#fff', cursor: 'pointer'
                }}
            >
                {CurrentIcon
                    ? <CurrentIcon size={24} strokeWidth={2.35} />
                    : <IconRenderer icon={value || getAgentIconValue('Brain')} size={24} color="#fff" />}
                <ChevronDown
                    size={15}
                    aria-hidden="true"
                    style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
                />
            </button>

            {isOpen && (
                <div
                    style={{
                        position: 'absolute', top: '56px', right: 0, zIndex: 30,
                        width: '326px', padding: '12px', borderRadius: '18px',
                        border: '1px solid var(--settings-border)',
                        background: 'var(--settings-sidebar-bg)',
                        boxShadow: '0 18px 45px rgba(15, 23, 42, 0.2)'
                    }}
                >
                    <div style={{ position: 'relative', marginBottom: '10px' }}>
                        <Search
                            size={16}
                            aria-hidden="true"
                            style={{
                                position: 'absolute', left: '11px', top: '50%',
                                transform: 'translateY(-50%)', color: 'var(--text-secondary)'
                            }}
                        />
                        <input
                            autoFocus
                            type="search"
                            className="gnosi-input"
                            value={searchTerm}
                            onChange={event => setSearchTerm(event.target.value)}
                            placeholder={searchPlaceholder}
                            style={{ width: '100%', padding: '9px 10px 9px 36px', fontSize: '0.82rem' }}
                        />
                    </div>
                    <div
                        role="listbox"
                        aria-label={label}
                        style={{
                            display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
                            gap: '6px', maxHeight: '286px', overflowY: 'auto', padding: '2px'
                        }}
                    >
                        {visibleIcons.map(name => {
                            const IconComponent = AGENT_ICON_REGISTRY[name];
                            const optionValue = getAgentIconValue(name);
                            const selected = value === optionValue;
                            return (
                                <button
                                    key={name}
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    aria-label={name}
                                    title={name}
                                    onClick={() => {
                                        onChange(optionValue);
                                        closePicker();
                                    }}
                                    style={{
                                        width: '42px', height: '42px', padding: 0,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        borderRadius: '11px',
                                        border: selected ? '2px solid #fff' : '1px solid var(--gnosi-blue)',
                                        background: 'var(--gnosi-blue)',
                                        color: '#fff',
                                        boxShadow: selected ? '0 0 0 2px var(--gnosi-blue)' : 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {IconComponent && <IconComponent size={20} strokeWidth={2.35} />}
                                </button>
                            );
                        })}
                    </div>
                    {visibleIcons.length === 0 && (
                        <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                            {noResultsLabel}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

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

/**
 * Keeps a collection editor next to its owning row without duplicating the
 * editor's stateful form. Creation forms render at their normal section
 * position; existing-item editors move into the matching row anchor.
 */
const InlineEditorPlacement = ({ target, waitForTarget = false, children }) => {
    if (target) return createPortal(children, target);
    return waitForTarget ? null : children;
};

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

const AccountRow = ({ itemId, name, description, status, type, provider, onSync, onEdit, onDelete, onToggleEnabled, enabled = true, isSyncing = false, isEditing = false }) => {
    const { t } = useTranslation();
    const ta = (k, opts) => t('settings.accounts.' + k, opts);
    return (
    <div className={`account-row settings-configurable-item hover-scale ${isEditing ? 'is-editing' : ''}`} data-settings-item-id={itemId} style={{
        padding: '18px 24px', border: '1px solid var(--settings-border)',
        background: 'var(--settings-sidebar-bg)', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
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

const SidebarItem = ({  icon: Icon, label, active, onClick }) => (
    <button 
        className={`settings-sidebar__item ${active ? 'active' : ''}`} 
        onClick={onClick}
    >
        <Icon size={18} strokeWidth={active ? 2.5 : 2} />
        <span style={{ flex: 1 }}>{label}</span>
        {active && <ChevronRight size={14} style={{ opacity: 0.5 }} />}
    </button>
);

const SettingsNavGroup = ({ label, children }) => (
    <section className="settings-sidebar-group" aria-label={label}>
        <h3 className="settings-sidebar-group__title gnosi-sidebar-section-title">{label}</h3>
        {children}
    </section>
);

export function GlobalSettingsModal({ isOpen, onClose, initialTab = 'general', initialPluginId = null, sidebarNavigation = null }) {
    const { t, i18n } = useTranslation();
    const { role } = useApi();
    const tn = useCallback((k, opts) => t('settings.' + k, opts), [t]);
    
    // -- UNIFIED DRAFT STATE --
    const [draft, setDraft] = useState({
        settings: {
            user_name: '', workspace_name: '', gnosi_mode: 'personal',
            org_user: '', org_password: '', org_workspace: '',
            language: 'ca', week_start: 1, currency: 'EUR (€)', decimal_symbol: ',', date_format: 'locale',
            theme: 'system', reduce_animations: false,
            reader: { podcast: { provider: '', model: '' } }
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

    const [activeTab, setActiveTab] = useState(
        initialTab === 'newsletters' ? 'reader' : initialTab,
    );
    const [readerSection, setReaderSection] = useState(
        initialTab === 'newsletters' ? 'subscriptions' : 'podcast',
    );
    const [aiSection, setAiSection] = useState('agents');
    const [generalSection, setGeneralSection] = useState('system');
    const [mailSection, setMailSection] = useState('accounts');
    const [graphSection, setGraphSection] = useState('engine');
    const [socialSection, setSocialSection] = useState('networks');
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(
        () => ['api', 'plugins'].includes(initialTab) || Boolean(initialPluginId)
    );

    useEffect(() => {
        if (!isOpen) return;
        const requestedTab = initialTab === 'newsletters' ? 'reader' : initialTab;
        setActiveTab(requestedTab);
        if (initialTab === 'newsletters') setReaderSection('subscriptions');
        if (['api', 'plugins'].includes(requestedTab) || initialPluginId) {
            setIsAdvancedOpen(true);
        }
    }, [initialPluginId, initialTab, isOpen]);

    const aiResources = useAIResources(isOpen && activeTab === 'ai');
    const [integrations, setIntegrations] = useState({ calendars: [], contacts: [], mail_accounts: [] });
    // Prevent autosave until every request that hydrates the unified draft has
    // settled. Saving a partially hydrated draft can remove protected agents or
    // overwrite identity/integration data with the initial empty values.
    const configLoadedRef = useRef(false);
    const aiCatalogLoadedRef = useRef(false);
    const integrationsLoadedRef = useRef(false);
    const identityLoadedRef = useRef(false);
    const hydrationGenerationRef = useRef(0);
    const [googleSubCalendars, setGoogleSubCalendars] = useState([]);
    const [databases, setDatabases] = useState([]);
    const [tables, setTables] = useState([]);
    // Graph nodes (lazy-loaded) to derive the actual options for the fields
    // of list type in the "Fixed value / default" control on the graph tab.
    const [graphNodes, setGraphNodes] = useState(null);
    const [graphNodesLoading, setGraphNodesLoading] = useState(false);
    const graphNodesFetchedRef = useRef(false);
    // Configured model registry (GET /api/ai/models) — the enabled models the
    // user activated through the comparison workflow. Agent creation chooses
    // from this, NOT the full catalog: an agent runs on a configured model.
    const [aiRegistry, setAiRegistry] = useState([]);
    const [aiUsage, setAiUsage] = useState(null);
    const [isUsageHistoryOpen, setIsUsageHistoryOpen] = useState(false);
    const [monthlyCostCap, setMonthlyCostCap] = useState('');
    const [enforceBlock, setEnforceBlock] = useState(false);
    const [savingBudget, setSavingBudget] = useState(false);
    const podcastProvider = draft.settings?.reader?.podcast?.provider || '';
    const podcastModelId = draft.settings?.reader?.podcast?.model || '';
    const podcastModelRoutes = useMemo(
        () => groupEnabledModelRoutes(aiRegistry, {
            provider: podcastProvider,
            model: podcastModelId,
        }),
        [aiRegistry, podcastProvider, podcastModelId],
    );
    const [isSaving, setIsSaving] = useState(false);

    // Translate-row skill: DeepL key lives in the Keychain (`/api/credentials/`),
    // the Softcatalà URL in Gnosi's local `.env` (it isn't secret). The bind is
    // separate because they use different endpoints with different semantics.
    const [translateState, setTranslateState] = useState({
        deepl_has_value: false,    // GET /api/credentials/deepl_api_key.has_value
        deepl_input: '',           // new value pending save (never pre-populated)
        softcatala_url: '',        // current value of SOFTCATALA_API_URL in local .env
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
        transportFetch('/api/graph')
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
                    return <span style={{ ...baseStyle, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center' }}>{t('common.loading', 'Carregant…')}</span>;
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
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{checked ? t('common.yes', 'Sí') : '—'}</span>
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
    const [, setGoogleAuthConfigured] = useState(false);
    // True if /api/calendar/calendars returns the X-Calendar-Auth-Error header
    // (Google token expired/revoked) → we show a reconnection warning.
    const [googleCalAuthError, setGoogleCalAuthError] = useState(false);

    // Inline AI collection editors
    const [editingAgent, setEditingAgent] = useState(null);
    const [agentEditorTarget, setAgentEditorTarget] = useState(null);
    const [isModelComparisonOpen, setIsModelComparisonOpen] = useState(false);

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
    const [accountEditorTarget, setAccountEditorTarget] = useState(null);
    const [tableColorEditorTarget, setTableColorEditorTarget] = useState(null);
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
    const [snippetEditorTarget, setSnippetEditorTarget] = useState(null);

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
            const [networks, streams] = await Promise.all([
                fetchSocialNetworks(),
                fetchSocialStreams(),
            ]);
            setSocialNetworks(networks);
            setSocialStreams(streams);
        } catch { /* silent */ }
    };

    const saveSocialNetworks = async (updated) => {
        // Update optimistic; rollback si la xarxa falla.
        const previous = socialNetworks;
        setSocialNetworks(updated);
        try {
            await updateSocialNetworks(updated);
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
            await updateSocialStreams(updated);
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
    const [, setSavingStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
    const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });
    const [isAddingTable, setIsAddingTable] = useState(false);
    const [editingTableColor, setEditingTableColor] = useState(null); // { id, name, color }

    // Inline editors belong to their Settings section. Account identifiers can
    // be shared by Calendar, Contacts, and Mail, so retaining an editor while
    // switching tabs can incorrectly mark the first matching row as active.
    useEffect(() => {
        setEditingAgent(null);
        setAgentEditorTarget(null);
        setEditingAccountId(null);
        setAccountEditorTarget(null);
        setEditingTableColor(null);
        setTableColorEditorTarget(null);
        setEditingSnippetId(null);
        setSnippetEditorTarget(null);
        setAddAccountType(null);
        setIsAddingTable(false);
    }, [activeTab]);
    const [isDatabasesExpanded, setIsDatabasesExpanded] = useState(true);
    const [isSystemEntitiesExpanded, setIsSystemEntitiesExpanded] = useState(true);

    useEffect(() => {
        if (isOpen) {
            const hydrationGeneration = ++hydrationGenerationRef.current;
            configLoadedRef.current = false;
            aiCatalogLoadedRef.current = false;
            integrationsLoadedRef.current = false;
            identityLoadedRef.current = false;
            lastSavedData.current = null; // Reset baseline to avoid spurious saves
            loadConfig(hydrationGeneration);
            loadAiCatalog(hydrationGeneration);
            loadAiRegistry();
            loadTablesAndDatabases();
            loadIntegrations(hydrationGeneration);
            loadNewsletterSources();
            loadNewsletterAccount();
            checkGoogleAuth();
            loadIdentity(hydrationGeneration);
            loadSocialSettings();
        }
    }, [isOpen]);

    const loadIdentity = async (hydrationGeneration = null) => {
        try {
            const res = await axios.get('/api/identity');
            if (res.data) {
                setDraft(prev => ({ ...prev, identity: { ...prev.identity, ...res.data } }));
            }
        } catch (error) {
            console.error("Error loading identity:", error);
        } finally {
            if (
                hydrationGeneration === null
                || hydrationGeneration === hydrationGenerationRef.current
            ) {
                identityLoadedRef.current = true;
            }
        }
    };

    useEffect(() => {
        if (activeTab === 'calendar' && isOpen) {
            transportFetch('/api/calendar/calendars')
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
    // reflectir canvis fets via ajustos segurs o edicions locals externes.
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
        } catch (error) {
            console.error('Error saving DeepL API key:', error);
            toast.error(t('translate_settings.deepl_save_error', "No s'ha pogut desar la clau de DeepL."));
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
        } catch (error) {
            console.error('Error deleting DeepL API key:', error);
            toast.error(t('translate_settings.deepl_delete_error', "No s'ha pogut eliminar la clau de DeepL."));
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
        } catch (error) {
            console.error('Error saving Softcatalà URL:', error);
            toast.error(t('translate_settings.softcatala_save_error', "No s'ha pogut desar la URL de Softcatalà."));
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
                const r = await transportFetch(`/api/mail/counts?email=${encodeURIComponent(email)}`);
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
    const childModalOpen = pickerOpen || confirmConfig.isOpen || isModelComparisonOpen;

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

            // Canvis newsletter POP3
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
                            updateNewsletterAccount(next)
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
            // Inline editors are scoped to an open Settings session. Leaving
            // one selected after closing makes its row look active when the
            // modal is opened again, even though its portal target is gone.
            setEditingAgent(null);
            setAgentEditorTarget(null);
            setEditingAccountId(null);
            setAccountEditorTarget(null);
            setEditingTableColor(null);
            setTableColorEditorTarget(null);
            setEditingSnippetId(null);
            setSnippetEditorTarget(null);
            setAddAccountType(null);
            setIsAddingTable(false);
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
            const res = await transportFetch('/api/auth/google/status');
            if (res.ok) {
                const data = await res.json();
                setGoogleAuthConfigured(data.configured);
            }
        } catch (err) { console.error("Error checking Google Auth:", err); }
    };

    const loadConfig = async (hydrationGeneration = null) => {
        try {
            const res = await transportFetch('/api/config');
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
        } catch (err) {
            console.error("Error loading config:", err);
        } finally {
            if (
                hydrationGeneration === null
                || hydrationGeneration === hydrationGenerationRef.current
            ) {
                configLoadedRef.current = true;
            }
        }
    };

    const loadIntegrations = async (hydrationGeneration = null) => {
        try {
            const res = await transportFetch(`/api/integrations?t=${Date.now()}`);
            if (res.ok) {
                const data = await res.json();
                setIntegrations(data);
            }
        } catch (err) {
            console.error("Error loading integrations:", err);
        } finally {
            if (
                hydrationGeneration === null
                || hydrationGeneration === hydrationGenerationRef.current
            ) {
                integrationsLoadedRef.current = true;
            }
        }
    };

    const loadAiCatalog = async (hydrationGeneration = null) => {
        try {
            const res = await transportFetch('/api/ai/catalog');
            if (res.ok) {
                const payload = await res.json();
                if (payload?.config?.providers) {
                    setDraft(prev => ({
                        ...prev,
                        ai: { ...prev.ai, providers: payload.config.providers }
                    }));
                }
            }
        } catch (err) {
            console.error("Error loading AI catalog:", err);
        } finally {
            if (
                hydrationGeneration === null
                || hydrationGeneration === hydrationGenerationRef.current
            ) {
                aiCatalogLoadedRef.current = true;
            }
        }
    };

    const loadAiRegistry = async () => {
        // Feeds the agent-creation model dropdown. Only enabled rows: a disabled
        // model in the registry is not a valid target for a new agent.
        try {
            const [modelsRes, comparisonRes, usageRes] = await Promise.all([
                transportFetch('/api/ai/models'),
                transportFetch('/api/ai/model-comparison'),
                transportFetch('/api/ai/usage')
            ]);
            
            if (modelsRes.ok) {
                const payload = await modelsRes.json();
                let comparisonModels = [];
                if (comparisonRes.ok) {
                    const comparisonPayload = await comparisonRes.json();
                    comparisonModels = comparisonPayload.models || [];
                }

                let usageModels = [];
                if (usageRes.ok) {
                    const usageData = await usageRes.json();
                    setAiUsage(usageData);
                    setMonthlyCostCap(usageData?.cap_ccy !== null && usageData?.cap_ccy !== undefined ? usageData.cap_ccy : (usageData?.budget?.monthly_cost_cap ?? ''));
                    setEnforceBlock(Boolean(usageData?.budget?.enforce_block));
                    usageModels = usageData?.per_model || [];
                }

                const configuredMap = new Map();
                for (const modelEntry of (payload?.configured_models || [])) {
                    if (modelEntry?.model_id) {
                        configuredMap.set(`${modelEntry.provider}:${modelEntry.model_id}`, modelEntry);
                    }
                }

                for (const u of usageModels) {
                    const key = `${u.provider}:${u.model_id}`;
                    if (!configuredMap.has(key) && (u.in > 0 || u.out > 0 || u.cost_usd > 0)) {
                        configuredMap.set(key, {
                            provider: u.provider,
                            model_id: u.model_id,
                            enabled: false,
                            cost_in: 0,
                            cost_out: 0,
                        });
                    }
                }

                const configured = [];
                for (const configuredModel of configuredMap.values()) {
                    const matched = comparisonModels.find(cm => registryEntryMatchesModel(configuredModel, cm));
                    const costIn = (matched && matched.input_price !== undefined && matched.input_price !== null)
                        ? Number(matched.input_price)
                        : Number(configuredModel.cost_in || 0);
                    const costOut = (matched && matched.output_price !== undefined && matched.output_price !== null)
                        ? Number(matched.output_price)
                        : Number(configuredModel.cost_out || 0);
                    const isFree = Boolean(configuredModel.is_local) || Boolean(matched?.is_free) || (costIn === 0 && costOut === 0);

                    const usage = usageModels.find(
                        u => u.provider === configuredModel.provider && u.model_id === configuredModel.model_id
                    );
                    const hasUsage = usage && (usage.in > 0 || usage.out > 0 || usage.cost_usd > 0);

                    if (configuredModel.enabled !== false || hasUsage) {
                        configured.push({
                            ...configuredModel,
                            name: matched?.name || configuredModel.model_id,
                            creator: matched?.creator || configuredModel.provider || '',
                            profile: matched?.profile || 'unrated',
                            cost_in: costIn,
                            cost_out: costOut,
                            is_free: isFree,
                        });
                    }
                }
                
                setAiRegistry(configured);
            }
        } catch (err) { console.error("Error loading AI model registry:", err); }
    };

    const saveAiBudget = async (newCap, newEnforceBlock) => {
        setSavingBudget(true);
        try {
            const modelsRes = await transportFetch('/api/ai/models');
            let currentModels = [];
            let currentBudget = {};
            if (modelsRes.ok) {
                const payload = await modelsRes.json();
                // Preserve capability, context, and quality metadata. The
                // budget control changes policy only; reducing each row to an
                // identity used to rewrite tool-capable models as tool-less.
                currentModels = payload?.configured_models || [];
                currentBudget = payload?.budget || {};
            }
            
            const updatedBudget = {
                ...currentBudget,
                monthly_cost_cap: newCap !== '' ? parseFloat(newCap) : 0,
                enforce_block: Boolean(newEnforceBlock)
            };

            const response = await transportFetch('/api/ai/models', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ models: currentModels, budget: updatedBudget }),
            });

            if (!response.ok) {
                throw new Error('Save failed');
            }

            const uRes = await transportFetch('/api/ai/usage');
            if (uRes.ok) setAiUsage(await uRes.json());
            window.dispatchEvent(new CustomEvent('gnosi-ai-models-changed', {
                detail: { source: 'budget-settings' },
            }));
        } catch (err) {
            console.error('Error saving AI budget:', err);
            toast.error(t('settings.ai.budget_save_error', 'Error en desar el límit de pressupost'));
        } finally {
            setSavingBudget(false);
        }
    };

    useEffect(() => {
        if (!isOpen) return undefined;
        const reloadAiRegistry = () => {
            void loadAiRegistry();
        };
        window.addEventListener('gnosi-ai-models-changed', reloadAiRegistry);
        return () => {
            window.removeEventListener('gnosi-ai-models-changed', reloadAiRegistry);
        };
    }, [isOpen]);

    const loadTablesAndDatabases = async () => {
        // Vault Tables and Databases — used by the Calendar
        // (table selection) and Databases tabs. They used to be loaded inside
        // loadZoteroData, removed when the Zotero integration was taken out of Settings.
        try {
            const res = await transportFetch('/api/vault/tables');
            if (res.ok) setTables(await res.json());
        } catch (e) { console.error("Tables fetch error:", e); }
        try {
            const res = await transportFetch('/api/vault/databases');
            if (res.ok) setDatabases(await res.json());
        } catch (e) { console.error("Databases fetch error:", e); }
    };

    const loadNewsletterSources = async () => {
        setNewsletterSourcesLoading(true);
        setNewsletterSourcesError('');
        try {
            const sources = await fetchReaderSources();
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
            const data = await fetchNewsletterAccount();
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
            await updateNewsletterAccount(payload);
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
            const data = await requestNewsletterTest(payload);
            setNewsletterAccountStatus(data.message || '');
        } catch (error) {
            setNewsletterAccountStatus(error instanceof Error
                ? error.message
                : t('subs_news_status_test_error'));
        } finally {
            setNewsletterAccountTesting(false);
        }
    };

    const syncNewsletterAccount = async () => {
        setNewsletterAccountSyncing(true);
        setNewsletterAccountStatus(t('subs_news_status_syncing'));
        try {
            const data = await requestNewsletterSync();
            setNewsletterAccountStatus(data.message || t('subs_news_status_sync_started'));
            await loadNewsletterSources();
        } catch (error) {
            setNewsletterAccountStatus(error instanceof Error
                ? error.message
                : t('subs_news_status_sync_conn_error'));
        } finally {
            setNewsletterAccountSyncing(false);
        }
    };


    // -- UNIFIED SAVE LOGIC --
    const triggerAutoSave = async () => {
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

        // The draft is hydrated by independent requests. Treat their completion
        // as one initialization gate so the first autosave pass only records a
        // complete baseline and never persists initial placeholder values.
        if (
            !configLoadedRef.current
            || !aiCatalogLoadedRef.current
            || !integrationsLoadedRef.current
            || !identityLoadedRef.current
        ) {
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
                // Aggressive removal of ALL lists from the object
                Object.keys(updatedIntegrations).forEach(key => {
                    if (Array.isArray(updatedIntegrations[key])) {
                        updatedIntegrations[key] = updatedIntegrations[key].filter(a => (a.id !== accountId && a.email !== accountId));
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

    const handleDeleteAIAgent = (agent) => {
        setConfirmConfig({
            isOpen: true,
            title: tn('ai.delete_agent_title'),
            message: tn('ai.delete_agent_msg', { name: agent.name }),
            onConfirm: () => {
                setDraft(prev => ({
                    ...prev,
                    ai: {
                        ...prev.ai,
                        agents: prev.ai.agents.filter(item => item.id !== agent.id)
                    }
                }));
                setEditingAgent(current => current?.id === agent.id ? null : current);
                setConfirmConfig(prev => ({ ...prev, isOpen: false }));
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
            await createReaderSource({
                name: newsletterName || finalUrl,
                url: finalUrl,
                type: newsletterType,
            });
            setNewsletterName(''); setNewsletterAddress(''); loadNewsletterSources();
            setNewsletterStatus(newsletterType === 'youtube' && finalUrl !== newsletterAddress.trim()
                ? t('subs_form_status_youtube_converted', { url: finalUrl })
                : t('subs_form_status_added'));
        } catch (error) {
            setNewsletterStatus(error instanceof Error ? error.message : t('subs_form_status_error'));
        }
    };

    const handleNewsletterOpmlUpload = async (file) => {
        if (!file) return;

        setNewsletterOpmlLoading(true);
        setNewsletterStatus(t('subs_opml_status_importing'));

        try {
            const data = await importReaderOpml(file);
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
            <div
                ref={panelRef}
                className={`settings-modal ${isOpen ? 'active' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-modal-title"
            >
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
                                <h2 id="settings-modal-title" className="settings-sidebar-title">{t('settings.title')}</h2>
                            </div>
                            
                        </div>

                        <div className="settings-sidebar-nav">
                            <SettingsNavGroup label={t('settings.navigation.basic')}>
                                <SidebarItem id="general" icon={SettingsIcon} label={t('settings.tabs.general') || 'General'} active={activeTab === 'general'} onClick={() => { setActiveTab('general'); setAddAccountType(null); }} />
                                <SidebarItem id="appearance" icon={Palette} label={t('settings.tabs.appearance') || 'Aparença'} active={activeTab === 'appearance'} onClick={() => { setActiveTab('appearance'); setAddAccountType(null); }} />
                                {sidebarNavigation && <SidebarItem id="menu" icon={LucideIcons.PanelLeft} label={t('settings.tabs.menu', 'Menú')} active={activeTab === 'menu'} onClick={() => { setActiveTab('menu'); setAddAccountType(null); }} />}
                                <SidebarItem id="language" icon={Globe} label={t('settings.tabs.language') || 'Idioma i Regió'} active={activeTab === 'language'} onClick={() => { setActiveTab('language'); setAddAccountType(null); }} />
                                <SidebarItem id="profile" icon={User} label={t('settings.tabs.profile') || 'Perfil'} active={activeTab === 'profile'} onClick={() => { setActiveTab('profile'); setAddAccountType(null); }} />
                                <SidebarItem id="account" icon={LucideIcons.UserCog} label={t('settings.tabs.account', 'Compte')} active={activeTab === 'account'} onClick={() => { setActiveTab('account'); setAddAccountType(null); }} />
                                <SidebarItem id="workspace" icon={Users} label={t('settings.tabs.workspace') || 'Workspace'} active={activeTab === 'workspace'} onClick={() => { setActiveTab('workspace'); setAddAccountType(null); }} />
                            </SettingsNavGroup>

                            <SettingsNavGroup label={t('settings.navigation.connections')}>
                                <SidebarItem id="calendar" icon={Calendar} label={t('settings.tabs.calendar') || 'Calendari'} active={activeTab === 'calendar'} onClick={() => { setActiveTab('calendar'); setAddAccountType(null); }} />
                                <SidebarItem id="contacts" icon={Users} label={t('settings.tabs.contacts') || 'Contactes'} active={activeTab === 'contacts'} onClick={() => { setActiveTab('contacts'); setAddAccountType(null); }} />
                                <SidebarItem id="mail" icon={Mail} label={t('settings.tabs.mail_accounts') || 'Correu'} active={activeTab === 'mail'} onClick={() => { setActiveTab('mail'); setAddAccountType(null); }} />
                                <SidebarItem id="reader" icon={Newspaper} label={t('settings.tabs.reader')} active={activeTab === 'reader'} onClick={() => { setActiveTab('reader'); setAddAccountType(null); }} />
                                <SidebarItem id="social" icon={Share2} label={t('settings.tabs.social') || 'Social'} active={activeTab === 'social'} onClick={() => { setActiveTab('social'); setAddAccountType(null); }} />
                                <SidebarItem id="notion" icon={Database} label={t('settings.tabs.notion') || 'Importar Notion'} active={activeTab === 'notion'} onClick={() => { setActiveTab('notion'); setAddAccountType(null); }} />
                            </SettingsNavGroup>

                            <SettingsNavGroup label={t('settings.navigation.knowledge')}>
                                <SidebarItem id="references" icon={BookOpen} label={t('settings.tabs.references') || 'Referències'} active={activeTab === 'references'} onClick={() => { setActiveTab('references'); setAddAccountType(null); }} />
                                <SidebarItem id="graph" icon={Share2} label={t('settings.tabs.graph') || 'Grafe'} active={activeTab === 'graph'} onClick={() => { setActiveTab('graph'); setAddAccountType(null); }} />
                                <SidebarItem id="ai" icon={Cpu} label={t('settings.tabs.ai') || 'IA i Agents'} active={activeTab === 'ai'} onClick={() => { setActiveTab('ai'); setAddAccountType(null); }} />
                                <SidebarItem id="translate" icon={Languages} label={t('settings.tabs.translate') || 'Traducció'} active={activeTab === 'translate'} onClick={() => { setActiveTab('translate'); setAddAccountType(null); }} />
                            </SettingsNavGroup>

                            <section className="settings-sidebar-group settings-sidebar-group--advanced">
                                <button
                                    type="button"
                                    className="settings-sidebar-group__toggle gnosi-sidebar-section-title"
                                    aria-expanded={isAdvancedOpen}
                                    onClick={() => setIsAdvancedOpen(isOpen => !isOpen)}
                                >
                                    <span>{t('settings.navigation.advanced')}</span>
                                    {isAdvancedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </button>
                                {isAdvancedOpen && (
                                    <div className="settings-sidebar-group__content">
                                        <SidebarItem id="plugins" icon={LucideIcons.Puzzle} label={t('settings.tabs.plugins', 'Plugins')} active={activeTab === 'plugins'} onClick={() => { setActiveTab('plugins'); setAddAccountType(null); }} />
                                        <SidebarItem id="api" icon={LucideIcons.KeyRound} label={t('settings.tabs.api', { defaultValue: 'API i tokens' })} active={activeTab === 'api'} onClick={() => { setActiveTab('api'); setAddAccountType(null); }} />
                                    </div>
                                )}
                            </section>
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

                             {activeTab === 'menu' && sidebarNavigation && (
                                <div className="animate-in">
                                    <AppSidebarSettings {...sidebarNavigation} />
                                </div>
                             )}

                            {/* GENERAL */}
                            {activeTab === 'general' && (
                                <>
                                <SettingsSectionTabs
                                    ariaLabel={tn('general.sections_label')}
                                    activeId={generalSection}
                                    onChange={setGeneralSection}
                                    items={[
                                        { id: 'system', icon: SettingsIcon, label: tn('general.system_title') },
                                        { id: 'files', icon: FolderOpen, label: tn('general.files_structure') },
                                    ]}
                                />
                                {generalSection === 'system' && (
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

                                </Section>
                                )}
                                {generalSection === 'files' && (
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
                                )}
                                </>
                            )}

                            {/* WORKSPACE — member management and vault access */}
                            {activeTab === 'workspace' && (
                                <Section
                                    title={t('settings.tabs.workspace') || 'Workspace'}
                                    icon={Users}
                                >
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '16px', lineHeight: 1.5 }}>
                                        {t('settings.workspace.intro', {
                                            defaultValue: 'Gestiona membres, rols i accés a vaults del workspace actiu. Aquesta secció existeix per a cooperatives, equips de recerca i col·lectius que comparteixen una mateixa instància de Gnosi. La col·laboració en temps real està en desenvolupament — vegis la directiva collaboration_proposal.md.',
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
                                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 0 }}>
                                            {t('literature.settings.references_moved')}
                                        </p>
                                        <button
                                            type="button"
                                            className="btn-gnosi btn-gnosi-primary"
                                            onClick={() => {
                                                window.sessionStorage.setItem('gnosi:configure-plugin', 'resources');
                                                setIsAdvancedOpen(true);
                                                setActiveTab('plugins');
                                            }}
                                        >
                                            {t('literature.settings.open_resources_plugin')}
                                        </button>
                                    </div>
                                </Section>
                            )}

                            {/* LANGUAGE AND REGION */}
                            {activeTab === 'language' && (
                                <Section title={tn('language.section_title')} icon={Globe}>
                                    <FormGroup label={tn('language.select_language')} description={tn('language.select_language_desc')}>
                                        <select className="gnosi-select" value={resolveLocale(draft.settings.language)} onChange={e => {
                                            const code = e.target.value;
                                            setDraft({...draft, settings: {...draft.settings, language: code}});
                                            i18n.changeLanguage(code);
                                        }}>
                                            {availableLocales.map(locale => (
                                                <option key={locale.code} value={locale.code}>{locale.nativeName}</option>
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
                                            <button key={opt.id} className={`settings-hover-card ${draft.settings.theme === opt.id ? 'is-selected' : ''}`} onClick={() => {
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

                                    <div className="settings-hover-card" style={{ background: 'var(--settings-sidebar-bg)', padding: '32px', borderRadius: '28px', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 10px 30px rgba(0,0,0,0.03)' }}>
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

                                    <div className="settings-hover-card" style={{ background: 'var(--settings-sidebar-bg)', padding: '32px', borderRadius: '28px', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 10px 30px rgba(0,0,0,0.03)', marginTop: '20px' }}>
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
                                                try { localStorage.setItem('gnosi_mail_dark_body', next ? '1' : '0'); } catch {
                                                    // Storage can be unavailable in restricted browser contexts.
                                                }
                                                try { window.dispatchEvent(new Event('gnosi-mail-dark-body-changed')); } catch {
                                                    // The event target may be unavailable while the modal unmounts.
                                                }
                                            }}
                                        />
                                    </div>
                                </Section>
                            )}

                            {/* Warning: Google token expired (calendars won't load) */}
                            {activeTab === 'calendar' && googleCalAuthError && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', marginBottom: '16px', borderRadius: '14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', flex: 1 }}>
                                        {t('settings.calendar.google_token_expired') || "El token de Google ha caducat o s'ha revocat. Reconnecta el compte per tornar a carregar els calendaris."}
                                    </div>
                                    <button
                                        onClick={() => { window.location.href = '/api/auth/google/login?type=calendar'; }}
                                        style={{ padding: '8px 16px', fontSize: '0.82rem', borderRadius: '10px', border: 'none', background: '#4285f4', color: 'white', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                                    >
                                        {t('settings.calendar.reconnect_google') || 'Reconnecta Google'}
                                    </button>
                                </div>
                            )}

                            {activeTab === 'mail' && (
                                <SettingsSectionTabs
                                    ariaLabel={tn('mail_accounts.sections_label')}
                                    activeId={mailSection}
                                    onChange={setMailSection}
                                    items={[
                                        { id: 'accounts', icon: Mail, label: tn('mail_accounts.title') },
                                        { id: 'snippets', icon: FileText, label: tn('snippets.title') },
                                    ]}
                                />
                            )}

                            {/* CALENDAR, CONTACTS, MAIL */}
                            {(activeTab === 'calendar' || activeTab === 'contacts' || (activeTab === 'mail' && mailSection === 'accounts')) && (
                                <Section 
                                    title={activeTab === 'calendar' ? tn('calendar.manage_title') : (activeTab === 'contacts' ? tn('contacts.sync_section_title') : tn('mail_accounts.title'))} 
                                    icon={activeTab === 'calendar' ? Calendar : (activeTab === 'contacts' ? Users : Mail)}
                                    extra={
                                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                            <div style={{ position: 'relative' }}>
                                                <button 
                                                    onClick={() => {
                                                        setEditingAccountId(null);
                                                        setAddAccountEmail('');
                                                        setAddAccountEmailBlurred(false);
                                                        setManualServer('');
                                                        setManualPassword('');
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
                                                        zIndex: 'var(--z-modal-dropdown)', width: '220px', overflow: 'hidden', padding: '6px'
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
                                            <InlineEditorPlacement
                                                target={editingAccountId ? accountEditorTarget : null}
                                                waitForTarget={Boolean(editingAccountId)}
                                            >
                                                <div
                                                    className={`settings-inline-editor animate-in ${editingAccountId ? 'is-attached' : 'is-create'}`}
                                                    data-settings-editor-for={editingAccountId ? `account:${editingAccountId}` : 'account:new'}
                                                >
                                                {!editingAccountId && (
                                                <div className="settings-inline-editor-title">
                                                    <span>{tn('accounts.account_config')}</span>
                                                    <button onClick={() => { setAddAccountType(null); setAddAccountEmail(''); setAddAccountEmailBlurred(false); setIsManualGoogle(false); setManualServer(''); setManualPassword(''); setEditingAccountId(null); }} aria-label={t('settings.footer.close')} title={t('settings.footer.close')} className="icon-btn hover-bg-strong" style={{ padding: '8px', borderRadius: '12px' }}><X size={18} /></button>
                                                </div>
                                                )}
                                                
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
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', background: 'var(--settings-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
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
                                                            </div>

                                                            {/* SMTP SECTION */}
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', background: 'var(--settings-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
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
                                                            </div>

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
                                                                    <input type="text" className="gnosi-input" value={mailCertificate} onChange={e => setMailCertificate(e.target.value)} placeholder={t('settings.accounts.certificate_placeholder', '/ruta/al/certificat.crt')} />
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
                                            </InlineEditorPlacement>
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
                                                    <div className="settings-configurable-list" style={{ '--settings-configurable-gap': '12px' }}>
                                                        {/* External Accounts / Integrations */}
                                                        {uniqueAccounts.map((acc, idx) => {
                                                            const accountItemId = acc.id || acc.email || acc.username || `account-${idx}`;
                                                            return (
                                                                <React.Fragment key={`acc-${accountItemId}`}>
                                                                    <AccountRow
                                                                        itemId={`account:${accountItemId}`}
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
                                                                        isEditing={editingAccountId === acc.id}
                                                                        onEdit={() => handleEditAccount(activeTab, acc)}
                                                                        onDelete={() => handleDeleteAccount(activeTab, acc.id)}
                                                                        color={activeTab === 'calendar' ? '#3b82f6' : (activeTab === 'contacts' ? '#10b981' : '#f59e0b')}
                                                                    />
                                                                    {editingAccountId === acc.id && (
                                                                        <div
                                                                            ref={setAccountEditorTarget}
                                                                            data-settings-editor-anchor-for={`account:${accountItemId}`}
                                                                        />
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                        
                                                        {/* Vault tables (Calendar only) */}
                                                        {vaultCalendars.map((tbl, idx) => {
                                                            const tblColor = integrations.calendar_colors?.[tbl.id] || integrations.calendar_colors?.[`${tbl.name}`] || '#6366f1';
                                                            return (
                                                                <React.Fragment key={`vault-${tbl.id || idx}`}>
                                                                    <AccountRow
                                                                        itemId={`vault-calendar:${tbl.id}`}
                                                                        name={tbl.name}
                                                                        description={tn('accounts.vault_table')}
                                                                        status="connected"
                                                                        type="calendar"
                                                                        provider="vault"
                                                                        isEditing={editingTableColor?.id === tbl.id}
                                                                        onEdit={() => setEditingTableColor({ id: tbl.id, name: tbl.name, color: tblColor })}
                                                                        onDelete={() => {
                                                                            const newList = integrations.vault_calendar?.enabled_tables?.filter(id => id !== tbl.id) || [];
                                                                            const updated = { ...integrations, vault_calendar: { ...integrations.vault_calendar, enabled_tables: newList } };
                                                                            setIntegrations(updated);
                                                                            axios.post('/api/integrations/bulk', updated).catch(console.error);
                                                                        }}
                                                                        color={tblColor}
                                                                    />
                                                                    {editingTableColor?.id === tbl.id && (
                                                                        <div
                                                                            ref={setTableColorEditorTarget}
                                                                            data-settings-editor-anchor-for={`vault-calendar:${tbl.id}`}
                                                                        />
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        })}

                                                        {/* Inline color editor for the selected vault calendar */}
                                                        {editingTableColor && (
                                                            <InlineEditorPlacement
                                                                target={tableColorEditorTarget}
                                                                waitForTarget
                                                            >
                                                                <div
                                                                    className="settings-inline-editor is-attached animate-in"
                                                                    data-settings-editor-for={`vault-calendar:${editingTableColor.id}`}
                                                                >
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
                                                            </InlineEditorPlacement>
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
                            {activeTab === 'mail' && mailSection === 'snippets' && (
                                <Section title={tn('snippets.title')} icon={FileText}>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                                        {tn('snippets.intro')}
                                    </p>

                                    {/* List of existing fragments */}
                                    {snippets.length > 0 && (
                                        <div className="settings-configurable-list" style={{ '--settings-configurable-gap': '8px', marginBottom: '24px' }}>
                                            {snippets.map(s => (
                                                <React.Fragment key={s.id}>
                                                    <div
                                                        className={`settings-configurable-item ${editingSnippetId === s.id ? 'is-editing' : ''}`}
                                                        data-settings-item-id={`snippet:${s.id}`}
                                                        style={{
                                                            display: 'flex', alignItems: 'flex-start', gap: '12px',
                                                            padding: '14px 16px', background: 'var(--settings-bg)',
                                                            border: '1px solid var(--settings-border)'
                                                        }}
                                                    >
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
                                                    {editingSnippetId === s.id && (
                                                        <div
                                                            ref={setSnippetEditorTarget}
                                                            data-settings-editor-anchor-for={`snippet:${s.id}`}
                                                        />
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    )}

                                    {/* Add/edit form */}
                                    <InlineEditorPlacement
                                        target={editingSnippetId ? snippetEditorTarget : null}
                                        waitForTarget={Boolean(editingSnippetId)}
                                    >
                                        <div
                                            className={`settings-inline-editor settings-inline-editor-compact ${editingSnippetId ? 'is-attached' : 'is-create'}`}
                                            data-settings-editor-for={editingSnippetId ? `snippet:${editingSnippetId}` : 'snippet:new'}
                                        >
                                        {!editingSnippetId && (
                                            <h4 className="settings-inline-editor-heading">{tn('snippets.new_snippet')}</h4>
                                        )}
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
                                    </InlineEditorPlacement>
                                </Section>
                            )}

                            {/* SOCIAL */}
                            {activeTab === 'social' && (
                                <>
                                    <SettingsSectionTabs
                                        ariaLabel={tn('social.sections_label')}
                                        activeId={socialSection}
                                        onChange={setSocialSection}
                                        items={[
                                            { id: 'networks', icon: Share2, label: tn('social.networks_title') },
                                            { id: 'streams', icon: Rss, label: tn('social.streams_title') },
                                        ]}
                                    />

                                    {socialSection === 'networks' && (
                                    <Section title={tn('social.networks_title')} icon={Share2}>
                                        <div className="settings-configurable-list" style={{ '--settings-configurable-gap': '10px' }}>
                                            {socialNetworks.map(net => (
                                                <div
                                                    key={net.id}
                                                    className="settings-configurable-item"
                                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'var(--settings-sidebar-bg)', borderRadius: '14px', border: '1px solid var(--settings-border)' }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        {isKnownSocialNetwork(net.id)
                                                            ? <SocialNetworkIcon network={net.id} size={26} />
                                                            : <span aria-hidden="true" style={{ fontSize: '1.4rem' }}>{net.icon}</span>}
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
                                    )}

                                    {socialSection === 'streams' && (
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
                                        <div className="settings-configurable-list" style={{ '--settings-configurable-gap': '8px' }}>
                                            {socialStreams.length === 0 && (
                                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', padding: '20px', textAlign: 'center' }}>
                                                    {tn('social.no_streams')}
                                                </div>
                                            )}
                                            {socialStreams.map(stream => (
                                                <div key={stream.id} className="settings-configurable-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--settings-sidebar-bg)', borderRadius: '12px', border: '1px solid var(--settings-border)' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        {isKnownSocialNetwork(stream.network)
                                                            ? <SocialNetworkIcon network={stream.network} size={21} />
                                                            : <span style={{ fontSize: '1.2rem' }}>{stream.icon}</span>}
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
                                    )}
                                </>
                            )}

                            {/* READER */}
                            {activeTab === 'reader' && (
                                <>
                                    <SettingsSectionTabs
                                        ariaLabel={t('settings.reader.sections_label')}
                                        activeId={readerSection}
                                        onChange={setReaderSection}
                                        items={[
                                            { id: 'podcast', icon: Newspaper, label: t('settings.reader.podcast_tab') },
                                            { id: 'subscriptions', icon: Rss, label: t('settings.reader.subscriptions_tab') },
                                        ]}
                                    />

                                    {readerSection === 'podcast' && (
                                    <Section title={t('settings.reader.podcast_title')} icon={Newspaper}>
                                    <div className="settings-desc" style={{ marginBottom: '24px', lineHeight: 1.6 }}>
                                        {t('settings.reader.podcast_description')}
                                    </div>
                                    <FormGroup
                                        label={t('settings.reader.model_label')}
                                        description={t('settings.reader.model_description')}
                                    >
                                        <select
                                            className="gnosi-select"
                                            value={podcastModelRoutes.selectedKey}
                                            onChange={event => {
                                                const route = parseModelRouteKey(event.target.value);
                                                setDraft(previous => ({
                                                    ...previous,
                                                    settings: {
                                                        ...previous.settings,
                                                        reader: {
                                                            ...(previous.settings.reader || {}),
                                                            podcast: route,
                                                        },
                                                    },
                                                }));
                                            }}
                                        >
                                            <option value="">{t('settings.reader.default_model')}</option>
                                            {podcastModelRoutes.groups.map(([provider, modelIds]) => (
                                                <optgroup key={provider} label={provider}>
                                                    {modelIds.map(modelId => (
                                                        <option key={modelId} value={`${provider}||${modelId}`}>
                                                            {modelId}
                                                        </option>
                                                    ))}
                                                </optgroup>
                                            ))}
                                            {podcastModelRoutes.unavailableSelection && (
                                                <optgroup label={t('settings.reader.unavailable_group')}>
                                                    <option value={podcastModelRoutes.unavailableSelection.key}>
                                                        {t('settings.reader.unavailable_model', {
                                                            provider: podcastModelRoutes.unavailableSelection.provider,
                                                            model: podcastModelRoutes.unavailableSelection.model,
                                                        })}
                                                    </option>
                                                </optgroup>
                                            )}
                                        </select>
                                        {podcastModelRoutes.groups.length === 0 && (
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 8 }}>
                                                {t('settings.reader.no_active_models')}
                                            </div>
                                        )}
                                    </FormGroup>
                                    </Section>
                                    )}

                                    {/* SUBSCRIPTIONS — dynamic form + list */}
                                    {readerSection === 'subscriptions' && (
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
                                                                await deleteReaderSource(s.id);
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
                                </>
                            )}

                            {/* GRAF */}
                            {activeTab === 'graph' && (
                                <>
                                <SettingsSectionTabs
                                    ariaLabel={tn('graph.sections_label')}
                                    activeId={graphSection}
                                    onChange={setGraphSection}
                                    items={[
                                        { id: 'engine', icon: Share2, label: tn('graph.visual_engine') },
                                        { id: 'structures', icon: Database, label: tn('graph.visible_structures') },
                                    ]}
                                />
                                {graphSection === 'engine' && (
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
                                            <div className="settings-hover-card" style={{ marginTop: '20px', padding: '20px', background: 'var(--settings-sidebar-bg)', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
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

                                </Section>
                                )}
                                {graphSection === 'structures' && (
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
                                                                                const tableFields = sortFieldItems(table.properties || []);
                                                                                
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
                                                                                const tableFields = sortFieldItems(table.properties || []);
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
                                )}
                                </>
                            )}

                            {/* IA */}
                            {activeTab === 'ai' && (
                                <>
                                    <SettingsSectionTabs
                                        ariaLabel={t('settings.ai.resources.sections_label')}
                                        activeId={aiSection}
                                        items={[
                                            { id: 'models', icon: Activity, label: t('settings.ai.resources.models_tab') },
                                            { id: 'agents', icon: Bot, label: t('settings.ai.resources.agents_tab') },
                                            { id: 'skills', icon: Zap, label: t('settings.ai.resources.skills_tab') },
                                            { id: 'tools', icon: Sliders, label: t('settings.ai.resources.tools_tab') },
                                            { id: 'automations', icon: Clock3, label: t('settings.ai.operations.automations_tab') },
                                            { id: 'operations', icon: History, label: t('settings.ai.operations.history_tab') },
                                        ]}
                                        onChange={sectionId => {
                                            setAiSection(sectionId);
                                            setEditingAgent(null);
                                        }}
                                    />

                                    {aiSection === 'models' && <div className="ai-comparison-launcher">
                                        <div>
                                            <strong>{t('model_comparison.launch_title')}</strong>
                                            <span>{t('model_comparison.launch_description')}</span>
                                        </div>
                                        <button type="button" className="btn-gnosi btn-gnosi-primary" onClick={() => setIsModelComparisonOpen(true)}>
                                            <Activity size={18} />
                                            {t('model_comparison.open')}
                                        </button>
                                    </div>}

                                    {aiSection === 'models' && aiRegistry.length > 0 && (() => {
                                        const curSymbol = aiUsage?.currency?.symbol || '€';
                                        const curRate = aiUsage?.currency?.usd_rate || 0.86;
                                        
                                        const formatTokens = (val) => {
                                            const num = Number(val || 0);
                                            if (num <= 0) return '0';
                                            if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
                                            if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
                                            return num.toLocaleString();
                                        };

                                        const activeModelsWithCosts = aiRegistry.map(model => {
                                            const usage = (aiUsage?.per_model || []).find(
                                                u => u.provider === model.provider && u.model_id === model.model_id
                                            ) || { in: 0, out: 0, cost_usd: 0 };

                                            const isFree = Boolean(model.is_local) || Boolean(model.is_free) || (parseFloat(model.cost_in || 0) === 0 && parseFloat(model.cost_out || 0) === 0);
                                            const costInPer1M = isFree ? 0 : parseFloat(model.cost_in || 0);
                                            const costOutPer1M = isFree ? 0 : parseFloat(model.cost_out || 0);

                                            const inCostUsd = isFree ? 0 : (usage.in * costInPer1M) / 1000000;
                                            const outCostUsd = isFree ? 0 : (usage.out * costOutPer1M) / 1000000;
                                            const modelTotalCostUsd = isFree ? 0 : (inCostUsd + outCostUsd);

                                            const inCostCcy = inCostUsd * curRate;
                                            const outCostCcy = outCostUsd * curRate;
                                            const modelTotalCostCcy = modelTotalCostUsd * curRate;

                                            return {
                                                ...model,
                                                usage,
                                                isFree,
                                                inCostCcy,
                                                outCostCcy,
                                                modelTotalCostCcy
                                            };
                                        });

                                        const totalActiveCost = activeModelsWithCosts.reduce((acc, m) => acc + m.modelTotalCostCcy, 0);

                                        return (
                                            <div style={{ marginTop: '20px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                                            <strong>{t('settings.ai.monthly_consumption', 'Consum mensual per model')}</strong>
                                                        </h4>
                                                        <button
                                                            type="button"
                                                            className="btn-gnosi-secondary"
                                                            onClick={() => setIsUsageHistoryOpen(true)}
                                                            style={{ fontSize: '0.78rem', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '8px' }}
                                                        >
                                                            <History size={14} />
                                                            {t('settings.ai.view_history', 'Històric de consum')}
                                                        </button>
                                                    </div>
                                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                        {t('settings.ai.monthly_total', 'Total consum mensual')}: <strong style={{ color: 'var(--text-primary)' }}>{formatCost(totalActiveCost, curSymbol, 2)}</strong>
                                                    </span>
                                                </div>

                                                <div className="ai-resource-list" style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden', gap: 0 }}>
                                                    {activeModelsWithCosts.map((model, index) => (
                                                        <article key={model.model_id} className="ai-resource-card" style={{ border: 'none', borderRadius: 0, borderBottom: index < activeModelsWithCosts.length - 1 ? '1px solid var(--border-color)' : 'none', marginBottom: 0 }}>
                                                            <div className="ai-resource-card__main" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                                                                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                                                    <Activity size={18} style={{ marginTop: '2px' }} />
                                                                    <span className="ai-resource-card__copy">
                                                                        <span className="ai-resource-card__heading">
                                                                            <strong>{model.name || model.model_id}</strong>
                                                                            {model.enabled === false && (
                                                                                <span style={{ marginLeft: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                                                                    ({t('settings.ai.disabled_badge', 'Inactiu')})
                                                                                </span>
                                                                            )}
                                                                            {model.profile && (
                                                                                <span className={`model-profile-badge ${model.profile}`} style={{ marginLeft: '10px', fontSize: '0.8rem', padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-secondary)' }}>
                                                                                    {{
                                                                                        worker: '🟢',
                                                                                        administrative: '🔵',
                                                                                        documentalist: '📑',
                                                                                        allrounder: '🟡',
                                                                                        expert: '🟣',
                                                                                        unrated: '⚪',
                                                                                    }[model.profile] || '⚪'} {t(`model_comparison.profiles.${model.profile}`, model.profile)}
                                                                                </span>
                                                                            )}
                                                                        </span>
                                                                        <span className="ai-resource-card__meta">
                                                                            {model.provider && <span style={{ textTransform: 'capitalize' }}>{model.provider}</span>}
                                                                            <span>{model.model_id}</span>
                                                                        </span>
                                                                    </span>
                                                                </div>

                                                                <div style={{ textAlign: 'right', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                                                    <div>
                                                                        <span>{t('settings.ai.in_tokens', 'Entrada')}: <strong>{formatTokens(model.usage.in)}</strong> ({formatCost(model.inCostCcy, curSymbol, 2)})</span>
                                                                        <span style={{ margin: '0 6px' }}>•</span>
                                                                        <span>{t('settings.ai.out_tokens', 'Sortida')}: <strong>{formatTokens(model.usage.out)}</strong> ({formatCost(model.outCostCcy, curSymbol, 2)})</span>
                                                                    </div>
                                                                    <div style={{ marginTop: '3px' }}>
                                                                        <strong style={{ color: 'var(--text-primary)', fontSize: '0.88rem' }}>
                                                                            {t('settings.ai.model_total', 'Cost total')}: {formatCost(model.modelTotalCostCcy, curSymbol, 2)}
                                                                        </strong>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </article>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {aiSection === 'models' && (
                                        <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                                            <h4 style={{ marginBottom: '14px', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                                <strong>{t('settings.ai.budget_title', 'Control de despesa i consum')}</strong>
                                            </h4>

                                            {aiUsage && (
                                                <div style={{
                                                    background: 'var(--bg-secondary)',
                                                    border: '1px solid var(--border-color)',
                                                    borderRadius: '12px',
                                                    padding: '16px',
                                                    marginBottom: '16px'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                            {t('settings.ai.current_consumption', 'Consum actual del mes')} ({aiUsage.period})
                                                        </span>
                                                        <strong style={{ fontSize: '0.95rem', color: aiUsage.over_cap ? 'var(--color-danger, #ef4444)' : 'var(--text-primary)' }}>
                                                            {typeof aiUsage.spent_ccy === 'number' ? formatCost(aiUsage.spent_ccy, aiUsage.currency?.symbol || '€', 2) : `${aiUsage.spent_ccy || 0}`}
                                                            {aiUsage.cap_ccy ? ` d'un límit de ${formatCost(aiUsage.cap_ccy, aiUsage.currency?.symbol || '€', 2)}` : ''}
                                                        </strong>
                                                    </div>

                                                    {aiUsage.cap_ccy > 0 && (
                                                        <div style={{ width: '100%', height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                                                            <div style={{
                                                                width: `${Math.min(100, Math.round((aiUsage.ratio || 0) * 100))}%`,
                                                                height: '100%',
                                                                background: aiUsage.over_cap
                                                                    ? 'var(--color-danger, #ef4444)'
                                                                    : (aiUsage.ratio > 0.8 ? 'var(--color-warning, #f59e0b)' : 'var(--color-primary, #3b82f6)'),
                                                                transition: 'width 0.3s ease'
                                                            }} />
                                                        </div>
                                                    )}

                                                    {aiUsage.over_cap && (
                                                        <div style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--color-danger, #ef4444)', fontWeight: 600 }}>
                                                            ⚠️ {t('settings.ai.budget_exceeded', 'S\'ha superat el límit mensual de cost!')}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '6px' }}>
                                                        {t('settings.ai.monthly_cap_label', 'Topall mensual de cost (€ / $)')}
                                                    </label>
                                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            placeholder="0.00 (Sense límit)"
                                                            className="gnosi-input"
                                                            style={{ width: '180px' }}
                                                            value={monthlyCostCap}
                                                            onChange={(e) => setMonthlyCostCap(e.target.value)}
                                                            onBlur={() => saveAiBudget(monthlyCostCap, enforceBlock)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    e.target.blur();
                                                                }
                                                            }}
                                                        />
                                                        {savingBudget && (
                                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <Loader2 size={14} className="animate-spin" />
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginTop: '4px', display: 'block' }}>
                                                        {t('settings.ai.cap_help', 'Deixa a 0 o en blanc per no establir cap límit mensual.')}
                                                    </span>
                                                </div>

                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                                                    <div>
                                                        <strong style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                                            {t('settings.ai.enforce_block_title', 'Bloquejar l\'accés en superar el límit')}
                                                        </strong>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                            {t('settings.ai.enforce_block_desc', 'Quan es superi el topall mensual, es bloquejaran les peticions d\'IA.')}
                                                        </span>
                                                    </div>
                                                    <GnosiToggle
                                                        active={enforceBlock}
                                                        onChange={(val) => {
                                                            setEnforceBlock(val);
                                                            saveAiBudget(monthlyCostCap, val);
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {aiSection === 'models' && <div style={{ height: '30px' }} />}

                                    {aiSection === 'agents' && <Section
                                        title={tn('ai.agents_section')}
                                        icon={Bot}
                                        extra={
                                            <button
                                                className="btn-gnosi btn-gnosi-primary"
                                                onClick={() => setEditingAgent(current => current ? null : {})}
                                                style={{
                                                    padding: '10px 20px', fontSize: '0.85rem', borderRadius: '14px',
                                                    display: 'flex', alignItems: 'center', gap: '10px'
                                                }}
                                            >
                                                {editingAgent ? <X size={16} /> : <Plus size={16} />}
                                                {editingAgent ? t('common.cancel') : tn('ai.create_agent_btn')}
                                            </button>
                                        }
                                    >
                                        {editingAgent && (
                                            <InlineEditorPlacement
                                                target={editingAgent.id ? agentEditorTarget : null}
                                                waitForTarget={Boolean(editingAgent.id)}
                                            >
                                                <div data-settings-editor-for={editingAgent.id ? `agent:${editingAgent.id}` : 'agent:new'}>
                                                    <AIAgentForm
                                                        key={editingAgent.id || 'new-agent'}
                                                        agent={editingAgent}
                                                        onSave={async (newAgent) => {
                                                            const isNew = !newAgent.id;
                                                            const id = isNew ? `agent_${Date.now()}` : newAgent.id;
                                                            const agentToSave = { ...newAgent, id };
                                                            const previousSkillIds = (
                                                                draft.ai.agents.find(item => item.id === id)?.skill_ids || []
                                                            );
                                                            const nextSkillIds = agentToSave.skill_ids || [];
                                                            const skillsChanged = (
                                                                previousSkillIds.length !== nextSkillIds.length
                                                                || previousSkillIds.some(skillId => !nextSkillIds.includes(skillId))
                                                            );
                                                            if (!isNew && skillsChanged) {
                                                                try {
                                                                    agentToSave.skill_ids = await aiResources.assignAgentSkills(
                                                                        id,
                                                                        nextSkillIds,
                                                                    );
                                                                } catch (error) {
                                                                    console.error('Error assigning skills to AI agent:', error);
                                                                    toast.error(t('settings.ai.resources.assignment_error'));
                                                                    throw error;
                                                                }
                                                            }
                                                            setDraft(prev => ({
                                                                ...prev,
                                                                ai: {
                                                                    ...prev.ai,
                                                                    agents: isNew
                                                                        ? [...prev.ai.agents, agentToSave]
                                                                        : prev.ai.agents.map(a => a.id === id ? agentToSave : a)
                                                                }
                                                            }));
                                                            setEditingAgent(null);
                                                        }}
                                                        aiRegistry={aiRegistry}
                                                        skills={aiResources.skills}
                                                        tools={aiResources.tools}
                                                    />
                                                </div>
                                            </InlineEditorPlacement>
                                        )}
                                        <div className="settings-configurable-list ai-agent-list" style={{ '--settings-configurable-gap': '20px' }}>
                                            {draft.ai.agents.map(agent => (
                                                <React.Fragment key={agent.id}>
                                                <div
                                                    className={`settings-configurable-item ai-agent-row hover-scale ${editingAgent?.id === agent.id ? 'is-editing' : ''}`}
                                                    data-settings-item-id={`agent:${agent.id}`}
                                                    onClick={() => setEditingAgent(agent)}
                                                    title={tn('ai.configure_name', { name: agent.name })}
                                                    style={{
                                                    width: '100%', padding: '24px', border: '1px solid var(--settings-border)',
                                                    background: 'var(--settings-sidebar-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                    gap: '20px', transition: 'all 0.2s', cursor: 'pointer', boxSizing: 'border-box',
                                                    opacity: agent.enabled ? 1 : 0.6
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', minWidth: 0 }}>
                                                        <div onClick={event => event.stopPropagation()}>
                                                            <GnosiToggle
                                                                active={agent.enabled}
                                                                label={tn('ai.enable_agent', { name: agent.name })}
                                                                scale={1.1}
                                                                style={{ marginRight: '10px' }}
                                                                onChange={() => {
                                                                    const newList = draft.ai.agents.map(item => item.id === agent.id ? { ...item, enabled: !item.enabled } : item);
                                                                    setDraft({ ...draft, ai: { ...draft.ai, agents: newList } });
                                                                }}
                                                            />
                                                        </div>
                                                        <div
                                                            aria-hidden="true"
                                                            style={{
                                                                width: '46px', height: '46px', flexShrink: 0,
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                borderRadius: '50%',
                                                                background: 'var(--gnosi-blue)',
                                                                color: '#fff',
                                                                filter: 'drop-shadow(0 5px 10px rgba(0,0,0,0.1))'
                                                            }}
                                                        >
                                                            <IconRenderer
                                                                icon={agent.icon || '🤖'}
                                                                size={26}
                                                                color="#fff"
                                                            />
                                                        </div>
                                                        <div style={{ minWidth: 0 }}>
                                                            <div style={{ fontWeight: '900', fontSize: '1.1rem', color: 'var(--text-primary)' }}>{agent.name}</div>
                                                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.model}</div>
                                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '5px' }}>
                                                                {t('settings.ai.resources.assigned_skill_count', { count: (agent.skill_ids || []).length })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
                                                        <button type="button" onClick={(event) => { event.stopPropagation(); setEditingAgent(agent); }} aria-label={tn('ai.configure_name', { name: agent.name })} title={tn('ai.configure_name', { name: agent.name })} className="icon-btn hover-bg-strong" style={{ padding: '14px', borderRadius: '16px' }}>
                                                            <SettingsIcon size={22} />
                                                        </button>
                                                        <button type="button" onClick={(event) => { event.stopPropagation(); handleDeleteAIAgent(agent); }} aria-label={tn('ai.delete_name', { name: agent.name })} title={tn('ai.delete_name', { name: agent.name })} className="icon-btn hover-bg-strong" style={{ padding: '14px', borderRadius: '16px', color: 'var(--status-error)' }}>
                                                            <Trash2 size={22} />
                                                        </button>
                                                    </div>
                                                </div>
                                                {editingAgent?.id === agent.id && (
                                                    <div
                                                        ref={setAgentEditorTarget}
                                                        data-settings-editor-anchor-for={`agent:${agent.id}`}
                                                    />
                                                )}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </Section>}

                                    {aiSection === 'skills' && (
                                        <Section title={t('settings.ai.resources.skills_title')} icon={Zap}>
                                            <SkillsSettingsPanel
                                                resources={aiResources}
                                                agents={draft.ai.agents}
                                                onAgentsChanged={agents => setDraft(prev => ({
                                                    ...prev,
                                                    ai: { ...prev.ai, agents },
                                                }))}
                                            />
                                        </Section>
                                    )}

                                    {aiSection === 'tools' && (
                                        <Section title={t('settings.ai.resources.tools_title')} icon={Sliders}>
                                            <ToolsSettingsPanel resources={aiResources} />
                                        </Section>
                                    )}

                                    {aiSection === 'automations' && (
                                        <Section title={t('settings.ai.operations.automations_title')} icon={Clock3}>
                                            <AutomationsSettingsPanel resources={aiResources} agents={draft.ai.agents} />
                                        </Section>
                                    )}

                                    {aiSection === 'operations' && (
                                        <Section title={t('settings.ai.operations.history_title')} icon={History}>
                                            <OperationsHistoryPanel resources={aiResources} />
                                        </Section>
                                    )}
                                </>
                            )}


                            {/* NOTION IMPORT */}
                            {activeTab === 'notion' && (
                                <Section title={t('settings.tabs.notion')} icon={Database}>
                                    <NotionImportSettings />
                                </Section>
                            )}

                            {/* PLUGINS */}
                            {activeTab === 'plugins' && (
                                <PluginsSettings
                                    initialPluginId={initialPluginId}
                                    onOpenSettingsTab={(tab) => {
                                        setActiveTab(tab);
                                        setAddAccountType(null);
                                    }}
                                />
                            )}

                            {/* TRANSLATION */}
                            {activeTab === 'translate' && (
                                <Section
                                    title={t('translate_settings.section_title') || 'Serveis de traducció'}
                                    icon={Languages}
                                >
                                    <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '24px' }}>
                                        {t('translate_settings.intro') || "Configura els proveïdors usats pel botó \"Traduir fila\". DeepL cobreix la majoria d'idiomes; Softcatalà s'usa per al català (DeepL no el suporta)."}
                                    </div>

                                    {/* DeepL */}
                                    <FormGroup
                                        label={t('translate_settings.deepl_label')}
                                        description={t('translate_settings.deepl_desc') || "Es desa al Keychain de macOS, no al fitxer .env_shared. Aconsegueix-ne una a deepl.com/pro-api."}
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
                                                        {t('translate_settings.deepl_configured') || 'API key configurada al Keychain'}
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
                                                        {t('common.delete') || 'Eliminar'}
                                                    </button>
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                <div style={{ flex: 1 }}>
                                                    <PasswordInput
                                                        value={translateState.deepl_input}
                                                        onChange={e => setTranslateState(s => ({ ...s, deepl_input: e.target.value, saved_deepl: false }))}
                                                        placeholder={translateState.deepl_has_value
                                                            ? (t('translate_settings.deepl_placeholder_replace') || 'Introdueix una clau nova per substituir')
                                                            : (t('translate_settings.deepl_placeholder') || 'Enganxa la teva DeepL API key…')}
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
                                        description={t('translate_settings.softcatala_desc') || "Endpoint del servei de traducció de Softcatalà (català). Es desa al .env local de Gnosi. Buida = usa el valor per defecte."}
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
                                            {t('translate_settings.usage_hint') || "Aquests valors els consumeix l'endpoint /api/vault/skills/translate-row. Després de desar la clau de DeepL pot caldre reiniciar el backend perquè el Keychain es recarregui."}
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

            <AIModelComparisonModal
                isOpen={isModelComparisonOpen}
                onClose={() => setIsModelComparisonOpen(false)}
            />

            <AIUsageHistoryModal
                isOpen={isUsageHistoryOpen}
                onClose={() => setIsUsageHistoryOpen(false)}
                activeModels={aiRegistry}
            />

        </>
    );
}

// --- SUB-COMPONENTS FOR AI ---


function AIAgentForm({ agent, onSave, aiRegistry, skills, tools }) {
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
    const [selectedSkillIds, setSelectedSkillIds] = useState(agent.skill_ids || []);
    const [savingAgent, setSavingAgent] = useState(false);

    // Group registry rows by provider for the <select> optgroups. Rows carry
    // {provider, model_id, ...}; we keep first-seen order of providers.
    const grouped = useMemo(() => {
        const map = new Map();
        for (const row of (aiRegistry || [])) {
            if (!row || row.enabled !== true || !row.provider || !row.model_id) continue;
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

    return (
        <div className={`settings-inline-editor ai-agent-form animate-in ${agent.id ? 'is-attached' : 'is-create'}`}>
                    {!agent.id && (
                        <h3 className="ai-agent-form-title">{t('settings.ai.new_agent_title')}</h3>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end' }}>
                            <div style={{ flex: 1 }}>
                                <FormGroup label={t('settings.ai.agent_name')}>
                                    <input type="text" className="gnosi-input" value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.ai.agent_name_placeholder')} />
                                </FormGroup>
                            </div>
                            <div style={{ width: '72px' }}>
                                <FormGroup label={t('settings.ai.icon_label')}>
                                    <AgentIconSelect
                                        value={icon}
                                        onChange={setIcon}
                                        label={t('settings.ai.icon_label')}
                                        searchPlaceholder={t('icon_picker.search_placeholder')}
                                        noResultsLabel={t('icon_picker.no_icons')}
                                    />
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
                                            defaultValue: 'Aquest model {{reason}} {{count}} vegades en els últims {{days}} dies.',
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

                        <FormGroup
                            label={t('settings.ai.resources.assigned_skills')}
                            description={t('settings.ai.resources.assigned_skills_help')}
                        >
                            <AgentSkillsField
                                agent={{ ...agent, provider, model }}
                                skills={skills}
                                tools={tools}
                                registry={aiRegistry}
                                selectedIds={selectedSkillIds}
                                onChange={setSelectedSkillIds}
                            />
                        </FormGroup>
                    </div>
                    <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                            className="btn-gnosi-primary"
                            disabled={!name || !provider || !model || savingAgent}
                            onClick={async () => {
                                setSavingAgent(true);
                                try {
                                    await onSave({
                                        ...agent,
                                        name,
                                        provider,
                                        model,
                                        icon,
                                        persona,
                                        context,
                                        context_refs: contextRefs,
                                        skill_ids: selectedSkillIds,
                                    });
                                } finally {
                                    setSavingAgent(false);
                                }
                            }}
                            style={{ padding: '14px 28px', borderRadius: '18px' }}
                        >
                            {savingAgent && <Loader2 size={16} className="animate-spin" />}
                            {agent.id ? t('settings.ai.update_agent') : t('settings.ai.create_agent_action')}
                        </button>
                    </div>
        </div>
    );
}
