import type { BlockEditorPageLink } from '../../../../shared/api/block-editor';
import { legacyText, previewTitle } from './valueBoundaries';
import { extractOutgoingPageLinks } from '../outgoingLinks';
import { fetchBlockEditorBacklinks } from '../../../../shared/api/block-editor';
import { fetchBlockEditorOutlinks } from '../../../../shared/api/block-editor';
import { fetchBlockEditorUnlinkedMentions } from '../../../../shared/api/block-editor';
import { isRequestCancelled } from '../media';
import { linkBlockEditorUnlinkedMentions } from '../../../../shared/api/block-editor';
import { logError } from '../../../../lib/notifyError';
import { notifyError } from '../../../../lib/notifyError';
import { toast } from '../../../../lib/toast';
import { useCallback } from 'react';
import { useEffect } from 'react';
import { useMemo } from 'react';
import type { usePageEditorState } from './usePageEditorState';
type Input = Pick<ReturnType<typeof usePageEditorState>, 'setLiveOutgoingLinks' | 'initialContent' | 'idToTitle' | 'noteFilename' | 'liveOutgoingLinks' | 't' | 'incomingLinks' | 'relatedPages' | 'unlinkedMentions' | 'onOpenParallel' | 'metadata' | 'showKnowledgePanels' | 'setIncomingLinks' | 'setRelatedPages' | 'setIncomingLinksLoading' | 'setUnlinkedMentions' | 'setUnlinkedMentionsLoading' | 'setLinkMentionsBusy' | 'onRefreshNotes'>;
export function usePageLinks(state: Input) {
  const { setLiveOutgoingLinks, initialContent, idToTitle, noteFilename, liveOutgoingLinks, t, incomingLinks, relatedPages, unlinkedMentions, onOpenParallel, metadata, showKnowledgePanels, setIncomingLinks, setRelatedPages, setIncomingLinksLoading, setUnlinkedMentions, setUnlinkedMentionsLoading, setLinkMentionsBusy, onRefreshNotes } = state;


  useEffect(() => {
    setLiveOutgoingLinks(extractOutgoingPageLinks(legacyText(initialContent || ''), idToTitle, noteFilename));
  }, [initialContent, idToTitle, noteFilename, setLiveOutgoingLinks]);

  const outgoingLinks = liveOutgoingLinks;

  const compactLinkPreviewSections = useMemo(() => {
    const toTitle = previewTitle;
    return [
      { key: 'outgoing', label: t('editor.outgoing'), items: outgoingLinks },
      { key: 'incoming', label: t('editor.incoming'), items: incomingLinks },
      { key: 'relations', label: t('editor.relations'), items: relatedPages },
      { key: 'pending', label: t('editor.pending'), items: unlinkedMentions },
    ].map(section => ({
      ...section,
      count: section.items.length,
      previewItems: section.items.slice(0, 4).map(toTitle).filter(Boolean),
    }));
  }, [incomingLinks, outgoingLinks, relatedPages, t, unlinkedMentions]);


  const openLinkedPage = useCallback((pageId: string | null | undefined) => {
    const safeId = (pageId || '').trim();
    if (!safeId) return;
    onOpenParallel(safeId);
  }, [onOpenParallel]);


  const formatIncomingDisambiguator = useCallback((pageId: string | null | undefined) => {
    const safeId = (pageId || '').trim();
    if (!safeId) return 'no-id';
    if (safeId.length <= 14) return safeId;
    return `${safeId.slice(0, 8)}...${safeId.slice(-4)}`;
  }, []);


  const incomingTitleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of incomingLinks) {
      const normalized = (link.title || '').trim().toLowerCase();
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
    return counts;
  }, [incomingLinks]);


  const currentTitleNormalized = useMemo(() => {
    return (metadata.title || '').trim().toLowerCase();
  }, [metadata.title]);


  const formatIncomingLinkLabel = useCallback((link: BlockEditorPageLink) => {
    const title = (link.title || '').trim();
    const id = (link.id || '').trim();
    if (!title) return id || 'untitled';

    const normalized = title.toLowerCase();
    const repeatedTitle = (incomingTitleCounts.get(normalized) || 0) > 1;
    const sameTitleAsCurrent = Boolean(currentTitleNormalized) && normalized === currentTitleNormalized;

    if (repeatedTitle || sameTitleAsCurrent) {
      return `${title} (${formatIncomingDisambiguator(id)})`;
    }

    return title;
  }, [incomingTitleCounts, currentTitleNormalized, formatIncomingDisambiguator]);


  useEffect(() => {
    const controller = new AbortController();

    const loadIncomingLinks = async () => {
      if (!noteFilename || !showKnowledgePanels) {
        setIncomingLinks([]);
        setRelatedPages([]);
        return;
      }

      const selfId = (noteFilename || '').trim();
      setIncomingLinksLoading(true);
      try {
        // Wiki backlinks (with kind) + outgoing schema relations, in parallel.
        const [backlinksRes, outlinksRes] = await Promise.all([
          fetchBlockEditorBacklinks(noteFilename, controller.signal),
          fetchBlockEditorOutlinks(noteFilename, controller.signal).catch((error: unknown) => {
            if (isRequestCancelled(error, controller.signal)) throw error;
            return { links: [], relations: [], unresolved: [] };
          }),
        ]);
        if (controller.signal.aborted) return;

        // Split backlinks: wiki-links → "entrants"; relations → "Relacions".
        const incomingDedup = new Map<string, BlockEditorPageLink>();
        const relationsDedup = new Map<string, BlockEditorPageLink>();
        const addRelation = (id: string, title: string) => {
          if (!id || id === selfId || relationsDedup.has(id)) return;
          relationsDedup.set(id, { id, title: (title || idToTitle[id] || id) });
        };
        for (const item of Array.isArray(backlinksRes) ? backlinksRes : []) {
          const id = (item.id || '').trim();
          if (!id || id === selfId) continue;
          const title = (item.title || idToTitle[id] || id);
          if (item.kind === 'relation') {
            addRelation(id, title);
          } else if (!incomingDedup.has(id)) {
            incomingDedup.set(id, { id, title });
          }
        }
        // Merge outgoing schema relations (same undirected relation edge in the graph).
        for (const item of Array.isArray(outlinksRes.relations) ? outlinksRes.relations : []) {
          addRelation((item.id || '').trim(), item.title);
        }

        setIncomingLinks(
          Array.from(incomingDedup.values()).sort((a, b) => a.title.localeCompare(b.title))
        );
        setRelatedPages(
          Array.from(relationsDedup.values()).sort((a, b) => a.title.localeCompare(b.title))
        );
      } catch (error) {
        if (isRequestCancelled(error, controller.signal)) return;
        logError('load-backlinks', error);
        setIncomingLinks([]);
        setRelatedPages([]);
      } finally {
        if (!controller.signal.aborted) {
          setIncomingLinksLoading(false);
        }
      }
    };

    void loadIncomingLinks();
    return () => {
      controller.abort();
    };
  }, [noteFilename, idToTitle, showKnowledgePanels, setIncomingLinksLoading, setIncomingLinks, setRelatedPages]);


  useEffect(() => {
    const controller = new AbortController();

    const loadUnlinkedMentions = async () => {
      if (!noteFilename || !showKnowledgePanels) {
        setUnlinkedMentions([]);
        return;
      }

      setUnlinkedMentionsLoading(true);
      try {
        const response = await fetchBlockEditorUnlinkedMentions(
          noteFilename,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const items = Array.isArray(response) ? response : [];
        setUnlinkedMentions(items);
      } catch (error) {
        if (isRequestCancelled(error, controller.signal)) return;
        logError('load-unlinked-mentions', error);
        setUnlinkedMentions([]);
      } finally {
        if (!controller.signal.aborted) {
          setUnlinkedMentionsLoading(false);
        }
      }
    };

    void loadUnlinkedMentions();
    return () => {
      controller.abort();
    };
  }, [noteFilename, setUnlinkedMentions, setUnlinkedMentionsLoading, showKnowledgePanels]);


  const handleLinkMentions = useCallback(async (sourceId = '') => {
    if (!noteFilename) return;
    setLinkMentionsBusy(true);
    try {
      const payload = {
        target_id: noteFilename,
        source_id: sourceId || null,
      };
      const response = await linkBlockEditorUnlinkedMentions(payload);
      const changed = (response.notes_changed || 0);
      const replacements = (response.total_replacements || 0);

      if (changed > 0) {
        toast.success(t('editor.mentions_linked', { count: replacements, notes: changed }));
      } else {
        toast(t('editor.no_pending_mentions'));
      }

      const mentionsRes = await fetchBlockEditorUnlinkedMentions(noteFilename);
      setUnlinkedMentions(Array.isArray(mentionsRes) ? mentionsRes : []);

      const backlinksRes = await fetchBlockEditorBacklinks(noteFilename);
      const dedup = new Map<string, BlockEditorPageLink>();
      for (const item of Array.isArray(backlinksRes) ? backlinksRes : []) {
        const id = (item.id || '').trim();
        if (!id || id === (noteFilename || '').trim() || dedup.has(id)) continue;
        dedup.set(id, {
          id,
          title: (item.title || idToTitle[id] || id),
        });
      }
      setIncomingLinks(Array.from(dedup.values()).sort((a, b) => a.title.localeCompare(b.title)));

      onRefreshNotes();
    } catch (error) {
      notifyError('link-mentions', error, t('editor.link_mentions_error'));
    } finally {
      setLinkMentionsBusy(false);
    }
  }, [noteFilename, setLinkMentionsBusy, setUnlinkedMentions, setIncomingLinks, onRefreshNotes, t, idToTitle]);
  return { outgoingLinks, compactLinkPreviewSections, openLinkedPage, formatIncomingDisambiguator, incomingTitleCounts, currentTitleNormalized, formatIncomingLinkLabel, handleLinkMentions };
}
