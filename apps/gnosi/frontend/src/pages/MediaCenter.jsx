import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { 
  Image as ImageIcon, 
  Upload, 
  Filter, 
  ChevronRight,
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
  FolderOpen
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

const PERSPECTIVES = [ // Mantenim per referència o inbox, però prioritzem àlbums
  { id: 'General', label: 'General', icon: FolderOpen, color: 'text-blue-500' },
  { id: 'Inbox', label: 'Inbox', icon: FolderOpen, color: 'text-orange-500' }
];

export default function MediaCenter() {
  const [media, setMedia] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeAlbum, setActiveAlbum] = useState('General');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [isUploading, setIsUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [editingMetadata, setEditingMetadata] = useState({ tags: [], description: '' });

  const fetchAlbums = async () => {
    try {
      const res = await axios.get('/api/vault/media/albums');
      setAlbums(res.data);
    } catch (err) {
      console.error('Error carregant àlbums:', err);
    }
  };

  const fetchMedia = useCallback(async () => {
    try {
      setLoading(true);
      const url = activeAlbum ? `/api/vault/media?album=${activeAlbum}` : '/api/vault/media';
      const res = await axios.get(url);
      setMedia(res.data);
    } catch (err) {
      console.error('Error carregant mitjans:', err);
      toast.error('No s\'han pogut carregar les fotos');
    } finally {
      setLoading(false);
    }
  }, [activeAlbum]);

  useEffect(() => {
    fetchAlbums();
    fetchMedia();
  }, [fetchMedia]);

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
            onClick={() => setActiveAlbum(null)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${!activeAlbum ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] shadow-sm' : 'hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
          >
            <ImageIcon size={18} />
            <span className="text-sm font-medium">Totes les fotos</span>
          </button>
          
          <div className="h-px bg-[var(--border-primary)] my-2 mx-2 opacity-50" />

          {albums.map((albumName) => (
            <button 
              key={albumName}
              onClick={() => setActiveAlbum(albumName)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${activeAlbum === albumName ? 'bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-sm text-[var(--gnosi-primary)]' : 'hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
            >
              <div className="flex items-center gap-3">
                <FolderOpen size={18} className={albumName === activeAlbum ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                <span className="text-sm font-medium truncate max-w-[120px]">{albumName}</span>
              </div>
              <ChevronRight size={14} className="text-[var(--text-tertiary)]" />
            </button>
          ))}
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--text-tertiary)]">
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                <ImageIcon size={48} className="opacity-20" />
              </motion.div>
              <p className="text-sm">Carregant galeria...</p>
            </div>
          ) : filteredMedia.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--text-tertiary)] opacity-40">
              <ImageIcon size={64} strokeWidth={1} />
              <p className="text-lg">No s'han trobat imatges</p>
              <p className="text-sm text-center">Puja la teva primera foto a l'àlbum <b>{activeAlbum || 'General'}</b>.</p>
            </div>
          ) : (
            <div className={viewMode === 'grid' ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6" : "flex flex-col gap-2"}>
              <AnimatePresence>
                {filteredMedia.map((item, idx) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: idx * 0.05 }}
                    key={item.id}
                    onClick={() => handlePhotoClick(item)}
                    className={viewMode === 'grid' 
                      ? `group relative flex flex-col bg-[var(--bg-primary)] rounded-2xl border ${selectedPhoto?.id === item.id ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)]'} overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer`
                      : `group flex items-center gap-4 p-3 bg-[var(--bg-primary)] rounded-xl border ${selectedPhoto?.id === item.id ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/5' : 'border-[var(--border-primary)]'} hover:border-[var(--gnosi-primary)]/30 transition-all cursor-pointer`
                    }
                  >
                    {/* Media Display */}
                    <div className={viewMode === 'grid' ? "aspect-square relative overflow-hidden bg-[var(--bg-secondary)]" : "w-16 h-16 rounded-lg overflow-hidden shrink-0"}>
                      <img 
                        src={item.url} 
                        alt={item.filename}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      {item.lat && (
                        <div className="absolute top-2 right-2 p-1.5 bg-black/40 backdrop-blur-md rounded-full text-white">
                          <MapPin size={10} />
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className={viewMode === 'grid' ? "p-3" : "flex-1 flex justify-between items-center pr-4"}>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-[var(--text-primary)] truncate">
                          {item.id}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
                            <Calendar size={10} />
                            {item.date_taken ? new Date(item.date_taken).toLocaleDateString() : new Date(item.last_modified).toLocaleDateString()}
                          </span>
                        </div>
                        {item.tags?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {item.tags.slice(0, 2).map(tag => (
                              <span key={tag} className="px-1.5 py-0.5 bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] text-[9px] rounded-md font-medium uppercase">{tag}</span>
                            ))}
                            {item.tags.length > 2 && <span className="text-[9px] text-[var(--text-tertiary)]">+{item.tags.length - 2}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </main>

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
                  <img src={selectedPhoto.url} className="w-full h-auto object-contain max-h-64 mx-auto" />
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
