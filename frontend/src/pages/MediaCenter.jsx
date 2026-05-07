import React, { useState, useEffect, useCallback } from 'react';
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
  Save,
  Folder,
  FolderOpen,
  CloudOff
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
const TreeNode = React.memo(function TreeNode({ node, depth, activeAlbum, onSelect }) {
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
          params: { path: node.path },
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
        />
      ))}
    </>
  );
});

// Thumb gestiona el seu estat de càrrega/error per imatge. Si OneDrive està
// materialitzant un fitxer en background, el primer GET pot retornar 503;
// reintentem un parell de cops abans d'ensenyar el placeholder cloud-off.
const Thumb = React.memo(function Thumb({ src, alt, viewMode }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 4000;

  // El query param `?_r=N` força el navegador a no servir-ho del cache.
  const finalSrc = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}_r=${attempt}`;

  if (failed) {
    return (
      <div className={`${viewMode === 'grid'
        ? 'aspect-square'
        : 'w-24 h-24 rounded-xl flex-shrink-0'
      } relative overflow-hidden bg-slate-800 text-slate-400 flex flex-col items-center justify-center gap-1 p-2`}>
        <CloudOff size={28} className="opacity-60" />
        <span className="text-[9px] text-center leading-tight opacity-70">No descarregat</span>
      </div>
    );
  }

  return (
    <div className={
      viewMode === 'grid'
        ? "aspect-square relative overflow-hidden bg-gray-900"
        : "w-24 h-24 relative rounded-xl overflow-hidden flex-shrink-0 bg-gray-900"
    }>
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
  
  // Estats de paginació
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 50;

  const fetchAlbums = async () => {
    try {
      // Arrel de l'arbre: subcarpetes immediates de Images/.
      const res = await axios.get('/api/vault/media/tree', { timeout: 30000 });
      setAlbums(res.data || []);
    } catch (err) {
      console.error('Error carregant arbre:', err);
    }
  };

  const fetchMedia = useCallback(async (reset = false) => {
    // `activeAlbum === null` (undefined) → no carreguem res. Cal que l'usuari
    // triï un àlbum o demani explícitament 'Totes les fotos' (string buida ''),
    // que dispara un escaneig recursiu de tot Images/ (lent la primera vegada).
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
      // Backend interpreta album buit com a "tot Images/".
      const albumParam = activeAlbum ? `&album=${encodeURIComponent(activeAlbum)}` : '';
      const url = `/api/vault/media?limit=${PAGE_SIZE}&offset=${currentOffset}${albumParam}`;

      // 'Totes les fotos' pot trigar minuts la primera vegada a OneDrive.
      const res = await axios.get(url, { timeout: 300000 });
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
  }, [activeAlbum, offset]);

  // Carrega la llista d'àlbums un cop, al muntatge.
  useEffect(() => {
    fetchAlbums();
  }, []);

  // Reset al canviar d'àlbum
  useEffect(() => {
    fetchMedia(true);
  }, [activeAlbum]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    
    const album = activeAlbum || 'General';

    try {
      setIsUploading(true);
      toast.loading('Pujant imatge...', { id: 'upload' });
      await axios.post(`/api/vault/media/upload?album=${album}`, formData);
      toast.success('Imatge pujada correctament', { id: 'upload' });
      fetchMedia();
    } catch (err) {
      console.error('Error pujant imatge:', err);
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

  const saveMetadata = async () => {
    if (!selectedPhoto) return;
    try {
      toast.loading('Desant...', { id: 'meta' });
      await axios.patch('/api/vault/media/metadata', {
        filename: selectedPhoto.filename,
        album: selectedPhoto.album,
        metadata: editingMetadata
      });
      toast.success('Metadades desades', { id: 'meta' });
      // Actualitzar info local
      setMedia(media.map(m => m.id === selectedPhoto.id ? { ...m, ...editingMetadata } : m));
      setSelectedPhoto({ ...selectedPhoto, ...editingMetadata });
    } catch (err) {
      toast.error('Error en desar', { id: 'meta' });
    }
  };

  const filteredMedia = media.filter(item => 
    item.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-secondary)] overflow-hidden">
      {/* Header */}
      <header className="p-6 bg-[var(--bg-primary)] border-b border-[var(--border-primary)] flex justify-between items-center z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[var(--gnosi-primary)]/10 rounded-lg text-[var(--gnosi-primary)]">
            <ImageIcon size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Arxiu Fotogràfic KPM</h1>
            <p className="text-xs text-[var(--text-tertiary)]">Memòria visual i gestió del coneixement</p>
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

          <label className="flex items-center gap-2 px-4 py-2 bg-[var(--gnosi-primary)] text-white rounded-lg hover:bg-[var(--gnosi-primary)]/90 cursor-pointer transition-all shadow-lg active:scale-95">
            <Plus size={18} />
            <span className="text-sm font-medium">Afegir Foto</span>
            <input type="file" className="hidden" onChange={handleUpload} />
          </label>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Albums */}
        <aside className="w-64 bg-[var(--bg-primary)] border-r border-[var(--border-primary)] p-4 flex flex-col gap-2 overflow-y-auto">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] px-2 mb-2">Àlbums (Carpetes)</p>
          
          <button
            onClick={() => setActiveAlbum('')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeAlbum === '' ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] shadow-sm' : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'}`}
            title="Indexa recursivament totes les fotos del Vault. La primera vegada pot trigar minuts."
          >
            <ImageIcon size={18} />
            <span className="text-sm font-medium">Totes les fotos</span>
          </button>
          
          <div className="h-px bg-[var(--border-primary)] my-2 mx-2 opacity-50" />

          {albums.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              activeAlbum={activeAlbum}
              onSelect={setActiveAlbum}
            />
          ))}
        </aside>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {activeAlbum === null ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] bg-[var(--bg-primary)]/30 rounded-2xl border-2 border-dashed border-[var(--border-primary)]">
              <Folder size={64} className="mb-4 opacity-20" />
              <p className="text-sm font-medium">Tria un àlbum a la barra lateral</p>
              <p className="text-xs opacity-60 mt-1 max-w-xs text-center">
                O bé clica «Totes les fotos» per veure tot l'arxiu (la primera vegada triga uns minuts).
              </p>
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
              <p className="text-sm font-medium">Indexant galeria...</p>
              <p className="text-xs opacity-60 mt-1 max-w-xs text-center">
                {activeAlbum
                  ? `Llegint «${activeAlbum}»`
                  : 'La primera indexació de tot l\'arxiu pot trigar uns minuts. Després serà instantani.'}
              </p>
            </div>
          ) : filteredMedia.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)]">
              <ImageIcon size={64} className="mb-4 opacity-10" />
              <p className="text-lg font-medium">No s'han trobat fotos</p>
              <p className="text-sm">Prova amb un altre filtre o puja una nova imatge</p>
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
                    />
                  </motion.div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Details Panel */}
        <AnimatePresence>
          {selectedPhoto && (
            <motion.aside 
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
              className="w-96 bg-[var(--bg-primary)] border-l border-[var(--border-primary)] shadow-2xl z-20 flex flex-col h-full"
            >
              <div className="p-4 border-b border-[var(--border-primary)] flex justify-between items-center">
                <h3 className="font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <ImageIcon size={18} className="text-[var(--gnosi-primary)]" />
                  Detalls de la imatge
                </h3>
                <button onClick={() => setSelectedPhoto(null)} className="p-1 hover:bg-[var(--bg-secondary)] rounded-md text-[var(--text-tertiary)]">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                {/* Preview */}
                <div className="rounded-2xl overflow-hidden border border-[var(--border-primary)] shadow-sm bg-[var(--bg-secondary)]">
                  <img 
                    src={normalizeUrl(selectedPhoto.url)} 
                    className="w-full h-auto object-contain max-h-64 mx-auto" 
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentElement.classList.add('flex', 'items-center', 'justify-center', 'bg-red-500/10', 'py-12');
                      const icon = document.createElement('div');
                      icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="text-red-500/20"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
                      e.target.parentElement.appendChild(icon.firstChild);
                    }}
                  />
                </div>

                {/* Info EXIF */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)]">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase font-bold mb-1">Data Presa</p>
                    <p className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-2">
                      <Calendar size={14} className="text-blue-500" />
                      {selectedPhoto.date_taken ? new Date(selectedPhoto.date_taken).toLocaleDateString() : 'N/A'}
                    </p>
                  </div>
                  <div className="p-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)]">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase font-bold mb-1">Àlbum</p>
                    <p className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-2">
                      <FolderOpen size={14} className="text-orange-500" />
                      {selectedPhoto.album}
                    </p>
                  </div>
                </div>

                {/* Maps & Location */}
                {selectedPhoto.lat && (
                  <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                    <p className="text-[10px] text-emerald-600 uppercase font-bold mb-2">Localització Detectada</p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <MapPin size={20} className="text-emerald-500" />
                        <span className="text-xs text-[var(--text-secondary)]">{selectedPhoto.lat.toFixed(4)}, {selectedPhoto.lng.toFixed(4)}</span>
                      </div>
                      <a 
                        href={`https://www.google.com/maps?q=${selectedPhoto.lat},${selectedPhoto.lng}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="px-3 py-1.5 bg-white border border-emerald-200 text-emerald-600 rounded-lg text-[10px] font-bold flex items-center gap-1 hover:bg-emerald-50 shadow-sm"
                      >
                        <ExternalLink size={12} /> Google Maps
                      </a>
                    </div>
                  </div>
                )}

                {/* Editor metadades */}
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase block mb-2 px-1">Etiquetes (Tags)</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {editingMetadata.tags.map(tag => (
                        <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] text-[10px] font-bold rounded-full group">
                          {tag}
                          <button onClick={() => setEditingMetadata({...editingMetadata, tags: editingMetadata.tags.filter(t => t !== tag)})}>
                            <X size={10} className="hover:text-red-500" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={14} />
                      <input 
                        type="text" 
                        placeholder="Afegir tag i prem Enter..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.target.value) {
                            if (!editingMetadata.tags.includes(e.target.value)) {
                              setEditingMetadata({...editingMetadata, tags: [...editingMetadata.tags, e.target.value]});
                            }
                            e.target.value = '';
                          }
                        }}
                        className="w-full pl-9 pr-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-xs focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase block mb-2 px-1">Descripció KPM</label>
                    <textarea 
                      value={editingMetadata.description}
                      onChange={(e) => setEditingMetadata({...editingMetadata, description: e.target.value})}
                      placeholder="Context del coneixement o record..."
                      className="w-full p-4 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl text-xs min-h-[100px] focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none resize-none"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)] grid grid-cols-2 gap-3">
                <button 
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-[var(--border-primary)] text-[var(--text-primary)] rounded-xl text-xs font-bold hover:bg-[var(--bg-primary)] transition-all shadow-sm"
                  onClick={() => toast.success('Properament: Creació de nota Markdown')}
                >
                  <FileText size={16} className="text-purple-500" />
                  Crear Nota
                </button>
                <button 
                  onClick={saveMetadata}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-[var(--gnosi-primary)] text-white rounded-xl text-xs font-bold hover:bg-[var(--gnosi-primary)]/90 transition-all shadow-sm"
                >
                  <Save size={16} />
                  Desar
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
