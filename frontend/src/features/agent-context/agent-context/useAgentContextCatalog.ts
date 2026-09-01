import { useEffect, useMemo, useState } from 'react';

import { logError } from '../../../shared/notifications/notifyError';
import {
    fetchExternalContextSources,
    fetchInternalContextSources,
    type InternalContextSource,
} from '../../../shared/api/agent-context';
import { fetchVaultPages, fetchVaultTables } from '../../../shared/api/vaults';
import {
    catalogItems,
    type ContextCatalogItem,
    type ContextPickingKind,
} from './agentContextModel';


interface AgentContextCatalog {
    readonly internalDescriptors: readonly InternalContextSource[];
    readonly options: readonly ContextCatalogItem[] | null;
}


export function useAgentContextCatalog(
    picking: ContextPickingKind | null,
    needsInternal: boolean,
): AgentContextCatalog {
    const [tables, setTables] = useState<ContextCatalogItem[] | null>(null);
    const [pages, setPages] = useState<ContextCatalogItem[] | null>(null);
    const [external, setExternal] = useState<ContextCatalogItem[] | null>(null);
    const [internal, setInternal] = useState<InternalContextSource[] | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;
        const reportFailure = (operation: string, error: unknown): void => {
            if (!signal.aborted) logError(operation, error);
        };

        if (picking === 'table' && tables === null) {
            void fetchVaultTables(undefined, signal)
                .then((items) => {
                    if (!signal.aborted) setTables(catalogItems(items));
                })
                .catch((error: unknown) => {
                    reportFailure('agent-context-load-tables', error);
                    if (!signal.aborted) setTables([]);
                });
        }
        if (picking === 'page' && pages === null) {
            void fetchVaultPages({}, signal)
                .then((items) => {
                    if (!signal.aborted) setPages(catalogItems(items));
                })
                .catch((error: unknown) => {
                    reportFailure('agent-context-load-pages', error);
                    if (!signal.aborted) setPages([]);
                });
        }
        if (picking === 'source' && external === null) {
            void fetchExternalContextSources(signal)
                .then((items) => {
                    if (!signal.aborted) setExternal(catalogItems(items));
                })
                .catch((error: unknown) => {
                    reportFailure('agent-context-load-external', error);
                    if (!signal.aborted) setExternal([]);
                });
        }
        if ((picking === 'internal' || needsInternal) && internal === null) {
            void fetchInternalContextSources(signal)
                .then((items) => {
                    if (!signal.aborted) setInternal(items);
                })
                .catch((error: unknown) => {
                    reportFailure('agent-context-load-internal', error);
                    if (!signal.aborted) setInternal([]);
                });
        }
        return () => {
            controller.abort();
        };
    }, [external, internal, needsInternal, pages, picking, tables]);

    const internalItems = useMemo(
        () => internal === null ? null : catalogItems(internal),
        [internal],
    );
    const options = picking === 'table'
        ? tables
        : picking === 'page'
            ? pages
            : picking === 'source'
                ? external
                : picking === 'internal'
                    ? internalItems
                    : null;
    return {
        internalDescriptors: internal ?? [],
        options,
    };
}
