/**
 * MediaPicker.jsx
 *
 * Picker reutilitzable de mitjans dins del vault. Permet navegar pels roots
 * disponibles (Images, Assets, Biblioteca, Vault) i seleccionar un fitxer
 * (imatge, vídeo, PDF...). El callback `onSelect(item)` rep l'objecte
 * complet retornat per `/api/vault/media`, incloent la `url` ja preparada
 * per inserir al BlockEditor.
 *
 * Disseny modal: muntat dins d'altres components (típicament
 * MediaInsertDialog) i mostrat amb `open=true`.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
    Image as ImageIcon, Folder, FolderOpen, ChevronRight, ChevronDown,
    FileText, Film, Music, File as FileIcon, Library, Database, Search, X,
} from 'lucide-react';
import { toast } from '../../lib/toast';

const ROOT_ICONS = {
    images: ImageIcon,
    assets: Folder,
    biblioteca: Library,
    vault: Database,
};

function normalizeUrl(url) {
    if (!url) return '';
    const m = url.match(/^https?:\/\/[^/]+(\/api\/.*)$/i);
    return m?.[1] || url;
}

function KindIcon({ kind, size = 14 }) {
    const Icon = kind === 'image' ? ImageIcon
        : kind === 'video' ? Film
        : kind === 'audio' ? Music
        : kind === 'pdf' ? FileText
        : FileIcon;
    return <Icon size={size} className="shrink-0 text-[var(--text-tertiary)]" />;
}

const TreeNode = React.memo(function TreeNode({ node, depth, root, activePath, onSelectFolder }) {
    const [expanded, setExpanded] = useState(false);
    const [children, setChildren] = useState(null);
    const [loading, setLoading] = useState(false);
    const isActive = activePath === node.path;

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
        setExpanded(v => !v);
    };

    return (
        <>
            <div
                style={{ paddingLeft: `${4 + depth * 14}px` }}
                className={`w-full flex items-stretch rounded-lg transition-colors ${
                    isActive ? 'bg-[var(--gnosi-primary)]/10' : 'hover:bg-[var(--bg-secondary)]'
                }`}
            >
                <button
                    type="button"
                    onClick={toggle}
                    className={`shrink-0 w-6 flex items-center justify-center ${node.has_children ? 'cursor-pointer' : 'cursor-default'}`}
                    aria-label={expanded ? 'Collapse' : 'Expand'}
                >
                    {node.has_children ? (
                        loading ? <span className="text-[var(--text-tertiary)] text-xs">…</span>
                            : expanded ? <ChevronDown size={14} className="text-[var(--text-tertiary)]" />
                            : <ChevronRight size={14} className="text-[var(--text-tertiary)]" />
                    ) : null}
                </button>
                <button
                    type="button"
                    onClick={() => onSelectFolder(node.path)}
                    className={`flex items-center gap-2 min-w-0 flex-1 pr-2 py-1.5 text-left ${
                        isActive ? 'text-[var(--gnosi-primary)] font-medium' : 'text-[var(--text-primary)]'
                    }`}
                    title={node.name}
                >
                    {expanded ? (
                        <FolderOpen size={14} className="shrink-0 text-[var(--text-tertiary)]" />
                    ) : (
                        <Folder size={14} className="shrink-0 text-[var(--text-tertiary)]" />
                    )}
                    <span className="text-xs truncate">{node.name}</span>
                </button>
            </div>
            {expanded && children && children.map(child => (
                <TreeNode
                    key={`${root}::${child.path}`}
                    node={child}
                    depth={depth + 1}
                    root={root}
                    activePath={activePath}
                    onSelectFolder={onSelectFolder}
                />
            ))}
        </>
    );
});

export function MediaPicker({ onSelect, onCancel, kindFilter = null }) {
    const [roots, setRoots] = useState([]);
    const [activeRoot, setActiveRoot] = useState('images');
    const [tree, setTree] = useState([]);
    // activePath: '' = arrel del root (recursiu), null = encara cap selecció,
    // 'subfolder' = només els fitxers d'aquesta subcarpeta.
    const [activePath, setActivePath] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');

    // Carrega els roots disponibles un cop
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await axios.get('/api/vault/media/roots', { timeout: 15000 });
                if (cancelled) return;
                const available = (res.data || []).filter(r => r.available);
                setRoots(available);
                if (available.length && !available.find(r => r.key === activeRoot)) {
                    setActiveRoot(available[0].key);
                }
            } catch (err) {
                console.error('No s\'han pogut carregar els roots:', err);
            }
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Recarrega l'arbre quan canvia el root actiu
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await axios.get('/api/vault/media/tree', {
                    params: { root: activeRoot },
                    timeout: 30000,
                });
                if (cancelled) return;
                setTree(res.data || []);
                setActivePath(null);
                setItems([]);
            } catch (err) {
                console.error('Error carregant arbre:', err);
                if (!cancelled) setTree([]);
            }
        })();
        return () => { cancelled = true; };
    }, [activeRoot]);

    // Recarrega els fitxers quan canvia el path actiu
    const fetchItems = useCallback(async () => {
        if (activePath === null) {
            setItems([]);
            return;
        }
        setLoading(true);
        try {
            const params = { root: activeRoot, limit: 200, offset: 0 };
            if (activePath) params.album = activePath;
            // Recursiu pot trigar la primera vegada (vault gran).
            const res = await axios.get('/api/vault/media', { params, timeout: 300000 });
            setItems(res.data?.items || []);
        } catch (err) {
            console.error('Error carregant fitxers:', err);
            toast.error('No s\'han pogut carregar els fitxers');
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [activeRoot, activePath]);

    useEffect(() => { fetchItems(); }, [fetchItems]);

    const filteredItems = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list = items;
        if (kindFilter) {
            list = list.filter(it => kindFilter === it.kind || (Array.isArray(kindFilter) && kindFilter.includes(it.kind)));
        }
        if (q) list = list.filter(it => it.filename.toLowerCase().includes(q));
        return list;
    }, [items, search, kindFilter]);

    return (
        <div className="flex flex-col h-full bg-[var(--bg-primary)] rounded-2xl overflow-hidden border border-[var(--border-primary)]">
            {/* Header amb tabs de root */}
            <div className="flex items-center gap-2 p-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                {roots.map(r => {
                    const Icon = ROOT_ICONS[r.key] || Folder;
                    const active = r.key === activeRoot;
                    return (
                        <button
                            key={r.key}
                            type="button"
                            onClick={() => setActiveRoot(r.key)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                active
                                    ? 'bg-[var(--gnosi-primary)] text-white shadow-sm'
                                    : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-primary)]'
                            }`}
                        >
                            <Icon size={14} />
                            {r.label}
                        </button>
                    );
                })}
                <div className="flex-1" />
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={14} />
                    <input
                        type="text"
                        placeholder="Filtrar..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-8 pr-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md text-xs w-44 outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]/30"
                    />
                </div>
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
                        aria-label="Tanca"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            <div className="flex flex-1 min-h-0">
                {/* Sidebar arbre */}
                <aside className="w-56 border-r border-[var(--border-primary)] overflow-y-auto p-2 flex flex-col gap-0.5 bg-[var(--bg-secondary)]/30">
                    <button
                        type="button"
                        onClick={() => setActivePath('')}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            activePath === '' ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]' : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                        }`}
                        title="Llistat recursiu — pot trigar la primera vegada"
                    >
                        <ImageIcon size={14} />
                        Tot el contingut
                    </button>
                    <div className="h-px bg-[var(--border-primary)] my-1 mx-1 opacity-50" />
                    {tree.map(node => (
                        <TreeNode
                            key={`${activeRoot}::${node.path}`}
                            node={node}
                            depth={0}
                            root={activeRoot}
                            activePath={activePath}
                            onSelectFolder={setActivePath}
                        />
                    ))}
                </aside>

                {/* Grid de fitxers */}
                <div className="flex-1 overflow-y-auto p-3">
                    {activePath === null ? (
                        <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] gap-2">
                            <Folder size={48} className="opacity-20" />
                            <p className="text-xs">Tria una carpeta o «Tot el contingut»</p>
                        </div>
                    ) : loading ? (
                        <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] gap-2">
                            <ImageIcon size={48} className="opacity-20 animate-pulse" />
                            <p className="text-xs">Indexant…</p>
                        </div>
                    ) : filteredItems.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] gap-2">
                            <FileIcon size={48} className="opacity-10" />
                            <p className="text-xs">No s'han trobat fitxers</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {filteredItems.map((item) => {
                                const isImage = item.kind === 'image';
                                return (
                                    <button
                                        key={`${item.root}::${item.path}`}
                                        type="button"
                                        onClick={() => onSelect(item)}
                                        className="group cursor-pointer bg-[var(--bg-secondary)] rounded-lg overflow-hidden border border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50 hover:shadow-md transition-all text-left"
                                        title={item.filename}
                                    >
                                        <div className="aspect-square relative overflow-hidden bg-gray-900 flex items-center justify-center">
                                            {isImage ? (
                                                <img
                                                    src={normalizeUrl(item.url)}
                                                    alt={item.filename}
                                                    loading="lazy"
                                                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                />
                                            ) : (
                                                <KindIcon kind={item.kind} size={36} />
                                            )}
                                        </div>
                                        <div className="p-1.5 flex items-center gap-1 min-w-0">
                                            <KindIcon kind={item.kind} size={12} />
                                            <span className="text-[10px] text-[var(--text-secondary)] truncate" title={item.filename}>
                                                {item.filename}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default MediaPicker;
