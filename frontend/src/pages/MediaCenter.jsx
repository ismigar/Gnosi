import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppHeader } from '../components/AppHeader';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  Image as ImageIcon,
  Upload,
  Filter,
  ChevronRight,
  ChevronDown,
  MoreVertical,
  Download,
  Trash2,
  ExternalLink,
  Search,
  Grid,
  List as ListIcon,
  Plus,
  MapPin,
  Calendar,
  Tag,
  FileText,
  X,
  Folder,
  FolderOpen,
  CloudOff,
  Library,
  Database,
  Music,
  Video,
  ArrowDown,
  ArrowUp,
  Eraser,
  HardDrive,
  Check,
  Loader2,
  AlertCircle,
  Bookmark,
  BookmarkPlus,
  BookmarkCheck,
  ChevronLeft,
  Maximize2,
  Minimize2,
  Play,
  Pause,
  PanelLeft
} from 'lucide-react';
import { toast } from '../lib/toast';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import {
  createMediaView,
  deleteMediaView,
  fetchMediaPage,
  fetchMediaRoots,
  fetchMediaTree,
  fetchMediaViews,
  updateMediaMetadata,
  updateMediaView,
  uploadMediaFile,
} from '../shared/api/media-browser';
import { uploadVaultAsset } from '../shared/api/vault-specialized';

const PERSPECTIVES = [ // We keep it for reference or inbox, but we prioritize albums
  { id: 'General', label: 'General', icon: FolderOpen, color: 'text-blue-500' },
  { id: 'Inbox', label: 'Inbox', icon: FolderOpen, color: 'text-orange-500' }
];

const normalizeUrl = (url) => {
  if (!url) return '';
  // If it's an absolute backend URL (e.g. http://backend:5002/api/...), we make it relative
  const match = url.match(/^https?:\/\/[^/]+(\/api\/.*)$/i);
  if (match?.[1]) return match[1];
  return url;
};

// TreeNode is recursive and lazy: it only requests subfolders when the user
// expands the node. Without this, indexing the archive's ~33k directories
// would make mounting the sidebar unviable.
const TreeNode = React.memo(function TreeNode({ node, depth, activeAlbum, onSelect, root = 'images' }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const isActive = activeAlbum === node.path;

  const toggle = async (e) => {
    e.stopPropagation();
    if (!node.has_children) return;
    if (!expanded && children === null) {
      setLoading(true);
      try {
        setChildren(await fetchMediaTree(root, node.path));
      } catch (err) {
        console.error('Error loading subfolders:', err);
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  };

  return (
    <>
      <div
        style={{ paddingLeft: `${4 + depth * 14}px` }}
        className={`w-full flex items-stretch rounded-xl transition-all ${
          isActive
            ? 'bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-sm'
            : 'hover:bg-[var(--bg-secondary)]'
        }`}
      >
        <button
          type="button"
          onClick={toggle}
          className={`shrink-0 w-6 flex items-center justify-center ${
            node.has_children ? 'cursor-pointer' : 'cursor-default'
          }`}
          aria-label={expanded ? t('common.collapse') : t('common.expand')}
        >
          {node.has_children ? (
            loading ? (
              <span className="text-[var(--text-tertiary)] text-xs">…</span>
            ) : expanded ? (
              <ChevronDown size={14} className="text-[var(--text-tertiary)]" />
            ) : (
              <ChevronRight size={14} className="text-[var(--text-tertiary)]" />
            )
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.path)}
          className={`flex items-center gap-2 min-w-0 flex-1 pr-3 py-2 text-left ${
            isActive ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'
          }`}
          title={node.name}
        >
          {expanded ? (
            <FolderOpen size={16} className={`shrink-0 ${isActive ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`} />
          ) : (
            <Folder size={16} className={`shrink-0 ${isActive ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`} />
          )}
          <span className="text-sm font-medium truncate min-w-0">{node.name}</span>
        </button>
      </div>

      {expanded && children && children.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          activeAlbum={activeAlbum}
          onSelect={onSelect}
          root={root}
        />
      ))}
    </>
  );
});

// Visual placeholders for files that `<img>` can't render
// (video, pdf, audio, other). Without this they show up as black boxes
// while `<img>` fails in a loop.
const NON_IMAGE_THUMB = {
  video: { Icon: Video, labelKey: 'media.thumb_video', accent: 'text-rose-400' },
  pdf:   { Icon: FileText, labelKey: 'media.thumb_pdf', accent: 'text-orange-400' },
  audio: { Icon: Music, labelKey: 'media.thumb_audio', accent: 'text-cyan-400' },
  other: { Icon: HardDrive, labelKey: 'media.thumb_other', accent: 'text-slate-400' },
};

// Thumb manages its own loading/error state per image. If OneDrive is
// materializing a file in the background, the first GET may return 503;
// we retry a couple of times before showing the cloud-off placeholder.
const Thumb = React.memo(function Thumb({ src, alt, viewMode, kind }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 4000;

  const wrapperClass = viewMode === 'grid'
    ? 'aspect-square relative overflow-hidden bg-gray-900'
    : 'w-24 h-24 relative rounded-xl overflow-hidden flex-shrink-0 bg-gray-900';

  // Video / PDF / audio / other: never go into `<img>` — placeholder with an icon
  // of the type and file name.
  if (kind && kind !== 'image') {
    const meta = NON_IMAGE_THUMB[kind] || NON_IMAGE_THUMB.other;
    const Icon = meta.Icon;
    return (
      <div className={`${wrapperClass} bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center gap-1.5 p-2`}>
        <Icon size={viewMode === 'grid' ? 36 : 24} className={`${meta.accent} opacity-90`} />
        <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">{t(meta.labelKey)}</span>
        <span className="text-[9px] text-slate-500 truncate w-full text-center" title={alt}>{alt}</span>
      </div>
    );
  }

  // The `?_r=N` query param forces the browser not to serve it from cache.
  const finalSrc = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}_r=${attempt}`;

  if (failed) {
    return (
      <div className={`${wrapperClass} bg-slate-800 text-slate-400 flex flex-col items-center justify-center gap-1 p-2`}>
        <CloudOff size={28} className="opacity-60" />
        <span className="text-[9px] text-center leading-tight opacity-70">{t('media.not_downloaded')}</span>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <img
        src={finalSrc}
        alt={alt}
        title={alt}
        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        loading="lazy"
        onError={() => {
          if (attempt < MAX_RETRIES) {
            setTimeout(() => setAttempt((n) => n + 1), RETRY_DELAY_MS * (attempt + 1));
          } else {
            setFailed(true);
          }
        }}
      />
    </div>
  );
});

// Visual metadata for the available roots. The effective list comes from the backend
// (/media/roots) and we only show the ones with `available=true`.
const ROOT_META = {
  images: { Icon: ImageIcon, labelKey: 'media.root_images', allLabelKey: 'media.all_images' },
  assets: { Icon: Folder, labelKey: 'media.root_assets', allLabelKey: 'media.all_assets' },
  library: { Icon: Library, labelKey: 'media.root_library', allLabelKey: 'media.all_library' },
  vault: { Icon: Database, labelKey: 'media.root_vault', allLabelKey: 'media.all_vault' },
};

// Centered modal to ask for a view's name. Replaces `window.prompt`
// (native to the browser, anchored top-left) to be consistent with the
// rest of the app's modals.
function ViewNamePromptModal({ open, defaultValue, onCancel, onConfirm }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue || '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue || '');
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [open, defaultValue]);

  if (!open) return null;

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onConfirm(v);
  };

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onCancel} />
      <div
        className="relative bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-[var(--gnosi-primary)]/10 rounded-lg text-[var(--gnosi-primary)]">
            <BookmarkPlus size={20} />
          </div>
          <h3 className="text-lg font-bold text-[var(--text-primary)]">{t('media.save_as_view')}</h3>
        </div>
        <label className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">{t('media.view_name_label')}</label>
        <input
          ref={inputRef}
          type="text"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('media.view_name_placeholder')}
          className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/30 mb-5"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-[var(--border-primary)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-all"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="px-4 py-2 rounded-lg bg-[var(--gnosi-primary)] text-white text-sm font-bold hover:bg-[var(--gnosi-primary)]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {t('media.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Reusable centered confirm. Replaces `window.confirm` (native, anchored
// at the top) so the app's dialogs are consistent.
function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = null,
  cancelLabel = null,
  danger = false,
  Icon = AlertCircle,
  onCancel,
  onConfirm,
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onCancel} />
      <div
        className="relative bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        tabIndex={-1}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className={`p-2 rounded-lg ${danger ? 'bg-red-500/10 text-red-500' : 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'}`}>
            <Icon size={20} />
          </div>
          <h3 className="text-lg font-bold text-[var(--text-primary)]">{title}</h3>
        </div>
        {message && (
          <p className="text-sm text-[var(--text-secondary)] mb-5">{message}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-[var(--border-primary)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-all"
          >
            {cancelLabel || t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`px-4 py-2 rounded-lg text-white text-sm font-bold transition-all ${
              danger
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/90'
            }`}
          >
            {confirmLabel || t('media.confirm_ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Type pills in the toolbar. The order defines the visual order.
const KIND_OPTIONS = [
  { key: 'image', labelKey: 'media.kind_image', Icon: ImageIcon },
  { key: 'video', labelKey: 'media.kind_video', Icon: Video },
  { key: 'audio', labelKey: 'media.kind_audio', Icon: Music },
  { key: 'pdf', labelKey: 'media.kind_pdf', Icon: FileText },
  { key: 'other', labelKey: 'media.kind_other', Icon: HardDrive },
];

// mtime range presets. `days=null` = custom (date input).
const DATE_PRESETS = [
  { key: 'all', labelKey: 'media.date_all', days: 0 },
  { key: '7d', labelKey: 'media.date_7d', days: 7 },
  { key: '30d', labelKey: 'media.date_30d', days: 30 },
  { key: '365d', labelKey: 'media.date_year', days: 365 },
  { key: 'custom', labelKey: 'media.date_custom', days: null },
];

const SIZE_PRESETS = [
  { key: 'all', labelKey: 'media.size_all', min: null, max: null },
  { key: 'small', label: '<500 KB', min: null, max: 500 },
  { key: 'medium', label: '500 KB – 5 MB', min: 500, max: 5120 },
  { key: 'large', label: '>5 MB', min: 5120, max: null },
];

const SORT_OPTIONS = [
  { key: 'mtime', labelKey: 'media.sort_mtime' },
  { key: 'filename', labelKey: 'media.sort_filename' },
  { key: 'size', labelKey: 'media.sort_size' },
  { key: 'kind', labelKey: 'media.sort_kind' },
];

const DEFAULT_FILTERS = Object.freeze({
  kinds: [],
  q: '',
  tagsAny: [],
  datePreset: 'all',
  mtimeFrom: '',
  mtimeTo: '',
  sizePreset: 'all',
});
const DEFAULT_SORT = Object.freeze({ field: 'mtime', dir: 'desc' });

const isoDaysAgo = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

// Filter + sort toolbar. F1: state only in memory in the parent component,
// not yet persisted as "views" (that's F3).
function MediaToolbar({
  filters,
  sort,
  onFiltersChange,
  onSortChange,
  onReset,
  hasActiveFilters,
  activeViewId,
  onSaveAsView,
  onUpdateView,
}) {
  const { t } = useTranslation();
  const [tagDraft, setTagDraft] = useState('');

  // Multi-select OR: clicking adds/removes a type from the selection. No pill
  // active = show everything. Active pills are shown in blue, so the
  // multiple selection is visually obvious.
  const toggleKind = (key) => {
    const set = new Set(filters.kinds);
    if (set.has(key)) set.delete(key); else set.add(key);
    onFiltersChange({ ...filters, kinds: Array.from(set) });
  };

  const setDatePreset = (key) => {
    if (key === 'all') {
      onFiltersChange({ ...filters, datePreset: key, mtimeFrom: '', mtimeTo: '' });
    } else if (key === 'custom') {
      onFiltersChange({ ...filters, datePreset: key });
    } else {
      const preset = DATE_PRESETS.find(p => p.key === key);
      onFiltersChange({
        ...filters,
        datePreset: key,
        mtimeFrom: isoDaysAgo(preset.days),
        mtimeTo: '',
      });
    }
  };

  const setSizePreset = (key) => {
    onFiltersChange({ ...filters, sizePreset: key });
  };

  const addTag = () => {
    const t = tagDraft.trim().toLowerCase();
    if (!t) return;
    if (filters.tagsAny.includes(t)) { setTagDraft(''); return; }
    onFiltersChange({ ...filters, tagsAny: [...filters.tagsAny, t] });
    setTagDraft('');
  };

  const removeTag = (t) => {
    onFiltersChange({ ...filters, tagsAny: filters.tagsAny.filter(x => x !== t) });
  };

  return (
    <div className="px-6 py-3 bg-[var(--bg-primary)] border-b border-[var(--border-primary)] flex flex-wrap items-center gap-3 text-xs">
      {/* Tipus */}
      <div className="flex items-center gap-1">
        {KIND_OPTIONS.map(({ key, labelKey, Icon }) => {
          const label = t(labelKey);
          const active = filters.kinds.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleKind(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${
                active
                  ? 'bg-[var(--gnosi-action-bg)] text-white border-[var(--gnosi-action-bg)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
              }`}
              title={label}
            >
              <Icon size={12} />
              <span className="font-medium">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="h-5 w-px bg-[var(--border-primary)] opacity-60" />

      {/* Data (mtime) */}
      <label className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
        <Calendar size={12} />
        <select
          value={filters.datePreset}
          onChange={(e) => setDatePreset(e.target.value)}
          aria-label={t('media.date_filter_label', 'Date filter')}
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
        >
          {DATE_PRESETS.map(p => <option key={p.key} value={p.key}>{t(p.labelKey)}</option>)}
        </select>
      </label>
      {filters.datePreset === 'custom' && (
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={filters.mtimeFrom}
            onChange={(e) => onFiltersChange({ ...filters, mtimeFrom: e.target.value })}
            className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
          />
          <span className="text-[var(--text-tertiary)]">–</span>
          <input
            type="date"
            value={filters.mtimeTo}
            onChange={(e) => onFiltersChange({ ...filters, mtimeTo: e.target.value })}
            className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
          />
        </div>
      )}

      <div className="h-5 w-px bg-[var(--border-primary)] opacity-60" />

      {/* Tags */}
      <div className="flex items-center gap-1.5">
        <Tag size={12} className="text-[var(--text-tertiary)]" />
        {filters.tagsAny.map(t => (
          <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] font-medium">
            {t}
            <button type="button" onClick={() => removeTag(t)} className="hover:text-red-500">
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          type="text"
          placeholder={t('media.tag_placeholder')}
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs w-28"
        />
      </div>

      <div className="h-5 w-px bg-[var(--border-primary)] opacity-60" />

      {/* Mida */}
      <label className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
        <HardDrive size={12} />
        <select
          value={filters.sizePreset}
          onChange={(e) => setSizePreset(e.target.value)}
          aria-label={t('media.size_filter_label', 'Size filter')}
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
        >
          {SIZE_PRESETS.map(p => <option key={p.key} value={p.key}>{p.labelKey ? t(p.labelKey) : p.label}</option>)}
        </select>
      </label>

      <div className="h-5 w-px bg-[var(--border-primary)] opacity-60" />

      {/* Sort */}
      <div className="flex items-center gap-1">
        <select
          value={sort.field}
          onChange={(e) => onSortChange({ ...sort, field: e.target.value })}
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
          title={t('media.sort_field_title')}
          aria-label={t('media.sort_field_title')}
        >
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{t(o.labelKey)}</option>)}
        </select>
        <button
          type="button"
          onClick={() => onSortChange({ ...sort, dir: sort.dir === 'desc' ? 'asc' : 'desc' })}
          className="p-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]"
          title={sort.dir === 'desc' ? t('media.sort_desc') : t('media.sort_asc')}
        >
          {sort.dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
        </button>
      </div>

      {/* Views + Reset */}
      {(hasActiveFilters || activeViewId) && (
        <div className="ml-auto flex items-center gap-2">
          {activeViewId ? (
            <button
              type="button"
              onClick={onUpdateView}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-all font-medium"
              title={t('media.update_view_title')}
            >
              <BookmarkCheck size={12} />
              <span>{t('media.update_view')}</span>
            </button>
          ) : hasActiveFilters ? (
            <button
              type="button"
              onClick={onSaveAsView}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-all font-medium"
              title={t('media.save_as_view_title')}
            >
              <BookmarkPlus size={12} />
              <span>{t('media.save_as_view')}</span>
            </button>
          ) : null}
          {(hasActiveFilters || activeViewId) && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all"
              title={t('media.clear_filters_title')}
            >
              <Eraser size={12} />
              <span>{t('media.clear_filters')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function MediaCenter() {
  const { t } = useTranslation();
  const isCompact = useMediaQuery('(max-width: 767px)');
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 767px)').matches);
  const [media, setMedia] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  // Default: null = "All photos". The "General" album is usually empty and made
  // the archive appear empty when opening it.
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [isUploading, setIsUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [editingMetadata, setEditingMetadata] = useState({ tags: [], description: '' });

  useEffect(() => {
    setSidebarOpen(!isCompact);
  }, [isCompact]);

  // Multi-root: the gallery can look at Images/ (default), Assets/, Library/
  // or the whole Vault. Available roots come from the backend.
  const [roots, setRoots] = useState([]);
  const [activeRoot, setActiveRoot] = useState('images');

  // Pagination state
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 50;

  // Filters and sorting. Can be saved as a "view" (sidecar in the vault)
  // and be reapplied from the sidebar.
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [sort, setSort] = useState({ ...DEFAULT_SORT });
  const [views, setViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);
  // When we apply a view we change `activeRoot`, and the useEffect listening to
  // `activeRoot` resets `activeAlbum=''`. This ref prevents that
  // reset overwrites the `activeAlbum` that the view requests.
  const applyingViewRef = useRef(false);
  const hasActiveFilters = (
    filters.kinds.length > 0
    || filters.q.trim() !== ''
    || filters.tagsAny.length > 0
    || filters.datePreset !== 'all'
    || filters.sizePreset !== 'all'
    || sort.field !== DEFAULT_SORT.field
    || sort.dir !== DEFAULT_SORT.dir
  );
  const resetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    setSort({ ...DEFAULT_SORT });
    setActiveViewId(null);
  }, []);

  const fetchAlbums = useCallback(async (root = activeRoot) => {
    try {
      setAlbums(await fetchMediaTree(root));
    } catch (err) {
      console.error('Error loading tree:', err);
    }
  }, [activeRoot]);

  const fetchMedia = useCallback(async (reset = false) => {
    // `activeAlbum === null` (undefined) → we load nothing. The user must
    // choose an album or explicitly request 'All photos' (empty string ''),
    // which triggers a recursive scan of the whole active root (slow the first
    // vegada a OneDrive).
    if (activeAlbum === null) {
      setMedia([]);
      setTotal(0);
      setHasMore(false);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const currentOffset = reset ? 0 : offset;
      const params = { limit: PAGE_SIZE, offset: currentOffset, root: activeRoot };
      if (activeAlbum) params.album = activeAlbum;

      // Filters (only the active ones are propagated to the backend)
      if (filters.kinds.length > 0) params.kinds = filters.kinds.join(',');
      if (filters.q.trim()) params.q = filters.q.trim();
      if (filters.tagsAny.length > 0) params.tags_any = filters.tagsAny.join(',');
      if (filters.mtimeFrom) params.mtime_from = filters.mtimeFrom;
      if (filters.mtimeTo) params.mtime_to = filters.mtimeTo;
      const sizePreset = SIZE_PRESETS.find(p => p.key === filters.sizePreset);
      if (sizePreset?.min != null) params.size_min = sizePreset.min;
      if (sizePreset?.max != null) params.size_max = sizePreset.max;

      // Sorting (only if it differs from the server-side default)
      if (sort.field !== 'mtime' || sort.dir !== 'desc') {
        params.sort = sort.field;
        params.dir = sort.dir;
      }

      // 'All photos' can take minutes the first time on OneDrive,
      // especially for root="vault" (scans the entire archive).
      const { items, total: totalCount } = await fetchMediaPage(
        params,
        undefined,
        600_000,
      );

      if (reset) {
        setMedia(items);
        setOffset(items.length);
      } else {
        setMedia(prev => [...prev, ...items]);
        setOffset(prev => prev + items.length);
      }

      setTotal(totalCount);
      setHasMore(items.length === PAGE_SIZE);
    } catch (err) {
      console.error('Error loading media:', err);
      toast.error(t('media.load_error'));
    } finally {
      setLoading(false);
    }
  }, [activeAlbum, activeRoot, offset, filters, sort, t]);

  // Loads the available roots once, on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rootsResponse = await fetchMediaRoots();
        if (cancelled) return;
        const all = rootsResponse.filter(r => r.available);
        setRoots(all);
      } catch (err) {
        console.error('Could not load the roots:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Reload the tree when the active root changes and select "Whole root"
  // automatically (`activeAlbum=''`). This way the filter toolbar appears
  // (which requires `activeAlbum !== null`) and the grid loads without
  // the user having to click anywhere. The first pass for a new root can
  // having to wait on OneDrive; afterwards the persistent cache makes it instant.
  // If we're applying a view, we don't reset `activeAlbum` (the later set
  // from `applyView` would overwrite it, but the render would be unstable).
  useEffect(() => {
    fetchAlbums(activeRoot);
    if (applyingViewRef.current) {
      applyingViewRef.current = false;
    } else {
      setActiveAlbum('');
    }
    setMedia([]);
    setOffset(0);
  }, [activeRoot, fetchAlbums]);

  // Initial load of saved views.
  const fetchViews = useCallback(async () => {
    try {
      const data = await fetchMediaViews();
      setViews(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading views:', err);
    }
  }, []);
  useEffect(() => { fetchViews(); }, [fetchViews]);

  const applyView = useCallback((view) => {
    if (!view) return;
    const targetRoot = view.scope?.root || 'images';
    const targetAlbum = view.scope?.album || '';
    const targetFilters = { ...DEFAULT_FILTERS, ...(view.filters || {}) };
    const targetSort = { ...DEFAULT_SORT, ...(view.sort || {}) };
    if (targetRoot !== activeRoot) {
      applyingViewRef.current = true;
    }
    setActiveViewId(view.id);
    setActiveRoot(targetRoot);
    setActiveAlbum(targetAlbum);
    setFilters(targetFilters);
    setSort(targetSort);
  }, [activeRoot]);

  // The centered modal replaces `window.prompt` (native, anchored to the top).
  const [viewPromptOpen, setViewPromptOpen] = useState(false);
  const handleSaveAsView = useCallback(() => {
    setViewPromptOpen(true);
  }, []);
  const submitNewView = useCallback(async (label) => {
    setViewPromptOpen(false);
    try {
      const data = await createMediaView({
        label,
        scope: { root: activeRoot, album: activeAlbum || '' },
        filters,
        sort,
      });
      setViews(prev => [...prev, data]);
      setActiveViewId(data.id);
      toast.success(t('media.view_saved'));
    } catch (err) {
      console.error('Error saving view:', err);
      toast.error(t('media.view_save_error'));
    }
  }, [activeRoot, activeAlbum, filters, sort, t]);

  const handleUpdateView = useCallback(async () => {
    if (!activeViewId) return;
    const current = views.find(v => v.id === activeViewId);
    try {
      const data = await updateMediaView(activeViewId, {
        label: current?.label || '',
        scope: { root: activeRoot, album: activeAlbum || '' },
        filters,
        sort,
      });
      setViews(prev => prev.map(v => v.id === activeViewId ? data : v));
      toast.success(t('media.view_updated'));
    } catch (err) {
      console.error('Error updating view:', err);
      toast.error(t('media.view_update_error'));
    }
  }, [activeViewId, activeRoot, activeAlbum, filters, sort, views, t]);

  // Generic confirm dialog: if it's not `null`, we render the centered modal.
  const [confirmDialog, setConfirmDialog] = useState(null);

  const handleDeleteView = useCallback((id) => {
    const view = views.find(v => v.id === id);
    setConfirmDialog({
      title: t('media.delete_view_title'),
      message: view ? t('media.delete_view_msg', { label: view.label }) : t('media.delete_view_msg_generic'),
      confirmLabel: t('media.confirm_delete'),
      danger: true,
      Icon: Trash2,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await deleteMediaView(id);
          setViews(prev => prev.filter(v => v.id !== id));
          if (activeViewId === id) setActiveViewId(null);
        } catch (err) {
          console.error('Error deleting view:', err);
          toast.error(t('media.view_delete_error'));
        }
      },
    });
  }, [activeViewId, views, t]);

  // Reset when changing album, root, filters, or sorting. All of them trigger a
  // new request with offset=0 because the reported `total` depends on the filters.
  useEffect(() => {
    fetchMedia(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAlbum, activeRoot, filters, sort]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      setIsUploading(true);
      toast.loading(t('media.uploading'), { id: 'upload' });
      // For the "images" root we keep the old flow (gallery with albums).
      // For the rest, defer to /assets/upload (there's no notion of album).
      if (activeRoot === 'images') {
        const album = activeAlbum || 'General';
        await uploadMediaFile(file, album);
      } else {
        await uploadVaultAsset(file);
      }
      // Fetch has no implicit client timeout: large video/image uploads remain
      // unbounded, preserving the historical `timeout: 0` behavior (#812).
      toast.success(t('media.upload_success'), { id: 'upload' });
      fetchMedia(true);
    } catch (err) {
      console.error('Error uploading file:', err);
      toast.error(t('media.upload_error'), { id: 'upload' });
    } finally {
      setIsUploading(false);
    }
  };

  const handlePhotoClick = (item) => {
    setSelectedPhoto(item);
    setEditingMetadata({ 
      tags: item.tags || [], 
      description: item.description || '' 
    });
  };

  // Auto-save: no "Save" button. Every change to tags/description triggers
  // a debounced PATCH (600 ms). We show "Saving…/Saved" at the bottom of the panel.
  // - `initialMetaRef`: snapshot per (photo) to avoid saves on open.
  // - `saveAbortRef`: cancels in-flight requests if a new edit comes in.
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const initialMetaRef = useRef({ id: null, tags: [], description: '' });
  const saveTimerRef = useRef(null);
  const saveAbortRef = useRef(null);

  const flushSave = useCallback(async (photo, meta) => {
    if (saveAbortRef.current) {
      try { saveAbortRef.current.abort(); } catch { /* noop */ }
    }
    const ctrl = new AbortController();
    saveAbortRef.current = ctrl;
    setSaveStatus('saving');
    try {
      await updateMediaMetadata({
        root: photo.root || activeRoot,
        path_in_root: photo.path_in_root,
        filename: photo.filename,
        album: photo.album,
        metadata: meta,
      }, ctrl.signal);
      // We sync the snapshot so the next diff starts from the saved value.
      initialMetaRef.current = {
        id: photo.id,
        tags: [...(meta.tags || [])],
        description: meta.description || '',
      };
      setSaveStatus('saved');
      setMedia(prev => prev.map(m => m.id === photo.id
        ? { ...m, tags: meta.tags, description: meta.description }
        : m
      ));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Error saving metadata:', err);
      setSaveStatus('error');
    }
  }, [activeRoot]);

  // When we open a photo, we record its initial snapshot. No save here.
  useEffect(() => {
    if (selectedPhoto) {
      initialMetaRef.current = {
        id: selectedPhoto.id,
        tags: [...(selectedPhoto.tags || [])],
        description: selectedPhoto.description || '',
      };
      setSaveStatus('idle');
    }
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (saveAbortRef.current) { try { saveAbortRef.current.abort(); } catch { /* noop */ } saveAbortRef.current = null; }
  }, [selectedPhoto?.id]);

  // Debounced auto-save when editingMetadata differs from the initial snapshot.
  useEffect(() => {
    if (!selectedPhoto) return;
    const initial = initialMetaRef.current;
    if (initial.id !== selectedPhoto.id) return; // snapshot doesn't match yet

    const sameTags = initial.tags.length === editingMetadata.tags.length
      && initial.tags.every((t, i) => t === editingMetadata.tags[i]);
    const sameDesc = (initial.description || '') === (editingMetadata.description || '');
    if (sameTags && sameDesc) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const photoSnap = selectedPhoto;
    const metaSnap = { tags: [...editingMetadata.tags], description: editingMetadata.description };
    saveTimerRef.current = setTimeout(() => flushSave(photoSnap, metaSnap), 600);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [editingMetadata, selectedPhoto, flushSave]);

  const filteredMedia = media.filter(item =>
    item.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ----- Visor (lightbox) -----
  // State: the viewer is open when `selectedPhoto != null`. The navigation
  // prev/next is derived from the index within `filteredMedia`.
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewerRootRef = useRef(null);
  const SLIDESHOW_INTERVAL_MS = 4000;

  const currentIndex = selectedPhoto
    ? filteredMedia.findIndex((m) => m.id === selectedPhoto.id)
    : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < filteredMedia.length - 1;

  const goPrev = useCallback(() => {
    if (currentIndex <= 0) return;
    handlePhotoClick(filteredMedia[currentIndex - 1]);
  }, [currentIndex, filteredMedia]);

  const goNext = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= filteredMedia.length - 1) return;
    handlePhotoClick(filteredMedia[currentIndex + 1]);
  }, [currentIndex, filteredMedia]);

  const closeViewer = useCallback(() => {
    setSelectedPhoto(null);
    setSlideshowActive(false);
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = viewerRootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  // Syncs `isFullscreen` with the browser's actual state (the user can
  // exit with native Esc, not just with the button).
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Global keyboard shortcut while the viewer is open. We ignore it if the user
  // is typing in an input/textarea (tags, description, etc).
  useEffect(() => {
    if (!selectedPhoto) return;
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeViewer();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === ' ') {
        e.preventDefault();
        setSlideshowActive((s) => !s);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedPhoto, goPrev, goNext, toggleFullscreen, closeViewer]);

  // Slideshow: every SLIDESHOW_INTERVAL_MS it moves to the next one. It stops when
  // it reaches the end or when the user disables it. It restarts when
  // the current item changes so that each item gets a fresh timer.
  useEffect(() => {
    if (!slideshowActive || !selectedPhoto) return;
    const t = setTimeout(() => {
      if (hasNext) goNext();
      else setSlideshowActive(false);
    }, SLIDESHOW_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [slideshowActive, selectedPhoto, hasNext, goNext]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)]">
      <AppHeader
        icon={ImageIcon}
        title={t('media.title')}
        subtitle={`${t('media.subtitle')} · ${ROOT_META[activeRoot]?.labelKey ? t(ROOT_META[activeRoot].labelKey) : activeRoot}`}
      >
        <button
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
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
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-52 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-2 pl-10 pr-4 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 sm:w-64"
            />
          </div>

          <div className="flex bg-[var(--bg-secondary)] p-1 rounded-lg border border-[var(--border-primary)]">
            <button 
              type="button"
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-[var(--bg-primary)] shadow-sm text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`}
              aria-label={t('media.grid_view', 'Grid view')}
              aria-pressed={viewMode === 'grid'}
            >
              <Grid size={18} />
            </button>
            <button 
              type="button"
              onClick={() => setViewMode('list')}
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
              <input type="file" className="hidden" onChange={handleUpload} disabled={isUploading} />
            </label>
          )}
        </div>
      </AppHeader>

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
          onUpdateView={handleUpdateView}
        />
      )}

      <div className="relative flex flex-1 overflow-hidden">
        {isCompact && sidebarOpen && (
          <button
            type="button"
            className="media-library__backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-label={t('common.close', 'Close')}
          />
        )}
        {/* Sidebar Albums */}
        <aside className={`media-library__sidebar ${sidebarOpen ? 'is-open' : ''}`}>
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
                      onClick={() => setActiveRoot(r.key)}
                      title={metaLabel}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        active
                          ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)] shadow-sm'
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
                        onClick={() => applyView(v)}
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
            onClick={() => setActiveAlbum('')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeAlbum === '' ? 'bg-[var(--gnosi-primary)]/10 text-blue-700 dark:text-blue-300 shadow-sm' : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'}`}
            title={t('media.all_root_title')}
          >
            <ImageIcon size={18} />
            <span className="text-sm font-medium">{ROOT_META[activeRoot]?.allLabelKey ? t(ROOT_META[activeRoot].allLabelKey) : t('media.all_of_root', { root: activeRoot })}</span>
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
        </aside>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {activeAlbum === null ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] bg-[var(--bg-primary)]/30 rounded-2xl border-2 border-dashed border-[var(--border-primary)]">
              <Folder size={64} className="mb-4 opacity-20" />
              <p className="text-sm font-medium">{t('media.select_view_or_album')}</p>
            </div>
          ) : loading && media.length === 0 ? (
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
              <p className="text-lg font-medium">{t('media.no_files')}</p>
              <p className="text-sm">
                {hasActiveFilters
                  ? t('media.try_other_filter')
                  : t('media.folder_empty')}
              </p>
            </div>
          ) : (
            <>
              <div className={
                viewMode === 'grid' 
                  ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6"
                  : "flex flex-col gap-3"
              }>
                {filteredMedia.map((item, index) => (
                  <motion.div
                    key={`${item.id}-${index}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02, duration: 0.3 }}
                    onClick={() => handlePhotoClick(item)}
                    className={`group cursor-pointer bg-[var(--bg-primary)] rounded-2xl overflow-hidden border border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50 hover:shadow-xl transition-all duration-300 ${
                      viewMode === 'list' ? 'flex items-center gap-4 p-3' : ''
                    }`}
                  >
                    <Thumb
                      src={normalizeUrl(item.url)}
                      alt={item.filename}
                      viewMode={viewMode}
                      kind={item.kind}
                    />
                  </motion.div>
                ))}
              </div>

              {hasMore && (
                <div className="flex justify-center mt-8">
                  <button
                    type="button"
                    onClick={() => fetchMedia(false)}
                    disabled={loading}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-all disabled:opacity-50 disabled:cursor-wait"
                  >
                    {loading
                      ? <Loader2 size={16} className="animate-spin" />
                      : <ChevronDown size={16} />}
                    {loading ? t('media.loading') : t('media.load_more')}
                  </button>
                </div>
              )}
              {total > 0 && (
                <p className="text-center text-xs text-[var(--text-tertiary)] mt-4">
                  {t('media.count_of', { count: media.length, total })}
                </p>
              )}
            </>
          )}
        </div>

      </div>

      {/* Viewer (lightbox) — near full-screen view with a metadata panel
          on the right, prev/next navigation, slideshow, and fullscreen. The panel
          collapses in fullscreen or slideshow mode to maximize
          the media's screen space. */}
      <AnimatePresence>
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
                  onClick={() => setSlideshowActive(s => !s)}
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
              {!isFullscreen && !slideshowActive && (
                <aside className="w-80 bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col h-full border-l border-white/10 shrink-0">
                  <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2.5 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)]">
                        <p className="text-[9px] text-[var(--text-tertiary)] uppercase font-bold mb-1">{t('media.date_taken')}</p>
                        <p className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                          <Calendar size={12} className="text-blue-500" />
                          {selectedPhoto.date_taken ? new Date(selectedPhoto.date_taken).toLocaleDateString() : 'N/A'}
                        </p>
                      </div>
                      <div className="p-2.5 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)]">
                        <p className="text-[9px] text-[var(--text-tertiary)] uppercase font-bold mb-1">{t('media.album')}</p>
                        <p className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                          <FolderOpen size={12} className="text-orange-500" />
                          <span className="truncate">{selectedPhoto.album}</span>
                        </p>
                      </div>
                    </div>

                    {selectedPhoto.lat != null && selectedPhoto.lng != null && (
                      <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                        <p className="text-[9px] text-emerald-600 uppercase font-bold mb-1.5">{t('media.location')}</p>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <MapPin size={14} className="text-emerald-500 shrink-0" />
                            <span className="text-[11px] text-[var(--text-secondary)] truncate">{selectedPhoto.lat.toFixed(4)}, {selectedPhoto.lng.toFixed(4)}</span>
                          </div>
                          <a
                            href={`https://www.google.com/maps?q=${selectedPhoto.lat},${selectedPhoto.lng}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2 py-1 bg-white border border-emerald-200 text-emerald-600 rounded text-[10px] font-bold flex items-center gap-1 hover:bg-emerald-50 shrink-0"
                          >
                            <ExternalLink size={10} /> Maps
                          </a>
                        </div>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <label className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase block mb-2 px-1">{t('media.tags')}</label>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {editingMetadata.tags.map(tag => (
                            <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] text-[10px] font-bold rounded-full">
                              {tag}
                              <button onClick={() => setEditingMetadata({...editingMetadata, tags: editingMetadata.tags.filter(t => t !== tag)})}>
                                <X size={10} className="hover:text-red-500" />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="relative">
                          <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={12} />
                          <input
                            type="text"
                            placeholder={t('media.add_tag_placeholder')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && e.target.value) {
                                if (!editingMetadata.tags.includes(e.target.value)) {
                                  setEditingMetadata({...editingMetadata, tags: [...editingMetadata.tags, e.target.value]});
                                }
                                e.target.value = '';
                              }
                            }}
                            className="w-full pl-8 pr-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-xs focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase block mb-2 px-1">{t('media.description')}</label>
                        <textarea
                          value={editingMetadata.description}
                          onChange={(e) => setEditingMetadata({...editingMetadata, description: e.target.value})}
                          placeholder={t('media.description_placeholder')}
                          className="w-full p-3 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-xs min-h-[100px] focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none resize-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)] flex items-center gap-3">
                    <button
                      className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[var(--border-primary)] text-[var(--text-primary)] rounded-lg text-[11px] font-bold hover:bg-[var(--bg-primary)] transition-all shadow-sm"
                      onClick={() => toast.success(t('media.create_note_soon'))}
                    >
                      <FileText size={14} className="text-purple-500" />
                      {t('media.create_note')}
                    </button>
                    <div className="flex-1 text-right text-[10px] font-medium" aria-live="polite">
                      {saveStatus === 'saving' && (
                        <span className="text-[var(--text-tertiary)] inline-flex items-center gap-1.5">
                          <Loader2 size={12} className="animate-spin" /> {t('media.saving')}
                        </span>
                      )}
                      {saveStatus === 'saved' && (
                        <span className="text-emerald-600 inline-flex items-center gap-1.5">
                          <Check size={12} /> {t('media.saved')}
                        </span>
                      )}
                      {saveStatus === 'error' && (
                        <span className="text-red-500 inline-flex items-center gap-1.5">
                          <AlertCircle size={12} /> {t('media.save_error')}
                        </span>
                      )}
                      {saveStatus === 'idle' && (
                        <span className="text-[var(--text-tertiary)]">{t('media.autosave')}</span>
                      )}
                    </div>
                  </div>
                </aside>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ViewNamePromptModal
        open={viewPromptOpen}
        onCancel={() => setViewPromptOpen(false)}
        onConfirm={submitNewView}
      />

      <ConfirmDialog
        open={confirmDialog != null}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        cancelLabel={confirmDialog?.cancelLabel}
        danger={confirmDialog?.danger}
        Icon={confirmDialog?.Icon}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => confirmDialog?.onConfirm?.()}
      />
    </div>
  );
}
