import { Loader2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { VaultFeedCard } from './VaultFeedCard';
import { feedDateGroup } from './vaultFeedModel';
import type {
  VaultFeedDensity,
  VaultFeedGroupMode,
  VaultFeedNote,
  VaultFeedPill,
} from './vaultFeedTypes';
import type { TitlePreviewTriggerProps } from '../../../shared/editor/useTitlePreview';


const FEED_BATCH = 12;


interface VaultFeedListProps {
  readonly buildPills: (note: VaultFeedNote) => readonly VaultFeedPill[];
  readonly density: VaultFeedDensity;
  readonly excerptLines: number;
  readonly getTitleProps: (id: string) => TitlePreviewTriggerProps;
  readonly groupMode: VaultFeedGroupMode;
  readonly isSelected: (id: string) => boolean;
  readonly notes: readonly VaultFeedNote[];
  readonly onOpen: (id: string) => void;
  readonly onPreview: (id: string) => void;
  readonly onToggleSelect: (
    id: string,
    shiftKey: boolean,
  ) => void;
  readonly pillLimit: number;
  readonly readIds: ReadonlySet<string>;
  readonly searchTerm: string;
  readonly selectionActive: boolean;
}


export function VaultFeedList({
  buildPills,
  density,
  excerptLines,
  getTitleProps,
  groupMode,
  isSelected,
  notes,
  onOpen,
  onPreview,
  onToggleSelect,
  pillLimit,
  readIds,
  searchTerm,
  selectionActive,
}: VaultFeedListProps) {
  const { i18n, t } = useTranslation();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(FEED_BATCH);
  const hasMore = visibleCount < notes.length;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((count) => Math.min(count + FEED_BATCH, notes.length));
      }
    }, { root: null, rootMargin: '600px 0px' });
    observer.observe(sentinel);
    return () => { observer.disconnect(); };
  }, [hasMore, notes.length]);

  const visibleNotes = useMemo(
    () => notes.slice(0, visibleCount),
    [notes, visibleCount],
  );

  return (
    <div className="relative flex w-full max-w-3xl flex-col gap-8 pb-16">
      {visibleNotes.map((note, index) => {
        const group = groupMode === 'date'
          ? feedDateGroup(note.last_modified, i18n.language, t)
          : '';
        const previous = index > 0 ? visibleNotes[index - 1] : undefined;
        const previousGroup = groupMode === 'date' && previous
          ? feedDateGroup(previous.last_modified, i18n.language, t)
          : '';
        return (
          <Fragment key={note.id}>
            {group && group !== previousGroup && (
              <h3 className="vault-feed-date-group">{group}</h3>
            )}
            <VaultFeedCard
              note={note}
              pills={buildPills(note)}
              isSelected={isSelected(note.id)}
              selectionActive={selectionActive}
              onToggleSelect={onToggleSelect}
              onOpen={onOpen}
              onPreview={onPreview}
              titlePreviewProps={getTitleProps(note.id)}
              searchTerm={searchTerm}
              isRead={readIds.has(note.id)}
              density={density}
              pillLimit={pillLimit}
              excerptLines={excerptLines}
            />
          </Fragment>
        );
      })}

      {hasMore && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center py-4 text-[var(--text-tertiary)]"
        >
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}
    </div>
  );
}
