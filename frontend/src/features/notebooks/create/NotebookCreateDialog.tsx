import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type SyntheticEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import { logError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import {
    createNotebook,
    fetchReferenceResources,
    type NotebookDetail,
    type ReferenceResource,
} from '../../../shared/api/notebooks';
import type {
    NotebookFacetOption,
    NotebookResourceFiltersProps,
} from './NotebookResourceFilters';
import NotebookCreateDialogView, {
    type NotebookConversationMode,
    type NotebookResourceFilterKey,
    type NotebookResourceFilters,
    type NotebookVisibility,
} from './NotebookCreateDialogView';
import { normalizeResourceFacets } from './notebookResourceCatalog';

interface ResourceData {
    readonly facets: NotebookResourceFiltersProps['facets'];
    readonly hidden_without_sources: number;
    readonly items: readonly ReferenceResource[];
    readonly page: number;
    readonly page_size: number;
    readonly total: number;
}

export interface NotebookCreateDialogProps {
    readonly initialResourceIds?: readonly string[];
    readonly isOpen: boolean;
    readonly onClose?: () => void;
    readonly onCreated?: (notebook: NotebookDetail) => void;
}

interface OpenDialogProps extends Omit<NotebookCreateDialogProps, 'isOpen'> {
    readonly defaultTitle: string;
}

const EMPTY_RESOURCE_IDS: readonly string[] = Object.freeze([]);
const EMPTY_FILTERS: NotebookResourceFilters = {
    author: '',
    tag: '',
    type: '',
};
const INITIAL_RESOURCE_DATA: ResourceData = {
    items: [],
    total: 0,
    page: 1,
    page_size: 50,
    facets: {
        authors: [],
        tags: [],
        types: [],
    },
    hidden_without_sources: 0,
};

function isFacetOption(value: unknown): value is NotebookFacetOption {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const option = value as Readonly<Record<string, unknown>>;
    return typeof option.value === 'string' && typeof option.count === 'number';
}

function normalizeFacets(
    facets: Parameters<typeof normalizeResourceFacets>[0],
): NotebookResourceFiltersProps['facets'] {
    const normalized = normalizeResourceFacets(facets);
    return {
        authors: normalized.authors.filter(isFacetOption),
        tags: normalized.tags.filter(isFacetOption),
        types: normalized.types.filter(isFacetOption),
    };
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
    return error instanceof Error && error.message ? error.message : 'Unknown error';
}

function OpenNotebookCreateDialog({
    defaultTitle,
    initialResourceIds = EMPTY_RESOURCE_IDS,
    onClose,
    onCreated,
}: OpenDialogProps) {
    const { t } = useTranslation();
    const [title, setTitle] = useState(defaultTitle);
    const [visibility, setVisibility] = useState<NotebookVisibility>('private');
    const [conversationMode, setConversationMode] = useState<NotebookConversationMode>(
        'private_member',
    );
    const [selectedIds, setSelectedIds] = useState(
        () => new Set(initialResourceIds.map(String)),
    );
    const [resourceData, setResourceData] = useState<ResourceData>(
        INITIAL_RESOURCE_DATA,
    );
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState<NotebookResourceFilters>(EMPTY_FILTERS);
    const [loadingResources, setLoadingResources] = useState(false);
    const [creating, setCreating] = useState(false);
    const dialogRef = useRef<HTMLFormElement>(null);

    useModalKeyboard({
        isOpen: true,
        onClose: onClose ?? (() => undefined),
        closeOnEscape: !creating,
        containerRef: dialogRef,
        trapFocus: true,
    });

    useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setLoadingResources(true);
            void fetchReferenceResources({
                query,
                page: resourceData.page,
                pageSize: 50,
                author: filters.author || undefined,
                resourceType: filters.type || undefined,
                tag: filters.tag || undefined,
            }, controller.signal)
                .then((data) => {
                    setResourceData({
                        items: Array.isArray(data.items) ? data.items : [],
                        total: data.total || 0,
                        page: data.page || resourceData.page,
                        page_size: data.page_size || 50,
                        facets: normalizeFacets(data.facets),
                        hidden_without_sources: data.hidden_without_sources || 0,
                    });
                })
                .catch((error: unknown) => {
                    if (isAbortError(error)) return;
                    logError('notebook-resources', error);
                    toast.error(t(
                        'notebooks.resources_error',
                        'Resources could not be loaded.',
                    ));
                })
                .finally(() => {
                    setLoadingResources(false);
                });
        }, 180);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [filters, query, resourceData.page, t]);

    const resourcePageCount = Math.max(
        1,
        Math.ceil(resourceData.total / resourceData.page_size),
    );

    const toggleResource = (resourceId: string): void => {
        setSelectedIds((previous) => {
            const next = new Set(previous);
            if (next.has(resourceId)) next.delete(resourceId);
            else next.add(resourceId);
            return next;
        });
    };

    const updateFilter = (key: NotebookResourceFilterKey | '', value: string): void => {
        setFilters((previous) => (
            key ? { ...previous, [key]: value } : EMPTY_FILTERS
        ));
        setResourceData((previous) => ({ ...previous, page: 1 }));
    };

    const create = async (
        event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
    ): Promise<void> => {
        event.preventDefault();
        if (selectedIds.size === 0 || creating) return;
        setCreating(true);
        try {
            const notebook = await createNotebook({
                title: title.trim() || defaultTitle,
                visibility,
                conversation_mode: conversationMode,
                resource_ids: [...selectedIds],
            });
            toast.success(t('notebooks.created', 'Notebook created.'));
            onCreated?.(notebook);
            onClose?.();
        } catch (error: unknown) {
            logError('notebook-create', error);
            toast.error(t(
                'notebooks.create_error',
                'The notebook could not be created: {{message}}',
                { message: errorMessage(error) },
            ));
        } finally {
            setCreating(false);
        }
    };

    return (
        <NotebookCreateDialogView
            conversationMode={conversationMode}
            creating={creating}
            dialogRef={dialogRef}
            facets={resourceData.facets}
            filters={filters}
            hiddenWithoutSources={resourceData.hidden_without_sources}
            loadingResources={loadingResources}
            onClose={onClose}
            onConversationModeChange={(value) => {
                setConversationMode(value);
            }}
            onFilterChange={updateFilter}
            onPageChange={(delta) => {
                setResourceData((previous) => ({
                    ...previous,
                    page: previous.page + delta,
                }));
            }}
            onQueryChange={(value) => {
                setQuery(value);
                setResourceData((previous) => ({ ...previous, page: 1 }));
            }}
            onSubmit={(event) => {
                void create(event);
            }}
            onTitleChange={(value) => {
                setTitle(value);
            }}
            onToggleResource={toggleResource}
            onVisibilityChange={(value) => {
                setVisibility(value);
            }}
            page={resourceData.page}
            pageCount={resourcePageCount}
            query={query}
            resources={resourceData.items}
            selectedIds={selectedIds}
            title={title}
            visibility={visibility}
        />
    );
}

export default function NotebookCreateDialog({
    initialResourceIds = EMPTY_RESOURCE_IDS,
    isOpen,
    onClose,
    onCreated,
}: NotebookCreateDialogProps) {
    const { t } = useTranslation();
    const defaultTitle = t('notebooks.default_title', 'New notebook');
    const initialKey = useMemo(
        () => [...initialResourceIds].sort().join(':'),
        [initialResourceIds],
    );
    if (!isOpen) return null;

    return (
        <OpenNotebookCreateDialog
            key={`${initialKey}:${defaultTitle}`}
            defaultTitle={defaultTitle}
            initialResourceIds={initialResourceIds}
            onClose={onClose}
            onCreated={onCreated}
        />
    );
}
