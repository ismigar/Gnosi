import {MediaToolbar} from './browser/MediaToolbar';
import {ViewNamePromptModal} from './browser/ViewNamePromptModal';
import {ConfirmDialog} from './browser/ConfirmDialog';
import {useMediaCenter} from './browser/useMediaCenter';
import {MediaHeader} from './browser/MediaHeader';
import {MediaSidebar} from './browser/MediaSidebar';
import {MediaGallery} from './browser/MediaGallery';
import {MediaLightbox} from './browser/MediaLightbox';
export default function MediaCenter() {
const state = useMediaCenter();
const {activeAlbum, filters, setFilters, sort, setSort, activeViewId, hasActiveFilters, resetFilters, viewPromptOpen, setViewPromptOpen, handleSaveAsView, submitNewView, handleUpdateView, confirmDialog, setConfirmDialog, t, isCompact, sidebarOpen, setSidebarOpen} = state;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)]">
      <MediaHeader state={state} />

      {/* Filter + sort toolbar (only when there's an active album) */}
      {activeAlbum !== null && (
        <MediaToolbar
          filters={filters}
          sort={sort}
          onFiltersChange={setFilters}
          onSortChange={setSort}
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
          activeViewId={activeViewId}
          onSaveAsView={handleSaveAsView}
          onUpdateView={() => { void handleUpdateView(); }}
        />
      )}

      <div className="relative flex flex-1 overflow-hidden">
        {isCompact && sidebarOpen && (
          <button
            type="button"
            className="media-library__backdrop"
            onClick={() => { setSidebarOpen(false); }}
            aria-label={t('common.close', 'Close')}
          />
        )}
        {/* Sidebar Albums */}
        <MediaSidebar state={state} />

        {/* Content Area */}
        <MediaGallery state={state} />

      </div>

      {/* Viewer (lightbox) — near full-screen view with a metadata panel
          on the right, prev/next navigation, slideshow, and fullscreen. The panel
          collapses in fullscreen or slideshow mode to maximize
          the media's screen space. */}
      <MediaLightbox state={state} />

      <ViewNamePromptModal
        open={viewPromptOpen}
        onCancel={() => { setViewPromptOpen(false); }}
        onConfirm={(label) => { void submitNewView(label); }}
      />

      <ConfirmDialog
        open={confirmDialog != null}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        cancelLabel={confirmDialog?.cancelLabel}
        danger={confirmDialog?.danger}
        Icon={confirmDialog?.Icon}
        onCancel={() => { setConfirmDialog(null); }}
        onConfirm={() => confirmDialog?.onConfirm()}
      />
    </div>
  );
}
