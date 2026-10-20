import type { ConfigurationUpdateInput } from '../../../shared/api/configuration';
import { getActiveVaultId } from '../../../shared/api/vault-context';
import type { GraphSettings } from './graphPageModel';

export type GraphToggleKey = 'show_arrows' | 'lin_log_mode'
  | 'strong_gravity_mode' | 'outbound_attraction_distribution';
type ToggleValues = Record<GraphToggleKey, boolean>;
type Listener = {
  change: (key: GraphToggleKey, value: boolean) => void;
  onError: (error: unknown) => void;
};
const DEFAULTS: ToggleValues = {
  show_arrows: true,
  lin_log_mode: false,
  strong_gravity_mode: true,
  outbound_attraction_distribution: false,
};
interface PendingToggles {
  confirmed: ToggleValues;
  selected: ToggleValues;
  touched: Set<GraphToggleKey>;
  revisions: Partial<Record<GraphToggleKey, number>>;
  listeners: Set<Listener>;
  tail: Promise<void>;
  pending: number;
}

// Share only mounted/pending edits inside one query cache. Keep an outstanding
// edit through navigation; release its journal after the last request/subscriber.
const scopes = new WeakMap<object, Map<string, PendingToggles>>();

export function createGraphTogglePersistence({
  scope, vaultId, save, acknowledge, change, onError,
}: Listener & {
  scope: object;
  vaultId: string;
  save: (input: ConfigurationUpdateInput) => Promise<unknown>;
  acknowledge: (key: GraphToggleKey, value: boolean) => void;
}) {
  const listener = { change, onError };
  function session(): PendingToggles {
    let vaults = scopes.get(scope);
    if (!vaults) { vaults = new Map(); scopes.set(scope, vaults); }
    let current = vaults.get(vaultId);
    if (!current) {
      current = {
        confirmed: { ...DEFAULTS }, selected: { ...DEFAULTS },
        touched: new Set(), revisions: {}, listeners: new Set(),
        tail: Promise.resolve(), pending: 0,
      };
      vaults.set(vaultId, current);
    }
    return current;
  }
  function release(current: PendingToggles): void {
    if (!current.pending && !current.listeners.size) scopes.get(scope)?.delete(vaultId);
  }
  function publish(current: PendingToggles, key: GraphToggleKey): void {
    if (getActiveVaultId() !== vaultId) return;
    for (const subscriber of current.listeners) subscriber.change(key, current.selected[key]);
  }
  return {
    subscribe(): () => void {
      const current = session();
      current.listeners.add(listener);
      for (const key of Object.keys(DEFAULTS) as GraphToggleKey[]) publish(current, key);
      return () => { current.listeners.delete(listener); release(current); };
    },
    hydrate(settings: GraphSettings): void {
      const current = session();
      for (const key of Object.keys(DEFAULTS) as GraphToggleKey[]) {
        const value = (key === 'show_arrows' ? settings[key] : settings.physics?.[key])
          ?? DEFAULTS[key];
        if (current.touched.has(key)) {
          // An older refetch can arrive after acknowledgement. Repair only
          // this confirmed field so the next mount also sees committed data.
          if (value !== current.confirmed[key]) acknowledge(key, current.confirmed[key]);
          continue;
        }
        current.confirmed[key] = value;
        current.selected[key] = value;
        publish(current, key);
      }
    },
    set(key: GraphToggleKey, value: boolean): void {
      if (getActiveVaultId() !== vaultId) return;
      const current = session();
      if (current.selected[key] === value) return;
      current.selected[key] = value;
      current.touched.add(key);
      const revision = (current.revisions[key] ?? 0) + 1;
      current.revisions[key] = revision;
      publish(current, key);
      current.pending++;
      current.tail = current.tail.then(async () => {
        try {
          // The shared API resolves Vault headers at dispatch time.
          if (getActiveVaultId() !== vaultId) return;
          await save({ graph: key === 'show_arrows'
            ? { show_arrows: value } : { physics: { [key]: value } } });
          current.confirmed[key] = value;
          // Cache confirmed data, never an optimistic later choice. Mounted
          // subscribers retain that later choice until its own write completes.
          acknowledge(key, value);
        } catch (error: unknown) {
          if (getActiveVaultId() === vaultId) {
            if (current.revisions[key] === revision) {
              current.selected[key] = current.confirmed[key];
              publish(current, key);
            }
            const subscribers = [...current.listeners];
            (subscribers.at(-1)?.onError ?? onError)(error);
          }
        } finally {
          current.pending--;
          release(current);
        }
      });
    },
  };
}
