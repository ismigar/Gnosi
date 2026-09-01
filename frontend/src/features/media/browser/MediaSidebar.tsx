import {Image as ImageIcon, Trash2, Folder, Library, Bookmark} from 'lucide-react';
import {TreeNode} from './TreeNode';
import {ROOT_META} from './constants';
import type {MediaCenterState} from './useMediaCenter';
export function MediaSidebar({state}: {state: MediaCenterState}) {
const {albums, activeAlbum, setActiveAlbum, roots, activeRoot, setActiveRoot, activeViewId, applyView, views, handleDeleteView, t, sidebarOpen} = state;
const rootMeta = ROOT_META[activeRoot];
return <><aside className={`media-library__sidebar ${sidebarOpen ? 'is-open' : ''}`}>
          {/* Root tabs: Images, Assets, Library, Vault */}
          {roots.length > 1 && (
            <>
              <p className="gnosi-sidebar-section-title px-2 mb-1">{t('media.origin')}</p>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {roots.map((r) => {
                  const meta = ROOT_META[r.key] || { Icon: Folder };
                  const metaLabel = meta.labelKey ? t(meta.labelKey) : r.label;
                  const Icon = meta.Icon;
                  const active = r.key === activeRoot;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => { setActiveRoot(r.key); }}
                      title={metaLabel}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        active
                          ? 'bg-[var(--gnosi-action-bg)] text-white border-[var(--gnosi-action-bg)] shadow-sm'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <Icon size={13} />
                      <span className="truncate">{metaLabel}</span>
                    </button>
                  );
                })}
              </div>
              <div className="h-px bg-[var(--border-primary)] mx-2 opacity-50" />
            </>
          )}

          {/* Saved views — appear above the folder list. Applying
              a view changes root, album, filters, and sorting all at once. */}
          {views.length > 0 && (
            <>
              <p className="gnosi-sidebar-section-title px-2 mb-1 mt-1">{t('media.views')}</p>
              <div className="flex flex-col gap-1 mb-2">
                {views.map((v) => {
                  const isActive = activeViewId === v.id;
                  return (
                    <div
                      key={v.id}
                      className={`group flex items-stretch rounded-xl transition-all ${
                        isActive
                          ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] shadow-sm'
                          : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => { applyView(v); }}
                        className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 text-left"
                        title={v.label}
                      >
                        <Bookmark size={14} className="shrink-0" />
                        <span className="text-sm font-medium truncate">{v.label}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteView(v.id); }}
                        className="px-2 opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-red-500 transition-all"
                        title={t('media.delete_view')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="h-px bg-[var(--border-primary)] mx-2 opacity-50 mb-2" />
            </>
          )}

          <p className="gnosi-sidebar-section-title px-2 mb-2 mt-1">{t('media.folders')}</p>

          <button
            onClick={() => { setActiveAlbum(''); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeAlbum === '' ? 'bg-[var(--gnosi-primary)]/10 text-blue-700 dark:text-blue-300 shadow-sm' : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'}`}
            title={t('media.all_root_title')}
          >
            <ImageIcon size={18} />
            <span className="text-sm font-medium">{rootMeta?.allLabelKey ? t(rootMeta.allLabelKey) : t('media.all_of_root', { root: activeRoot })}</span>
          </button>

          <div className="h-px bg-[var(--border-primary)] my-2 mx-2 opacity-50" />

          {albums.map((node) => (
            <TreeNode
              key={`${activeRoot}::${node.path}`}
              node={node}
              depth={0}
              activeAlbum={activeAlbum}
              onSelect={setActiveAlbum}
              root={activeRoot}
            />
          ))}
        </aside></>;
}
