import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Globe, Palette, RefreshCw, Info, ExternalLink, Monitor, BookOpen, Save, Check, FolderOpen, Database, Cpu, Zap, Settings as SettingsIcon, Sliders, Calendar, Mail, Trash2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FolderPickerModal } from './FolderPickerModal';
import { IconPicker, NOTION_COLORS } from './Vault/IconPicker';
import axios from 'axios';
import * as LucideIcons from 'lucide-react';

const LANGUAGES = [
    { code: 'ca', label: 'Català', icon: '🏴󠁥󠁳󠁣󠁡󠁿' },
    { code: 'es', label: 'Español', icon: '🇪🇸' },
    { code: 'en', label: 'English', icon: '🇬🇧' },
    { code: 'fr', label: 'Français', icon: '🇫🇷' },
];

const THEME_OPTIONS = [
    { id: 'light', label: 'Clar', previewClass: 'settings-theme-preview--light', disabled: false },
    { id: 'dark', label: 'Fosc', previewClass: 'settings-theme-preview--dark', disabled: false },
    { id: 'system', label: 'Sistema', icon: Monitor, disabled: false },
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
    'cloudflare-ai-gateway': { name: 'Cloudflare AI Gateway', icon: '🛡️', color: '#f97316', description: 'Gateway unificat multi-proveïdor.', baseUrl: '' },
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
        timezone: '',
        currency: '',
        week_start: 1,
        use_system_defaults: true
    });
    const [calendarWizard, setCalendarWizard] = useState(null); // { step: 'ask_email' | 'configure', email: '', provider: 'google' | 'icloud' | 'custom' }
    const [emailWizard, setEmailWizard] = useState(null); // { step: 'ask_email' | 'configure', email: '', provider: 'google' | 'icloud' | 'pangea' | 'custom' }
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

    const [aiAgents, setAiAgents] = useState([]);
    const [aiProviders, setAiProviders] = useState({});
    const [aiCatalog, setAiCatalog] = useState({});
    const [activeAgentId, setActiveAgentId] = useState('');
    const [editingAgent, setEditingAgent] = useState(null);

    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerField, setPickerField] = useState(null); // 'vault', 'databases', 'newsletters'
    const [editingProvider, setEditingProvider] = useState(null); // { id, name, api_key, base_url, source, ... }
    const [isAddProviderOpen, setIsAddProviderOpen] = useState(false);
    const [newProviderDraft, setNewProviderDraft] = useState({ providerId: 'groq', apiKey: '', secretValue: '', baseUrl: '' });
    const [providerSearchQuery, setProviderSearchQuery] = useState('');
    const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
    const [highlightedProviderId, setHighlightedProviderId] = useState('');

    // Theme application is now handled globally in App.jsx via db-theme-changed event
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

    useEffect(() => {
        if (!isOpen || activeTab !== 'newsletters') return;
        loadNewsletterSources();
    }, [isOpen, activeTab]);

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
                
                // AI Config
                if (cfg.ai) {
                    setAiAgents(cfg.ai.agents || []);
                    setActiveAgentId(cfg.ai.active_agent_id || '');
                }
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
                    if (!providerCfg || providerCfg.source !== 'user') {
                        return acc;
                    }
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
            if (channelMatch?.[1]) {
                return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelMatch[1]}`;
            }
            return value;
        };

        const normalizedAddress = newsletterType === 'youtube'
            ? normalizeYoutubeUrl(sourceAddress)
            : sourceAddress;

        const normalizedCategory = newsletterType === 'rss'
            ? 'RSS'
            : newsletterType === 'youtube'
                ? 'YouTube'
                : 'Newsletters';

        setNewsletterStatus('Afegint subscripció...');
        try {
            const res = await fetch('/api/reader/sources', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: sourceName,
                    url: normalizedAddress,
                    category: normalizedCategory,
                    type: newsletterType
                })
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

            const res = await fetch('/api/reader/sources/opml', {
                method: 'POST',
                body: formData,
            });

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
            if (newsletterOpmlRef.current) {
                newsletterOpmlRef.current.value = '';
            }
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

    const handleLanguageChange = (code) => {
        i18n.changeLanguage(code);
        setLocalSettings(prev => ({ ...prev, language: code }));
    };

    const handleSaveGlobal = async () => {
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
                // Save main config
                axios.post('/api/config', updatedConfig),
                // Save all integrations (bulk)
                axios.post('/api/integrations/bulk', integrations)
            ];

            // Save Zotero config if available
            if (zoteroConfig) {
                savePromises.push(axios.post('/api/zotero/config', zoteroConfig));
            }

            const results = await Promise.all(savePromises);
            const allOk = results.every(res => res.status >= 200 && res.status < 300);

            if (allOk) {
                setSaveStatus('✅ Guardat!');
                setTimeout(() => {
                    setSaveStatus('');
                    window.location.reload();
                }, 1000);
            } else {
                setSaveStatus('❌ Error al guardar');
            }
        } catch (err) {
            console.error("Error saving global config:", err);
            setSaveStatus('❌ Error de connexió');
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
                setSyncMessage('⏳ Ja en curs...');
            } else if (res.ok) {
                setSyncMessage('✅ Sincronització completada!');
            } else {
                setSyncMessage('❌ Error al sincronitzar');
            }
        } catch {
            setSyncMessage('❌ No s\'ha pogut connectar');
        } finally {
            setSyncing(false);
        }
    };


    const handleZoteroSync = async () => {
        if (zoteroSyncing) return;
        setZoteroSyncing(true);
        try {
            const res = await fetch('/api/zotero/sync', { method: 'POST' });
            if (res.ok) {
                alert('Sincronització de Zotero iniciada!');
            } else {
                alert('Error al iniciar la sincronització');
            }
        } catch {
            alert('Error de connexió');
        } finally {
            setZoteroSyncing(false);
        }
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

    const getProviderName = (providerId) => {
        return LLM_PROVIDERS_META[providerId]?.name || providerId;
    };

    const getProviderCategory = (providerId) => {
        return PROVIDER_CATEGORY_MAP[providerId] || 'Specialized APIs';
    };

    const getFilteredProviderIds = (query) => {
        const q = (query || '').trim().toLowerCase();
        const ids = Object.keys(LLM_PROVIDERS_META).filter(p => p !== 'custom');
        if (!q) return ids;
        return ids.filter((providerId) => {
            const meta = LLM_PROVIDERS_META[providerId] || {};
            return [providerId, meta.name, meta.description]
                .filter(Boolean)
                .some(value => String(value).toLowerCase().includes(q));
        });
    };

    const getGroupedProviderOptions = (query) => {
        const filteredIds = getFilteredProviderIds(query);
        const grouped = PROVIDER_CATEGORY_ORDER.map((category) => {
            const options = filteredIds
                .filter(providerId => getProviderCategory(providerId) === category)
                .sort((a, b) => getProviderName(a).localeCompare(getProviderName(b)));
            return { category, options };
        }).filter(group => group.options.length > 0);
        return grouped;
    };

    const groupedProviderOptions = useMemo(
        () => getGroupedProviderOptions(providerSearchQuery),
        [providerSearchQuery]
    );

    const flatProviderOptionIds = useMemo(
        () => groupedProviderOptions.flatMap(group => group.options),
        [groupedProviderOptions]
    );

    const selectProviderFromDropdown = (providerId) => {
        setNewProviderDraft(prev => ({
            ...prev,
            providerId,
            apiKey: '',
            secretValue: '',
            baseUrl: LLM_PROVIDERS_META[providerId]?.baseUrl || ''
        }));
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
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!flatProviderOptionIds.length) return;
            const currentIndex = flatProviderOptionIds.indexOf(highlightedProviderId);
            const nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
            setHighlightedProviderId(flatProviderOptionIds[nextIndex]);
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            if (highlightedProviderId) {
                selectProviderFromDropdown(highlightedProviderId);
            }
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            setIsProviderDropdownOpen(false);
        }
    };

    useEffect(() => {
        if (!isProviderDropdownOpen) return;

        if (!flatProviderOptionIds.length) {
            setHighlightedProviderId('');
            return;
        }

        setHighlightedProviderId((prev) => {
            if (prev && flatProviderOptionIds.includes(prev)) {
                return prev;
            }
            if (flatProviderOptionIds.includes(newProviderDraft.providerId)) {
                return newProviderDraft.providerId;
            }
            return flatProviderOptionIds[0];
        });
    }, [isProviderDropdownOpen, flatProviderOptionIds, newProviderDraft.providerId]);

    useEffect(() => {
        if (!isProviderDropdownOpen || !highlightedProviderId) return;

        const optionElement = document.getElementById(`provider-option-${highlightedProviderId}`);
        if (optionElement) {
            optionElement.scrollIntoView({ block: 'nearest' });
        }
    }, [isProviderDropdownOpen, highlightedProviderId]);

    const renderHighlightedText = (text, query) => {
        const value = String(text || '');
        const q = String(query || '').trim();
        if (!q) return value;
        const lowerValue = value.toLowerCase();
        const lowerQuery = q.toLowerCase();
        const start = lowerValue.indexOf(lowerQuery);
        if (start < 0) return value;
        const end = start + q.length;
        return (
            <>
                {value.slice(0, start)}
                <mark style={{ background: 'rgba(59,130,246,0.2)', color: 'var(--text-primary)', borderRadius: '4px', padding: '0 2px' }}>
                    {value.slice(start, end)}
                </mark>
                {value.slice(end)}
            </>
        );
    };

    const openAddProviderModal = () => {
        const firstProvider = Object.keys(LLM_PROVIDERS_META).find(p => p !== 'custom') || 'groq';
        setNewProviderDraft({
            providerId: firstProvider,
            apiKey: '',
            secretValue: '',
            baseUrl: LLM_PROVIDERS_META[firstProvider]?.baseUrl || ''
        });
        setProviderSearchQuery('');
        setIsProviderDropdownOpen(false);
        setIsAddProviderOpen(true);
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="settings-overlay" onClick={onClose}>
                <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
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
                            {[
                                { id: 'general', label: 'General', icon: Globe },
                                { id: 'integrations', label: 'Integracions', icon: Zap },
                                { id: 'newsletters', label: 'Subscripcions', icon: Mail },
                                { id: 'graph', label: 'Graf', icon: Database },
                                { id: 'ai', label: 'AI', icon: Cpu },
                                { id: 'notion', label: 'Notion', icon: RefreshCw },
                                { id: 'zotero', label: 'Zotero', icon: BookOpen }
                            ].map(tab => (
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
                                            {THEME_OPTIONS.map(({ id, label, icon: Icon, disabled }) => (
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
                                                    <span style={{ fontSize: '0.85rem', fontWeight: theme === id ? '600' : '400' }}>{label}</span>
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
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Configura aquí de forma segura els comptes externs. Cada compte desa les credencials de forma independent.</p>
                                    </div>

                                    {/* Email Settings */}
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <RefreshCw size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Comptes de Correu (IMAP/SMTP)</h3>
                                            </div>
                                            {!emailWizard && (
                                                <button onClick={() => setEmailWizard({ step: 'ask_email', email: '' })} style={{ padding: '6px 12px', borderRadius: '8px', background: 'var(--settings-sidebar-bg)', color: 'var(--text-primary)', border: '1px solid var(--settings-border)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}>+ Afegir Compte</button>
                                            )}
                                        </div>

                                        {emailWizard && (
                                            <div style={{ background: 'rgba(59, 130, 246, 0.05)', padding: '20px', borderRadius: '12px', border: '1px solid var(--gnosi-blue)', marginBottom: '20px' }}>
                                                {emailWizard.step === 'ask_email' ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                        <label style={{ fontSize: '0.9rem', fontWeight: '600' }}>Introdueix l'adreça de correu</label>
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
                                                                Continuar
                                                            </button>
                                                            <button onClick={() => setEmailWizard(null)} style={{ padding: '10px', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel·lar</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ fontSize: '0.9rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                {emailWizard.provider === 'google' && <span style={{ fontSize: '1.2rem' }}>🌐</span>}
                                                                {emailWizard.provider === 'icloud' && <span style={{ fontSize: '1.2rem' }}>☁️</span>}
                                                                {emailWizard.provider === 'pangea' && <span style={{ fontSize: '1.2rem' }}>📧</span>}
                                                                Configurant compte {emailWizard.email}
                                                            </span>
                                                            <button onClick={() => setEmailWizard({ ...emailWizard, step: 'ask_email' })} style={{ fontSize: '0.8rem', color: 'var(--gnosi-blue)', background: 'none', border: 'none', cursor: 'pointer' }}>Canviar email</button>
                                                        </div>

                                                        {emailWizard.provider === 'google' && (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #4285F4' }}>
                                                                    <div style={{ fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <span style={{ fontSize: '1.2rem' }}>🌐</span> Recomanat: Connectar directament
                                                                    </div>
                                                                    Evita les configuracions manuals i connecta amb Google OAuth2.
                                                                    {!googleAuthConfigured ? (
                                                                        <div style={{ marginTop: '12px', color: '#ef4444', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                                                            ⚠️ <strong>Configuració requerida:</strong> No s'han trobat credencials de Google OAuth vàlides al fitxer <code>.env_shared</code>. Configura el <code>CLIENT_ID</code> i <code>CLIENT_SECRET</code> per activar-ho.
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
                                                                    — o bé manualment —
                                                                </div>
                                                            </div>
                                                        )}

                                                        {emailWizard.provider === 'icloud' && (
                                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)', padding: '10px', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
                                                                <strong>Nota:</strong> Has d'utilitzar una <strong>Contrasenya d'Aplicació</strong>.
                                                                <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noreferrer" style={{ color: 'var(--gnosi-blue)', marginLeft: '5px', textDecoration: 'underline' }}>ID d'Apple <ExternalLink size={12} style={{ display: 'inline' }} /></a>
                                                            </div>
                                                        )}

                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Servidor IMAP</label>
                                                                <input
                                                                    type="text"
                                                                    id="email_wizard_imap"
                                                                    defaultValue={emailWizard.provider === 'google' ? 'imap.gmail.com' : (emailWizard.provider === 'icloud' ? 'imap.mail.me.com' : (emailWizard.provider === 'pangea' ? 'mail.pangea.org' : ''))}
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Servidor SMTP</label>
                                                                <input
                                                                    type="text"
                                                                    id="email_wizard_smtp"
                                                                    defaultValue={emailWizard.provider === 'google' ? 'smtp.gmail.com' : (emailWizard.provider === 'icloud' ? 'smtp.mail.me.com' : (emailWizard.provider === 'pangea' ? 'smtp.pangea.org' : ''))}
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </div>
                                                            <div style={{ gridColumn: 'span 2' }}>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Contrasenya / App Password</label>
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
                                                                        alert('Cal omplir tots els camps');
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
                                                                Afegir Compte
                                                            </button>
                                                            <button onClick={() => setEmailWizard(null)} style={{ padding: '10px', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel·lar</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                            {(integrations?.emails || []).map((account, index) => (
                                                <div key={account.id || index} style={{ background: 'rgba(0,0,0,0.02)', padding: '15px', borderRadius: '12px', border: '1px solid var(--settings-border)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                                        <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>Compte {index + 1} {account.password_status === 'connected' && <span style={{ fontSize: '0.75rem', background: '#10b98122', color: '#059669', padding: '2px 8px', borderRadius: '12px', marginLeft: '10px' }}>Connectat ✅</span>}</span>
                                                        <button onClick={() => handleRemoveIntegrationItem('emails', index)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>Eliminar</button>
                                                    </div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>IMAP Server</label>
                                                            <input type="text" value={account.imap_server || ''} onChange={(e) => handleUpdateIntegrationItem('emails', index, 'imap_server', e.target.value)} placeholder="imap.gmail.com" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>SMTP Server</label>
                                                            <input type="text" value={account.smtp_server || ''} onChange={(e) => handleUpdateIntegrationItem('emails', index, 'smtp_server', e.target.value)} placeholder="smtp.gmail.com" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Adreça Email</label>
                                                            <input type="email" value={account.username || ''} onChange={(e) => handleUpdateIntegrationItem('emails', index, 'username', e.target.value)} placeholder="nom@exemple.com" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Contrasenya / App Password</label>
                                                            <input type="password" placeholder={account.password_status === 'connected' ? '******** (Modifica per actualitzar)' : '••••••••'} onChange={(e) => handleUpdateIntegrationItem('emails', index, 'password', e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div style={{ gridColumn: 'span 2' }}>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Signatura (HTML)</label>
                                                            <textarea
                                                                value={account.html_signature || ''}
                                                                onChange={(e) => handleUpdateIntegrationItem('emails', index, 'html_signature', e.target.value)}
                                                                placeholder="<p>Atentament, <b>Ismael</b></p>"
                                                                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem', minHeight: '80px', fontFamily: 'monospace' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            {!(integrations?.emails?.length > 0) && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '10px' }}>Cap compte de correu configurat. Prem "+ Afegir Compte" per començar.</p>}
                                        </div>
                                    </section>

                                    {/* Calendar Settings */}
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <Calendar size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Calendaris (Google / CalDAV)</h3>
                                            </div>
                                            {!calendarWizard && (
                                                <button onClick={() => setCalendarWizard({ step: 'ask_email', email: '' })} style={{ padding: '6px 12px', borderRadius: '8px', background: 'var(--settings-sidebar-bg)', color: 'var(--text-primary)', border: '1px solid var(--settings-border)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}>+ Afegir Calendari</button>
                                            )}
                                        </div>

                                        {calendarWizard && (
                                            <div style={{ background: 'rgba(59, 130, 246, 0.05)', padding: '20px', borderRadius: '12px', border: '1px solid var(--gnosi-blue)', marginBottom: '20px' }}>
                                                {calendarWizard.step === 'ask_email' ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                        <label style={{ fontSize: '0.9rem', fontWeight: '600' }}>Introdueix l'adreça de correu o identificador</label>
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
                                                                Continuar
                                                            </button>
                                                            <button onClick={() => setCalendarWizard(null)} style={{ padding: '10px', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel·lar</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ fontSize: '0.9rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                {calendarWizard.provider === 'google' && <span style={{ fontSize: '1.2rem' }}>🌐</span>}
                                                                {calendarWizard.provider === 'icloud' && <span style={{ fontSize: '1.2rem' }}>☁️</span>}
                                                                Configurant {calendarWizard.email} ({calendarWizard.provider})
                                                            </span>
                                                            <button onClick={() => setCalendarWizard({ ...calendarWizard, step: 'ask_email' })} style={{ fontSize: '0.8rem', color: 'var(--gnosi-blue)', background: 'none', border: 'none', cursor: 'pointer' }}>Canviar email</button>
                                                        </div>

                                                        {calendarWizard.provider === 'google' && (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #4285F4' }}>
                                                                    <div style={{ fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <span style={{ fontSize: '1.2rem' }}>🌐</span> Recomanat: Connectar directament
                                                                    </div>
                                                                    Per evitar configurar contrasenyes d'aplicació manuals, pots connectar el teu compte de Google directament per sincronitzar calendaris i correu.
                                                                    {!googleAuthConfigured ? (
                                                                        <div style={{ marginTop: '12px', color: '#ef4444', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                                                            ⚠️ <strong>Configuració requerida:</strong> No s'han trobat credencials de Google OAuth vàlides.
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
                                                                    — o bé manualment —
                                                                </div>
                                                            </div>
                                                        )}

                                                        {calendarWizard.provider === 'icloud' && (
                                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)', padding: '10px', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
                                                                <strong>Nota:</strong> Per a iCloud, necessites una contrasenya específica per a aplicacions.
                                                                <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noreferrer" style={{ color: 'var(--gnosi-blue)', marginLeft: '5px', textDecoration: 'underline' }}>Gestiona el teu ID d'Apple <ExternalLink size={12} style={{ display: 'inline' }} /></a>
                                                            </div>
                                                        )}

                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Nom personalitzat (Ex: Feina, Personal...)</label>
                                                                <input
                                                                    type="text"
                                                                    placeholder="Calendari Personal"
                                                                    id="wizard_name"
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Servidor / URL CalDAV</label>
                                                                <input
                                                                    type="text"
                                                                    defaultValue={calendarWizard.provider === 'icloud' ? 'caldav.icloud.com' : (calendarWizard.provider === 'google' ? 'https://apidata.googleusercontent.com/caldav/v1/calendars/primary/events' : '')}
                                                                    placeholder="https://servidor.com/caldav"
                                                                    id="wizard_url"
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Contrasenya / App Password</label>
                                                                <input
                                                                    type="password"
                                                                    placeholder="••••••••"
                                                                    id="wizard_token"
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </div>
                                                        </div>

                                                        <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                                                            <button
                                                                onClick={() => {
                                                                    const name = document.getElementById('wizard_name').value || calendarWizard.email;
                                                                    const url = document.getElementById('wizard_url').value;
                                                                    const token = document.getElementById('wizard_token').value;

                                                                    if (!url || !token) {
                                                                        alert('Cal omplir la URL i la contrasenya');
                                                                        return;
                                                                    }

                                                                    const newCalendar = {
                                                                        id: 'new_' + Date.now().toString(),
                                                                        name,
                                                                        url,
                                                                        token,
                                                                        username: calendarWizard.email,
                                                                        provider: calendarWizard.provider
                                                                    };

                                                                    const updatedCalendars = [...(Array.isArray(integrations.calendars) ? integrations.calendars : []), newCalendar];
                                                                    setIntegrations(prev => ({
                                                                        ...prev,
                                                                        calendars: updatedCalendars
                                                                    }));
                                                                    setCalendarWizard(null);
                                                                }}
                                                                style={{ padding: '10px 20px', borderRadius: '8px', background: 'var(--gnosi-blue)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: '600' }}
                                                            >
                                                                Afegir
                                                            </button>
                                                            <button onClick={() => setCalendarWizard(null)} style={{ padding: '10px', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel·lar</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                            {(integrations?.calendars || []).map((account, index) => (
                                                <div key={account.id || index} style={{ background: 'rgba(0,0,0,0.02)', padding: '15px', borderRadius: '12px', border: '1px solid var(--settings-border)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                                        <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>{account.name || account.email || account.username || `Calendari ${index + 1}`} {account.token_status === 'connected' && <span style={{ fontSize: '0.75rem', background: '#10b98122', color: '#059669', padding: '2px 8px', borderRadius: '12px', marginLeft: '10px' }}>Connectat ✅</span>}</span>
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
                                                                Predeterminat
                                                            </label>
                                                            <input
                                                                type="color"
                                                                value={account.color || '#e5e7eb'}
                                                                onChange={(e) => handleUpdateIntegrationItem('calendars', index, 'color', e.target.value)}
                                                                style={{ width: '20px', height: '20px', padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: '4px' }}
                                                            />
                                                            <button onClick={() => handleRemoveIntegrationItem('calendars', index)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>Eliminar</button>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px' }}>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Nom / Identificador</label>
                                                            <input type="text" value={account.name || ''} onChange={(e) => handleUpdateIntegrationItem('calendars', index, 'name', e.target.value)} placeholder="Ex: Feina, Personal..." style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Servidor / URL</label>
                                                            <input type="text" value={account.url || ''} onChange={(e) => handleUpdateIntegrationItem('calendars', index, 'url', e.target.value)} placeholder="https://..." style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Token d'Açcés / Autenticació</label>
                                                            <input type="password" placeholder={account.token_status === 'connected' ? '******** (Modifica per actualitzar)' : '••••••••'} onChange={(e) => handleUpdateIntegrationItem('calendars', index, 'token', e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            {!(integrations?.calendars?.length > 0) && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '10px' }}>Cap calendari configurat. Prem "+ Afegir Calendari" per començar.</p>}
                                        </div>
                                    </section>

                                    {/* Vault Tables for Calendar */}
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <Database size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Taules de la Vault al Calendari</h3>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Color per defecte:</span>
                                                <input
                                                    type="color"
                                                    value={integrations?.vault_calendar?.color || '#e57373'}
                                                    onChange={(e) => {
                                                        const newVal = e.target.value;
                                                        const updated = { ...integrations.vault_calendar, color: newVal };
                                                        setIntegrations(prev => ({ ...prev, vault_calendar: updated }));
                                                    }}
                                                    style={{ width: '20px', height: '20px', padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: '4px' }}
                                                />
                                            </div>
                                        </div>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '15px' }}>Selecciona quines taules vols que mostrin els seus registres amb data al calendari.</p>
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
                                            ))}                                        </div>
                                    </section>
                                </div>
                            )}

                            {activeTab === 'graph' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                            <Sliders size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Visualització</h3>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            <div className="setting-control">
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={graphConfig.show_arrows}
                                                        onChange={e => setGraphConfig(prev => ({ ...prev, show_arrows: e.target.checked }))}
                                                    />
                                                    Mostrar fletxes
                                                </label>
                                            </div>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>Mida dels nodes ({graphConfig.node_size.toFixed(1)})</label>
                                                <input
                                                    type="range" min="0.1" max="5" step="0.1"
                                                    value={graphConfig.node_size}
                                                    onChange={e => setGraphConfig(prev => ({ ...prev, node_size: parseFloat(e.target.value) }))}
                                                    style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }}
                                                />
                                            </div>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>Gruix dels enllaços ({graphConfig.edge_thickness.toFixed(1)})</label>
                                                <input
                                                    type="range" min="0.1" max="5" step="0.1"
                                                    value={graphConfig.edge_thickness}
                                                    onChange={e => setGraphConfig(prev => ({ ...prev, edge_thickness: parseFloat(e.target.value) }))}
                                                    style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }}
                                                />
                                            </div>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>Llindar d'etiquetes ({graphConfig.label_threshold})</label>
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
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Forces (Física)</h3>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>Gravetat ({graphConfig.physics.gravity})</label>
                                                <input
                                                    type="range" min="0" max="2" step="0.05"
                                                    value={graphConfig.physics.gravity}
                                                    onChange={e => setGraphConfig(prev => ({ ...prev, physics: { ...prev.physics, gravity: parseFloat(e.target.value) } }))}
                                                    style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }}
                                                />
                                            </div>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>Repulsió ({graphConfig.physics.repulsion})</label>
                                                <input
                                                    type="range" min="0" max="10000" step="100"
                                                    value={graphConfig.physics.repulsion}
                                                    onChange={e => setGraphConfig(prev => ({ ...prev, physics: { ...prev.physics, repulsion: parseInt(e.target.value) } }))}
                                                    style={{ width: '100%', accentColor: 'var(--gnosi-blue)' }}
                                                />
                                            </div>
                                            <div className="setting-control">
                                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '8px' }}>Fricció ({graphConfig.physics.friction})</label>
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
                                                    Mode Lin-Log
                                                </label>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                            <Database size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Visibilitat</h3>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                            <div>
                                                <h4 style={{ fontSize: '0.9rem', margin: '0 0 10px 0', color: 'var(--text-secondary)', borderBottom: '1px solid var(--settings-border)', paddingBottom: '5px' }}>Selecció Jeràrquica</h4>
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
                                                <h4 style={{ fontSize: '0.9rem', margin: '0 0 10px 0', color: 'var(--text-secondary)', borderBottom: '1px solid var(--settings-border)', paddingBottom: '5px' }}>Filtres de Taula (Barra lateral)</h4>
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>Selecciona quines taules voldràs filtrar individualment des de la barra lateral.</p>
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

                            {activeTab === 'newsletters' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                            <Mail size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Subscripcions de contingut</h3>
                                        </div>

                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                                            Gestiona subscripcions RSS, newsletters i canals de YouTube des d'un únic lloc.
                                        </p>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 180px auto', gap: '10px', marginBottom: '16px' }}>
                                            <input
                                                type="text"
                                                value={newsletterName}
                                                onChange={(e) => setNewsletterName(e.target.value)}
                                                placeholder="Nom (opcional)"
                                                style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                                            />
                                            <input
                                                type="text"
                                                value={newsletterAddress}
                                                onChange={(e) => setNewsletterAddress(e.target.value)}
                                                placeholder={newsletterType === 'rss' ? 'URL del feed RSS' : newsletterType === 'youtube' ? 'URL de canal YouTube o feed' : 'Email o identificador'}
                                                style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                                            />
                                            <select
                                                value={newsletterType}
                                                onChange={(e) => setNewsletterType(e.target.value)}
                                                style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                                            >
                                                <option value="rss">RSS</option>
                                                <option value="newsletter">Newsletter</option>
                                                <option value="youtube">YouTube</option>
                                            </select>
                                            <button
                                                onClick={handleAddNewsletter}
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: '8px', border: 'none', background: 'var(--gnosi-blue)', color: 'white', cursor: 'pointer', fontWeight: 600 }}
                                            >
                                                <Plus size={16} />
                                                Afegir
                                            </button>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                                            <input
                                                ref={newsletterOpmlRef}
                                                type="file"
                                                accept=".opml,.xml"
                                                onChange={(e) => handleNewsletterOpmlUpload(e.target.files?.[0])}
                                                style={{ display: 'none' }}
                                            />
                                            <button
                                                onClick={() => newsletterOpmlRef.current?.click()}
                                                disabled={newsletterOpmlLoading}
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-btn-bg)', color: 'var(--text-primary)', cursor: newsletterOpmlLoading ? 'not-allowed' : 'pointer', opacity: newsletterOpmlLoading ? 0.7 : 1, fontWeight: 500 }}
                                            >
                                                <Mail size={14} />
                                                {newsletterOpmlLoading ? 'Important OPML...' : 'Importar fitxer OPML'}
                                            </button>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Puja un export OPML de newsletters i feeds.</span>
                                        </div>

                                        {newsletterStatus && (
                                            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>{newsletterStatus}</p>
                                        )}

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            {newsletterLoading ? (
                                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Carregant subscripcions...</p>
                                            ) : newsletterSources.length === 0 ? (
                                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Encara no tens subscripcions configurades.</p>
                                            ) : (
                                                newsletterSources.map((source) => (
                                                    <div
                                                        key={source.id}
                                                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--settings-border)', borderRadius: '10px', padding: '12px' }}
                                                    >
                                                        <div style={{ minWidth: 0 }}>
                                                            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                {source.name}
                                                                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.02em', borderRadius: '999px', padding: '2px 8px', background: source.type === 'youtube' ? '#ef444422' : source.type === 'newsletter' ? '#0ea5e922' : '#22c55e22', color: source.type === 'youtube' ? '#b91c1c' : source.type === 'newsletter' ? '#0369a1' : '#166534' }}>
                                                                    {source.type || 'rss'}
                                                                </span>
                                                            </div>
                                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.url}</div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleDeleteNewsletter(source.id)}
                                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', border: '1px solid #ef444433', background: 'transparent', color: '#ef4444', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' }}
                                                        >
                                                            <Trash2 size={14} />
                                                            Eliminar
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </section>
                                </div>
                            )}

                            {activeTab === 'notion' && (
                                <section className="settings-section">
                                    <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                        <RefreshCw size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Sincronització de Notion</h3>
                                    </div>
                                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>{t('sync_desc')}</p>
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
                                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Zotero Sync</h3>
                                        </div>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '15px' }}>Configura la sincronització de la teva biblioteca local de Zotero.</p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Taula Destí</label>
                                                <select
                                                    value={zoteroConfig.target_table || ''}
                                                    onChange={e => setZoteroConfig(prev => ({ ...prev, target_table: e.target.value }))}
                                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                                                >
                                                    <option value="">Selecciona una taula...</option>
                                                    {zoteroTables.map(t => (
                                                        <option key={t.id} value={t.id}>{t.name}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="settings-mapping-list" style={{ background: 'rgba(0,0,0,0.02)', padding: '15px', borderRadius: '12px', border: '1px solid var(--settings-border)', maxHeight: '300px', overflowY: 'auto' }}>
                                                <h4 style={{ fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '12px' }}>Mapeig de Camps</h4>
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
                                                            <option value="">-- No mapar --</option>
                                                            {availableProperties.map(prop => (
                                                                <option key={prop.name} value={prop.name}>{prop.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                ))}
                                            </div>

                                                <button
                                                    onClick={handleZoteroSync}
                                                    disabled={zoteroSyncing}
                                                    style={{ flex: 1, padding: '10px', borderRadius: '8px', background: 'var(--gnosi-blue)', color: 'white', border: 'none', cursor: zoteroSyncing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                                >
                                                    <RefreshCw size={16} className={zoteroSyncing ? 'spin-anim' : ''} />
                                                    Sincronitzar
                                                </button>
                                        </div>
                                    </section>
                                </div>
                            )}

                            {activeTab === 'ai' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', flex: 1, overflow: 'auto', paddingRight: '10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '-10px' }}>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Configura els teus assistents d'IA i els proveïdors de models (Groq, OpenAI, Ollama, etc).</p>
                                    </div>

                                    {/* Providers Section */}
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <Zap size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Proveïdors de LLM</h3>
                                            </div>
                                            <button 
                                                onClick={openAddProviderModal}
                                                style={{ 
                                                    padding: '6px 12px', 
                                                    borderRadius: '8px', 
                                                    background: 'var(--gnosi-blue)', 
                                                    color: 'white', 
                                                    border: 'none', 
                                                    cursor: 'pointer', 
                                                    fontSize: '0.8rem', 
                                                    fontWeight: '600',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px'
                                                }}
                                            >
                                                <LucideIcons.Plus size={14} /> Afegir Proveïdor
                                            </button>
                                        </div>
                                        
                                        <div className="ai-provider-grid">
                                            {Object.entries(aiProviders).map(([pId, config]) => {
                                                const meta = LLM_PROVIDERS_META[pId] || LLM_PROVIDERS_META.custom;
                                                
                                                return (
                                                    <div 
                                                        key={pId} 
                                                        className="provider-card"
                                                        onClick={() => setEditingProvider({ id: pId, ...config, name: meta.name, pending_api_key: '' })}
                                                    >
                                                        <div className="provider-card__header">
                                                            <div className="provider-card__identity">
                                                                <div className="provider-card__logo" style={{ color: meta.color }}>
                                                                    {meta.icon}
                                                                </div>
                                                                <div className="provider-card__name">{meta.name}</div>
                                                            </div>
                                                        </div>
                                                        
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                                                            {meta.description}
                                                        </div>

                                                                                                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                                                                                                                    {getProviderRequirementLabels(pId).map((label) => (
                                                                                                                        <span key={`${pId}-${label}`} style={{ fontSize: '0.7rem', border: '1px solid var(--settings-border)', borderRadius: '999px', padding: '2px 8px', color: 'var(--text-secondary)' }}>
                                                                                                                            {label}
                                                                                                                        </span>
                                                                                                                    ))}
                                                                                                                </div>

                                                        <div className="provider-card__footer">
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <div className={`provider-card__indicator ${config.has_api_key ? 'provider-card__indicator--active' : ''}`} />
                                                                <span>{config.has_api_key ? 'Connectat' : 'Sense configurar'}</span>
                                                            </div>
                                                            <LucideIcons.ChevronRight size={14} style={{ opacity: 0.5 }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {Object.keys(aiProviders).length === 0 && (
                                                <div style={{ border: '1px dashed var(--settings-border)', borderRadius: '12px', padding: '16px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                    Encara no hi ha proveïdors afegits. Prem "Afegir Proveïdor" per configurar-ne un.
                                                </div>
                                            )}
                                        </div>
                                    </section>

                                    {/* Agents Section */}
                                    <section className="settings-section">
                                        <div className="settings-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <Cpu size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Perfils d'Agents</h3>
                                            </div>
                                            <button 
                                                onClick={() => setEditingAgent({ id: 'agent_' + Date.now(), name: 'Nou Agent', icon: '🤖', persona: '', provider: 'groq', model: '', enabled: true })}
                                                style={{ padding: '6px 12px', borderRadius: '8px', background: 'var(--settings-sidebar-bg)', color: 'var(--text-primary)', border: '1px solid var(--settings-border)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}
                                            >
                                                + Nou Agent
                                            </button>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '15px' }}>
                                            {aiAgents.map((agent, idx) => (
                                                <div 
                                                    key={agent.id || idx} 
                                                    onClick={() => setEditingAgent({...agent})}
                                                    style={{ 
                                                        background: activeAgentId === agent.id ? 'var(--settings-sidebar-active)' : 'var(--settings-sidebar-bg)', 
                                                        padding: '15px', 
                                                        borderRadius: '12px', 
                                                        border: '1.5px solid',
                                                        borderColor: activeAgentId === agent.id ? 'var(--gnosi-blue)' : 'var(--settings-border)',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s',
                                                        position: 'relative',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '12px'
                                                    }}
                                                >
                                                    <div style={{ fontSize: '2rem', minWidth: '45px', height: '45px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.1)', borderRadius: '10px' }}>
                                                        {agent.icon?.startsWith('lucide:') ? (
                                                            (() => {
                                                                const [_, name, colorName] = agent.icon.split(':');
                                                                const IconComp = LucideIcons[name];
                                                                const color = colorName ? (NOTION_COLORS.find(c => c.name === colorName)?.color || 'currentColor') : 'currentColor';
                                                                return IconComp ? <IconComp size={24} color={color} /> : '🤖';
                                                            })()
                                                        ) : (agent.icon || '🤖')}
                                                    </div>
                                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                                        <div style={{ fontWeight: '700', fontSize: '0.95rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.name}</div>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{agent.provider} • {agent.model || 'Auto'}</div>
                                                    </div>
                                                    {activeAgentId === agent.id && (
                                                        <div style={{ position: 'absolute', top: '-8px', right: '-8px', background: 'var(--gnosi-blue)', color: 'white', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            <Check size={12} strokeWidth={3} />
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                    </section>

                                    {/* Provider Editor Modal */}
                                    {editingProvider && (
                                        <div style={{ position: 'fixed', inset: 0, zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                                            <div onClick={() => setEditingProvider(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} />
                                            <div style={{ position: 'relative', width: '100%', maxWidth: '450px', background: 'var(--settings-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                                                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--settings-border)', background: 'var(--settings-header-bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '600' }}>Configura {editingProvider.name}</h3>
                                                    <button onClick={() => setEditingProvider(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><LucideIcons.X size={18} /></button>
                                                </div>
                                                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                    {(getProviderRequirements(editingProvider.id).needsApiKey || getProviderRequirements(editingProvider.id).needsSecret) && (
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '6px' }}>
                                                                {getProviderRequirements(editingProvider.id).needsSecret ? (getProviderRequirements(editingProvider.id).secretLabel || 'Secret') : 'API Key'}
                                                            </label>
                                                            <input 
                                                                type="password" 
                                                                placeholder="sk-..."
                                                                value={editingProvider.pending_api_key || ''}
                                                                onChange={(e) => setEditingProvider({...editingProvider, pending_api_key: e.target.value})}
                                                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }} 
                                                            />
                                                            <div style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                                {editingProvider.has_api_key ? 'Credencial guardada en almacenamiento seguro.' : 'La clave se guardará en keychain/secret store y no en params.yaml.'}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {getProviderRequirements(editingProvider.id).needsBaseUrl && (
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '6px' }}>Base URL</label>
                                                            <input 
                                                                type="text" 
                                                                placeholder={LLM_PROVIDERS_META[editingProvider.id]?.baseUrl || 'https://api...'}
                                                                value={editingProvider.base_url || ''}
                                                                onChange={(e) => setEditingProvider({...editingProvider, base_url: e.target.value})}
                                                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }} 
                                                            />
                                                        </div>
                                                    )}

                                                    <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                                                        <button 
                                                            onClick={() => setEditingProvider(null)}
                                                            style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'transparent', color: 'var(--text-primary)', fontWeight: '600', cursor: 'pointer' }}
                                                        >
                                                            Cancel·lar
                                                        </button>
                                                        <button 
                                                            onClick={async () => {
                                                                try {
                                                                    const pendingApiKey = (editingProvider.pending_api_key || '').trim();
                                                                        if (editingProvider.id !== 'ollama' && pendingApiKey) {
                                                                        const credentialRes = await fetch(`/api/ai/providers/${editingProvider.id}/credentials`, {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ api_key: pendingApiKey, base_url: editingProvider.base_url || '' })
                                                                        });
                                                                        if (!credentialRes.ok) {
                                                                            const payload = await credentialRes.json().catch(() => ({}));
                                                                            throw new Error(payload?.detail || 'No s\'ha pogut guardar la credencial');
                                                                        }
                                                                    }

                                                                    setAiProviders(prev => ({
                                                                        ...prev,
                                                                        [editingProvider.id]: {
                                                                            ...prev[editingProvider.id],
                                                                            source: 'user',
                                                                            base_url: editingProvider.base_url,
                                                                            credential_ref: editingProvider.credential_ref || prev[editingProvider.id]?.credential_ref,
                                                                            has_api_key: pendingApiKey ? true : Boolean(prev[editingProvider.id]?.has_api_key)
                                                                        }
                                                                    }));
                                                                    setEditingProvider(null);
                                                                } catch (error) {
                                                                    console.error('Error saving provider credentials:', error);
                                                                    alert(error.message || 'Error guardant credencial del proveïdor');
                                                                }
                                                            }}
                                                            style={{ flex: 1, padding: '10px', borderRadius: '8px', background: 'var(--gnosi-blue)', color: 'white', border: 'none', fontWeight: '600', cursor: 'pointer' }}
                                                        >
                                                            Guardar
                                                        </button>
                                                    </div>

                                                    {aiProviders[editingProvider.id] && (
                                                        <button 
                                                            onClick={() => {
                                                                const newProviders = { ...aiProviders };
                                                                delete newProviders[editingProvider.id];
                                                                setAiProviders(newProviders);
                                                                setEditingProvider(null);
                                                            }}
                                                            style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '0.75rem', cursor: 'pointer', marginTop: '5px' }}
                                                        >
                                                            Eliminar configuració
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Add Provider Modal */}
                                    {isAddProviderOpen && (
                                        <div style={{ position: 'fixed', inset: 0, zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                                            <div onClick={() => { setIsProviderDropdownOpen(false); setIsAddProviderOpen(false); }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} />
                                            <div style={{ position: 'relative', width: '100%', maxWidth: '450px', background: 'var(--settings-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                                                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--settings-border)', background: 'var(--settings-header-bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '600' }}>Afegir Proveïdor Personalitzat</h3>
                                                    <button onClick={() => { setIsProviderDropdownOpen(false); setIsAddProviderOpen(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><LucideIcons.X size={18} /></button>
                                                </div>
                                                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>Selecciona el proveïdor i completa només les credencials necessàries.</p>

                                                    <div style={{ position: 'relative' }}>
                                                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '6px' }}>Proveïdor</label>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setIsProviderDropdownOpen(prev => {
                                                                    const nextState = !prev;
                                                                    if (nextState) {
                                                                        setProviderSearchQuery('');
                                                                    }
                                                                    return nextState;
                                                                });
                                                            }}
                                                            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                                                        >
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <span>{LLM_PROVIDERS_META[newProviderDraft.providerId]?.icon || '⚙️'}</span>
                                                                <span>{getProviderName(newProviderDraft.providerId)}</span>
                                                            </span>
                                                            <LucideIcons.ChevronDown size={16} style={{ color: 'var(--text-secondary)', transform: isProviderDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
                                                        </button>

                                                        {isProviderDropdownOpen && (
                                                            <>
                                                                <div
                                                                    onClick={() => setIsProviderDropdownOpen(false)}
                                                                    style={{ position: 'fixed', inset: 0, zIndex: 1 }}
                                                                />
                                                                <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 2, border: '1px solid var(--settings-border)', borderRadius: '10px', background: 'var(--settings-bg)', boxShadow: '0 14px 30px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
                                                                    <div style={{ padding: '10px', borderBottom: '1px solid var(--settings-border)' }}>
                                                                        <input
                                                                            type="text"
                                                                            autoFocus
                                                                            placeholder="Buscar proveïdor..."
                                                                            value={providerSearchQuery}
                                                                            onChange={(e) => setProviderSearchQuery(e.target.value)}
                                                                            onKeyDown={handleProviderDropdownKeyDown}
                                                                            style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                        />
                                                                    </div>

                                                                    <div style={{ maxHeight: '260px', overflowY: 'auto', padding: '8px' }}>
                                                                        {groupedProviderOptions.length === 0 && (
                                                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', padding: '8px' }}>
                                                                                Sense resultats per aquesta cerca.
                                                                            </div>
                                                                        )}
                                                                        {groupedProviderOptions.map((group) => (
                                                                            <div key={group.category} style={{ marginBottom: '8px' }}>
                                                                                <div style={{ fontSize: '0.68rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', padding: '6px 8px' }}>
                                                                                    {group.category}
                                                                                </div>
                                                                                {group.options.map((providerId) => (
                                                                                    <button
                                                                                        id={`provider-option-${providerId}`}
                                                                                        key={providerId}
                                                                                        type="button"
                                                                                        onMouseEnter={() => setHighlightedProviderId(providerId)}
                                                                                        onClick={() => selectProviderFromDropdown(providerId)}
                                                                                        style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '7px 8px', borderRadius: '8px', border: 'none', background: highlightedProviderId === providerId ? 'var(--settings-sidebar-active)' : (newProviderDraft.providerId === providerId ? 'rgba(59,130,246,0.12)' : 'transparent'), color: 'var(--text-primary)', cursor: 'pointer' }}
                                                                                    >
                                                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                            <span>{LLM_PROVIDERS_META[providerId]?.icon || '⚙️'}</span>
                                                                                            <span>{renderHighlightedText(getProviderName(providerId), providerSearchQuery)}</span>
                                                                                        </span>
                                                                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{getProviderCategory(providerId)}</span>
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>

                                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                        {getProviderRequirementLabels(newProviderDraft.providerId).map((label) => (
                                                            <span key={`draft-${newProviderDraft.providerId}-${label}`} style={{ fontSize: '0.72rem', border: '1px solid var(--settings-border)', borderRadius: '999px', padding: '3px 9px', color: 'var(--text-secondary)', background: 'var(--settings-sidebar-bg)' }}>
                                                                {label} requerit
                                                            </span>
                                                        ))}
                                                    </div>

                                                    {getProviderRequirements(newProviderDraft.providerId).needsApiKey && (
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '6px' }}>API Key</label>
                                                            <input 
                                                                type="password" 
                                                                placeholder="sk-..."
                                                                value={newProviderDraft.apiKey}
                                                                onChange={(e) => setNewProviderDraft(prev => ({ ...prev, apiKey: e.target.value }))}
                                                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }} 
                                                            />
                                                        </div>
                                                    )}

                                                    {getProviderRequirements(newProviderDraft.providerId).needsSecret && (
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '6px' }}>
                                                                {getProviderRequirements(newProviderDraft.providerId).secretLabel || 'Secret'}
                                                            </label>
                                                            <input
                                                                type="password"
                                                                placeholder="Introdueix el secret"
                                                                value={newProviderDraft.secretValue}
                                                                onChange={(e) => setNewProviderDraft(prev => ({ ...prev, secretValue: e.target.value }))}
                                                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                            />
                                                        </div>
                                                    )}

                                                    {getProviderRequirements(newProviderDraft.providerId).needsBaseUrl && (
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '6px' }}>Base URL</label>
                                                            <input 
                                                                type="text" 
                                                                placeholder="https://api..."
                                                                value={newProviderDraft.baseUrl}
                                                                onChange={(e) => setNewProviderDraft(prev => ({ ...prev, baseUrl: e.target.value }))}
                                                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }} 
                                                            />
                                                        </div>
                                                    )}

                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                        Les credencials es guarden en emmagatzematge segur (keychain/secret store).
                                                    </div>

                                                    <button 
                                                        onClick={async () => {
                                                            try {
                                                                const providerId = newProviderDraft.providerId;
                                                                const requirements = getProviderRequirements(providerId);
                                                                const apiKey = (newProviderDraft.apiKey || '').trim();
                                                                const secretValue = (newProviderDraft.secretValue || '').trim();
                                                                const baseUrl = (newProviderDraft.baseUrl || '').trim();

                                                                if (requirements.needsApiKey && !apiKey) {
                                                                    throw new Error('Aquest proveïdor necessita API key');
                                                                }
                                                                if (requirements.needsSecret && !secretValue) {
                                                                    throw new Error('Aquest proveïdor necessita secret addicional');
                                                                }

                                                                const credentialValue = apiKey || secretValue;

                                                                if (credentialValue) {
                                                                    const credentialRes = await fetch(`/api/ai/providers/${providerId}/credentials`, {
                                                                        method: 'POST',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ api_key: credentialValue, base_url: baseUrl })
                                                                    });
                                                                    if (!credentialRes.ok) {
                                                                        const payload = await credentialRes.json().catch(() => ({}));
                                                                        throw new Error(payload?.detail || 'No s\'ha pogut connectar el proveïdor');
                                                                    }
                                                                }

                                                                setAiProviders(prev => ({
                                                                    ...prev,
                                                                    [providerId]: {
                                                                        ...prev[providerId],
                                                                        source: 'user',
                                                                        base_url: baseUrl,
                                                                        has_api_key: Boolean(credentialValue)
                                                                    }
                                                                }));
                                                                setIsProviderDropdownOpen(false);
                                                                setIsAddProviderOpen(false);
                                                            } catch (error) {
                                                                console.error('Error adding AI provider:', error);
                                                                alert(error.message || 'Error afegint el proveïdor');
                                                            }
                                                        }}
                                                        style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'var(--gnosi-blue)', color: 'white', border: 'none', fontWeight: '700', cursor: 'pointer', marginTop: '5px' }}
                                                    >
                                                        Afegir Proveïdor
                                                    </button>

                                                    <button
                                                        onClick={() => { setIsProviderDropdownOpen(false); setIsAddProviderOpen(false); }}
                                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'transparent', color: 'var(--text-primary)', fontWeight: '600', cursor: 'pointer' }}
                                                    >
                                                        Cancel·lar
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {editingAgent && (
                                        <div style={{ position: 'fixed', inset: 0, zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                                            <div onClick={() => setEditingAgent(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
                                            <div style={{ position: 'relative', width: '100%', maxWidth: '600px', background: 'var(--settings-bg)', borderRadius: '16px', border: '1px solid var(--settings-border)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--settings-border)', background: 'var(--settings-header-bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '600' }}>Edita Perfil de l'Agent</h3>
                                                    <button onClick={() => setEditingAgent(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><LucideIcons.X size={20} /></button>
                                                </div>
                                                
                                                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', maxHeight: '70vh' }}>
                                                    <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                                                            <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Icona</label>
                                                            <button 
                                                                id="agent-icon-trigger"
                                                                onClick={() => {
                                                                    setPickerField('agent_icon');
                                                                    setPickerOpen(true);
                                                                }}
                                                                style={{ width: '80px', height: '80px', borderRadius: '16px', background: 'var(--settings-sidebar-bg)', border: '2px solid var(--settings-border)', fontSize: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                                            >
                                                                {editingAgent.icon?.startsWith('lucide:') ? (
                                                                    (() => {
                                                                        const [_, name, colorName] = editingAgent.icon.split(':');
                                                                        const IconComp = LucideIcons[name];
                                                                        const color = colorName ? (NOTION_COLORS.find(c => c.name === colorName)?.color || 'currentColor') : 'currentColor';
                                                                        return IconComp ? <IconComp size={40} color={color} /> : editingAgent.icon;
                                                                    })()
                                                                ) : editingAgent.icon}
                                                            </button>
                                                        </div>
                                                        
                                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px' }}>Nom de l'Assistant</label>
                                                                <input 
                                                                    type="text" 
                                                                    value={editingAgent.name}
                                                                    onChange={(e) => setEditingAgent({...editingAgent, name: e.target.value})}
                                                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }} 
                                                                />
                                                            </div>
                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                                                <div>
                                                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px' }}>Proveïdor</label>
                                                                    <select 
                                                                        value={editingAgent.provider}
                                                                        onChange={(e) => {
                                                                            const nextProvider = e.target.value;
                                                                            const models = getProviderModels(nextProvider);
                                                                            const nextModel = models.includes(editingAgent.model) ? editingAgent.model : (models[0] || '');
                                                                            setEditingAgent({...editingAgent, provider: nextProvider, model: nextModel});
                                                                        }}
                                                                        style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }}
                                                                    >
                                                                        {Object.keys(aiProviders).map(pId => (
                                                                            <option key={pId} value={pId}>
                                                                                {LLM_PROVIDERS_META[pId]?.name || pId}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px' }}>Model</label>
                                                                    <input 
                                                                        type="text" 
                                                                        list={`provider-models-${editingAgent.provider}`}
                                                                        placeholder="llama-3.3-70b-versatile"
                                                                        value={editingAgent.model}
                                                                        onChange={(e) => setEditingAgent({...editingAgent, model: e.target.value})}
                                                                        style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)' }} 
                                                                    />
                                                                    <datalist id={`provider-models-${editingAgent.provider}`}>
                                                                        {getProviderModels(editingAgent.provider).map(modelId => (
                                                                            <option key={modelId} value={modelId} />
                                                                        ))}
                                                                    </datalist>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '6px' }}>Instruccions / Persona (System Prompt)</label>
                                                        <textarea 
                                                            value={editingAgent.persona}
                                                            onChange={(e) => setEditingAgent({...editingAgent, persona: e.target.value})}
                                                            placeholder="Ets un assistent útil que..."
                                                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--settings-border)', background: 'var(--settings-input-bg)', color: 'var(--text-primary)', minHeight: '150px', fontSize: '0.9rem', lineHeight: '1.5' }} 
                                                        />
                                                    </div>

                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <input 
                                                            type="checkbox" 
                                                            id="agent_enabled" 
                                                            checked={editingAgent.enabled} 
                                                            onChange={(e) => setEditingAgent({...editingAgent, enabled: e.target.checked})} 
                                                        />
                                                        <label htmlFor="agent_enabled" style={{ fontSize: '0.85rem' }}>Habilitar aquest agent</label>
                                                    </div>
                                                </div>
                                                
                                                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--settings-border)', background: 'var(--settings-header-bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <button 
                                                        onClick={() => {
                                                            setAiAgents(prev => prev.filter(a => a.id !== editingAgent.id));
                                                            if (activeAgentId === editingAgent.id) setActiveAgentId(aiAgents[0]?.id || '');
                                                            setEditingAgent(null);
                                                        }}
                                                        style={{ padding: '8px 16px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}
                                                    >
                                                        Eliminar Agent
                                                    </button>
                                                    
                                                    <div style={{ display: 'flex', gap: '12px' }}>
                                                        <button 
                                                            onClick={() => {
                                                                setActiveAgentId(editingAgent.id);
                                                            }}
                                                            style={{ padding: '8px 16px', borderRadius: '8px', background: activeAgentId === editingAgent.id ? '#10b981' : 'var(--settings-sidebar-bg)', color: activeAgentId === editingAgent.id ? 'white' : 'var(--text-primary)', border: '1px solid var(--settings-border)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}
                                                        >
                                                            {activeAgentId === editingAgent.id ? 'Agent Actiu ✅' : 'Fer Actiu'}
                                                        </button>
                                                        <button 
                                                            onClick={() => {
                                                                setAiAgents(prev => {
                                                                    const idx = prev.findIndex(a => a.id === editingAgent.id);
                                                                    if (idx > -1) {
                                                                        const newList = [...prev];
                                                                        newList[idx] = editingAgent;
                                                                        return newList;
                                                                    } else {
                                                                        return [...prev, editingAgent];
                                                                    }
                                                                });
                                                                setEditingAgent(null);
                                                            }}
                                                            style={{ padding: '8px 20px', borderRadius: '8px', background: 'var(--gnosi-blue)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}
                                                        >
                                                            Acceptar
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <IconPicker 
                                        isOpen={pickerOpen && pickerField === 'agent_icon'} 
                                        onClose={() => setPickerOpen(false)} 
                                        onSelectIcon={(icon) => {
                                            setEditingAgent(prev => ({ ...prev, icon }));
                                            setPickerOpen(false);
                                        }} 
                                        currentIcon={editingAgent?.icon || ''}
                                        triggerRef={{ current: document.getElementById('agent-icon-trigger') }} 
                                    />
                                </div>
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
                            style={{
                                padding: '10px 20px',
                                borderRadius: '8px',
                                border: '1px solid var(--settings-border)',
                                background: 'transparent',
                                cursor: 'pointer',
                                color: 'var(--text-primary)',
                                fontWeight: '500',
                                transition: 'all 0.2s'
                            }}
                        >
                            Tancar
                        </button>
                        <button
                            onClick={handleSaveGlobal}
                            disabled={isSaving}
                            style={{
                                padding: '10px 24px',
                                borderRadius: '8px',
                                border: 'none',
                                background: 'var(--gnosi-blue)',
                                color: 'white',
                                fontWeight: '600',
                                cursor: isSaving ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.2s',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                            }}
                        >
                            {isSaving ? <RefreshCw size={18} className="spin-anim" /> : <Save size={18} />}
                            Guardar Canvis
                        </button>
                    </div>
                </div>
            </div>
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
