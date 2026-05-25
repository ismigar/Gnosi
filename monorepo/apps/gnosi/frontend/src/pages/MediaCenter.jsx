import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
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
  Pause
} from 'lucide-react';
import { toast } from '../lib/toast';
import { motion, AnimatePresence } from 'framer-motion';

const PERSPECTIVES = [ // Mantenim per referència o inbox, però prioritzem àlbums
  { id: 'General', label: 'General', icon: FolderOpen, color: 'text-blue-500' },
  { id: 'Inbox', label: 'Inbox', icon: FolderOpen, color: 'text-orange-500' }
];

const normalizeUrl = (url) => {
  if (!url) return '';
  // Si és una URL absoluta del backend (p.e. http://backend:5002/api/...), la fem relativa
  const match = url.match(/^https?:\/\/[^/]+(\/api\/.*)$/i);
  if (match?.[1]) return match[1];
  return url;
};

// TreeNode és recursiu i lazy: només demana les subcarpetes quan l'usuari
// expandeix el node. Sense això, indexar els ~33k directoris de l'arxiu
// faria inviable el muntatge de la sidebar.
const TreeNode = React.memo(function TreeNode({ node, depth, activeAlbum, onSelect, root = 'images' }) {
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
        const res = await axios.get('/api/vault/media/tree', {
          params: { path: node.path, root },
          timeout: 30000,
        });
        setChildren(res.data || []);
      } catch (err) {
        console.error('Error carregant subcarpetes:', err);
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
          aria-label={expanded ? 'Collapse' : 'Expand'}
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

// Placeholders visuals per a fitxers que `<img>` no pot renderitzar
// (vídeo, pdf, àudio, altres). Sense això surten com a quadres negres
// mentre `<img>` falla en bucle.
const NON_IMAGE_THUMB = {
  video: { Icon: Video, label: 'Vídeo', accent: 'text-rose-400' },
  pdf:   { Icon: FileText, label: 'PDF', accent: 'text-orange-400' },
  audio: { Icon: Music, label: 'Àudio', accent: 'text-cyan-400' },
  other: { Icon: HardDrive, label: 'Fitxer', accent: 'text-slate-400' },
};

// Thumb gestiona el seu estat de càrrega/error per imatge. Si OneDrive està
// materialitzant un fitxer en background, el primer GET pot retornar 503;
// reintentem un parell de cops abans d'ensenyar el placeholder cloud-off.
const Thumb = React.memo(function Thumb({ src, alt, viewMode, kind }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 4000;

  const wrapperClass = viewMode === 'grid'
    ? 'aspect-square relative overflow-hidden bg-gray-900'
    : 'w-24 h-24 relative rounded-xl overflow-hidden flex-shrink-0 bg-gray-900';

  // Vídeo / PDF / àudio / altres: mai van a `<img>` — placeholder amb icona
  // del tipus i nom del fitxer.
  if (kind && kind !== 'image') {
    const meta = NON_IMAGE_THUMB[kind] || NON_IMAGE_THUMB.other;
    const Icon = meta.Icon;
    return (
      <div className={`${wrapperClass} bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center gap-1.5 p-2`}>
        <Icon size={viewMode === 'grid' ? 36 : 24} className={`${meta.accent} opacity-90`} />
        <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">{meta.label}</span>
        <span className="text-[9px] text-slate-500 truncate w-full text-center" title={alt}>{alt}</span>
      </div>
    );
  }

  // El query param `?_r=N` força el navegador a no servir-ho del cache.
  const finalSrc = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}_r=${attempt}`;

  if (failed) {
    return (
      <div className={`${wrapperClass} bg-slate-800 text-slate-400 flex flex-col items-center justify-center gap-1 p-2`}>
        <CloudOff size={28} className="opacity-60" />
        <span className="text-[9px] text-center leading-tight opacity-70">No descarregat</span>
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

// Metadades visuals dels roots disponibles. La llista efectiva ve del backend
// (/media/roots) i només mostrem els que tenen `available=true`.
const ROOT_META = {
  images: { Icon: ImageIcon, label: 'Imatges', allLabel: 'Totes les imatges' },
  assets: { Icon: Folder, label: 'Assets', allLabel: 'Tots els assets' },
  biblioteca: { Icon: Library, label: 'Biblioteca', allLabel: 'Tota la biblioteca' },
  vault: { Icon: Database, label: 'Tot el Vault', allLabel: 'Tot el Vault' },
};

// Modal centrat per demanar el nom d'una vista. Substitueix `window.prompt`
// (nadiu del navegador, ancorat a dalt-esquerra) per ser consistent amb la
// resta de modals de l'app.
function ViewNamePromptModal({ open, defaultValue, onCancel, onConfirm }) {
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
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
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
          <h3 className="text-lg font-bold text-[var(--text-primary)]">Desa com a vista</h3>
        </div>
        <label className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Nom de la vista</label>
        <input
          ref={inputRef}
          type="text"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ex: Vídeos del 2026"
          className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/30 mb-5"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-[var(--border-primary)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-all"
          >
            Cancel·la
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="px-4 py-2 rounded-lg bg-[var(--gnosi-primary)] text-white text-sm font-bold hover:bg-[var(--gnosi-primary)]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Desa
          </button>
        </div>
      </div>
    </div>
  );
}

// Confirm centrat reutilitzable. Substitueix `window.confirm` (nadiu, ancorat
// a dalt) perquè els dialogs de l'app siguin consistents.
function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'D\'acord',
  cancelLabel = 'Cancel·la',
  danger = false,
  Icon = AlertCircle,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
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
            {cancelLabel}
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
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Pills de tipus al toolbar. L'ordre defineix l'ordre visual.
const KIND_OPTIONS = [
  { key: 'image', label: 'Imatges', Icon: ImageIcon },
  { key: 'video', label: 'Vídeos', Icon: Video },
  { key: 'audio', label: 'Àudio', Icon: Music },
  { key: 'pdf', label: 'PDFs', Icon: FileText },
  { key: 'other', label: 'Altres', Icon: HardDrive },
];

// Presets de rang de mtime. `days=null` = personalitzat (input de dates).
const DATE_PRESETS = [
  { key: 'all', label: 'Sempre', days: 0 },
  { key: '7d', label: '7 dies', days: 7 },
  { key: '30d', label: '30 dies', days: 30 },
  { key: '365d', label: 'Aquest any', days: 365 },
  { key: 'custom', label: 'Personalitzat', days: null },
];

const SIZE_PRESETS = [
  { key: 'all', label: 'Tot', min: null, max: null },
  { key: 'small', label: '<500 KB', min: null, max: 500 },
  { key: 'medium', label: '500 KB – 5 MB', min: 500, max: 5120 },
  { key: 'large', label: '>5 MB', min: 5120, max: null },
];

const SORT_OPTIONS = [
  { key: 'mtime', label: 'Modificació' },
  { key: 'filename', label: 'Nom' },
  { key: 'size', label: 'Mida' },
  { key: 'kind', label: 'Tipus' },
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

// Toolbar de filtres + sort. F1: estat només en memòria del component pare,
// no es persisteixen com a "vistes" encara (això és F3).
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
  const [tagDraft, setTagDraft] = useState('');

  // Multi-select OR: clicar afegeix/treu un tipus de la selecció. Cap pill
  // activa = mostrar tot. Les pills actives es veuen blaves, així que la
  // selecció múltiple és visualment òbvia.
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
        {KIND_OPTIONS.map(({ key, label, Icon }) => {
          const active = filters.kinds.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleKind(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${
                active
                  ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)]'
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
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
        >
          {DATE_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
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
          placeholder="Tag + Enter"
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
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
        >
          {SIZE_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>

      <div className="h-5 w-px bg-[var(--border-primary)] opacity-60" />

      {/* Sort */}
      <div className="flex items-center gap-1">
        <select
          value={sort.field}
          onChange={(e) => onSortChange({ ...sort, field: e.target.value })}
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-xs"
          title="Camp d'ordenació"
        >
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <button
          type="button"
          onClick={() => onSortChange({ ...sort, dir: sort.dir === 'desc' ? 'asc' : 'desc' })}
          className="p-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]"
          title={sort.dir === 'desc' ? 'Descendent' : 'Ascendent'}
        >
          {sort.dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
        </button>
      </div>

      {/* Vistes + Reset */}
      {(hasActiveFilters || activeViewId) && (
        <div className="ml-auto flex items-center gap-2">
          {activeViewId ? (
            <button
              type="button"
              onClick={onUpdateView}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-all font-medium"
              title="Sobreescriu la vista activa amb els filtres actuals"
            >
              <BookmarkCheck size={12} />
              <span>Actualitzar vista</span>
            </button>
          ) : hasActiveFilters ? (
            <button
              type="button"
              onClick={onSaveAsView}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-all font-medium"
              title="Desa els filtres actuals com a vista"
            >
              <BookmarkPlus size={12} />
              <span>Desa com a vista</span>
            </button>
          ) : null}
          {(hasActiveFilters || activeViewId) && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all"
              title="Netejar filtres, ordenació i vista activa"
            >
              <Eraser size={12} />
              <span>Netejar</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function MediaCenter() {
  const [media, setMedia] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  // Defecte: null = "Totes les fotos". L'àlbum "General" sol estar buit i feia
  // que l'arxiu aparegués buit en obrir-lo.
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [isUploading, setIsUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [editingMetadata, setEditingMetadata] = useState({ tags: [], description: '' });

  // Multi-root: la galeria pot mirar Images/ (default), Assets/, Biblioteca/
  // o tot el Vault. Els roots disponibles vénen del backend.
  const [roots, setRoots] = useState([]);
  const [activeRoot, setActiveRoot] = useState('images');

  // Estats de paginació
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 50;

  // Filtres i ordenació. Es poden desar com a "vista" (sidecar al vault)
  // i tornar-se a aplicar des de la sidebar.
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [sort, setSort] = useState({ ...DEFAULT_SORT });
  const [views, setViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);
  // Quan apliquem una vista canviem `activeRoot` i el useEffect que escolta
  // `activeRoot` reseteja `activeAlbum=''`. Aquesta ref evita que aquest
  // reset sobreescrigui l'`activeAlbum` que la vista demana.
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
      const res = await axios.get('/api/vault/media/tree', {
        params: { root },
        timeout: 30000,
      });
      setAlbums(res.data || []);
    } catch (err) {
      console.error('Error carregant arbre:', err);
    }
  }, [activeRoot]);

  const fetchMedia = useCallback(async (reset = false) => {
    // `activeAlbum === null` (undefined) → no carreguem res. Cal que l'usuari
    // triï un àlbum o demani explícitament 'Totes les fotos' (string buida ''),
    // que dispara un escaneig recursiu de tot el root actiu (lent la primera
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

      // Filtres (només els actius es propaguen al backend)
      if (filters.kinds.length > 0) params.kinds = filters.kinds.join(',');
      if (filters.q.trim()) params.q = filters.q.trim();
      if (filters.tagsAny.length > 0) params.tags_any = filters.tagsAny.join(',');
      if (filters.mtimeFrom) params.mtime_from = filters.mtimeFrom;
      if (filters.mtimeTo) params.mtime_to = filters.mtimeTo;
      const sizePreset = SIZE_PRESETS.find(p => p.key === filters.sizePreset);
      if (sizePreset?.min != null) params.size_min = sizePreset.min;
      if (sizePreset?.max != null) params.size_max = sizePreset.max;

      // Ordenació (només si difereix del defecte server-side)
      if (sort.field !== 'mtime' || sort.dir !== 'desc') {
        params.sort = sort.field;
        params.dir = sort.dir;
      }

      // 'Totes les fotos' pot trigar minuts la primera vegada a OneDrive,
      // sobretot per al root="vault" (escaneja tot l'arxiu).
      const res = await axios.get('/api/vault/media', { params, timeout: 600000 });
      const { items, total: totalCount } = res.data;

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
      console.error('Error carregant mitjans:', err);
      toast.error('No s\'han pogut carregar les fotos');
    } finally {
      setLoading(false);
    }
  }, [activeAlbum, activeRoot, offset, filters, sort]);

  // Carrega els roots disponibles un cop, al muntatge.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get('/api/vault/media/roots', { timeout: 15000 });
        if (cancelled) return;
        const all = (res.data || []).filter(r => r.available);
        setRoots(all);
      } catch (err) {
        console.error('No s\'han pogut carregar els roots:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Recarrega l'arbre quan canvia el root actiu i selecciona "Tot el root"
  // automàticament (`activeAlbum=''`). Així apareix el toolbar de filtres
  // (que requereix `activeAlbum !== null`) i el grid es carrega sense que
  // l'usuari hagi de clicar enlloc. La primera passada per root nou pot
  // trigar a OneDrive; després el cache persistent la fa instantània.
  // Si estem aplicant una vista, no resetegem `activeAlbum` (el set posterior
  // de `applyView` el sobreescriuria però el render seria inestable).
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

  // Carga inicial de vistes desades.
  const fetchViews = useCallback(async () => {
    try {
      const r = await axios.get('/api/vault/media/views', { timeout: 15000 });
      setViews(Array.isArray(r.data) ? r.data : []);
    } catch (err) {
      console.error('Error carregant vistes:', err);
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

  // El modal centrat substitueix `window.prompt` (nadiu, ancorat a dalt).
  const [viewPromptOpen, setViewPromptOpen] = useState(false);
  const handleSaveAsView = useCallback(() => {
    setViewPromptOpen(true);
  }, []);
  const submitNewView = useCallback(async (label) => {
    setViewPromptOpen(false);
    try {
      const r = await axios.post('/api/vault/media/views', {
        label,
        scope: { root: activeRoot, album: activeAlbum || '' },
        filters,
        sort,
      });
      setViews(prev => [...prev, r.data]);
      setActiveViewId(r.data.id);
      toast.success('Vista desada');
    } catch (err) {
      console.error('Error desant vista:', err);
      toast.error('No s\'ha pogut desar la vista');
    }
  }, [activeRoot, activeAlbum, filters, sort]);

  const handleUpdateView = useCallback(async () => {
    if (!activeViewId) return;
    const current = views.find(v => v.id === activeViewId);
    try {
      const r = await axios.patch(`/api/vault/media/views/${activeViewId}`, {
        label: current?.label || '',
        scope: { root: activeRoot, album: activeAlbum || '' },
        filters,
        sort,
      });
      setViews(prev => prev.map(v => v.id === activeViewId ? r.data : v));
      toast.success('Vista actualitzada');
    } catch (err) {
      console.error('Error actualitzant vista:', err);
      toast.error('No s\'ha pogut actualitzar la vista');
    }
  }, [activeViewId, activeRoot, activeAlbum, filters, sort, views]);

  // Confirm dialog genèric: si no és `null`, renderitzem el modal centrat.
  const [confirmDialog, setConfirmDialog] = useState(null);

  const handleDeleteView = useCallback((id) => {
    const view = views.find(v => v.id === id);
    setConfirmDialog({
      title: 'Esborrar vista',
      message: view ? `«${view.label}» s'eliminarà del sidecar. Aquesta acció no es pot desfer.` : 'Aquesta acció no es pot desfer.',
      confirmLabel: 'Esborra',
      danger: true,
      Icon: Trash2,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await axios.delete(`/api/vault/media/views/${id}`);
          setViews(prev => prev.filter(v => v.id !== id));
          if (activeViewId === id) setActiveViewId(null);
        } catch (err) {
          console.error('Error esborrant vista:', err);
          toast.error('No s\'ha pogut esborrar la vista');
        }
      },
    });
  }, [activeViewId, views]);

  // Reset al canviar d'àlbum, root, filtres o ordenació. Tots disparen una
  // nova petició amb offset=0 perquè el `total` reportat depèn dels filtres.
  useEffect(() => {
    fetchMedia(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAlbum, activeRoot, filters, sort]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      setIsUploading(true);
      toast.loading('Pujant fitxer...', { id: 'upload' });
      // Per al root "images" mantenim el flux antic (galeria amb àlbums).
      // Per a la resta, derivar a /assets/upload (no hi ha noció d'àlbum).
      let url;
      if (activeRoot === 'images') {
        const album = activeAlbum || 'General';
        url = `/api/vault/media/upload?album=${encodeURIComponent(album)}`;
      } else {
        url = '/api/vault/assets/upload';
      }
      await axios.post(url, formData);
      toast.success('Fitxer pujat correctament', { id: 'upload' });
      fetchMedia(true);
    } catch (err) {
      console.error('Error pujant fitxer:', err);
      toast.error('Error en la càrrega', { id: 'upload' });
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

  // Auto-save: cap botó "Desar". Cada modificació de tags/descripció dispara
  // un PATCH debounced (600 ms). Mostrem "Desant…/Desat" al peu del panell.
  // - `initialMetaRef`: snapshot per (foto) per evitar saves a l'obrir.
  // - `saveAbortRef`: cancel·la peticions en curs si arriba una nova edició.
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
      await axios.patch('/api/vault/media/metadata', {
        root: photo.root || activeRoot,
        path_in_root: photo.path_in_root,
        filename: photo.filename,
        album: photo.album,
        metadata: meta,
      }, { signal: ctrl.signal });
      // Sincronitzem l'snapshot perquè el següent diff parteixi del valor desat.
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
      if (axios.isCancel(err) || err?.name === 'CanceledError') return;
      console.error('Error desant metadades:', err);
      setSaveStatus('error');
    }
  }, [activeRoot]);

  // Quan obrim una foto, registrem el seu snapshot inicial. Cap save aquí.
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

  // Auto-save debounced quan editingMetadata difereix de l'snapshot inicial.
  useEffect(() => {
    if (!selectedPhoto) return;
    const initial = initialMetaRef.current;
    if (initial.id !== selectedPhoto.id) return; // snapshot encara no quadra

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
  // Estat: el visor està obert quan `selectedPhoto != null`. La navegació
  // prev/next es deriva de l'índex dins `filteredMedia`.
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

  // Sincronitza `isFullscreen` amb l'estat real del browser (l'usuari pot
  // sortir amb Esc nadiu, no només amb el botó).
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Atall de teclat global mentre el visor està obert. Ignorem si l'usuari
  // està escrivint a un input/textarea (tags, descripció, etc).
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

  // Slideshow: cada SLIDESHOW_INTERVAL_MS va a la següent. S'atura quan
  // arriba al final o quan l'usuari el desactiva. Es reinicia quan canvia
  // l'item actual perquè cada item té un timer fresc.
  useEffect(() => {
    if (!slideshowActive || !selectedPhoto) return;
    const t = setTimeout(() => {
      if (hasNext) goNext();
      else setSlideshowActive(false);
    }, SLIDESHOW_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [slideshowActive, selectedPhoto, hasNext, goNext]);

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-secondary)] overflow-hidden">
      {/* Header */}
      <header className="p-6 bg-[var(--bg-primary)] border-b border-[var(--border-primary)] flex justify-between items-center z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[var(--gnosi-primary)]/10 rounded-lg text-[var(--gnosi-primary)]">
            <ImageIcon size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Gestor de Mitjans</h1>
            <p className="text-xs text-[var(--text-tertiary)]">
              Imatges, vídeos, àudio i PDFs · {ROOT_META[activeRoot]?.label || activeRoot}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] group-focus-within:text-[var(--gnosi-primary)] transition-colors" size={16} />
            <input 
              type="text" 
              placeholder="Cerca en l'arxiu..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 w-64 transition-all"
            />
          </div>

          <div className="flex bg-[var(--bg-secondary)] p-1 rounded-lg border border-[var(--border-primary)]">
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-[var(--bg-primary)] shadow-sm text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`}
            >
              <Grid size={18} />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-[var(--bg-primary)] shadow-sm text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`}
            >
              <ListIcon size={18} />
            </button>
          </div>

          {(activeRoot === 'images' || activeRoot === 'assets') && (
            <label className="flex items-center gap-2 px-4 py-2 bg-[var(--gnosi-primary)] text-white rounded-lg hover:bg-[var(--gnosi-primary)]/90 cursor-pointer transition-all shadow-lg active:scale-95">
              <Plus size={18} />
              <span className="text-sm font-medium">Penjar fitxer</span>
              <input type="file" className="hidden" onChange={handleUpload} />
            </label>
          )}
        </div>
      </header>

      {/* Toolbar de filtres + ordenació (només quan hi ha àlbum actiu) */}
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

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Albums */}
        <aside className="w-64 bg-[var(--bg-primary)] border-r border-[var(--border-primary)] p-4 flex flex-col gap-2 overflow-y-auto">
          {/* Tabs de root: Images, Assets, Biblioteca, Vault */}
          {roots.length > 1 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] px-2 mb-1">Origen</p>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {roots.map((r) => {
                  const meta = ROOT_META[r.key] || { Icon: Folder, label: r.label };
                  const Icon = meta.Icon;
                  const active = r.key === activeRoot;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setActiveRoot(r.key)}
                      title={r.label}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        active
                          ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)] shadow-sm'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <Icon size={13} />
                      <span className="truncate">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="h-px bg-[var(--border-primary)] mx-2 opacity-50" />
            </>
          )}

          {/* Vistes desades — apareixen sobre la llista de carpetes. Aplicar
              una vista canvia root, àlbum, filtres i ordenació alhora. */}
          {views.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] px-2 mb-1 mt-1">Vistes</p>
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
                        title="Esborrar vista"
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

          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] px-2 mb-2 mt-1">Carpetes</p>

          <button
            onClick={() => setActiveAlbum('')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeAlbum === '' ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] shadow-sm' : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'}`}
            title="Indexa recursivament tot el contingut del root actiu. La primera vegada pot trigar minuts."
          >
            <ImageIcon size={18} />
            <span className="text-sm font-medium">{ROOT_META[activeRoot]?.allLabel || `Tot ${activeRoot}`}</span>
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
              <p className="text-sm font-medium">Selecciona una vista o un àlbum a la barra lateral</p>
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
              <p className="text-sm font-medium">Indexant fitxers…</p>
              <p className="text-xs opacity-60 mt-1 max-w-xs text-center">
                {activeAlbum
                  ? `Llegint «${activeAlbum}»`
                  : 'La primera indexació de tot l\'origen pot trigar uns minuts. Després serà instantània.'}
              </p>
            </div>
          ) : filteredMedia.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)]">
              <ImageIcon size={64} className="mb-4 opacity-10" />
              <p className="text-lg font-medium">No s'ha trobat cap fitxer</p>
              <p className="text-sm">
                {hasActiveFilters
                  ? 'Prova amb un altre filtre o neteja\'ls.'
                  : 'Aquesta carpeta està buida.'}
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
            </>
          )}
        </div>

      </div>

      {/* Visor (lightbox) — pantalla quasi-completa amb panell de metadades
          a la dreta, navegació prev/next, slideshow i fullscreen. El panell
          es plega quan estem en mode fullscreen o slideshow per maximitzar
          l'espai del media. */}
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div
            ref={viewerRootRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[9000] bg-black/95 backdrop-blur-md flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 text-white border-b border-white/10 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={closeViewer}
                  className="p-2 rounded-lg hover:bg-white/10 transition-all"
                  title="Tancar (Esc)"
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
                  title={slideshowActive ? 'Aturar presentació (Espai)' : 'Iniciar presentació (Espai)'}
                >
                  {slideshowActive ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="p-2 rounded-lg hover:bg-white/10 text-white transition-all"
                  title={isFullscreen ? 'Sortir de pantalla completa (F)' : 'Pantalla completa (F)'}
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
                    title="Anterior (←)"
                  >
                    <ChevronLeft size={24} />
                  </button>
                )}
                {hasNext && (
                  <button
                    onClick={goNext}
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all backdrop-blur-sm"
                    title="Següent (→)"
                  >
                    <ChevronRight size={24} />
                  </button>
                )}

                {/* Render segons tipus */}
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
                    <ExternalLink size={16} /> Obrir fitxer al navegador
                  </a>
                )}
              </div>

              {/* Panell de metadades — amagat en fullscreen i slideshow */}
              {!isFullscreen && !slideshowActive && (
                <aside className="w-80 bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col h-full border-l border-white/10 shrink-0">
                  <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2.5 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)]">
                        <p className="text-[9px] text-[var(--text-tertiary)] uppercase font-bold mb-1">Data presa</p>
                        <p className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                          <Calendar size={12} className="text-blue-500" />
                          {selectedPhoto.date_taken ? new Date(selectedPhoto.date_taken).toLocaleDateString() : 'N/A'}
                        </p>
                      </div>
                      <div className="p-2.5 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)]">
                        <p className="text-[9px] text-[var(--text-tertiary)] uppercase font-bold mb-1">Àlbum</p>
                        <p className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                          <FolderOpen size={12} className="text-orange-500" />
                          <span className="truncate">{selectedPhoto.album}</span>
                        </p>
                      </div>
                    </div>

                    {selectedPhoto.lat && (
                      <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                        <p className="text-[9px] text-emerald-600 uppercase font-bold mb-1.5">Localització</p>
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
                        <label className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase block mb-2 px-1">Etiquetes</label>
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
                            placeholder="Afegir tag i prem Enter…"
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
                        <label className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase block mb-2 px-1">Descripció</label>
                        <textarea
                          value={editingMetadata.description}
                          onChange={(e) => setEditingMetadata({...editingMetadata, description: e.target.value})}
                          placeholder="Context del coneixement o record…"
                          className="w-full p-3 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-xs min-h-[100px] focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none resize-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)] flex items-center gap-3">
                    <button
                      className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[var(--border-primary)] text-[var(--text-primary)] rounded-lg text-[11px] font-bold hover:bg-[var(--bg-primary)] transition-all shadow-sm"
                      onClick={() => toast.success('Properament: Creació de nota Markdown')}
                    >
                      <FileText size={14} className="text-purple-500" />
                      Crear nota
                    </button>
                    <div className="flex-1 text-right text-[10px] font-medium" aria-live="polite">
                      {saveStatus === 'saving' && (
                        <span className="text-[var(--text-tertiary)] inline-flex items-center gap-1.5">
                          <Loader2 size={12} className="animate-spin" /> Desant…
                        </span>
                      )}
                      {saveStatus === 'saved' && (
                        <span className="text-emerald-600 inline-flex items-center gap-1.5">
                          <Check size={12} /> Desat
                        </span>
                      )}
                      {saveStatus === 'error' && (
                        <span className="text-red-500 inline-flex items-center gap-1.5">
                          <AlertCircle size={12} /> Error en desar
                        </span>
                      )}
                      {saveStatus === 'idle' && (
                        <span className="text-[var(--text-tertiary)]">Auto-desat</span>
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
