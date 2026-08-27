import axios from 'axios';

import { setActiveVaultCookie } from './fileResource.js';

export const ACTIVE_VAULT_ID_KEY = 'gnosi_active_vault';
export const ACTIVE_VAULT_NAME_KEY = 'gnosi_active_vault_name';
export const ACTIVE_VAULT_SLUG_KEY = 'gnosi_active_vault_slug';
const VAULT_CATALOG_KEY = 'gnosi_vault_catalog';

const LEGACY_BROWSER_APPS = {
    '/vault': 'knowledge',
    '/graph': 'graph',
    '/calendar': 'calendar',
    '/reader': 'reader',
    '/mail': 'mail',
    '/scheduler': 'automations',
    '/composer': 'social',
    '/social-dashboard': 'social',
    '/media': 'media',
    '/contacts': 'contacts',
    '/planning': 'planning',
    '/literature': 'resources',
    '/notebooks': 'notebooks',
};

const LEGACY_API_RULES = [
    { prefix: '/api/vault/literature', app: 'resources' },
    { prefix: '/api/vault/media', app: 'media' },
    { prefix: '/api/vault', app: 'knowledge' },
    { prefix: '/api/pages', app: 'knowledge', keepPrefix: '/pages' },
    { prefix: '/api/meetings', app: 'calendar', keepPrefix: '/meetings' },
    { prefix: '/api/calendar', app: 'calendar' },
    { prefix: '/api/mail', app: 'mail' },
    { prefix: '/api/reader', app: 'reader' },
    { prefix: '/api/schedulers', app: 'automations' },
    { prefix: '/api/social', app: 'social' },
    { prefix: '/api/contacts', app: 'contacts' },
    { prefix: '/api/planning', app: 'planning' },
    { prefix: '/api/notebooks', app: 'notebooks' },
    { prefix: '/api/graph', app: 'graph' },
    { prefix: '/api/ai', app: 'ai', keepPrefix: '/ai' },
    { prefix: '/api/chat', app: 'ai', keepPrefix: '/chat' },
    { prefix: '/api/agent', app: 'ai', keepPrefix: '/agent' },
    { prefix: '/api/tools', app: 'ai', keepPrefix: '/tools' },
    { prefix: '/api/skills', app: 'ai', keepPrefix: '/skills' },
];

function storageGet(key) {
    try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(key) || '' : '';
    } catch {
        return '';
    }
}

function storageSet(key, value) {
    try {
        if (typeof localStorage === 'undefined') return;
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
    } catch {
        // Storage can be unavailable in hardened browser contexts.
    }
}

export function getActiveVaultId() {
    return storageGet(ACTIVE_VAULT_ID_KEY);
}

export function getActiveVaultSlug() {
    return storageGet(ACTIVE_VAULT_SLUG_KEY);
}

export function getVaultSlugById(vaultId) {
    return readVaultCatalog().find((vault) => vault.id === vaultId)?.slug || '';
}

export function readVaultCatalog() {
    try {
        const parsed = JSON.parse(storageGet(VAULT_CATALOG_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function persistVaultCatalog(vaults) {
    const normalized = Array.isArray(vaults)
        ? vaults.filter((vault) => vault?.id && vault?.slug)
        : [];
    storageSet(VAULT_CATALOG_KEY, JSON.stringify(normalized));
    return normalized;
}

export function activateVault(vault, { notify = true } = {}) {
    if (!vault?.id || !vault?.slug) return false;
    const changed = getActiveVaultId() !== vault.id || getActiveVaultSlug() !== vault.slug;
    storageSet(ACTIVE_VAULT_ID_KEY, vault.id);
    storageSet(ACTIVE_VAULT_SLUG_KEY, vault.slug);
    storageSet(ACTIVE_VAULT_NAME_KEY, vault.name || '');
    setActiveVaultCookie(vault.id);
    if (changed && notify && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gnosi:vault-changed', {
            detail: { id: vault.id, slug: vault.slug, name: vault.name || '' },
        }));
    }
    return true;
}

function slugFromBrowserPath(pathname) {
    const match = String(pathname || '').match(/^\/@([^/]+)(?:\/|$)/);
    return match ? decodeURIComponent(match[1]).toLowerCase() : '';
}

export async function initializeVaultRouting({ preferredSlug = '', force = false } = {}) {
    const routeSlug = preferredSlug || (
        typeof window !== 'undefined' ? slugFromBrowserPath(window.location.pathname) : ''
    );
    let vaults = force ? [] : readVaultCatalog();
    try {
        const response = await fetch('/api/vaults', { credentials: 'include' });
        if (response.ok) {
            const data = await response.json();
            vaults = persistVaultCatalog(data?.vaults || []);
        }
    } catch {
        // Cached routing metadata still permits offline navigation.
    }
    const currentId = getActiveVaultId();
    const target = (
        vaults.find((vault) => vault.slug === routeSlug)
        || vaults.find((vault) => vault.id === currentId)
        || vaults.find((vault) => vault.active)
        || vaults[0]
    );
    if (target) activateVault(target, { notify: false });
    return { vaults, active: target || null, routeFound: !routeSlug || target?.slug === routeSlug };
}

export async function activateVaultSlug(slug) {
    const normalized = String(slug || '').trim().toLowerCase();
    let vaults = readVaultCatalog();
    let target = vaults.find((vault) => vault.slug === normalized);
    if (!target) {
        const result = await initializeVaultRouting({ preferredSlug: normalized, force: true });
        vaults = result.vaults;
        target = vaults.find((vault) => vault.slug === normalized);
    }
    if (!target) return null;
    activateVault(target);
    return target;
}

export function vaultPath(app, resourcePath = '', explicitSlug = '') {
    const slug = explicitSlug || getActiveVaultSlug();
    if (!slug) return '/';
    const cleanApp = String(app || 'knowledge').replace(/^\/+|\/+$/g, '');
    const cleanResource = String(resourcePath || '').replace(/^\/+/, '');
    const base = `/@${encodeURIComponent(slug)}/${cleanApp}`;
    return cleanResource ? `${base}/${cleanResource}` : base;
}

export function knowledgeDocumentType(document) {
    const metadata = document?.metadata || {};
    const dashboardFlag = document?.is_dashboard ?? metadata.is_dashboard;
    return dashboardFlag === true || dashboardFlag === 'true' ? 'dashboard' : 'page';
}

export function knowledgeDocumentPath(documentId, document = {}, explicitSlug = '') {
    const encodedId = encodeURIComponent(String(documentId || ''));
    return vaultPath(
        'knowledge',
        `${knowledgeDocumentType(document)}/${encodedId}`,
        explicitSlug,
    );
}

export function vaultAppFromPath(pathname) {
    const canonical = String(pathname || '').match(/^\/@[^/]+\/([^/?#]+)/);
    if (canonical) return canonical[1];
    const legacy = Object.entries(LEGACY_BROWSER_APPS).find(([prefix]) => (
        pathname === prefix || pathname.startsWith(`${prefix}/`)
    ));
    return legacy?.[1] || '';
}

export function legacyBrowserPathToCanonical(pathname, explicitSlug = '') {
    const value = String(pathname || '/');
    if (value.startsWith('/@')) return value;
    const match = Object.entries(LEGACY_BROWSER_APPS).find(([prefix]) => (
        value === prefix || value.startsWith(`${prefix}/`)
    ));
    if (!match) return value;
    const [prefix, app] = match;
    let remainder = value.slice(prefix.length).replace(/^\/+/, '');
    if (prefix === '/vault' && remainder === 'pdf') remainder = 'document';
    if (prefix === '/composer' && !remainder) remainder = 'compose';
    return vaultPath(app, remainder, explicitSlug);
}

export function canonicalVaultSwitchPath(pathname, targetSlug) {
    const app = vaultAppFromPath(pathname) || 'knowledge';
    return vaultPath(app, '', targetSlug);
}

export function canonicalizeVaultApiUrl(url, explicitSlug = '') {
    if (typeof url !== 'string') return url;
    if (url.startsWith('/api/v1/vaults/') || url.startsWith('/api/vaults')) return url;
    const slug = explicitSlug || getActiveVaultSlug();
    if (!slug) return url;
    const rule = LEGACY_API_RULES.find(({ prefix }) => (
        url === prefix
        || url.startsWith(`${prefix}/`)
        || url.startsWith(`${prefix}?`)
    ));
    if (!rule) return url;
    const remainder = url.slice(rule.prefix.length);
    const canonicalRemainder = `${rule.keepPrefix || ''}${remainder}`;
    return `/api/v1/vaults/${encodeURIComponent(slug)}/${rule.app}${canonicalRemainder}`;
}

let apiRoutingInstalled = false;

export function installVaultApiRouting() {
    if (apiRoutingInstalled) return;
    apiRoutingInstalled = true;

    axios.interceptors.request.use((config) => {
        const explicitId = config.headers?.['X-Vault-Id'] || config.headers?.['x-vault-id'];
        const explicitSlug = explicitId ? getVaultSlugById(explicitId) : '';
        // When a one-off explicit vault is unknown to the local catalog, keep
        // the legacy URL so its header semantics remain intact.
        if (!explicitId || explicitSlug) {
            config.url = canonicalizeVaultApiUrl(config.url, explicitSlug);
        }
        return config;
    });

    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const isRequest = typeof Request !== 'undefined' && input instanceof Request;
        const headers = new Headers(init?.headers || (isRequest ? input.headers : undefined));
        const explicitId = headers.get('X-Vault-Id') || '';
        const explicitSlug = explicitId ? getVaultSlugById(explicitId) : '';
        const rewrite = (value) => (
            !explicitId || explicitSlug ? canonicalizeVaultApiUrl(value, explicitSlug) : value
        );
        if (typeof input === 'string') {
            return nativeFetch(rewrite(input), init);
        }
        if (input instanceof URL) {
            const next = rewrite(`${input.pathname}${input.search}${input.hash}`);
            return nativeFetch(new URL(next, input.origin), init);
        }
        // Request bodies can be one-shot streams. Preserve Request objects
        // unchanged instead of cloning them solely for URL rewriting.
        return nativeFetch(input, init);
    };
}
