import {Image as ImageIcon, ChevronDown, Folder, Loader2} from 'lucide-react';
import {motion} from 'framer-motion';
import {useRef} from 'react';
import {normalizeUrl} from './model';
import {Thumb} from './Thumb';
import type {MediaCenterState} from './useMediaCenter';
export function MediaGallery({state}: {state: MediaCenterState}) {
const scrollRoot = useRef<HTMLDivElement>(null);
const {media, loading, hasSnapshot, indexState, indexError, indexPollingPaused, indexRetryBlocked, activeAlbum, total, hasMore, hasActiveFilters, fetchMedia, handlePhotoClick, t, viewMode, filteredMedia} = state;
const loadMore = hasMore && (
                <div className="flex justify-center mt-8">
                  <button
                    type="button"
                    onClick={() => { void fetchMedia(false); }}
                    disabled={loading}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-all disabled:opacity-50 disabled:cursor-wait"
                  >
                    {loading
                      ? <Loader2 size={16} className="animate-spin" />
                      : <ChevronDown size={16} />}
                    {loading ? t('media.loading') : t('media.load_more')}
                  </button>
                </div>
              );
return <><div ref={scrollRoot} className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {activeAlbum !== null && (indexError || indexPollingPaused || indexState === 'refreshing') && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-secondary)]" role={indexError ? 'alert' : 'status'} aria-live="polite">
              <span>{t(indexError ? 'media.index_update_failed' : indexPollingPaused ? 'media.index_update_paused' : 'media.index_updating')}</span>
              {(indexError || indexPollingPaused) && (
                <button type="button" disabled={loading || indexRetryBlocked} onClick={() => {void fetchMedia(true);}} className="shrink-0 font-semibold text-[var(--gnosi-primary)] disabled:opacity-50">
                  {t(indexRetryBlocked ? 'media.index_retry_wait' : 'common.retry')}
                </button>
              )}
            </div>
          )}
          {activeAlbum === null ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] bg-[var(--bg-primary)]/30 rounded-2xl border-2 border-dashed border-[var(--border-primary)]">
              <Folder size={64} className="mb-4 opacity-20" />
              <p className="text-sm font-medium">{t('media.select_view_or_album')}</p>
            </div>
          ) : loading && !hasSnapshot ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] bg-[var(--bg-primary)]/30 rounded-2xl border-2 border-dashed border-[var(--border-primary)]">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="mb-4"
              >
                <ImageIcon size={48} className="opacity-20" />
              </motion.div>
              <p className="text-sm font-medium">{t('media.indexing')}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xs text-center">
                {activeAlbum
                  ? t('media.reading_album', { album: activeAlbum })
                  : t('media.first_index_hint')}
              </p>
            </div>
          ) : filteredMedia.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)]">
              <ImageIcon size={64} className="mb-4 opacity-10" />
              <p className="text-lg font-medium">{t(media.length === 0 && hasMore ? 'media.no_files_in_page' : 'media.no_files')}</p>
              {(media.length > 0 || !hasMore) && <p className="text-sm">
                {hasActiveFilters
                  ? t('media.try_other_filter')
                  : t('media.folder_empty')}
              </p>}
              {loadMore}
            </div>
          ) : (
            <>
              <div className={
                viewMode === 'grid'
                  ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6"
                  : "flex flex-col gap-3"
              }>
                {filteredMedia.map(item => (
                  <div
                    key={`${item.root}:${item.path_in_root}`}
                    onClick={() => { handlePhotoClick(item); }}
                    className={`group cursor-pointer bg-[var(--bg-primary)] rounded-2xl overflow-hidden border border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50 hover:shadow-xl transition-all duration-300 ${
                      viewMode === 'list' ? 'flex items-center gap-4 p-3' : ''
                    }`}
                  >
                    <Thumb
                      src={normalizeUrl(item.url)}
                      alt={item.filename}
                      viewMode={viewMode}
                      kind={item.kind}
                      scrollRoot={scrollRoot}
                    />
                  </div>
                ))}
              </div>

              {loadMore}
              {total > 0 && (
                <p className="text-center text-xs text-[var(--text-tertiary)] mt-4">
                  {t('media.count_of', { count: media.length, total })}
                </p>
              )}
            </>
          )}
        </div></>;
}
