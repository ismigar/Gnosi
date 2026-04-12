import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Globe, Palette, RefreshCw, Info, ExternalLink, Monitor, BookOpen, Save, Check, FolderOpen, Database, Cpu, Zap, Settings as SettingsIcon, Sliders, Calendar, Mail, Trash2, Plus, Users, ChevronRight, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FolderPickerModal } from './FolderPickerModal';
import { IconPicker, VAULT_COLORS } from './Vault/IconPicker';
import axios from 'axios';
import * as LucideIcons from 'lucide-react';

const LANGUAGES = [
    { code: 'ca', label: 'Català', icon: '🏴󠁥󠁳󠁣󠁡󠁿' },
    { code: 'es', label: 'Español', icon: '🇪🇸' },
    { code: 'en', label: 'English', icon: '🇬🇧' },
    { code: 'fr', label: 'Français', icon: '🇫🇷' },
];

const THEME_OPTIONS = [
    { id: 'light', label: 'settings.general.theme_light', previewClass: 'settings-theme-preview--light', disabled: false },
    { id: 'dark', label: 'settings.general.theme_dark', previewClass: 'settings-theme-preview--dark', disabled: false },
    { id: 'system', label: 'settings.general.theme_system', icon: Monitor, disabled: false },
];

function getStoredTheme() {
    return localStorage.getItem('db-theme') || 'system';
}

const LLM_PROVIDERS_META = {
    opencode_zen: { name: 'OpenCode Zen', icon: '🧠', color: '#2563eb', description: 'Models validats per l’equip d’OpenCode.', baseUrl: '' },
    opencode_go: { name: 'OpenCode Go', icon: '🚀', color: '#0ea5e9', description: 'Pla low-cost amb models de coding verificats.', baseUrl: '' },
    '302_ai': { name: '302.AI', icon: '🔗', color: '#0891b2', description: 'Accés multi-model via API.', baseUrl: '' },
    'amazon-bedrock': { name: 'Amazon Bedrock', icon: '☁️', color: '#f59e0b', description: 'Models via AWS Bedrock.', baseUrl: '' },
    groq: { name: 'Groq', icon: '⚡', color: '#f59e0b', description: 'Inferència ultra-ràpida amb Llama 3 i Mixtral.', baseUrl: 'https://api.groq.com/openai/v1' },
    openai: { name: 'OpenAI', icon: '🤖', color: '#10b981', description: 'Models GPT-4o i GPT-4-turbo originals.', baseUrl: 'https://api.openai.com/v1' },
    anthropic: { name: 'Anthropic', icon: '🎨', color: '#d97706', description: 'Models Claude 3.5 Sonnet i Opus.', baseUrl: '' },
    'azure-openai': { name: 'Azure OpenAI', icon: '🟦', color: '#2563eb', description: 'OpenAI desplegat a Azure.', baseUrl: '' },
    'azure-cognitive-services': { name: 'Azure Cognitive Services', icon: '🧩', color: '#1d4ed8', description: 'Models servits des de Cognitive Services.', baseUrl: '' },
    baseten: { name: 'Baseten', icon: '📦', color: '#7c3aed', description: 'Inferència i hosting de models.', baseUrl: '' },
    cerebras: { name: 'Cerebras', icon: '🧮', color: '#ea580c', description: 'Inferència d’alta velocitat.', baseUrl: '' },
    'cloudflare-ai-gateway': { name: 'Cloudflare AI Gateway', icon: '🛡️', color: '#f97316', description: 'Gateway unificat multi-proveïdor.', baseUrl: 'https://ai-gateway.helicone.ai' },
    'cloudflare-workers-ai': { name: 'Cloudflare Workers AI', icon: '🌩️', color: '#fb923c', description: 'Models al edge de Cloudflare.', baseUrl: '' },
    cortecs: { name: 'Cortecs', icon: '🧪', color: '#db2777', description: 'Provider de models fundacionals.', baseUrl: '' },
    deepseek: { name: 'DeepSeek', icon: '🔍', color: '#0f766e', description: 'Models DeepSeek API.', baseUrl: '' },
    'deep-infra': { name: 'Deep Infra', icon: '🏗️', color: '#0ea5e9', description: 'Infraestructura d’inferència multi-model.', baseUrl: '' },
    firmware: { name: 'Firmware', icon: '🧱', color: '#6d28d9', description: 'Provider compatible OpenAI.', baseUrl: '' },
    fireworks: { name: 'Fireworks AI', icon: '🎆', color: '#ef4444', description: 'Inferència accelerada.', baseUrl: '' },
    'gitlab-duo': { name: 'GitLab Duo', icon: '🦊', color: '#f97316', description: 'Duo Agent Platform / OAuth o PAT.', baseUrl: '' },
    'github-copilot': { name: 'GitHub Copilot', icon: '🐙', color: '#111827', description: 'Subscripció Copilot via login OAuth.', baseUrl: '' },
    'google-vertex-ai': { name: 'Google Vertex AI', icon: '🛰️', color: '#2563eb', description: 'Models a Google Cloud Vertex.', baseUrl: '' },
    'hugging-face': { name: 'Hugging Face', icon: '🤗', color: '#eab308', description: 'Inference Providers de Hugging Face.', baseUrl: '' },
    helicone: { name: 'Helicone', icon: '📊', color: '#7c3aed', description: 'Gateway + observabilitat LLM.', baseUrl: 'https://ai-gateway.helicone.ai' },
    'llama-cpp': { name: 'llama.cpp', icon: '🦙', color: '#4b5563', description: 'Servidor local compatible OpenAI.', baseUrl: 'http://127.0.0.1:8080/v1' },
    'io-net': { name: 'IO.NET', icon: '🌐', color: '#06b6d4', description: 'Plataforma d’inferència de models.', baseUrl: '' },
    lmstudio: { name: 'LM Studio', icon: '💻', color: '#6366f1', description: 'Models locals via LM Studio.', baseUrl: 'http://127.0.0.1:1234/v1' },
    moonshot: { name: 'Moonshot AI', icon: '🌙', color: '#4338ca', description: 'Kimi i altres models Moonshot.', baseUrl: '' },
    minimax: { name: 'MiniMax', icon: '🧠', color: '#14b8a6', description: 'Models MiniMax.', baseUrl: '' },
    nebius: { name: 'Nebius Token Factory', icon: '🏭', color: '#0f766e', description: 'Token Factory per inferència.', baseUrl: '' },
    ollama: { name: 'Ollama', icon: '🏠', color: '#71717a', description: 'Models locals sense privacitat compromesa.', baseUrl: 'http://localhost:11434' },
    'ollama-cloud': { name: 'Ollama Cloud', icon: '☁️', color: '#4f46e5', description: 'Models cloud d’Ollama.', baseUrl: '' },
    openrouter: { name: 'OpenRouter', icon: '🌐', color: '#3b82f6', description: 'Accés a centenars de models via API unificada.', baseUrl: 'https://openrouter.ai/api/v1' },
    google: { name: 'Google Gemini', icon: '✨', color: '#4285f4', description: 'Models Gemini Pro i Flash via Google AI Studio.', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
    'sap-ai-core': { name: 'SAP AI Core', icon: '🏢', color: '#0ea5e9', description: 'Models via service key JSON de SAP.', baseUrl: '' },
    stackit: { name: 'STACKIT', icon: '🇪🇺', color: '#2563eb', description: 'Hosting sobirà europeu de models.', baseUrl: '' },
    ovhcloud: { name: 'OVHcloud AI Endpoints', icon: '🌍', color: '#1d4ed8', description: 'Endpoints AI d’OVHcloud.', baseUrl: '' },
    scaleway: { name: 'Scaleway', icon: '🛰️', color: '#7c3aed', description: 'Generative APIs de Scaleway.', baseUrl: '' },
    together: { name: 'Together AI', icon: '🤝', color: '#0f766e', description: 'Models open i propietaris.', baseUrl: '' },
    venice: { name: 'Venice AI', icon: '🏛️', color: '#be123c', description: 'Models via API de Venice.', baseUrl: '' },
    vercel: { name: 'Vercel AI Gateway', icon: '▲', color: '#111827', description: 'Gateway multi-proveïdor de Vercel.', baseUrl: '' },
    xai: { name: 'xAI', icon: '❌', color: '#111827', description: 'Models Grok via xAI.', baseUrl: '' },
    z_ai: { name: 'Z.AI', icon: '🧬', color: '#16a34a', description: 'Models GLM i pla coding.', baseUrl: '' },
    zenmux: { name: 'ZenMux', icon: '🔀', color: '#1d4ed8', description: 'Router multi-model compatible.', baseUrl: '' },
    custom: { name: 'Personalitzat', icon: '⚙️', color: '#8b5cf6', description: 'Qualsevol endpoint compatible amb OpenAI.', baseUrl: '' }
};

const PROVIDERS_REQUIREMENTS = {
    opencode_zen: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    opencode_go: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    '302_ai': { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    'amazon-bedrock': { needsApiKey: false, needsBaseUrl: false, needsSecret: true, secretLabel: 'AWS Credentials / Bearer Token' },
    groq: { needsApiKey: true, needsBaseUrl: false },
    openai: { needsApiKey: true, needsBaseUrl: false },
    anthropic: { needsApiKey: true, needsBaseUrl: false },
    'azure-openai': { needsApiKey: true, needsBaseUrl: false, needsSecret: true, secretLabel: 'Azure Resource Name' },
    'azure-cognitive-services': { needsApiKey: true, needsBaseUrl: false, needsSecret: true, secretLabel: 'Cognitive Resource Name' },
    baseten: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    cerebras: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    'cloudflare-ai-gateway': { needsApiKey: true, needsBaseUrl: false, needsSecret: true, secretLabel: 'Account ID + Gateway ID' },
    'cloudflare-workers-ai': { needsApiKey: true, needsBaseUrl: false, needsSecret: true, secretLabel: 'Cloudflare Account ID' },
    cortecs: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    deepseek: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    'deep-infra': { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    firmware: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    fireworks: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    'gitlab-duo': { needsApiKey: false, needsBaseUrl: false, needsSecret: true, secretLabel: 'OAuth o GitLab PAT' },
    'github-copilot': { needsApiKey: false, needsBaseUrl: false, needsSecret: true, secretLabel: 'OAuth Device Login' },
    'google-vertex-ai': { needsApiKey: false, needsBaseUrl: false, needsSecret: true, secretLabel: 'Project ID + Credentials' },
    'hugging-face': { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    helicone: { needsApiKey: true, needsBaseUrl: true, needsSecret: false },
    'llama-cpp': { needsApiKey: false, needsBaseUrl: true, needsSecret: false },
    'io-net': { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    lmstudio: { needsApiKey: false, needsBaseUrl: true, needsSecret: false },
    moonshot: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    minimax: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    nebius: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    ollama: { needsApiKey: false, needsBaseUrl: true, needsSecret: false },
    'ollama-cloud': { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    openrouter: { needsApiKey: true, needsBaseUrl: true, needsSecret: false },
    google: { needsApiKey: true, needsBaseUrl: false },
    'sap-ai-core': { needsApiKey: false, needsBaseUrl: false, needsSecret: true, secretLabel: 'Service Key JSON' },
    stackit: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    ovhcloud: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    scaleway: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    together: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    venice: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    vercel: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    xai: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    z_ai: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    zenmux: { needsApiKey: true, needsBaseUrl: false, needsSecret: false },
    custom: { needsApiKey: true, needsBaseUrl: true, needsSecret: false }
};

const PROVIDER_CATEGORY_ORDER = [
    'OpenCode',
    'Major LLMs',
    'Cloud Platforms',
    'Gateways & Routing',
    'Specialized APIs',
    'Enterprise',
    'Local'
];

const PROVIDER_CATEGORY_MAP = {
    opencode_zen: 'OpenCode',
    opencode_go: 'OpenCode',
    openai: 'Major LLMs',
    anthropic: 'Major LLMs',
    google: 'Major LLMs',
    groq: 'Major LLMs',
    xai: 'Major LLMs',
    deepseek: 'Major LLMs',
    moonshot: 'Major LLMs',
    minimax: 'Major LLMs',
    z_ai: 'Major LLMs',
    'amazon-bedrock': 'Cloud Platforms',
    'google-vertex-ai': 'Cloud Platforms',
    'azure-openai': 'Cloud Platforms',
    'azure-cognitive-services': 'Cloud Platforms',
    'cloudflare-workers-ai': 'Cloud Platforms',
    openrouter: 'Gateways & Routing',
    vercel: 'Gateways & Routing',
    zenmux: 'Gateways & Routing',
    helicone: 'Gateways & Routing',
    'cloudflare-ai-gateway': 'Gateways & Routing',
    '302_ai': 'Specialized APIs',
    baseten: 'Specialized APIs',
    cerebras: 'Specialized APIs',
    cortecs: 'Specialized APIs',
    'deep-infra': 'Specialized APIs',
    firmware: 'Specialized APIs',
    fireworks: 'Specialized APIs',
    'hugging-face': 'Specialized APIs',
    'io-net': 'Specialized APIs',
    nebius: 'Specialized APIs',
    ovhcloud: 'Specialized APIs',
    scaleway: 'Specialized APIs',
    stackit: 'Specialized APIs',
    together: 'Specialized APIs',
    venice: 'Specialized APIs',
    'sap-ai-core': 'Enterprise',
    'gitlab-duo': 'Enterprise',
    'github-copilot': 'Enterprise',
    ollama: 'Local',
    'ollama-cloud': 'Local',
    'llama-cpp': 'Local',
    lmstudio: 'Local'
};

export function GlobalSettingsModal({ isOpen, onClose, initialTab = 'general' }) {
    const { t, i18n } = useTranslation();
    const [syncing, setSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState('');
    const [theme, setTheme] = useState(getStoredTheme);
    const [zoteroConfig, setZoteroConfig] = useState(null);
    const [zoteroTables, setZoteroTables] = useState([]);
    const [zoteroFields, setZoteroFields] = useState([]);
    const [zoteroSyncing, setZoteroSyncing] = useState(false);
    const [databases, setDatabases] = useState([]);
    const [tables, setTables] = useState([]);
    const [integrations, setIntegrations] = useState({});
    const [googleAuthConfigured, setGoogleAuthConfigured] = useState(false);

    const [activeTab, setActiveTab] = useState(initialTab);
    const [fullConfig, setFullConfig] = useState(null);
    const [localSettings, setLocalSettings] = useState({
        language: '',
        user_name: '',
        password: '',
        reduce_animations: false,
        timezone: '',
        currency: '',
        week_start: 1,
        use_system_defaults: true
    });
    const [calendarWizard, setCalendarWizard] = useState(null);
    const [emailWizard, setEmailWizard] = useState(null);
    const [newsletterSources, setNewsletterSources] = useState([]);
    const [newsletterLoading, setNewsletterLoading] = useState(false);
    const [newsletterName, setNewsletterName] = useState('');
    const [newsletterAddress, setNewsletterAddress] = useState('');
    const [newsletterType, setNewsletterType] = useState('rss');
    const [newsletterStatus, setNewsletterStatus] = useState('');
    const [newsletterOpmlLoading, setNewsletterOpmlLoading] = useState(false);
    const newsletterOpmlRef = useRef(null);
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
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState('');
    const [hasUnappliedChanges, setHasUnappliedChanges] = useState(false);
    const initialLoadDone = useRef(false);
    const autoSaveTimerRef = useRef(null);

    const [aiAgents, setAiAgents] = useState([]);
    const [aiProviders, setAiProviders] = useState({});
    const [aiCatalog, setAiCatalog] = useState({});
    const [activeAgentId, setActiveAgentId] = useState('');
    const [editingAgent, setEditingAgent] = useState(null);

    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerField, setPickerField] = useState(null);
    const [editingProvider, setEditingProvider] = useState(null);
    const [isAddProviderOpen, setIsAddProviderOpen] = useState(false);
    const [newProviderDraft, setNewProviderDraft] = useState({ providerId: 'groq', apiKey: '', secretValue: '', baseUrl: '' });
    const [providerSearchQuery, setProviderSearchQuery] = useState('');
    const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
    const [highlightedProviderId, setHighlightedProviderId] = useState('');

    const handleThemeChange = (newTheme) => {
        setTheme(newTheme);
        localStorage.setItem('db-theme', newTheme);
        window.dispatchEvent(new Event('db-theme-changed'));
    };

    useEffect(() => {
        if (isOpen) {
            loadConfig();
            loadAiCatalog();
            loadZoteroData();
            loadIntegrations();
            loadNewsletterSources();

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
                setFullConfig(cfg);
                if (cfg.settings) setLocalSettings(prev => ({ ...prev, ...cfg.settings }));
                if (cfg.paths) setLocalPaths(prev => ({ ...prev, ...cfg.paths }));
                if (cfg.graph) setGraphConfig(prev => ({ ...prev, ...cfg.graph }));
                if (cfg.ai) {
                    setAiAgents(cfg.ai.agents || []);
                    setActiveAgentId(cfg.ai.active_agent_id || '');
                }
                setTimeout(() => {
                    initialLoadDone.current = true;
                }, 500);
            }
        } catch (err) {
            console.error("Error loading config:", err);
        }
    };

    const loadAiCatalog = async () => {
        try {
            const res = await fetch('/api/ai/catalog');
            if (!res.ok) return;
            const payload = await res.json();
            const providers = Array.isArray(payload?.catalog?.providers) ? payload.catalog.providers : [];
            const catalogMap = providers.reduce((acc, provider) => {
                acc[provider.id] = provider;
                return acc;
            }, {});
            setAiCatalog(catalogMap);

            if (payload?.config?.providers) {
                const persistedProviders = Object.entries(payload.config.providers).reduce((acc, [providerId, providerCfg]) => {
                    if (!providerCfg || providerCfg.source !== 'user') return acc;
                    acc[providerId] = providerCfg;
                    return acc;
                }, {});
                setAiProviders(persistedProviders);
            }
        } catch (err) {
            console.error('Error loading AI catalog:', err);
        }
    };

    const loadNewsletterSources = async () => {
        setNewsletterLoading(true);
        try {
            const res = await fetch('/api/reader/sources');
            if (!res.ok) {
                setNewsletterStatus('No s\'han pogut carregar les subscripcions.');
                return;
            }
            const sources = await res.json();
            setNewsletterSources((sources || []).filter((source) => ['rss', 'newsletter', 'youtube'].includes(source.type)));
            setNewsletterStatus('');
        } catch (err) {
            console.error('Error loading newsletter sources:', err);
            setNewsletterStatus('Error de connexió carregant les subscripcions.');
        } finally {
            setNewsletterLoading(false);
        }
    };

    const handleAddNewsletter = async () => {
        const sourceAddress = newsletterAddress.trim();
        const sourceName = newsletterName.trim() || sourceAddress;
        if (!sourceAddress) {
            setNewsletterStatus('Cal indicar l\'adreça o identificador de la subscripció.');
            return;
        }

        const normalizeYoutubeUrl = (rawValue) => {
            const value = String(rawValue || '').trim();
            if (!value) return value;
            if (value.includes('feeds/videos.xml?channel_id=')) return value;
            const channelMatch = value.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
            if (channelMatch?.[1]) return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelMatch[1]}`;
            return value;
        };

        const normalizedAddress = newsletterType === 'youtube' ? normalizeYoutubeUrl(sourceAddress) : sourceAddress;
        const normalizedCategory = newsletterType === 'rss' ? 'RSS' : newsletterType === 'youtube' ? 'YouTube' : 'Newsletters';

        setNewsletterStatus('Afegint subscripció...');
        try {
            const res = await fetch('/api/reader/sources', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: sourceName, url: normalizedAddress, category: normalizedCategory, type: newsletterType })
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                setNewsletterStatus(errorData?.detail || 'No s\'ha pogut afegir la subscripció.');
                return;
            }

            setNewsletterName('');
            setNewsletterAddress('');
            setNewsletterType('rss');
            setNewsletterStatus('Subscripció afegida correctament.');
            await loadNewsletterSources();
        } catch (err) {
            console.error('Error adding newsletter source:', err);
            setNewsletterStatus('Error de connexió afegint la subscripció.');
        }
    };

    const handleDeleteNewsletter = async (sourceId) => {
        try {
            const res = await fetch(`/api/reader/sources/${sourceId}`, { method: 'DELETE' });
            if (!res.ok) {
                setNewsletterStatus('No s\'ha pogut eliminar la subscripció.');
                return;
            }
            setNewsletterStatus('Subscripció eliminada.');
            await loadNewsletterSources();
        } catch (err) {
            console.error('Error deleting newsletter source:', err);
            setNewsletterStatus('Error de connexió eliminant la subscripció.');
        }
    };

    const handleNewsletterOpmlUpload = async (file) => {
        if (!file) return;
        setNewsletterOpmlLoading(true);
        setNewsletterStatus('Important subscripcions OPML...');
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/reader/sources/opml', { method: 'POST', body: formData });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setNewsletterStatus(data?.detail || 'No s\'ha pogut importar l\'OPML.');
                return;
            }
            setNewsletterStatus(data?.message || 'Importació OPML completada.');
            await loadNewsletterSources();
        } catch (err) {
            console.error('Error importing OPML newsletters:', err);
            setNewsletterStatus('Error de connexió important l\'OPML.');
        } finally {
            setNewsletterOpmlLoading(false);
            if (newsletterOpmlRef.current) newsletterOpmlRef.current.value = '';
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

            const vtRes = await fetch('/api/vault/tables');
            if (vtRes.ok) setTables(await vtRes.json());
        } catch (err) {
            console.error("Error loading Zotero data:", err);
        }
    };

    const handleSaveGlobal = async (forceReload = false) => {
        setIsSaving(true);
        setSaveStatus('Guardant...');
        try {
            const persistedProviders = Object.entries(aiProviders).reduce((acc, [providerId, providerCfg]) => {
                const cfg = { ...(providerCfg || {}) };
                delete cfg.api_key;
                delete cfg.has_api_key;
                delete cfg.pending_api_key;
                acc[providerId] = cfg;
                return acc;
            }, {});

            const updatedConfig = {
                ...fullConfig,
                settings: localSettings,
                paths: localPaths,
                graph: graphConfig,
                ai: {
                    agents: aiAgents,
                    providers: persistedProviders,
                    active_agent_id: activeAgentId
                }
            };

            const savePromises = [
                axios.post('/api/config', updatedConfig),
                axios.post('/api/integrations/bulk', integrations)
            ];

            if (zoteroConfig) {
                savePromises.push(axios.post('/api/zotero/config', zoteroConfig));
            }

            const results = await Promise.all(savePromises);
            const allOk = results.every(res => res.status >= 200 && res.status < 300);

            if (allOk) {
                setSaveStatus('✅ ' + t('common.status.saved'));
                setHasUnappliedChanges(true);
                setTimeout(() => {
                    setSaveStatus('');
                    if (forceReload) window.location.reload();
                }, 2000);
            } else {
                setSaveStatus('❌ ' + t('common.status.error_saving'));
            }
        } catch (err) {
            console.error("Error saving global config:", err);
            setSaveStatus('❌ Error de connexió');
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        if (!initialLoadDone.current || !isOpen) return;
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        setSaveStatus(t('common.status.unsaved_changes'));
        autoSaveTimerRef.current = setTimeout(() => {
            handleSaveGlobal();
        }, 1500);
        return () => {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        };
    }, [localSettings, localPaths, graphConfig, integrations, aiAgents, activeAgentId, aiProviders]);

    const handleZoteroSync = async () => {
        if (zoteroSyncing) return;
        setZoteroSyncing(true);
        try {
            const res = await fetch('/api/zotero/sync', { method: 'POST' });
            if (res.ok) alert('Sincronització de Zotero iniciada!');
            else alert('Error al iniciar la sincronització');
        } catch {
            alert('Error de connexió');
        } finally {
            setZoteroSyncing(false);
        }
    };

    const getAvailableProperties = () => {
        if (!zoteroConfig?.target_table || !zoteroTables?.length) return [];
        const selectedTable = zoteroTables.find(t => t.id === zoteroConfig.target_table);
        return selectedTable?.properties || [];
    };

    const availableProperties = getAvailableProperties();

    const getProviderModels = (providerId) => {
        const entry = aiCatalog[providerId];
        return Array.isArray(entry?.models) ? entry.models : [];
    };

    const getProviderRequirements = (providerId) => {
        return PROVIDERS_REQUIREMENTS[providerId] || PROVIDERS_REQUIREMENTS.custom;
    };

    const getProviderRequirementLabels = (providerId) => {
        const req = getProviderRequirements(providerId);
        const labels = [];
        if (req.needsApiKey) labels.push('API Key');
        if (req.needsSecret) labels.push(req.secretLabel || 'Secret');
        if (req.needsBaseUrl) labels.push('Base URL');
        if (providerId === 'google') labels.push('Project Key');
        return labels;
    };

    const getProviderName = (providerId) => LLM_PROVIDERS_META[providerId]?.name || providerId;
    const getProviderCategory = (providerId) => PROVIDER_CATEGORY_MAP[providerId] || 'Specialized APIs';

    const getFilteredProviderIds = (query) => {
        const q = (query || '').trim().toLowerCase();
        const ids = Object.keys(LLM_PROVIDERS_META).filter(p => p !== 'custom');
        if (!q) return ids;
        return ids.filter((providerId) => {
            const meta = LLM_PROVIDERS_META[providerId] || {};
            return [providerId, meta.name, meta.description].filter(Boolean).some(value => String(value).toLowerCase().includes(q));
        });
    };

    const getGroupedProviderOptions = (query) => {
        const filteredIds = getFilteredProviderIds(query);
        return PROVIDER_CATEGORY_ORDER.map((category) => {
            const options = filteredIds
                .filter(providerId => getProviderCategory(providerId) === category)
                .sort((a, b) => getProviderName(a).localeCompare(getProviderName(b)));
            return { category, options };
        }).filter(group => group.options.length > 0);
    };

    const groupedProviderOptions = useMemo(() => getGroupedProviderOptions(providerSearchQuery), [providerSearchQuery]);
    const flatProviderOptionIds = useMemo(() => groupedProviderOptions.flatMap(group => group.options), [groupedProviderOptions]);

    const selectProviderFromDropdown = (providerId) => {
        setNewProviderDraft(prev => ({ ...prev, providerId, apiKey: '', secretValue: '', baseUrl: LLM_PROVIDERS_META[providerId]?.baseUrl || '' }));
        setProviderSearchQuery('');
        setIsProviderDropdownOpen(false);
    };

    const handleProviderDropdownKeyDown = (event) => {
        if (!isProviderDropdownOpen) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!flatProviderOptionIds.length) return;
            const currentIndex = flatProviderOptionIds.indexOf(highlightedProviderId);
            const nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, flatProviderOptionIds.length - 1);
            setHighlightedProviderId(flatProviderOptionIds[nextIndex]);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!flatProviderOptionIds.length) return;
            const currentIndex = flatProviderOptionIds.indexOf(highlightedProviderId);
            const nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
            setHighlightedProviderId(flatProviderOptionIds[nextIndex]);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (highlightedProviderId) selectProviderFromDropdown(highlightedProviderId);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setIsProviderDropdownOpen(false);
        }
    };

    useEffect(() => {
        if (!isProviderDropdownOpen) return;
        if (!flatProviderOptionIds.length) { setHighlightedProviderId(''); return; }
        setHighlightedProviderId(prev => (prev && flatProviderOptionIds.includes(prev)) ? prev : (flatProviderOptionIds.includes(newProviderDraft.providerId) ? newProviderDraft.providerId : flatProviderOptionIds[0]));
    }, [isProviderDropdownOpen, flatProviderOptionIds, newProviderDraft.providerId]);

    const renderHighlightedText = (text, query) => {
        const value = String(text || '');
        const q = String(query || '').trim();
        if (!q) return value;
        const lowerValue = value.toLowerCase();
        const lowerQuery = q.toLowerCase();
        const start = lowerValue.indexOf(lowerQuery);
        if (start < 0) return value;
        const end = start + q.length;
        return <>{value.slice(0, start)}<mark style={{ background: 'rgba(59,130,246,0.2)', color: 'var(--text-primary)', borderRadius: '4px', padding: '0 2px' }}>{value.slice(start, end)}</mark>{value.slice(end)}</>;
    };

    const openAddProviderModal = () => {
        const firstProvider = Object.keys(LLM_PROVIDERS_META).find(p => p !== 'custom') || 'groq';
        setNewProviderDraft({ providerId: firstProvider, apiKey: '', secretValue: '', baseUrl: LLM_PROVIDERS_META[firstProvider]?.baseUrl || '' });
        setProviderSearchQuery('');
        setIsProviderDropdownOpen(false);
        setIsAddProviderOpen(true);
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="settings-overlay" onClick={onClose}>
                <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="settings-modal__header" style={{ background: 'var(--settings-header-bg)', borderBottom: '1px solid var(--settings-border)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 className="settings-header__title" style={{ color: 'var(--settings-title)', margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <SettingsIcon size={20} />
                            {t('settings.title')}
                        </h2>
                        <button className="settings-modal__close" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                            <X size={20} />
                        </button>
                    </div>

                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                        <div className="settings-sidebar" style={{ width: '220px', borderRight: '1px solid var(--settings-border)', padding: '20px 12px', background: 'var(--settings-sidebar-bg)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <button className={`settings-sidebar__item ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: 'none', borderRadius: '10px', background: activeTab === 'general' ? 'var(--settings-sidebar-active)' : 'transparent', color: activeTab === 'general' ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontWeight: activeTab === 'general' ? '600' : '500', fontSize: '0.9rem', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                <Globe size={18} /> <span>{t('settings.tabs.general')}</span>
                            </button>
                            <button className={`settings-sidebar__item ${activeTab === 'language' ? 'active' : ''}`} onClick={() => setActiveTab('language')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: 'none', borderRadius: '10px', background: activeTab === 'language' ? 'var(--settings-sidebar-active)' : 'transparent', color: activeTab === 'language' ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontWeight: activeTab === 'language' ? '600' : '500', fontSize: '0.9rem', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                <Globe size={18} /> <span>{t('settings.tabs.language')}</span>
                            </button>
                            <button className={`settings-sidebar__item ${activeTab === 'appearance' ? 'active' : ''}`} onClick={() => setActiveTab('appearance')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: 'none', borderRadius: '10px', background: activeTab === 'appearance' ? 'var(--settings-sidebar-active)' : 'transparent', color: activeTab === 'appearance' ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontWeight: activeTab === 'appearance' ? '600' : '500', fontSize: '0.9rem', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                <Palette size={18} /> <span>{t('settings.tabs.appearance')}</span>
                            </button>
                            <button className={`settings-sidebar__item ${activeTab === 'calendar' ? 'active' : ''}`} onClick={() => setActiveTab('calendar')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: 'none', borderRadius: '10px', background: activeTab === 'calendar' ? 'var(--settings-sidebar-active)' : 'transparent', color: activeTab === 'calendar' ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontWeight: activeTab === 'calendar' ? '600' : '500', fontSize: '0.9rem', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                <Calendar size={18} /> <span>{t('settings.tabs.calendar')}</span>
                            </button>
                            <button className={`settings-sidebar__item ${activeTab === 'graph' ? 'active' : ''}`} onClick={() => setActiveTab('graph')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: 'none', borderRadius: '10px', background: activeTab === 'graph' ? 'var(--settings-sidebar-active)' : 'transparent', color: activeTab === 'graph' ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontWeight: activeTab === 'graph' ? '600' : '500', fontSize: '0.9rem', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                <Zap size={18} /> <span>{t('settings.tabs.graph')}</span>
                            </button>
                            <button className={`settings-sidebar__item ${activeTab === 'newsletters' ? 'active' : ''}`} onClick={() => setActiveTab('newsletters')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: 'none', borderRadius: '10px', background: activeTab === 'newsletters' ? 'var(--settings-sidebar-active)' : 'transparent', color: activeTab === 'newsletters' ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontWeight: activeTab === 'newsletters' ? '600' : '500', fontSize: '0.9rem', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                <Mail size={18} /> <span>{t('settings.tabs.newsletters')}</span>
                            </button>
                            <button className={`settings-sidebar__item ${activeTab === 'contacts' ? 'active' : ''}`} onClick={() => setActiveTab('contacts')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: 'none', borderRadius: '10px', background: activeTab === 'contacts' ? 'var(--settings-sidebar-active)' : 'transparent', color: activeTab === 'contacts' ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontWeight: activeTab === 'contacts' ? '600' : '500', fontSize: '0.9rem', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                <Users size={18} /> <span>{t('settings.tabs.contacts')}</span>
                            </button>
                            <button className={`settings-sidebar__item ${activeTab === 'mail_accounts' ? 'active' : ''}`} onClick={() => setActiveTab('mail_accounts')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: 'none', borderRadius: '10px', background: activeTab === 'mail_accounts' ? 'var(--settings-sidebar-active)' : 'transparent', color: activeTab === 'mail_accounts' ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontWeight: activeTab === 'mail_accounts' ? '600' : '500', fontSize: '0.9rem', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                <Mail size={18} /> <span>{t('settings.tabs.mail_accounts')}</span>
                            </button>
                            <button className={`settings-sidebar__item ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveTab('ai')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: 'none', borderRadius: '10px', background: activeTab === 'ai' ? 'var(--settings-sidebar-active)' : 'transparent', color: activeTab === 'ai' ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontWeight: activeTab === 'ai' ? '600' : '500', fontSize: '0.9rem', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                <Cpu size={18} /> <span>{t('settings.tabs.ai')}</span>
                            </button>
                            <button className={`settings-sidebar__item ${activeTab === 'zotero' ? 'active' : ''}`} onClick={() => setActiveTab('zotero')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: 'none', borderRadius: '10px', background: activeTab === 'zotero' ? 'var(--settings-sidebar-active)' : 'transparent', color: activeTab === 'zotero' ? 'var(--settings-sidebar-active-text)' : 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontWeight: activeTab === 'zotero' ? '600' : '500', fontSize: '0.9rem', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                <BookOpen size={18} /> <span>{t('settings.tabs.zotero')}</span>
                            </button>
                        </div>

                        <div className="settings-modal__content" style={{ flex: 1, overflowY: 'auto', padding: '25px', background: 'var(--settings-bg)' }}>
                            <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                                
                                {activeTab === 'general' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                        <section className="settings-section">
                                            <div className="settings-section__header">
                                                <Globe size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{t('settings.general.title')}</h3>
                                            </div>
                                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>{t('settings.general.desc')}</p>
                                            <div className="settings-section__content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                                <div className="setting-control">
                                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '8px' }}>{t('settings.general.user_name')}</label>
                                                    <input type="text" value={localSettings.user_name || ''} onChange={(e) => setLocalSettings(prev => ({ ...prev, user_name: e.target.value }))} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }} />
                                                </div>
                                                <div className="setting-control">
                                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '8px' }}>{t('settings.general.password')}</label>
                                                    <input type="password" value={localSettings.password || ''} onChange={(e) => setLocalSettings(prev => ({ ...prev, password: e.target.value }))} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }} placeholder="••••••••" />
                                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{t('settings.general.password_desc')}</p>
                                                </div>
                                            </div>
                                        </section>
                                    </div>
                                )}

                                {activeTab === 'language' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                        <section className="settings-section">
                                            <div className="settings-section__header">
                                                <Globe size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{t('settings.tabs.language')}</h3>
                                            </div>
                                            <div className="settings-section__content">
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
                                                    {['ca', 'es', 'en', 'fr'].map(lang => (
                                                        <button key={lang} onClick={() => i18n.changeLanguage(lang)} className={`settings-lang-option ${i18n.language === lang ? 'active' : ''}`} style={{ padding: '12px', borderRadius: '10px', border: i18n.language === lang ? '2px solid var(--gnosi-blue)' : '1px solid var(--settings-border)', background: i18n.language === lang ? 'rgba(59,130,246,0.05)' : 'var(--settings-section-bg)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: '600', textTransform: 'uppercase' }}>
                                                            {lang === 'ca' ? 'Català' : lang === 'es' ? 'Español' : lang === 'en' ? 'English' : 'Français'}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </section>
                                    </div>
                                )}

                                {activeTab === 'appearance' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                        <section className="settings-section">
                                            <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                                                <Palette size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{t('settings.appearance.title')}</h3>
                                            </div>
                                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>{t('settings.appearance.desc')}</p>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>{t('settings.appearance.theme')}</label>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                                                        {THEME_OPTIONS.map((opt) => {
                                                            const Icon = opt.icon;
                                                            return (
                                                                <button key={opt.id} onClick={() => !opt.disabled && handleThemeChange(opt.id)} className={`settings-theme-option ${theme === opt.id ? 'active' : ''} ${opt.disabled ? 'disabled' : ''}`} style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', borderRadius: '12px', border: theme === opt.id ? '2px solid var(--gnosi-blue)' : '1px solid var(--settings-border)', background: theme === opt.id ? 'rgba(59,130,246,0.05)' : 'var(--settings-section-bg)', cursor: opt.disabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s ease', opacity: opt.disabled ? 0.6 : 1 }}>
                                                                    <div className={opt.previewClass} style={{ width: '100%', height: '60px', borderRadius: '8px', border: '1px solid var(--settings-border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                        {Icon && <Icon size={24} style={{ color: 'var(--text-secondary)' }} />}
                                                                    </div>
                                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                                                        <span style={{ fontSize: '0.85rem', fontWeight: '600', color: theme === opt.id ? 'var(--gnosi-blue)' : 'var(--text-primary)' }}>{t(opt.label)}</span>
                                                                        <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: '2px solid', borderColor: theme === opt.id ? 'var(--gnosi-blue)' : 'var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                            {theme === opt.id && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gnosi-blue)' }} />}
                                                                        </div>
                                                                    </div>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', borderRadius: '12px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={localSettings.reduce_animations || false} onChange={e => setLocalSettings(prev => ({ ...prev, reduce_animations: e.target.checked }))} />
                                                    <span style={{ fontSize: '0.9rem', fontWeight: '500' }}>{t('settings.appearance.reduce_animations')}</span>
                                                </label>
                                            </div>
                                        </section>
                                    </div>
                                )}

                                {activeTab === 'calendar' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                        <section className="settings-section">
                                            <div className="settings-section__header">
                                                <Calendar size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{t('settings.calendar.title')}</h3>
                                            </div>
                                            <div className="settings-section__content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                                <div className="setting-control">
                                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '8px' }}>{t('settings.calendar.account_title')}</label>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '15px', background: 'var(--settings-section-bg)', borderRadius: '12px', border: '1px solid var(--settings-border)' }}>
                                                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: googleAuthConfigured ? '#10b981' : '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                                            {googleAuthConfigured ? <Check size={20} /> : <Mail size={20} />}
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{googleAuthConfigured ? 'Google Calendar' : t('settings.calendar.not_connected')}</div>
                                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{googleAuthConfigured ? t('settings.calendar.connected_status') : t('settings.calendar.connect_desc')}</div>
                                                        </div>
                                                        <button onClick={() => window.location.href = '/api/auth/google/login'} className="btn-gnosi-primary" style={{ padding: '8px 16px' }}>
                                                            {googleAuthConfigured ? t('common.reconnect') : t('common.connect')}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </section>
                                    </div>
                                )}

                                {activeTab === 'graph' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                        <section className="settings-section">
                                            <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                                <Sliders size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('settings.graph.visualization')}</h3>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                                <div className="setting-control">
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                                        <input type="checkbox" checked={graphConfig.show_arrows} onChange={e => setGraphConfig(prev => ({ ...prev, show_arrows: e.target.checked }))} />
                                                        {t('settings.graph.show_arrows')}
                                                    </label>
                                                </div>
                                                <div className="setting-control">
                                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>{t('settings.graph.node_size')} ({parseFloat(graphConfig.node_size || 1).toFixed(1)})</label>
                                                    <input type="range" min="0.1" max="5" step="0.1" value={graphConfig.node_size || 1} onChange={e => setGraphConfig(prev => ({ ...prev, node_size: parseFloat(e.target.value) }))} style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }} />
                                                </div>
                                            </div>
                                        </section>
                                        <section className="settings-section">
                                            <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                                <Zap size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('settings.graph.physics')}</h3>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                                <div className="setting-control">
                                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>{t('settings.graph.gravity')} ({graphConfig.physics?.gravity || 0.1})</label>
                                                    <input type="range" min="0" max="2" step="0.05" value={graphConfig.physics?.gravity || 0.1} onChange={e => setGraphConfig(prev => ({ ...prev, physics: { ...prev.physics, gravity: parseFloat(e.target.value) } }))} style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }} />
                                                </div>
                                                <div className="setting-control">
                                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>{t('settings.graph.repulsion')} ({graphConfig.physics?.repulsion || 1000})</label>
                                                    <input type="range" min="0" max="10000" step="100" value={graphConfig.physics?.repulsion || 1000} onChange={e => setGraphConfig(prev => ({ ...prev, physics: { ...prev.physics, repulsion: parseInt(e.target.value) } }))} style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }} />
                                                </div>
                                            </div>
                                        </section>
                                    </div>
                                )}

                                {activeTab === 'newsletters' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                        <section className="settings-section">
                                            <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                                <Mail size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('settings.newsletters.subscriptions_title')}</h3>
                                            </div>
                                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>{t('settings.newsletters.subscriptions_desc')}</p>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 180px auto', gap: '10px', marginBottom: '16px' }}>
                                                <input type="text" value={newsletterName} onChange={(e) => setNewsletterName(e.target.value)} placeholder={t('settings.newsletters.name_placeholder')} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                <input type="text" value={newsletterAddress} onChange={(e) => setNewsletterAddress(e.target.value)} placeholder={newsletterType === 'rss' ? t('settings.newsletters.rss_placeholder') : newsletterType === 'youtube' ? t('settings.newsletters.youtube_placeholder') : t('settings.newsletters.email_placeholder')} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                <select value={newsletterType} onChange={(e) => setNewsletterType(e.target.value)} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                                                    <option value="rss">RSS</option>
                                                    <option value="newsletter">Newsletter</option>
                                                    <option value="youtube">YouTube</option>
                                                </select>
                                                <button onClick={handleAddNewsletter} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: '8px', border: 'none', background: 'var(--gnosi-blue)', color: 'white', cursor: 'pointer', fontWeight: 600 }}>
                                                    <Plus size={16} /> {t('settings.newsletters.add_btn')}
                                                </button>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                                                <input ref={newsletterOpmlRef} type="file" accept=".opml,.xml" onChange={(e) => handleNewsletterOpmlUpload(e.target.files?.[0])} style={{ display: 'none' }} />
                                                <button onClick={() => newsletterOpmlRef.current?.click()} disabled={newsletterOpmlLoading} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-btn-bg)', color: 'var(--text-primary)', cursor: newsletterOpmlLoading ? 'not-allowed' : 'pointer', opacity: newsletterOpmlLoading ? 0.7 : 1, fontWeight: 500 }}>
                                                    <Mail size={14} /> {newsletterOpmlLoading ? t('settings.newsletters.importing_opml') : t('settings.newsletters.import_opml')}
                                                </button>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                {newsletterLoading ? <p>{t('settings.newsletters.loading_subscriptions')}</p> : newsletterSources.length === 0 ? <p>{t('settings.newsletters.no_subscriptions')}</p> : newsletterSources.map(source => (
                                                    <div key={source.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--settings-border)', borderRadius: '10px' }}>
                                                        <div>
                                                            <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>{source.name} <span style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'rgba(59,130,246,0.1)', color: 'var(--gnosi-blue)', borderRadius: '10px' }}>{source.type}</span></div>
                                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{source.url}</div>
                                                        </div>
                                                        <button onClick={() => handleDeleteNewsletter(source.id)} style={{ color: '#ef4444' }}><Trash2 size={16} /></button>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    </div>
                                )}

                                {activeTab === 'contacts' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                        <section className="settings-section">
                                            <div className="settings-section__header">
                                                <Users size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{t('settings.contacts.title') || 'Contactes'}</h3>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '15px' }}>
                                                <div style={{ padding: '15px', background: 'var(--settings-section-bg)', borderRadius: '12px', border: '1px solid var(--settings-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <Globe size={20} />
                                                        <div>
                                                            <div style={{ fontWeight: 600 }}>Sincronització Global</div>
                                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Sincronitza tots els comptes de contactes configurats.</div>
                                                        </div>
                                                    </div>
                                                    <button onClick={() => axios.post('/api/contacts/sync')} className="btn-gnosi-primary" style={{ padding: '8px 16px' }}>
                                                        Sincronitza comptes
                                                    </button>
                                                </div>
                                            </div>
                                        </section>
                                    </div>
                                )}

                                {activeTab === 'mail_accounts' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                        <section className="settings-section">
                                            <div className="settings-section__header">
                                                <Mail size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{t('settings.tabs.mail_accounts')}</h3>
                                            </div>
                                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '15px' }}>Configura els teus comptes de correu IMAP/SMTP.</p>
                                            <button className="btn-gnosi-secondary" style={{ width: '100%', padding: '12px' }}>Pròximament</button>
                                        </section>
                                    </div>
                                )}

                                {activeTab === 'ai' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                        <section className="settings-section">
                                            <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <Zap size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('settings.ai.providers_title')}</h3>
                                                </div>
                                                <button onClick={openAddProviderModal} className="btn-gnosi-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>+ {t('settings.ai.add_provider_btn')}</button>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
                                                {Object.entries(aiProviders).map(([pId, config]) => (
                                                    <div key={pId} className="provider-card" onClick={() => setEditingProvider({ id: pId, ...config, name: getProviderName(pId), pending_api_key: '' })} style={{ padding: '15px', background: 'var(--settings-section-bg)', border: '1px solid var(--settings-border)', borderRadius: '12px', cursor: 'pointer' }}>
                                                        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>{LLM_PROVIDERS_META[pId]?.icon} {getProviderName(pId)}</div>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{config.has_api_key ? '✅ Connectat' : '❌ No configurat'}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                        <section className="settings-section">
                                            <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <Cpu size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('settings.ai.agents_title')}</h3>
                                                </div>
                                                <button onClick={() => setEditingAgent({ id: 'agent_' + Date.now(), name: 'Nou Agent', icon: '🤖', persona: '', provider: 'groq', model: '', enabled: true })} className="btn-gnosi-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>+ Nou Agent</button>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '15px' }}>
                                                {aiAgents.map(agent => (
                                                    <div key={agent.id} onClick={() => setEditingAgent({ ...agent })} style={{ padding: '15px', background: activeAgentId === agent.id ? 'rgba(59,130,246,0.1)' : 'var(--settings-section-bg)', border: '1.5px solid', borderColor: activeAgentId === agent.id ? 'var(--gnosi-blue)' : 'var(--settings-border)', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <span style={{ fontSize: '1.5rem' }}>{agent.icon || '🤖'}</span>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{agent.name}</div>
                                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{agent.provider} • {agent.model || 'Auto'}</div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    </div>
                                )}

                                {activeTab === 'zotero' && zoteroConfig && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                        <section className="settings-section">
                                            <div className="settings-section__header">
                                                <BookOpen size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{t('settings.zotero.title')}</h3>
                                            </div>
                                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('settings.zotero.description')}</p>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '6px' }}>{t('settings.zotero.target_table')}</label>
                                                    <select value={zoteroConfig.target_table || ''} onChange={e => setZoteroConfig(prev => ({ ...prev, target_table: e.target.value }))} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}>
                                                        <option value="">{t('settings.zotero.select_table_placeholder')}</option>
                                                        {zoteroTables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                                    </select>
                                                </div>
                                                <button onClick={handleZoteroSync} disabled={zoteroSyncing} className="btn-gnosi-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px' }}>
                                                    <RefreshCw size={16} className={zoteroSyncing ? 'spin-anim' : ''} /> {t('settings.zotero.sync_btn')}
                                                </button>
                                            </div>
                                        </section>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="settings-modal__footer" style={{ padding: '16px 20px', borderTop: '1px solid var(--settings-border)', background: 'var(--settings-header-bg)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }}>
                        <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {saveStatus && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: saveStatus.includes('✅') ? '#10b981' : 'var(--text-secondary)', fontSize: '0.9rem', background: 'var(--settings-sidebar-bg)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--settings-border)' }}>
                                    {isSaving ? <RefreshCw size={14} className="spin-anim" /> : (saveStatus.includes('✅') ? <Check size={14} /> : <Info size={14} />)}
                                    {saveStatus}
                                </div>
                            )}
                        </div>
                        {hasUnappliedChanges && (
                            <button onClick={() => window.location.reload()} className="btn-gnosi-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <RefreshCw size={16} /> {t('common.refresh')} per aplicar
                            </button>
                        )}
                        <button onClick={onClose} className="btn-gnosi-secondary" style={{ padding: '10px 20px' }}>{t('settings.footer.close')}</button>
                    </div>
                </div>
            </div>

            {/* Overlays for Editors */}
            {editingProvider && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div onClick={() => setEditingProvider(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}></div>
                    <div style={{ position: 'relative', width: '100%', maxWidth: '450px', background: 'var(--settings-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)', padding: '20px' }}>
                        <h3 style={{ margin: '0 0 20px 0' }}>Sincronitzant {editingProvider.name}</h3>
                        <label style={{ display: 'block', marginBottom: '8px' }}>API Key</label>
                        <input type="password" value={editingProvider.pending_api_key} onChange={(e) => setEditingProvider({ ...editingProvider, pending_api_key: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }} />
                        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                            <button onClick={() => setEditingProvider(null)} className="btn-gnosi-secondary" style={{ flex: 1 }}>Cancellar</button>
                            <button onClick={async () => {
                                if (editingProvider.pending_api_key) {
                                    await fetch(`/api/ai/providers/${editingProvider.id}/credentials`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: editingProvider.pending_api_key }) });
                                }
                                setAiProviders(prev => ({ ...prev, [editingProvider.id]: { ...prev[editingProvider.id], has_api_key: true } }));
                                setEditingProvider(null);
                            }} className="btn-gnosi-primary" style={{ flex: 1 }}>Guardar</button>
                        </div>
                    </div>
                </div>
            )}

            {isAddProviderOpen && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div onClick={() => setIsAddProviderOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}></div>
                    <div style={{ position: 'relative', width: '100%', maxWidth: '450px', background: 'var(--settings-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)', padding: '20px' }}>
                        <h3 style={{ margin: '0 0 20px 0' }}>Afegir Proveïdor</h3>
                        <div style={{ position: 'relative' }}>
                            <button onClick={() => setIsProviderDropdownOpen(!isProviderDropdownOpen)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', textAlign: 'left' }}>
                                {getProviderName(newProviderDraft.providerId)}
                            </button>
                            {isProviderDropdownOpen && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--settings-bg)', border: '1px solid var(--settings-border)', borderRadius: '8px', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                                    {Object.keys(LLM_PROVIDERS_META).map(id => (
                                        <div key={id} onClick={() => selectProviderFromDropdown(id)} style={{ padding: '10px', cursor: 'pointer', borderBottom: '1px solid var(--settings-border)' }}>{LLM_PROVIDERS_META[id].name}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <input type="password" placeholder="API Key" value={newProviderDraft.apiKey} onChange={e => setNewProviderDraft(prev => ({ ...prev, apiKey: e.target.value }))} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', marginTop: '15px' }} />
                        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                            <button onClick={() => setIsAddProviderOpen(false)} className="btn-gnosi-secondary" style={{ flex: 1 }}>Cancellar</button>
                            <button onClick={async () => {
                                if (newProviderDraft.apiKey) {
                                    await fetch(`/api/ai/providers/${newProviderDraft.providerId}/credentials`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: newProviderDraft.apiKey }) });
                                }
                                setAiProviders(prev => ({ ...prev, [newProviderDraft.providerId]: { source: 'user', has_api_key: true } }));
                                setIsAddProviderOpen(false);
                            }} className="btn-gnosi-primary" style={{ flex: 1 }}>Afegir</button>
                        </div>
                    </div>
                </div>
            )}

            {editingAgent && (
                 <div style={{ position: 'fixed', inset: 0, zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div onClick={() => setEditingAgent(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}></div>
                    <div style={{ position: 'relative', width: '100%', maxWidth: '500px', background: 'var(--settings-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)', padding: '20px' }}>
                        <h3 style={{ margin: '0 0 15px 0' }}>Editor d'Agent</h3>
                        <label style={{ display: 'block', marginBottom: '5px' }}>Nom</label>
                        <input type="text" value={editingAgent.name} onChange={e => setEditingAgent({ ...editingAgent, name: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', marginBottom: '15px' }} />
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '5px' }}>Proveïdor</label>
                                <select value={editingAgent.provider} onChange={e => setEditingAgent({ ...editingAgent, provider: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}>
                                    {Object.keys(aiProviders).map(id => <option key={id} value={id}>{getProviderName(id)}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '5px' }}>Model</label>
                                <input type="text" value={editingAgent.model} onChange={e => setEditingAgent({ ...editingAgent, model: e.target.value })} list="agent-models" style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }} />
                                <datalist id="agent-models">
                                    {getProviderModels(editingAgent.provider).map(m => <option key={m} value={m} />)}
                                </datalist>
                            </div>
                        </div>

                        <label style={{ display: 'block', marginBottom: '5px' }}>Instruccions / Persona</label>
                        <textarea value={editingAgent.persona} onChange={e => setEditingAgent({ ...editingAgent, persona: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', minHeight: '100px', marginBottom: '20px' }} />

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setEditingAgent(null)} className="btn-gnosi-secondary" style={{ flex: 1 }}>Cancellar</button>
                            <button onClick={() => {
                                setAiAgents(prev => {
                                    const idx = prev.findIndex(a => a.id === editingAgent.id);
                                    if (idx > -1) { const n = [...prev]; n[idx] = editingAgent; return n; }
                                    return [...prev, editingAgent];
                                });
                                setEditingAgent(null);
                            }} className="btn-gnosi-primary" style={{ flex: 1 }}>Guardar Agent</button>
                        </div>
                    </div>
                 </div>
            )}

            <FolderPickerModal
                isOpen={pickerOpen && pickerField !== 'agent_icon'}
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
