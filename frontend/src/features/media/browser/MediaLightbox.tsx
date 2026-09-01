import {ChevronRight, ExternalLink, X, ChevronLeft, Maximize2, Minimize2, Play, Pause} from 'lucide-react';
import {AnimatePresence, motion} from 'framer-motion';
import {normalizeUrl} from './model';
import {MediaMetadataPanel} from './MediaMetadataPanel';
import type {MediaCenterState} from './useMediaCenter';
export function MediaLightbox({state}: {state: MediaCenterState}) {
const {selectedPhoto, slideshowActive, setSlideshowActive, isFullscreen, viewerRootRef, currentIndex, hasPrev, hasNext, goPrev, goNext, closeViewer, toggleFullscreen, t, filteredMedia} = state;
return <><AnimatePresence>
        {selectedPhoto && (
          <motion.div
            ref={viewerRootRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[var(--z-modal)] bg-black/95 backdrop-blur-md flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 text-white border-b border-white/10 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={closeViewer}
                  className="p-2 rounded-lg hover:bg-white/10 transition-all"
                  title={t('media.close_esc')}
                >
                  <X size={20} />
                </button>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" title={selectedPhoto.filename}>{selectedPhoto.filename}</p>
                  <p className="text-[11px] text-white/50">{selectedPhoto.album}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-white/60 mr-2 tabular-nums">
                  {currentIndex + 1} / {filteredMedia.length}
                </span>
                <button
                  onClick={() => { setSlideshowActive(s => !s); }}
                  className={`p-2 rounded-lg transition-all ${slideshowActive ? 'bg-[var(--gnosi-primary)] text-white' : 'hover:bg-white/10 text-white'}`}
                  title={slideshowActive ? t('media.stop_slideshow') : t('media.start_slideshow')}
                >
                  {slideshowActive ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="p-2 rounded-lg hover:bg-white/10 text-white transition-all"
                  title={isFullscreen ? t('media.exit_fullscreen') : t('media.fullscreen')}
                >
                  {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 flex min-h-0">
              {/* Media + fletxes */}
              <div className="relative flex-1 flex items-center justify-center p-4 min-w-0">
                {hasPrev && (
                  <button
                    onClick={goPrev}
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all backdrop-blur-sm"
                    title={t('media.prev')}
                  >
                    <ChevronLeft size={24} />
                  </button>
                )}
                {hasNext && (
                  <button
                    onClick={goNext}
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all backdrop-blur-sm"
                    title={t('media.next')}
                  >
                    <ChevronRight size={24} />
                  </button>
                )}

                {/* Render based on type */}
                {selectedPhoto.kind === 'image' && (
                  <img
                    key={selectedPhoto.id}
                    src={normalizeUrl(selectedPhoto.url)}
                    alt={selectedPhoto.filename}
                    className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                  />
                )}
                {selectedPhoto.kind === 'video' && (
                  <video
                    key={selectedPhoto.id}
                    src={normalizeUrl(selectedPhoto.url)}
                    controls
                    autoPlay
                    className="max-w-full max-h-full rounded-lg shadow-2xl"
                  />
                )}
                {selectedPhoto.kind === 'audio' && (
                  <audio
                    key={selectedPhoto.id}
                    src={normalizeUrl(selectedPhoto.url)}
                    controls
                    autoPlay
                    className="w-full max-w-md"
                  />
                )}
                {selectedPhoto.kind === 'pdf' && (
                  <iframe
                    key={selectedPhoto.id}
                    src={normalizeUrl(selectedPhoto.url)}
                    title={selectedPhoto.filename}
                    className="w-full h-full bg-white rounded-lg shadow-2xl"
                  />
                )}
                {(!['image', 'video', 'audio', 'pdf'].includes(selectedPhoto.kind)) && (
                  <a
                    href={normalizeUrl(selectedPhoto.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-300 hover:underline text-sm flex items-center gap-2"
                  >
                    <ExternalLink size={16} /> {t('media.open_in_browser')}
                  </a>
                )}
              </div>

              {/* Metadata panel — hidden in fullscreen and slideshow */}
              <MediaMetadataPanel state={state} />
            </div>
          </motion.div>
        )}
      </AnimatePresence></>;
}
