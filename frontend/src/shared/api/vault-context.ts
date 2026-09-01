import {
  defineStorageKey,
  readStorage,
  removeStorage,
  stringStorageCodec,
  writeStorage,
} from '../platform/browser-storage';


export const ACTIVE_VAULT_ID_KEY = 'gnosi_active_vault';
export const ACTIVE_VAULT_NAME_KEY = 'gnosi_active_vault_name';
export const ACTIVE_VAULT_SLUG_KEY = 'gnosi_active_vault_slug';
export const VAULT_CATALOG_KEY = 'gnosi_vault_catalog';


export interface StoredVault {
  readonly active?: boolean;
  readonly id: string;
  readonly name?: string;
  readonly slug: string;
  readonly [key: string]: unknown;
}


interface LegacyApiRule {
  readonly app: string;
  readonly keepPrefix?: string;
  readonly prefix: string;
}


const LEGACY_API_RULES: readonly LegacyApiRule[] = [
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


const activeVaultIdStorageKey = defineStorageKey(ACTIVE_VAULT_ID_KEY, stringStorageCodec);
const activeVaultSlugStorageKey = defineStorageKey(ACTIVE_VAULT_SLUG_KEY, stringStorageCodec);


export function storageGet(key: string): string {
  return readStorage(defineStorageKey(key, stringStorageCodec)) ?? '';
}


export function storageSet(key: string, value: string): void {
  const storageKey = defineStorageKey(key, stringStorageCodec);
  if (value) writeStorage(storageKey, value);
  else removeStorage(storageKey);
}


export function getActiveVaultId(): string {
  return readStorage(activeVaultIdStorageKey) ?? '';
}


export function getActiveVaultSlug(): string {
  return readStorage(activeVaultSlugStorageKey) ?? '';
}


export function setActiveVaultCookie(vaultId: string | null): void {
  try {
    if (typeof document === 'undefined') return;
    if (vaultId) {
      document.cookie = `${ACTIVE_VAULT_ID_KEY}=${encodeURIComponent(vaultId)}; path=/; SameSite=Lax; max-age=31536000`;
    } else {
      document.cookie = `${ACTIVE_VAULT_ID_KEY}=; path=/; SameSite=Lax; max-age=0`;
    }
  } catch {
    // Cookies can be unavailable in hardened browser contexts.
  }
}


export function readVaultCatalog(): StoredVault[] {
  try {
    const parsed: unknown = JSON.parse(storageGet(VAULT_CATALOG_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((vault): vault is StoredVault => (
      typeof vault === 'object'
      && vault !== null
      && typeof (vault as Partial<StoredVault>).id === 'string'
      && Boolean((vault as Partial<StoredVault>).id)
      && typeof (vault as Partial<StoredVault>).slug === 'string'
      && Boolean((vault as Partial<StoredVault>).slug)
    ));
  } catch {
    return [];
  }
}


export function persistVaultCatalog(vaults: unknown): StoredVault[] {
  const normalized = Array.isArray(vaults)
    ? vaults.filter((vault): vault is StoredVault => (
      typeof vault === 'object'
      && vault !== null
      && typeof (vault as Partial<StoredVault>).id === 'string'
      && Boolean((vault as Partial<StoredVault>).id)
      && typeof (vault as Partial<StoredVault>).slug === 'string'
      && Boolean((vault as Partial<StoredVault>).slug)
    ))
    : [];
  storageSet(VAULT_CATALOG_KEY, JSON.stringify(normalized));
  return normalized;
}


export function getVaultSlugById(vaultId: string): string {
  return readVaultCatalog().find((vault) => vault.id === vaultId)?.slug ?? '';
}


export function canonicalizeVaultApiUrl(url: string, explicitSlug = ''): string {
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
  const canonicalRemainder = `${rule.keepPrefix ?? ''}${remainder}`;
  return `/api/v1/vaults/${encodeURIComponent(slug)}/${rule.app}${canonicalRemainder}`;
}
