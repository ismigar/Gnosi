import { useState } from 'react';
import { fetchExternalContextSources, fetchInternalContextSources } from '../../../shared/api/agent-context';
import { fetchVaultPages, fetchVaultTables } from '../../../shared/api/vaults';
import { catalogItems, type ContextPickingKind } from './agentContextModel';
import { useContextResource } from './useContextResource';

const loadPages = async (signal: AbortSignal) => catalogItems(await fetchVaultPages({}, signal));
const loadTables = async (signal: AbortSignal) => catalogItems(await fetchVaultTables(undefined, signal));
const loadExternal = async (signal: AbortSignal) => catalogItems(await fetchExternalContextSources(signal));

export function useAgentContextCatalog(picking: ContextPickingKind | null, needsInternal: boolean) {
    const [revision, setRevision] = useState(0);
    const vaultVisible = picking === 'internal' || picking === 'vault' || picking === 'page' || picking === 'table';
    const pages = useContextResource(loadPages, vaultVisible, revision);
    const tables = useContextResource(loadTables, vaultVisible, revision);
    const external = useContextResource(loadExternal, picking === 'source', revision);
    const internal = useContextResource(fetchInternalContextSources, picking === 'internal' || needsInternal, revision);
    const active = picking === 'page' ? pages : picking === 'table' ? tables : picking === 'source' ? external : internal;
    return {
        internalDescriptors: internal.data ?? [],
        internal,
        pages,
        tables,
        options: picking === 'internal' ? (internal.data ? catalogItems(internal.data) : null) : active.data ? catalogItems(active.data) : null,
        error: active.error,
        loading: active.loading,
        refresh: () => { setRevision(value => value + 1); },
        revision,
    };
}
