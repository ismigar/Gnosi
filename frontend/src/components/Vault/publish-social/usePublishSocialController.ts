import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import {
    composeSocialPosts,
    fetchSocialNetworks,
    publishSocialPosts,
    scheduleSocialPosts,
    type SocialPublicationResult,
} from '../../../shared/api/social';
import { fetchVaultPage } from '../../../shared/api/vaults';
import {
    buildSocialPosts,
    deriveSocialContent,
    initialPublishSocialState,
    publishSocialReducer,
    socialErrorMessage,
    type SocialResult,
} from './publishSocialModel';


export interface PublishSocialControllerOptions {
    readonly noteId?: string | null;
    readonly onClose: () => void;
    readonly onPublished?: (result: SocialResult) => void;
    readonly recordMetadata?: Readonly<Record<string, unknown>>;
}


function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}


export function usePublishSocialController({
    noteId = null,
    onClose,
    onPublished,
    recordMetadata = {},
}: PublishSocialControllerOptions) {
    const { t } = useTranslation();
    const [state, dispatch] = useReducer(
        publishSocialReducer,
        recordMetadata,
        initialPublishSocialState,
    );
    const selectedNetworks = useMemo(() => [...state.selected], [state.selected]);
    const networkById = useMemo(() => new Map(
        state.networks.map((network) => [network.id, network]),
    ), [state.networks]);
    const charLimitFor = useCallback(
        (network: string): number => networkById.get(network)?.char_limit ?? 280,
        [networkById],
    );
    const nameFor = useCallback(
        (network: string): string => networkById.get(network)?.name ?? network,
        [networkById],
    );
    const overLimitNetworks = useMemo(() => selectedNetworks.filter((network) => (
        (state.drafts[network] ?? '').length > charLimitFor(network)
    )), [charLimitFor, selectedNetworks, state.drafts]);
    const fallbackTitle = typeof recordMetadata.title === 'string'
        ? recordMetadata.title.trim()
        : '';
    const fallbackContent = deriveSocialContent(recordMetadata);
    const networksErrorMessage = t(
        'social.networks_error',
        'The networks could not be loaded.',
    );

    useEffect(() => {
        let cancelled = false;
        void fetchSocialNetworks()
            .then((networks) => {
                if (!cancelled) dispatch({
                    networks: networks.filter(({ enabled }) => enabled),
                    type: 'networks-loaded',
                });
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                logError('publish-social.networks', error);
                toast.error(networksErrorMessage);
            });
        return () => { cancelled = true; };
    }, [networksErrorMessage]);

    useEffect(() => {
        if (!noteId) return undefined;
        let cancelled = false;
        void fetchVaultPage(noteId)
            .then((page) => {
                if (cancelled) return;
                const title = (
                    stringValue(page.title)
                    || stringValue(page.metadata.title)
                    || fallbackTitle
                ).trim();
                const content = page.content.trim() || fallbackContent;
                dispatch({ content, title, type: 'source-loaded' });
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                logError('publish-social.source', error);
                dispatch({
                    content: fallbackContent,
                    title: fallbackTitle,
                    type: 'source-loaded',
                });
            });
        return () => { cancelled = true; };
    }, [fallbackContent, fallbackTitle, noteId]);

    const generate = useCallback(async (): Promise<void> => {
        if (selectedNetworks.length === 0) {
            toast.error(t('social.pick_network', 'Select at least one network.'));
            return;
        }
        if (!state.sourceContent.trim() && !state.sourceTitle.trim()) {
            toast.error(t(
                'social.need_content',
                'Content is required to generate the posts.',
            ));
            return;
        }
        dispatch({ type: 'compose-started' });
        try {
            const result = await composeSocialPosts({
                content: state.sourceContent,
                hint: state.hint,
                networks: selectedNetworks,
                source_page_id: noteId,
                title: state.sourceTitle,
            });
            dispatch({ proposals: result.proposals, type: 'compose-finished' });
        } catch (error: unknown) {
            logError('publish-social.compose', error);
            dispatch({ type: 'compose-stopped' });
            toast.error(`${t('social.compose_error', 'Error generating the proposals')}: ${socialErrorMessage(error, t('errors.unknown', 'Unknown error'))}`);
        }
    }, [noteId, selectedNetworks, state.hint, state.sourceContent, state.sourceTitle, t]);

    const regenerate = useCallback(async (network: string): Promise<void> => {
        const variation = (state.variationByNetwork[network] ?? 0) + 1;
        dispatch({ network, type: 'regenerate-started' });
        try {
            const result = await composeSocialPosts({
                content: state.sourceContent,
                hint: state.hint,
                networks: selectedNetworks,
                regenerate_only: [network],
                source_page_id: noteId,
                title: state.sourceTitle,
                variation,
            });
            dispatch({
                network,
                proposal: result.proposals[network],
                type: 'regenerate-finished',
                variation,
            });
        } catch (error: unknown) {
            logError('publish-social.regenerate', error);
            dispatch({ network, type: 'regenerate-finished', variation });
            toast.error(`${t('social.regen_error', 'Error regenerating')}: ${socialErrorMessage(error, t('errors.unknown', 'Unknown error'))}`);
        }
    }, [noteId, selectedNetworks, state.hint, state.sourceContent, state.sourceTitle, state.variationByNetwork, t]);

    const reportResults = useCallback((result: SocialPublicationResult): void => {
        const succeeded = Object.entries(result.results)
            .filter(([, value]) => value.status === 'success')
            .map(([network]) => nameFor(network));
        const failed = Object.entries(result.results)
            .filter(([, value]) => value.status === 'error')
            .map(([network]) => nameFor(network));
        if (succeeded.length > 0 && failed.length === 0) {
            toast.success(t('social.published_ok', {
                defaultValue: 'Published to: {{nets}}.',
                nets: succeeded.join(', '),
            }));
        } else if (succeeded.length > 0) {
            toast.success(t('social.published_partial', {
                defaultValue: 'Published to {{ok}}. Failed on {{err}}.',
                err: failed.join(', '),
                ok: succeeded.join(', '),
            }));
        } else {
            toast.error(t('social.published_none', {
                defaultValue: 'Could not publish to: {{nets}}.',
                nets: failed.join(', '),
            }));
        }
    }, [nameFor, t]);

    const publish = useCallback(async (): Promise<void> => {
        const posts = buildSocialPosts(selectedNetworks, state.drafts);
        if (Object.keys(posts).length === 0) {
            toast.error(t('social.nothing_to_publish', 'There is no text to publish.'));
            return;
        }
        if (overLimitNetworks.length > 0) {
            toast.error(t('social.over_limit', {
                defaultValue: 'Exceeds the limit on: {{nets}}.',
                nets: overLimitNetworks.map(nameFor).join(', '),
            }));
            return;
        }
        dispatch({ type: 'publish-started' });
        try {
            const result = await publishSocialPosts({
                posts,
                source_page_id: noteId,
                source_title: state.sourceTitle,
            });
            reportResults(result);
            onPublished?.(result);
            onClose();
        } catch (error: unknown) {
            logError('publish-social.publish', error);
            toast.error(`${t('social.publish_error', 'Error publishing')}: ${socialErrorMessage(error, t('errors.unknown', 'Unknown error'))}`);
        } finally {
            dispatch({ type: 'publish-finished' });
        }
    }, [nameFor, noteId, onClose, onPublished, overLimitNetworks, reportResults, selectedNetworks, state.drafts, state.sourceTitle, t]);

    const schedule = useCallback(async (): Promise<void> => {
        const posts = buildSocialPosts(selectedNetworks, state.drafts);
        if (Object.keys(posts).length === 0) {
            toast.error(t('social.nothing_to_publish', 'There is no text to publish.'));
            return;
        }
        if (!state.scheduledAt || new Date(state.scheduledAt) <= new Date()) {
            toast.error(t('social.schedule_future', 'Choose a future date.'));
            return;
        }
        if (overLimitNetworks.length > 0) {
            toast.error(t('social.over_limit', {
                defaultValue: 'Exceeds the limit on: {{nets}}.',
                nets: overLimitNetworks.map(nameFor).join(', '),
            }));
            return;
        }
        dispatch({ type: 'publish-started' });
        try {
            const result = await scheduleSocialPosts({
                posts,
                scheduled_time: new Date(state.scheduledAt).toISOString(),
                source_page_id: noteId,
                source_title: state.sourceTitle,
            });
            toast.success(t('social.scheduled_ok', 'Post scheduled.'));
            onPublished?.(result);
            onClose();
        } catch (error: unknown) {
            logError('publish-social.schedule', error);
            toast.error(`${t('social.schedule_error', 'Error scheduling')}: ${socialErrorMessage(error, t('errors.unknown', 'Unknown error'))}`);
        } finally {
            dispatch({ type: 'publish-finished' });
        }
    }, [nameFor, noteId, onClose, onPublished, overLimitNetworks, selectedNetworks, state.drafts, state.scheduledAt, state.sourceTitle, t]);

    return {
        busy: state.composing || state.publishing,
        charLimitFor,
        dispatch,
        generate,
        nameFor,
        networkById,
        overLimitNetworks,
        publish,
        regenerate,
        schedule,
        selectedNetworks,
        state,
    };
}
