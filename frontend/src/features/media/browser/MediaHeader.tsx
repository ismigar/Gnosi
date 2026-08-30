import {Image as ImageIcon, Search, Grid, List as ListIcon, Plus, Loader2, PanelLeft} from 'lucide-react';
import {AppHeader} from '../../../components/AppHeader';
import {ROOT_META} from './constants';
import type {MediaCenterState} from './useMediaCenter';
export function MediaHeader({state}: {state: MediaCenterState}) {
const {activeRoot, t, sidebarOpen, setSidebarOpen, searchTerm, setSearchTerm, viewMode, setViewMode, isUploading, handleUpload} = state;
const rootMeta = ROOT_META[activeRoot];
return <><AppHeader
        icon={ImageIcon}
        title={t('media.title')}
        subtitle={`${t('media.subtitle')} · ${rootMeta?.labelKey ? t(rootMeta.labelKey) : activeRoot}`}
      >
        <button
          type="button"
          onClick={() => { setSidebarOpen((open) => !open); }}
          className="gnosi-icon-button md:hidden"
          title={t('media.toggle_library', 'Show or hide media library')}
          aria-label={t('media.toggle_library', 'Show or hide media library')}
          aria-expanded={sidebarOpen}
        >
          <PanelLeft size={18} />
        </button>
        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] group-focus-within:text-[var(--gnosi-primary)] transition-colors" size={16} />
            <input
              type="text"
              placeholder={t('media.search_placeholder')}
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.currentTarget.value); }}
              className="w-52 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-2 pl-10 pr-4 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 sm:w-64"
            />
          </div>

          <div className="flex bg-[var(--bg-secondary)] p-1 rounded-lg border border-[var(--border-primary)]">
            <button
              type="button"
              onClick={() => { setViewMode('grid'); }}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-[var(--bg-primary)] shadow-sm text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`}
              aria-label={t('media.grid_view', 'Grid view')}
              aria-pressed={viewMode === 'grid'}
            >
              <Grid size={18} />
            </button>
            <button
              type="button"
              onClick={() => { setViewMode('list'); }}
              className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-[var(--bg-primary)] shadow-sm text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`}
              aria-label={t('media.list_view', 'List view')}
              aria-pressed={viewMode === 'list'}
            >
              <ListIcon size={18} />
            </button>
          </div>

          {(activeRoot === 'images' || activeRoot === 'assets') && (
            <label className={`flex items-center gap-2 px-4 py-2 bg-[var(--gnosi-action-bg)] text-white rounded-lg transition-all shadow-lg ${isUploading ? 'opacity-70 cursor-wait pointer-events-none' : 'cursor-pointer active:scale-95'}`}>
              {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
              <span className="text-sm font-medium">{isUploading ? t('media.uploading_short') : t('media.upload_button')}</span>
              <input type="file" className="hidden" onChange={(event) => { void handleUpload(event); }} disabled={isUploading} />
            </label>
          )}
        </div>
      </AppHeader></>;
}
