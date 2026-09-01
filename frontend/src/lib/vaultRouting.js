import { setActiveVaultCookie } from './fileResource.js';
import { fetchVaultCatalog } from '../shared/api/vaults';
import {
    ACTIVE_VAULT_ID_KEY,
    ACTIVE_VAULT_NAME_KEY,
    ACTIVE_VAULT_SLUG_KEY,
    canonicalizeVaultApiUrl,
    getActiveVaultId,
    getActiveVaultSlug,
    persistVaultCatalog,
    readVaultCatalog,
    storageSet,
} from '../shared/api/vault-context';

export {
    ACTIVE_VAULT_ID_KEY,
    ACTIVE_VAULT_NAME_KEY,
    ACTIVE_VAULT_SLUG_KEY,
    canonicalizeVaultApiUrl,
    getActiveVaultId,
    getActiveVaultSlug,
    persistVaultCatalog,
    readVaultCatalog,
};

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
        const data = await fetchVaultCatalog();
        vaults = persistVaultCatalog(data.vaults || []);
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
