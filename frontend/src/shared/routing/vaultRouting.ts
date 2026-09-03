import { fetchVaultCatalog, invalidateVaultCatalog } from '../api/vaults';
import {
    ACTIVE_VAULT_ID_KEY,
    ACTIVE_VAULT_NAME_KEY,
    ACTIVE_VAULT_SLUG_KEY,
    canonicalizeVaultApiUrl,
    getActiveVaultId,
    getActiveVaultSlug,
    persistVaultCatalog,
    readVaultCatalog,
    setActiveVaultCookie,
    storageSet,
    type StoredVault,
} from '../api/vault-context';
import { emitAppEvent } from '../platform/app-events';

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

type RoutingScalar = string | number | boolean | null | undefined;

export interface ActivateVaultOptions {
    readonly notify?: boolean;
}

export interface InitializeVaultRoutingOptions {
    readonly force?: boolean;
    readonly preferredSlug?: string;
}

export interface VaultRoutingState {
    readonly active: StoredVault | null;
    readonly routeFound: boolean;
    readonly vaults: StoredVault[];
}

export interface KnowledgeDocument {
    readonly is_dashboard?: unknown;
    readonly metadata?: Readonly<Record<string, unknown>> | null;
}

const LEGACY_BROWSER_APPS: Readonly<Record<string, string>> = {
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

export function activateVault(
    vault: StoredVault | null | undefined,
    { notify = true }: ActivateVaultOptions = {},
): boolean {
    if (!vault?.id || !vault.slug) return false;
    const changed = getActiveVaultId() !== vault.id || getActiveVaultSlug() !== vault.slug;
    storageSet(ACTIVE_VAULT_ID_KEY, vault.id);
    storageSet(ACTIVE_VAULT_SLUG_KEY, vault.slug);
    storageSet(ACTIVE_VAULT_NAME_KEY, vault.name || '');
    setActiveVaultCookie(vault.id);
    if (changed && notify && typeof window !== 'undefined') {
        emitAppEvent('gnosi:vault-changed', {
            id: vault.id,
            slug: vault.slug,
            name: vault.name || '',
        });
    }
    return true;
}

function slugFromBrowserPath(pathname: RoutingScalar): string {
    const match = String(pathname || '').match(/^\/@([^/]+)(?:\/|$)/);
    const slug = match?.[1];
    return slug ? decodeURIComponent(slug).toLowerCase() : '';
}

export async function initializeVaultRouting({
    preferredSlug = '',
    force = false,
}: InitializeVaultRoutingOptions = {}): Promise<VaultRoutingState> {
    const routeSlug = preferredSlug || (
        typeof window !== 'undefined' ? slugFromBrowserPath(window.location.pathname) : ''
    );
    let vaults = force ? [] : readVaultCatalog();
    try {
        if (force) await invalidateVaultCatalog();
        const data = await fetchVaultCatalog();
        vaults = persistVaultCatalog(data.vaults);
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

export async function activateVaultSlug(slug: RoutingScalar): Promise<StoredVault | null> {
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

export function vaultPath(
    app: RoutingScalar,
    resourcePath: RoutingScalar = '',
    explicitSlug = '',
): string {
    const slug = explicitSlug || getActiveVaultSlug();
    if (!slug) return '/';
    const cleanApp = String(app || 'knowledge').replace(/^\/+|\/+$/g, '');
    const cleanResource = String(resourcePath || '').replace(/^\/+/, '');
    const base = `/@${encodeURIComponent(slug)}/${cleanApp}`;
    return cleanResource ? `${base}/${cleanResource}` : base;
}

export function knowledgeDocumentType(
    document: KnowledgeDocument | null | undefined,
): 'dashboard' | 'page' {
    const metadata = document?.metadata || {};
    const dashboardFlag = document?.is_dashboard ?? metadata.is_dashboard;
    return dashboardFlag === true || dashboardFlag === 'true' ? 'dashboard' : 'page';
}

export function knowledgeDocumentPath(
    documentId: RoutingScalar,
    document: KnowledgeDocument = {},
    explicitSlug = '',
): string {
    const encodedId = encodeURIComponent(String(documentId || ''));
    return vaultPath(
        'knowledge',
        `${knowledgeDocumentType(document)}/${encodedId}`,
        explicitSlug,
    );
}

export function vaultAppFromPath(pathname: string): string {
    const canonical = pathname.match(/^\/@[^/]+\/([^/?#]+)/);
    if (canonical) return canonical[1] ?? '';
    const legacy = Object.entries(LEGACY_BROWSER_APPS).find(([prefix]) => (
        pathname === prefix || pathname.startsWith(`${prefix}/`)
    ));
    return legacy?.[1] || '';
}

export function legacyBrowserPathToCanonical(
    pathname: RoutingScalar,
    explicitSlug = '',
): string {
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

export function canonicalVaultSwitchPath(pathname: string, targetSlug: string): string {
    const app = vaultAppFromPath(pathname) || 'knowledge';
    return vaultPath(app, '', targetSlug);
}
