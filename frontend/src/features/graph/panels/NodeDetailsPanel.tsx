import { useEffect, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import { logError } from '../../../shared/notifications/notifyError';
import { fetchVaultPage } from '../../../shared/api/vaults';
import type { VaultPage } from '../../../shared/api/vaults';
import { VaultMarkdown } from '../../../shared/editor/VaultMarkdown';

interface NamedTag {
    readonly name?: string | null;
}

type NodeTag = string | NamedTag;

export interface NodeDetailsData extends Readonly<Record<string, unknown>> {
    readonly content?: unknown;
    readonly kind?: unknown;
    readonly label?: unknown;
    readonly last_edited_time?: unknown;
    readonly tags?: unknown;
    readonly title?: unknown;
    readonly url?: unknown;
}

interface NodeDetailsPanelProps {
    readonly initialData?: NodeDetailsData | null;
    readonly isOpen: boolean;
    readonly nodeId?: string | null;
    readonly onClose: () => void;
}

interface NodeDetailsRequestState {
    readonly error: string | null;
    readonly loading: boolean;
    readonly nodeId: string | null;
    readonly page: VaultPage | null;
}

function optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function isNamedTag(value: unknown): value is NamedTag {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTags(value: unknown): NodeTag[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
        (tag): tag is NodeTag => typeof tag === 'string' || isNamedTag(tag),
    );
}

function tagLabel(tag: NodeTag): string {
    return typeof tag === 'string' ? tag : optionalString(tag.name) ?? '';
}

function mergePageData(
    current: NodeDetailsData | null,
    page: VaultPage,
): NodeDetailsData {
    return { ...(current ?? {}), ...page };
}

function requestWasAborted(signal: AbortSignal): boolean {
    return signal.aborted;
}

export function NodeDetailsPanel({
    nodeId,
    isOpen,
    onClose,
    initialData = null,
}: NodeDetailsPanelProps) {
    const { t } = useTranslation();
    const [requestState, setRequestState] = useState<NodeDetailsRequestState>({
        error: null,
        loading: false,
        nodeId: null,
        page: null,
    });

    useEffect(() => {
        if (!isOpen || !nodeId) return undefined;
        const controller = new AbortController();

        const loadPage = async (): Promise<void> => {
            await Promise.resolve();
            if (requestWasAborted(controller.signal)) return;
            setRequestState({ error: null, loading: true, nodeId, page: null });
            try {
                const page = await fetchVaultPage(nodeId, controller.signal);
                if (!requestWasAborted(controller.signal)) {
                    setRequestState({ error: null, loading: false, nodeId, page });
                }
            } catch (caught: unknown) {
                if (requestWasAborted(controller.signal)) return;
                logError('graph-node-details', caught);
                setRequestState({
                    error: t('failed_to_load_node_details', 'Failed to load'),
                    loading: false,
                    nodeId,
                    page: null,
                });
            }
        };

        void loadPage();

        return () => {
            controller.abort();
        };
    }, [nodeId, isOpen, t]);

    if (!isOpen) return null;

    const currentRequest = requestState.nodeId === nodeId ? requestState : null;
    const data = currentRequest?.page
        ? mergePageData(initialData, currentRequest.page)
        : initialData;
    const loading = currentRequest?.loading ?? Boolean(nodeId);
    const error = currentRequest?.error ?? null;

    const displayTitle = optionalString(data?.title)
        ?? optionalString(data?.label)
        ?? t('common.untitled', 'Untitled');
    const imageUrl = optionalString(data?.url);
    const isMedia = data?.kind === 'media'
        || Boolean(imageUrl?.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i));
    const tags = normalizeTags(data?.tags).filter((tag) => tagLabel(tag));
    const lastEditedTime = optionalString(data?.last_edited_time);
    const content = optionalString(data?.content);

    const hideBrokenImage = (event: SyntheticEvent<HTMLImageElement>): void => {
        event.currentTarget.style.display = 'none';
    };

    return (
        <div
            className="node-details-panel"
            style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: '400px',
                height: '100%',
                backgroundColor: 'var(--bg-primary)',
                boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
                zIndex: 'var(--z-popover)',
                padding: '20px',
                overflowY: 'auto',
                transform: 'translateX(0)',
                transition: 'transform 0.3s ease-in-out',
                borderLeft: '1px solid var(--border-primary)',
                color: 'var(--text-primary)',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    marginBottom: '10px',
                    gap: '10px',
                }}
            >
                <button
                    type="button"
                    onClick={onClose}
                    className="gnosi-close-btn"
                    aria-label={t('graph.node_panel.close', 'Close details')}
                >
                    <X />
                </button>
            </div>

            {loading && !data && (
                <div style={{ marginTop: '40px', textAlign: 'center' }}>
                    {t('graph.node_panel.loading', 'Loading... ⏳')}
                </div>
            )}

            {error && !data && (
                <div style={{ marginTop: '40px', color: 'red', textAlign: 'center' }}>
                    {error}
                </div>
            )}

            {data && (
                <div>
                    <div style={{ marginBottom: '20px' }}>
                        <h2 style={{ margin: '0 0 10px 0', fontSize: '1.5rem' }}>
                            {displayTitle}
                        </h2>

                        {isMedia && imageUrl && (
                            <div
                                style={{
                                    marginBottom: '20px',
                                    borderRadius: '12px',
                                    overflow: 'hidden',
                                    border: '1px solid var(--border-primary)',
                                }}
                            >
                                <img
                                    src={imageUrl}
                                    alt={displayTitle}
                                    style={{ width: '100%', height: 'auto', display: 'block' }}
                                    onError={hideBrokenImage}
                                />
                            </div>
                        )}

                        <div
                            style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '5px',
                                marginBottom: '15px',
                            }}
                        >
                            {tags.map((tag) => {
                                const label = tagLabel(tag);
                                return (
                                    <span
                                        key={label}
                                        style={{
                                            backgroundColor: 'var(--bg-tertiary)',
                                            color: 'var(--text-primary)',
                                            padding: '2px 8px',
                                            borderRadius: '12px',
                                            fontSize: '0.8rem',
                                        }}
                                    >
                                        #{label}
                                    </span>
                                );
                            })}
                        </div>

                        {lastEditedTime && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                                {t('graph.node_panel.updated', 'Updated: {{date}}', {
                                    date: new Date(lastEditedTime).toLocaleDateString(),
                                })}
                            </div>
                        )}
                    </div>

                    {loading && (
                        <div style={{ marginBottom: '20px', color: 'var(--text-tertiary)' }}>
                            {t('graph.node_panel.loading_content', 'Finishing loading content...')}
                        </div>
                    )}

                    <div className="markdown-body" style={{ lineHeight: '1.6', fontSize: '0.95rem' }}>
                        {content
                            ? <VaultMarkdown md={content} />
                            : !loading && (
                                <em style={{ color: 'var(--text-tertiary)' }}>
                                    {t('graph.node_panel.no_content', 'No content...')}
                                </em>
                            )}
                    </div>
                </div>
            )}
        </div>
    );
}
