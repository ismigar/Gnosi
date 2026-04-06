import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
    FileText, 
    Calendar, 
    Tag, 
    Hash, 
    Type, 
    CheckSquare, 
    ChevronDown, 
    ChevronRight, 
    Plus, 
    X, 
    Loader2, 
    Search,
    Database,
    Table as TableIcon,
    LayoutGrid,
    List as ListIcon,
    LayoutPanelLeft,
    Share2, 
    Trash2, 
    ExternalLink, 
    Maximize2, 
    Columns, 
    MessageSquare, 
    Settings,
    Link2,
    AtSign,
    Smile
} from 'lucide-react';
import axios from 'axios';
import { 
    useCreateBlockNote,
    getDefaultReactSlashMenuItems,
    SuggestionMenuController,
    createReactBlockSpec,
    createReactInlineContentSpec
} from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import { withMultiColumn, multiColumnDropCursor } from "@blocknote/xl-multi-column";
import "@blocknote/mantine/style.css";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/react/style.css";
import { useTranslation } from 'react-i18next';
import { VaultViewHeader } from './VaultViewHeader';
import { toast } from 'react-hot-toast';
import { useTheme } from '../../hooks/useTheme';
import PageHistory from './PageHistory';
import { IconPicker } from './IconPicker';
import { CoverPicker } from './CoverPicker';
import { IconRenderer } from './IconRenderer';

import { VaultEditorContext } from './VaultEditorContext';
import { buildSlashCommandCatalog, buildColumnLayoutCatalog } from './slashMenuUtils';
import { blocksToRichMarkdown, richMarkdownToBlocks } from './markdown-mapper';

const normalizeVaultAssetUrl = (value) => {
    if (typeof value !== 'string') return value;

    if (value.startsWith('Assets/')) {
        return `/api/vault/assets/${value.substring(7)}`;
    }

    if (value.startsWith('/api/vault/assets/')) {
        return value;
    }

    const absAssetMatch = value.match(/^https?:\/\/[^/]+\/api\/vault\/assets\/(.+)$/i);
    if (absAssetMatch?.[1]) {
        return `/api/vault/assets/${absAssetMatch[1]}`;
    }

    return value;
};

const parseMarkdownHeading = (line) => {
    const match = String(line || '').match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match?.[1] || !match?.[2]) return null;

    const level = match[1].length;
    const title = match[2]
        .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .trim();

    if (!title) return null;
    return { level, title };
};

const markdownToPlainText = (markdown) => {
    return String(markdown || '')
        .replace(/!\[\[[^\]]+\]\]/g, '')
        .replace(/\[\[[^\]]+\]\]/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/[#>*_`~\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Registry for notes currently in the process of being saved.
 * This global Map survives component unmounting, allowing next component
 * instance (or dashboard) to access most recent content before backend reflects it.
 */
export const inFlightSaves = new Map();

const extractSectionPreview = (markdown, sectionName) => {
    const cleanSectionName = String(sectionName || '').trim().toLowerCase();
    if (!cleanSectionName) return '';

    if (cleanSectionName.startsWith('^')) {
        const blockId = cleanSectionName.substring(1).trim();
        if (!blockId) return '';
        const source = String(markdown || '').replace(/```[\s\S]*?```/g, '');
        const lines = source.split('\n');
        for (const line of lines) {
            const markerMatch = String(line || '').match(/(?:^|\s)\^([a-zA-Z0-9_-]+)\s*$/);
            if (!markerMatch?.[1]) continue;
            if (String(markerMatch[1]).toLowerCase() !== blockId) continue;
            const cleanLine = String(line || '').replace(/\s*\^[a-zA-Z0-9_-]+\s*$/, '').trim();
            return markdownToPlainText(cleanLine);
        }
        return '';
    }

    const source = String(markdown || '').replace(/```[\s\S]*?```/g, '');
    const lines = source.split('\n');

    let startIndex = -1;
    let startLevel = 0;

    for (let i = 0; i < lines.length; i += 1) {
        const heading = parseMarkdownHeading(lines[i]);
        if (!heading) continue;

        if (heading.title.toLowerCase() === cleanSectionName) {
            startIndex = i + 1;
            startLevel = heading.level;
            break;
        }
    }

    if (startIndex < 0) return '';

    const sectionLines = [];
    for (let i = startIndex; i < lines.length; i += 1) {
        const heading = parseMarkdownHeading(lines[i]);
        if (heading && heading.level <= startLevel) {
            break;
        }
        sectionLines.push(lines[i]);
    }

    return markdownToPlainText(sectionLines.join('\n'));
};

const normalizeLinkedPageRef = (rawRef) => {
    const source = String(rawRef || '').trim();
    if (!source) return '';

    let decoded = source;
    try {
        decoded = decodeURIComponent(source);
    } catch {
        decoded = source;
    }

    const withoutHash = decoded.split('#')[0].trim();
    if (!withoutHash) return '';

    const vaultPageMatch = withoutHash.match(/(?:https?:\/\/[^/]+)?\/vault\/page\/([^/?#]+)/i);
    if (vaultPageMatch?.[1]) {
        try {
            return decodeURIComponent(vaultPageMatch[1]).trim();
        } catch {
            return String(vaultPageMatch[1] || '').trim();
        }
    }

    const apiPageMatch = withoutHash.match(/(?:https?:\/\/[^/]+)?\/api\/vault\/pages\/([^/?#]+)/i);
    if (apiPageMatch?.[1]) {
        try {
            return decodeURIComponent(apiPageMatch[1]).trim();
        } catch {
            return String(apiPageMatch[1] || '').trim();
        }
    }

    return withoutHash;
};

const extractOutgoingPageLinks = (markdown, idToTitle = {}, selfId = '') => {
    const titleToId = Object.entries(idToTitle || {}).reduce((acc, [id, title]) => {
        const key = String(title || '').trim().toLowerCase();
        if (key && !acc[key]) {
            acc[key] = String(id || '').trim();
        }
        return acc;
    }, {});

    const addResolved = (bucket, targetId, fallbackTitle = '') => {
        const safeId = String(targetId || '').trim();
        if (!safeId || safeId === String(selfId || '').trim()) return;
        if (bucket.has(safeId)) return;
        bucket.set(safeId, {
            id: safeId,
            title: String(idToTitle?.[safeId] || fallbackTitle || safeId),
            resolved: true,
        });
    };

    const unresolved = new Map();
    const resolved = new Map();
    const body = String(markdown || '');

    const wikiRegex = /!?\[\[([^\]]+)\]\]/g;
    for (const match of body.matchAll(wikiRegex)) {
        const rawTarget = String(match?.[1] || '').trim();
        if (!rawTarget) continue;

        const baseTarget = rawTarget.split('|')[0].split('#')[0].trim();
        if (!baseTarget) continue;

        const normalizedRef = normalizeLinkedPageRef(baseTarget);
        const byId = idToTitle?.[normalizedRef] ? normalizedRef : '';
        const byTitle = titleToId[String(baseTarget || '').toLowerCase()] || '';
        const resolvedId = byId || byTitle;

        if (resolvedId) {
            addResolved(resolved, resolvedId, baseTarget);
            continue;
        }

        const key = String(baseTarget).toLowerCase();
        if (!unresolved.has(key)) {
            unresolved.set(key, {
                id: '',
                title: baseTarget,
                resolved: false,
            });
        }
    }

    const mdRegex = /\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of body.matchAll(mdRegex)) {
        const rawRef = String(match?.[1] || '').trim();
        if (!rawRef) continue;

        const normalizedRef = normalizeLinkedPageRef(rawRef);
        if (!normalizedRef) continue;

        const byId = idToTitle?.[normalizedRef] ? normalizedRef : '';
        const byTitle = titleToId[String(normalizedRef || '').toLowerCase()] || '';
        const resolvedId = byId || byTitle;

        if (resolvedId) {
            addResolved(resolved, resolvedId, normalizedRef);
            continue;
        }

        if (rawRef.startsWith('http://') || rawRef.startsWith('https://') || rawRef.startsWith('/')) {
            continue;
        }

        const key = String(normalizedRef).toLowerCase();
        if (!unresolved.has(key)) {
            unresolved.set(key, {
                id: '',
                title: normalizedRef,
                resolved: false,
            });
        }
    }

    return [
        ...Array.from(resolved.values()).sort((a, b) => a.title.localeCompare(b.title)),
        ...Array.from(unresolved.values()).sort((a, b) => a.title.localeCompare(b.title)),
    ];
};

const MultiSelectPills = ({ value, onChange, options, idToTitle, placeholder, onCreate, fieldKey }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const containerRef = useRef(null);
    const currentValues = useMemo(() => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
            return value ? [value] : [];
        }
    }, [value]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredOptions = (options || []).filter(opt => 
        (idToTitle[opt] || opt).toLowerCase().includes(searchTerm.toLowerCase()) &&
        !currentValues.includes(opt)
    );

    const toggleValue = (val) => {
        const next = currentValues.includes(val)
            ? currentValues.filter(v => v !== val)
            : [...currentValues, val];
        onChange(next);
    };

    return (
        <div className="relative w-full" ref={containerRef}>
            <div 
                onClick={() => setIsOpen(!isOpen)}
                className="flex flex-wrap gap-1.5 p-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg cursor-pointer hover:border-[var(--gnosi-primary)]/50 transition-all min-h-[42px] items-center"
            >
                {currentValues.length === 0 && <span className="text-[var(--text-tertiary)]/60 text-sm ml-1">{placeholder}</span>}
                {currentValues.map(val => (
                    <span key={val} className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-full text-xs font-medium text-[var(--text-secondary)] shadow-sm">
                        {idToTitle[val] || val}
                        <X size={10} className="hover:text-[var(--status-error)] transition-colors" onClick={(e) => { e.stopPropagation(); toggleValue(val); }} />
                    </span>
                ))}
            </div>
            {isOpen && (
                <div className="absolute z-50 w-full mt-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl p-2 animate-in fade-in zoom-in-95 duration-100 max-h-[300px] flex flex-col">
                    <div className="relative mb-2 shrink-0">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]/60" />
                        <input
                            autoFocus
                            className="w-full pl-9 pr-4 py-2 bg-[var(--bg-secondary)] border-none rounded-lg text-sm focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none text-[var(--text-primary)]"
                            placeholder="Buscar..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="overflow-y-auto flex-1 custom-scrollbar">
                        {filteredOptions.map(opt => (
                            <div
                                key={opt}
                                onClick={() => toggleValue(opt)}
                                className="p-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--gnosi-primary)]/10 hover:text-[var(--gnosi-primary)] rounded-lg cursor-pointer transition-colors flex items-center justify-between group"
                            >
                                <span>{idToTitle[opt] || opt}</span>
                                <Plus size={14} className="opacity-0 group-hover:opacity-100" />
                            </div>
                        ))}
                        {searchTerm && !(options || []).includes(searchTerm) && onCreate && (
                            <button
                                onClick={() => { onCreate(searchTerm); setSearchTerm(''); }}
                                className="btn-gnosi btn-gnosi-primary !text-xs !py-2 w-full mt-2"
                            >
                                <Plus size={14} />
                                Crear "{searchTerm}"
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const SingleSelectPill = ({ value, onChange, options, idToTitle, placeholder }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative inline-block" ref={containerRef}>
            <div 
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg cursor-pointer hover:border-[var(--gnosi-primary)]/50 transition-all shadow-sm"
            >
                <div className="w-2 h-2 rounded-full bg-[var(--gnosi-primary)]/60"></div>
                <span className="text-xs font-semibold text-[var(--text-primary)]">{idToTitle[value] || value || placeholder}</span>
                <ChevronDown size={14} className={`text-[var(--text-tertiary)]/60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
            {isOpen && (
                <div className="absolute z-[100] top-full mt-2 w-56 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-150">
                    <div className="text-[10px] font-bold text-[var(--text-tertiary)]/40 px-3 py-2 uppercase tracking-wider">Selecciona Taula</div>
                    {(options || []).map(opt => (
                        <div
                            key={opt}
                            onClick={() => { onChange(opt); setIsOpen(false); }}
                            className={`p-2.5 text-sm rounded-lg cursor-pointer transition-colors flex items-center gap-3 ${value === opt ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${value === opt ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/30'}`}></div>
                            {idToTitle[opt] || opt}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const InlineDatabase = React.forwardRef(({ block, editor }, ref) => {
    const context = React.useContext(VaultEditorContext);
    const { allTables, onEditSchema, onCreateRecord, onDeletePage, onOpenParallel, idToTitle, registry } = context || {};
    const [activeTableId, setActiveTableId] = useState(block.props.database_table_id);

    const handleTableChange = (id) => {
        setActiveTableId(id);
        editor.updateBlock(block, { props: { ...block.props, database_table_id: id } });
    };

    const tableData = (allTables || []).find(t => t.id === activeTableId);
    if (!activeTableId) {
        return (
            <div className="p-12 border-2 border-dashed border-[var(--border-primary)] rounded-xl flex flex-col items-center justify-center gap-4 bg-[var(--bg-secondary)]/30 group-hover:border-[var(--gnosi-primary)]/30 transition-colors">
                <div className="p-4 bg-[var(--gnosi-primary)]/10 rounded-2xl"><Database size={32} className="text-[var(--gnosi-primary)]/60" /></div>
                <div className="text-center">
                    <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Configura la vista</h3>
                    <p className="text-xs text-[var(--text-tertiary)]/60 mt-1">Selecciona una base de dades per començar</p>
                </div>
                <SingleSelectPill 
                    value={activeTableId} 
                    onChange={handleTableChange} 
                    options={(allTables || []).map(t => t.id)} 
                    idToTitle={Object.fromEntries((allTables || []).map(t => [t.id, t.name]))} 
                    placeholder="Triar taula..." 
                />
            </div>
        );
    }
    return (
        <div ref={ref} className="bn-database-container">
            <div className="p-8 text-center text-[var(--text-tertiary)]/60 text-[11px] italic border border-[var(--border-primary)] rounded-lg bg-[var(--bg-primary)] shadow-sm my-6">
                L'editor de dades en línia estarà disponible en una futura actualització.
            </div>
        </div>
    );
});
InlineDatabase.displayName = 'InlineDatabase';

const TransclusionEmbed = React.forwardRef(({ block }, ref) => {
    const context = React.useContext(VaultEditorContext);
    const { idToTitle = {}, onOpenParallel = () => {} } = context || {};
    const target = String(block?.props?.target || '').trim();
    const alias = String(block?.props?.alias || '').trim();
    const section = String(block?.props?.section || '').trim();

    const resolvedId = useMemo(() => {
        if (!target) return null;
        if (idToTitle[target]) return target;

        const lowerTarget = target.toLowerCase();
        const byTitle = Object.entries(idToTitle).find(([, title]) => String(title || '').toLowerCase() === lowerTarget);
        return byTitle?.[0] || null;
    }, [target, idToTitle]);

    const displayTitle = alias || idToTitle[resolvedId] || target || 'Transclusio';
    const [preview, setPreview] = useState('');

    useEffect(() => {
        let cancelled = false;
        const loadPreview = async () => {
            if (!resolvedId) {
                setPreview('No s\'ha trobat la nota de desti.');
                return;
            }

            try {
                const response = await axios.get(`/api/vault/pages/${encodeURIComponent(resolvedId)}`);
                const raw = String(response?.data?.content || '');
                const scopedSection = section ? extractSectionPreview(raw, section) : '';
                const clean = scopedSection || markdownToPlainText(raw);

                if (!cancelled) {
                    if (section && !scopedSection) {
                        setPreview('No s\'ha trobat aquest apartat a la nota de desti.');
                        return;
                    }

                    setPreview(clean.slice(0, 300) || 'Sense contingut.');
                }
            } catch (error) {
                if (!cancelled) {
                    setPreview('No s\'ha pogut carregar la previsualitzacio.');
                }
            }
        };

        loadPreview();
        return () => {
            cancelled = true;
        };
    }, [resolvedId, section]);

    return (
        <div
            ref={ref}
            className="my-4 p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 cursor-pointer hover:border-[var(--gnosi-primary)]/40 transition-colors"
            onClick={() => {
                if (resolvedId) onOpenParallel(resolvedId);
            }}
            title={resolvedId ? 'Obrir nota incrustada' : 'Nota no resolta'}
        >
            <div className="flex items-center gap-2 text-[var(--gnosi-primary)] text-xs font-semibold uppercase tracking-wider mb-2">
                <Maximize2 size={13} />
                Transclusio
            </div>
            <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">{displayTitle}</div>
            {section ? <div className="text-[11px] text-[var(--gnosi-primary)] mb-1">#{section}</div> : null}
            <div className="text-xs text-[var(--text-tertiary)] leading-relaxed">{preview}</div>
        </div>
    );
});
TransclusionEmbed.displayName = 'TransclusionEmbed';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) { return { hasError: true, error }; }
    componentDidCatch(error, errorInfo) { console.error("ErrorBoundary caught an error", error, errorInfo); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-12 border-2 border-dashed border-[var(--status-error)]/30 rounded-xl bg-[var(--status-error)]/5 flex flex-col items-center gap-4 text-center my-10">
                    <div className="p-4 bg-[var(--status-error)]/10 rounded-full text-[var(--status-error)]"><X size={32} /></div>
                    <div className="max-w-md">
                        <h3 className="text-lg font-bold text-[var(--text-primary)]">S'ha produït un error a l'editor</h3>
                        <p className="text-sm text-[var(--text-tertiary)] mt-1">El contingut d'aquesta pàgina conté blocs no suportats o mal formatats.</p>
                        <div className="bg-[var(--bg-secondary)] p-3 rounded-lg text-left mt-4 overflow-auto max-h-40 border border-[var(--border-primary)] shadow-inner">
                            <code className="text-[10px] text-[var(--text-tertiary)] leading-relaxed whitespace-pre-wrap">
                                {this.state.error?.toString()}
                            </code>
                        </div>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

const MarkdownCodeEditor = ({ noteFilename, initialContent, metadata, onUpdate, onRefreshNotes }) => {
    const [markdownText, setMarkdownText] = useState(String(initialContent || ''));
    const saveTimerRef = useRef(null);

    useEffect(() => {
        setMarkdownText(String(initialContent || ''));
    }, [initialContent, noteFilename]);

    const saveMarkdown = useCallback(async (nextText, { silent = true } = {}) => {
        if (!noteFilename) return false;

        try {
            const data = {
                title: metadata?.title || 'Sense títol',
                content: nextText,
                metadata: metadata || {},
            };
            await axios.patch(`/api/vault/pages/${noteFilename}`, data);
            if (onUpdate) onUpdate(data.content, { metadata: data.metadata, title: data.title });
            if (onRefreshNotes) onRefreshNotes();
            if (!silent) toast.success('Markdown desat');
            return true;
        } catch (err) {
            if (!silent) toast.error('Error desant Markdown');
            return false;
        }
    }, [noteFilename, metadata, onUpdate, onRefreshNotes]);

    useEffect(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            void saveMarkdown(markdownText);
        }, 900);

        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [markdownText, saveMarkdown]);

    const handleForceSave = useCallback(async () => {
        await saveMarkdown(markdownText, { silent: false });
    }, [markdownText, saveMarkdown]);

    return (
        <div className="px-10 py-6">
            <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/70">Mode Markdown (codi)</div>
                <button
                    onClick={handleForceSave}
                    className="btn btn-gnosi-primary px-3 py-1.5 text-[10px] font-bold"
                    title="Cmd/Ctrl+S"
                >
                    Desar
                </button>
            </div>

            <textarea
                value={markdownText}
                onChange={(e) => setMarkdownText(e.target.value)}
                onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && String(e.key || '').toLowerCase() === 's') {
                        e.preventDefault();
                        void handleForceSave();
                    }
                }}
                spellCheck={false}
                className="w-full min-h-[520px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/20 p-4 font-mono text-sm leading-6 text-[var(--text-primary)] outline-none resize-y focus:border-[var(--gnosi-primary)]/40"
            />

            <div className="mt-2 text-xs text-[var(--text-secondary)]/70">
                Guardat automàtic activat. Drecera: Cmd/Ctrl+S per desar immediatament.
            </div>
        </div>
    );
};

const DashworksJsonEditor = ({ noteFilename, initialContent, metadata, onUpdate, onRefreshNotes, effectiveTheme }) => {
    const [jsonText, setJsonText] = useState(String(initialContent || '{\n  \n}'));
    const [jsonError, setJsonError] = useState('');
    const saveTimerRef = useRef(null);
    const textareaRef = useRef(null);
    const highlightRef = useRef(null);
    const gutterRef = useRef(null);
    const isDarkTheme = effectiveTheme === 'dark';

    const escapeHtml = useCallback((value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'), []);

    const renderJsonHighlight = useCallback((source) => {
        const text = String(source || '');
        let i = 0;
        let html = '';

        const isSpace = (ch) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';

        while (i < text.length) {
            const ch = text[i];

            if (ch === '"') {
                let j = i + 1;
                let escaped = false;
                while (j < text.length) {
                    const c = text[j];
                    if (!escaped && c === '"') break;
                    escaped = !escaped && c === '\\';
                    if (c !== '\\') escaped = false;
                    j += 1;
                }
                const token = text.slice(i, Math.min(j + 1, text.length));
                let k = j + 1;
                while (k < text.length && isSpace(text[k])) k += 1;
                const isKey = text[k] === ':';
                html += `<span class="${isKey ? 'json-key' : 'json-string'}">${escapeHtml(token)}</span>`;
                i = Math.min(j + 1, text.length);
                continue;
            }

            if (ch === '-' || (ch >= '0' && ch <= '9')) {
                const numberMatch = text.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
                if (numberMatch) {
                    const token = numberMatch[0];
                    html += `<span class="json-number">${escapeHtml(token)}</span>`;
                    i += token.length;
                    continue;
                }
            }

            const keywordMatch = text.slice(i).match(/^(true|false|null)\b/);
            if (keywordMatch) {
                const token = keywordMatch[0];
                const cls = token === 'null' ? 'json-null' : 'json-boolean';
                html += `<span class="${cls}">${token}</span>`;
                i += token.length;
                continue;
            }

            if ('{}[],:'.includes(ch)) {
                html += `<span class="json-punct">${escapeHtml(ch)}</span>`;
                i += 1;
                continue;
            }

            html += escapeHtml(ch);
            i += 1;
        }

        return html;
    }, [escapeHtml]);

    useEffect(() => {
        setJsonText(String(initialContent || '{\n  \n}'));
        setJsonError('');
    }, [initialContent, noteFilename]);

    const validateJson = useCallback((value) => {
        try {
            JSON.parse(value);
            setJsonError('');
            return true;
        } catch (err) {
            setJsonError(err?.message || 'JSON invàlid');
            return false;
        }
    }, []);

    const saveJson = useCallback(async (nextText, { silent = true } = {}) => {
        if (!noteFilename) return;
        if (!validateJson(nextText)) {
            if (!silent) toast.error('JSON invàlid, no es pot desar');
            return false;
        }

        try {
            const data = {
                title: metadata?.title || 'Sense títol',
                content: nextText,
                metadata: {
                    ...(metadata || {}),
                    is_dashworks: true,
                    content_format: 'json',
                },
            };
            await axios.patch(`/api/vault/pages/${noteFilename}`, data);
            if (onUpdate) onUpdate(data.content, { metadata: data.metadata, title: data.title });
            if (onRefreshNotes) onRefreshNotes();
            if (!silent) toast.success('JSON desat');
            return true;
        } catch (err) {
            toast.error('Error desant JSON');
            return false;
        }
    }, [noteFilename, metadata, onUpdate, onRefreshNotes, validateJson]);

    useEffect(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            void saveJson(jsonText);
        }, 900);

        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [jsonText, saveJson]);

    const handleFormatJson = () => {
        try {
            const parsed = JSON.parse(jsonText);
            const pretty = JSON.stringify(parsed, null, 2);
            setJsonText(pretty);
            setJsonError('');
            toast.success('JSON formatejat');
        } catch (err) {
            setJsonError(err?.message || 'JSON invàlid');
            toast.error('JSON invàlid, no es pot formatejar');
        }
    };

    const handleForceSave = useCallback(async () => {
        await saveJson(jsonText, { silent: false });
    }, [jsonText, saveJson]);

    const handleFormatAndSave = useCallback(async () => {
        try {
            const parsed = JSON.parse(jsonText);
            const pretty = JSON.stringify(parsed, null, 2);
            setJsonText(pretty);
            setJsonError('');
            await saveJson(pretty, { silent: false });
        } catch (err) {
            setJsonError(err?.message || 'JSON invàlid');
            toast.error('JSON invàlid, no es pot formatejar');
        }
    }, [jsonText, saveJson]);

    const highlightedJson = useMemo(() => renderJsonHighlight(jsonText), [jsonText, renderJsonHighlight]);
    const lineNumbers = useMemo(() => {
        const count = Math.max(1, String(jsonText || '').split('\n').length);
        return Array.from({ length: count }, (_, i) => i + 1).join('\n');
    }, [jsonText]);

    const syncScroll = useCallback(() => {
        if (!textareaRef.current || !highlightRef.current) return;
        highlightRef.current.scrollTop = textareaRef.current.scrollTop;
        highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
        if (gutterRef.current) {
            gutterRef.current.scrollTop = textareaRef.current.scrollTop;
        }
    }, []);

    return (
        <div className="px-10 py-6">
            <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/70">Mode JSON estricte</div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleForceSave}
                        className="btn btn-gnosi-primary px-3 py-1.5 text-[10px] font-bold"
                        title="Cmd/Ctrl+S"
                    >
                        Desar
                    </button>
                    <button
                        onClick={handleFormatJson}
                        className="btn btn-gnosi-primary px-3 py-1.5 text-[10px] font-bold"
                        title="Cmd/Ctrl+Shift+S"
                    >
                        Formatejar JSON
                    </button>
                </div>
            </div>

            <div className="relative w-full min-h-[520px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/20 focus-within:border-[var(--gnosi-primary)]/40 overflow-hidden">
                <pre
                    ref={gutterRef}
                    aria-hidden="true"
                    className="absolute left-0 top-0 bottom-0 m-0 w-14 p-4 pr-2 text-right font-mono text-xs leading-6 overflow-hidden pointer-events-none select-none border-r border-[var(--border-primary)] text-[var(--text-tertiary)]/70"
                >
                    {lineNumbers}
                </pre>
                <pre
                    ref={highlightRef}
                    aria-hidden="true"
                    className="absolute inset-0 m-0 p-4 pl-16 font-mono text-sm leading-6 overflow-auto pointer-events-none select-none text-[var(--text-primary)]"
                    dangerouslySetInnerHTML={{ __html: highlightedJson + '\n' }}
                />
                <textarea
                    ref={textareaRef}
                    value={jsonText}
                    onChange={(e) => {
                        const next = e.target.value;
                        setJsonText(next);
                        validateJson(next);
                    }}
                    onScroll={syncScroll}
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && String(e.key || '').toLowerCase() === 's') {
                            e.preventDefault();
                            if (e.shiftKey) {
                                void handleFormatAndSave();
                            } else {
                                void handleForceSave();
                            }
                        }
                    }}
                    spellCheck={false}
                    className="relative z-10 w-full min-h-[520px] bg-transparent font-mono text-sm leading-6 p-4 pl-16 outline-none resize-y"
                    style={{ color: 'transparent', caretColor: 'var(--text-primary)' }}
                />
            </div>

            <style>{`
                .json-key { color: ${isDarkTheme ? '#7dd3fc' : '#0369a1'}; }
                .json-string { color: ${isDarkTheme ? '#86efac' : '#166534'}; }
                .json-number { color: ${isDarkTheme ? '#fca5a5' : '#b91c1c'}; }
                .json-boolean { color: ${isDarkTheme ? '#c4b5fd' : '#6d28d9'}; }
                .json-null { color: ${isDarkTheme ? '#fcd34d' : '#b45309'}; }
                .json-punct { color: var(--text-secondary); }
            `}</style>

            {jsonError ? (
                <div className="mt-2 text-xs text-[var(--status-error)]">
                    JSON invàlid. No es desa fins que sigui correcte: {jsonError}
                </div>
            ) : (
                <div className="mt-2 text-xs text-[var(--text-secondary)]/70">
                    JSON vàlid. Guardat automàtic activat. Dreceres: Cmd/Ctrl+S (desar), Cmd/Ctrl+Shift+S (formatejar + desar).
                </div>
            )}
        </div>
    );
};

export function EditorInner({ 
    noteFilename, 
    initialContent, 
    metadata, 
    onUpdate, 
    idToTitle, 
    onRefreshNotes, 
    effectiveTheme, 
    contextValue,
    saveStatus,
    setSaveStatus,
    metadataRef
}) {
    const { t } = useTranslation();
    const schema = useMemo(() => {
        const specs = {
            database: createReactBlockSpec({
                type: "database",
                propSchema: { database_table_id: { default: "" }, viewId: { default: "" }, filters: { default: "" }, sort: { default: "" }, search: { default: "" }, visibleProperties: { default: "" }, viewType: { default: "table" } },
                content: "none",
            }, { render: (props) => <InlineDatabase block={props.block} editor={props.editor} /> }),
            transclusion: createReactBlockSpec({
                type: "transclusion",
                propSchema: { target: { default: "" }, alias: { default: "" }, section: { default: "" } },
                content: "none",
            }, { render: (props) => <TransclusionEmbed block={props.block} /> }),
            toggle: createReactBlockSpec({
                type: "toggle",
                propSchema: { backgroundColor: { default: "default" }, textColor: { default: "default" } },
                content: "inline",
            }, { render: (props) => (
                <div className="bn-toggle-container mb-2">
                    <details className="bn-toggle group/toggle">
                        <summary className="cursor-pointer list-none flex items-center gap-1 hover:text-[var(--gnosi-primary)] transition-colors">
                            <div className="p-1 rounded hover:bg-[var(--gnosi-primary)]/10"><ChevronRight size={16} className="transition-transform group-open/toggle:rotate-90 text-[var(--text-tertiary)]" /></div>
                            <div className="flex-1 font-medium" ref={props.contentRef} />
                        </summary>
                        <div className="bn-toggle-content pl-6 pt-2 border-l border-[var(--border-primary)]/10 ml-3" />
                    </details>
                </div>
            ) }),
            wikilink: createReactInlineContentSpec({
                type: "wikilink",
                propSchema: {
                    title: { default: "" },
                    target: { default: "" },
                },
                content: "none",
            }, {
                render: (props) => (
                    <span 
                        className="wikilink-inline text-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary-hover)] underline decoration-[var(--gnosi-primary)]/30 underline-offset-4 cursor-pointer transition-all font-semibold"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (props.inlineContent.props.target) {
                                contextValue.onOpenParallel(props.inlineContent.props.target);
                            }
                        }}
                    >
                        {props.inlineContent.props.title}
                    </span>
                )
            }),
            alert: createReactBlockSpec({
                type: "alert",
                propSchema: {
                    type: { default: "info", values: ["info", "warning", "error", "success"] },
                },
                content: "inline",
            }, {
                render: (props) => (
                    <div className={`bn-alert bn-alert-${props.block.props.type} p-4 rounded-lg flex gap-3 my-4 bg-[var(--bg-secondary)] border-l-4 border-[var(--gnosi-primary)]`}>
                        <div className="flex-1" ref={props.contentRef} />
                    </div>
                )
            })
        };
        const baseSchema = BlockNoteSchema.create({
            blockSpecs: {
                ...defaultBlockSpecs,
                database: { ...specs.database(), group: "bnBlock" },
                transclusion: { ...specs.transclusion(), group: "bnBlock" },
                toggle: { ...specs.toggle(), group: "bnBlock" },
                alert: { ...specs.alert(), group: "bnBlock" },
            },
            inlineContentSpecs: {
                ...defaultInlineContentSpecs,
                wikilink: specs.wikilink,
            },
            styleSpecs: defaultStyleSpecs,
        });
        // Wrap with official multi-column support (adds columnList + column blocks natively)
        return withMultiColumn(baseSchema);
    }, [contextValue]);

    const sanitizeBlocks = useCallback((blocks) => {
        if (!Array.isArray(blocks)) return blocks;
        return blocks.map(block => {
            let sanitizedBlock = { ...block };

            // BlockNote can crash rendering if any block arrives without id.
            if (!sanitizedBlock.id) {
                sanitizedBlock.id = (typeof crypto !== 'undefined' && crypto?.randomUUID)
                    ? crypto.randomUUID()
                    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
            }
            
            // 1. Mapatge de tipus llegat (Notion -> Modern BlockNote)
            if (block.type === 'heading1') {
                sanitizedBlock.type = 'heading';
                sanitizedBlock.props = { ...sanitizedBlock.props, level: 1 };
            } else if (block.type === 'heading2') {
                sanitizedBlock.type = 'heading';
                sanitizedBlock.props = { ...sanitizedBlock.props, level: 2 };
            } else if (block.type === 'heading3') {
                sanitizedBlock.type = 'heading';
                sanitizedBlock.props = { ...sanitizedBlock.props, level: 3 };
            } else if (block.type === 'bulleted_list_item') {
                sanitizedBlock.type = 'bulletListItem';
            } else if (block.type === 'numbered_list_item') {
                sanitizedBlock.type = 'numberedListItem';
            }

            // 2. Eliminar content si el bloc és un dels nostres contenidors estrictes
            if (['columnList', 'column', 'database', 'transclusion'].includes(sanitizedBlock.type)) {
                delete sanitizedBlock.content;
            }
            
            // 3. Regla de seguretat general per a dades de Notion: 
            // Si té content com a array buit i té fills, BlockNote prefereix només els fills
            if (Array.isArray(sanitizedBlock.content) && sanitizedBlock.content.length === 0 && sanitizedBlock.children && sanitizedBlock.children.length > 0) {
                delete sanitizedBlock.content;
            }

            // Recorre recursivament
            if (sanitizedBlock.children) {
                sanitizedBlock.children = sanitizeBlocks(sanitizedBlock.children);
            }
            return sanitizedBlock;
        });
    }, []);

    const [blocks, setBlocks] = useState(null);
    const [isParsing, setIsParsing] = useState(true);
    const linkableNotes = useMemo(() => {
        const titleMap = idToTitle || {};
        const registry = contextValue?.registry || {};
        const reservedIds = new Set([
            ...(registry.tables || []).map((item) => item.id),
            ...(registry.databases || []).map((item) => item.id),
            ...(registry.views || []).map((item) => item.id),
        ]);

        return Object.entries(titleMap)
            .filter(([id, title]) => {
                if (!id || reservedIds.has(id)) return false;
                return typeof title === "string" && title.trim().length > 0;
            })
            .map(([id, title]) => ({ id, title: title.trim() }));
    }, [idToTitle, contextValue]);

    const normalizedLinkableNotes = useMemo(() => {
        const seen = new Set();
        return linkableNotes.filter((note) => {
            const key = `${note.id}::${note.title}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }, [linkableNotes]);

    const formatNoteDisambiguator = useCallback((noteId) => {
        const id = String(noteId || '').trim();
        if (!id) return 'sense-id';
        if (id.length <= 14) return id;
        return `${id.slice(0, 8)}...${id.slice(-4)}`;
    }, []);

    const editor = useCreateBlockNote({
        schema,
        initialContent: blocks || undefined,
        dropCursor: multiColumnDropCursor,
    });

    const initializedNoteRef = useRef('');

    useEffect(() => {
        let cancelled = false;
        const activeEditor = editor;

        const loadInitialContent = async () => {
            if (!initialContent) {
                if (!cancelled) {
                    setIsParsing(false);
                }
                return;
            }

            const currentNoteId = String(noteFilename || '');
            const alreadyInitializedSameNote = initializedNoteRef.current === currentNoteId;
            const hasEditorContent = Array.isArray(editor?.document)
                ? editor.document.some((block) => ((block?.content?.length ?? 0) > 0) || ((block?.children?.length ?? 0) > 0))
                : false;

            // Avoid re-initializing while typing in the same note; this can reset scroll/cursor.
            if (alreadyInitializedSameNote && hasEditorContent) {
                if (!cancelled) setIsParsing(false);
                return;
            }

            try {
                const parsedBlocks = await richMarkdownToBlocks(initialContent, editor);
                if (cancelled || activeEditor !== editor) return;

                if (parsedBlocks) {
                    const sanitized = sanitizeBlocks(parsedBlocks);
                    setBlocks(sanitized);
                    initializedNoteRef.current = currentNoteId;

                    // Si l'editor ja està creat, aprofitem per injectar-los
                    const currentDoc = Array.isArray(editor?.document)
                        ? editor.document.filter((block) => block?.id)
                        : [];
                    const isTriviallyEmpty = currentDoc.length <= 1 && ((currentDoc[0]?.content?.length ?? 0) === 0);

                    if (editor && isTriviallyEmpty && sanitized.length > 0) {
                        editor.replaceBlocks(currentDoc, sanitized);
                    }
                }
            } catch (e) {
                if (!cancelled) {
                    console.error("Error carregant contingut inicial:", e);
                }
            } finally {
                if (!cancelled) {
                    setIsParsing(false);
                }
            }
        };
        loadInitialContent();

        return () => {
            cancelled = true;
        };
    }, [initialContent, noteFilename, editor, sanitizeBlocks]);

    const [editorReady, setEditorReady] = useState(false);
    useEffect(() => { if (editor) { const timer = setTimeout(() => setEditorReady(true), 100); return () => clearTimeout(timer); } }, [editor]);

    const headingCacheRef = useRef(new Map());
    const headingInFlightRef = useRef(new Map());

    const extractHeadingsFromMarkdown = useCallback((markdown) => {
        const text = String(markdown || '');
        const noCodeBlocks = text.replace(/```[\s\S]*?```/g, '');
        const lines = noCodeBlocks.split('\n');
        const parentStack = [];
        const seen = new Set();
        const headings = [];

        for (const line of lines) {
            const heading = parseMarkdownHeading(line);
            if (!heading) continue;

            parentStack[heading.level - 1] = heading.title;
            parentStack.length = heading.level;
            const path = parentStack.slice(0, Math.max(0, heading.level - 1)).join(' > ');
            const key = `${heading.level}::${path.toLowerCase()}::${heading.title.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);

            headings.push({
                title: heading.title,
                level: heading.level,
                path,
                kind: 'heading',
            });

            const blockMatch = String(line || '').match(/(?:^|\s)\^([a-zA-Z0-9_-]+)\s*$/);
            if (blockMatch?.[1]) {
                const blockId = String(blockMatch[1] || '').trim();
                const blockKey = `block::${blockId.toLowerCase()}`;
                if (!seen.has(blockKey)) {
                    seen.add(blockKey);
                    const preview = String(line || '').replace(/\s*\^[a-zA-Z0-9_-]+\s*$/, '').trim();
                    headings.push({
                        title: `^${blockId}`,
                        level: 0,
                        path: heading.title,
                        kind: 'block',
                        preview,
                    });
                }
            }
        }

        // Also support orphan block IDs in plain paragraphs.
        for (const line of lines) {
            const blockMatch = String(line || '').match(/(?:^|\s)\^([a-zA-Z0-9_-]+)\s*$/);
            if (!blockMatch?.[1]) continue;
            const blockId = String(blockMatch[1] || '').trim();
            const blockKey = `block::${blockId.toLowerCase()}`;
            if (seen.has(blockKey)) continue;
            seen.add(blockKey);
            const preview = String(line || '').replace(/\s*\^[a-zA-Z0-9_-]+\s*$/, '').trim();
            headings.push({
                title: `^${blockId}`,
                level: 0,
                path: '',
                kind: 'block',
                preview,
            });
        }

        return headings;
    }, []);

    const getNoteHeadings = useCallback(async (noteId) => {
        const safeId = String(noteId || '').trim();
        if (!safeId) return [];

        if (headingCacheRef.current.has(safeId)) {
            return headingCacheRef.current.get(safeId) || [];
        }

        if (headingInFlightRef.current.has(safeId)) {
            return await headingInFlightRef.current.get(safeId);
        }

        const request = (async () => {
            try {
                const response = await axios.get(`/api/vault/pages/${encodeURIComponent(safeId)}`);
                const headings = extractHeadingsFromMarkdown(response?.data?.content || '');
                headingCacheRef.current.set(safeId, headings);
                return headings;
            } catch {
                headingCacheRef.current.set(safeId, []);
                return [];
            } finally {
                headingInFlightRef.current.delete(safeId);
            }
        })();

        headingInFlightRef.current.set(safeId, request);
        return await request;
    }, [extractHeadingsFromMarkdown]);

    const saveTimerRef = useRef(null);
    const handleSave = useCallback(async () => {
        if (!noteFilename || !editor || isParsing || !editorReady) return;

        try {
            setSaveStatus('saving');
            const markdownContent = blocksToRichMarkdown(editor.document);
            const currentMetadata = metadataRef.current;
            
            const data = { 
                title: currentMetadata?.title || "Sense títol", 
                content: markdownContent, 
                metadata: currentMetadata 
            };

            // Register in global in-flight saves before starting request
            const savePromise = axios.patch(`/api/vault/pages/${noteFilename}`, data);
            
            inFlightSaves.set(noteFilename, {
                content: markdownContent,
                metadata: currentMetadata,
                promise: savePromise,
                timestamp: Date.now()
            });

            await savePromise;
            
            // If another save hasn't started for this file, clear from registry
            const currentRecord = inFlightSaves.get(noteFilename);
            if (currentRecord && currentRecord.promise === savePromise) {
                inFlightSaves.delete(noteFilename);
            }

            setSaveStatus('saved');
            if (onUpdate) onUpdate(noteFilename, data);
            
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            
            // Revert specifically to idle after a while so it doesn't stay "Saved" forever
            setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 3000);
        } catch (err) { 
            console.error("Error al desar automàticament:", err);
            setSaveStatus('error');
            toast.error("Error al desar automàticament");
        }
    }, [noteFilename, editor, isParsing, editorReady, onUpdate]);

    const expandBracketRange = (text, start, end) => {
        const source = String(text || '');
        let safeStart = Math.max(0, Number(start) || 0);
        let safeEnd = Math.max(safeStart, Number(end) || safeStart);

        // Consume up to 2 leading brackets
        let leftExtra = 0;
        while (safeStart > 0 && source[safeStart - 1] === '[' && leftExtra < 2) {
            safeStart -= 1;
            leftExtra += 1;
        }

        // Consume up to 2 trailing brackets
        let rightExtra = 0;
        while (safeEnd < source.length && source[safeEnd] === ']' && rightExtra < 2) {
            safeEnd += 1;
            rightExtra += 1;
        }

        return { start: safeStart, end: safeEnd };
    };

    const replaceTokenInInlineArray = (inlineItems, rangeStart, rangeEnd, replacementItem) => {
        if (!Array.isArray(inlineItems)) return null;
        let cursor = 0;
        let injected = false;
        const next = [];

        for (const item of inlineItems) {
            const text = typeof item?.text === 'string' ? item.text : '';
            const itemStart = cursor;
            const itemEnd = cursor + (text ? text.length : 1); // Generic object placeholder length

            if (!text) {
                // If the object is outside the range to replace, keep it.
                if (itemEnd <= rangeStart || itemStart >= rangeEnd) {
                    next.push(item);
                } else if (!injected) {
                    // If the object was in the range, replace it with our link
                    next.push(replacementItem);
                    injected = true;
                }
                cursor = itemEnd;
                continue;
            }

            const noOverlap = itemEnd <= rangeStart || itemStart >= rangeEnd;
            if (noOverlap) {
                next.push(item);
                cursor = itemEnd;
                continue;
            }

            // Text overlap logic
            const leftCut = Math.max(0, rangeStart - itemStart);
            const rightCut = Math.max(0, itemEnd - rangeEnd);
            const leftText = text.slice(0, leftCut);
            const rightText = text.slice(text.length - rightCut);

            if (leftText) next.push({ ...item, text: leftText });
            if (!injected) {
                next.push(replacementItem);
                injected = true;
            }
            if (rightText) next.push({ ...item, text: rightText });

            cursor = itemEnd;
        }

        return injected ? next : null;
    };

    const insertWikiLink = useCallback(async (noteTitle, section = '', noteId = '', replaceQuery = '') => {
        if (!editor) return;
        const safeTitle = String(noteTitle || '').trim();
        const safeId = String(noteId || '').trim();
        if (!safeTitle) return;

        const wikilinkItem = {
            type: 'wikilink',
            props: {
                title: section ? `${safeTitle} > ${section}` : safeTitle,
                target: safeId || safeTitle,
                section: section || "",
            }
        };

        const cursor = editor.getTextCursorPosition?.();
        const currentBlock = cursor?.block;

        if (!currentBlock) {
            editor.insertInlineContent([wikilinkItem]);
            return;
        }

        const inline = Array.isArray(currentBlock.content) ? currentBlock.content : [];
        const plainText = inline.map((item) => item.text || '').join('');
        const cursorIndex = cursor.index;
        
        // Strategy: find the best match for the query that likely triggered the insertion,
        // searching backwards from the current cursor position.
        const rawQuery = String(replaceQuery || '').trim();
        const searchTerms = [rawQuery, `[[${rawQuery}`, `[${rawQuery}`].filter(t => t.length > 0);

        let matchStart = -1;
        let matchedToken = '';

        for (const token of searchTerms) {
            const idx = plainText.lastIndexOf(token, cursorIndex);
            if (idx > matchStart) {
                matchStart = idx;
                matchedToken = token;
            }
        }

        // Final heuristic for pending links (last [[ or [ before cursor)
        if (matchStart === -1) {
            const lastDouble = plainText.lastIndexOf('[[', cursorIndex);
            const lastSingle = plainText.lastIndexOf('[', cursorIndex);
            matchStart = lastDouble >= 0 ? lastDouble : lastSingle;
            if (matchStart >= 0) {
                matchedToken = plainText.substring(matchStart, cursorIndex);
            }
        }

        if (matchStart >= 0) {
            try {
                let replaceStart = matchStart;
                let replaceEnd = matchStart + matchedToken.length;

                // Atomic replacement of query + brackets
                const expanded = expandBracketRange(plainText, replaceStart, replaceEnd);
                const inlineReplaced = replaceTokenInInlineArray(inline, expanded.start, expanded.end, wikilinkItem);
                
                if (inlineReplaced) {
                    editor.updateBlock(currentBlock, { content: inlineReplaced });
                    // Ensure save reflects the modification
                    if (typeof handleSave === 'function') setTimeout(() => handleSave(), 100);
                    return;
                }
            } catch (e) {
                console.warn("Atomic replacement failed", e);
            }
        }

        // Fallback: standard insertion at cursor if replacement logic fails
        editor.insertInlineContent([wikilinkItem]);
        if (typeof handleSave === 'function') setTimeout(() => handleSave(), 100);
    }, [editor, handleSave]);


    const insertTransclusion = useCallback((targetId, alias = '', section = '') => {
        if (!editor) return;

        const safeTarget = String(targetId || '').trim();
        if (!safeTarget) return;

        const safeAlias = String(alias || '').trim();
        const safeSection = String(section || '').trim();
        const cursor = editor.getTextCursorPosition?.();
        const currentBlock = cursor?.block;
        const inline = currentBlock?.content;

        if (!currentBlock) {
            const anchor = editor.document?.[editor.document.length - 1];
            if (anchor) {
                editor.insertBlocks(
                    [{ type: 'transclusion', props: { target: safeTarget, alias: safeAlias, section: safeSection } }],
                    anchor,
                    'after',
                );
            }
            return;
        }

        if (Array.isArray(inline)) {
            const plainText = inline.map((item) => item.text || '').join('');
            const lastDouble = plainText.lastIndexOf('![[');
            const lastSingle = plainText.lastIndexOf('!');
            const start = lastDouble >= 0 ? lastDouble : lastSingle;
            
            if (start >= 0) {
                try {
                    const textBefore = plainText.slice(0, start).trim();
                    
                    if (!textBefore) {
                        editor.replaceBlocks([currentBlock], [{
                            type: 'transclusion',
                            props: { target: safeTarget, alias: safeAlias, section: safeSection },
                        }]);
                    } else {
                        const updatedContent = plainText.slice(0, start).trim();
                        editor.updateBlock(currentBlock, {
                            content: [{ type: 'text', text: updatedContent, styles: {} }]
                        });
                        editor.insertBlocks(
                            [{ type: 'transclusion', props: { target: safeTarget, alias: safeAlias, section: safeSection } }],
                            currentBlock,
                            'after'
                        );
                    }
                    return;
                } catch (error) {
                    // Fallback to insertion below.
                }
            }
        }

        const anchor = currentBlock || editor.document[editor.document.length - 1];
        editor.insertBlocks(
            [{ type: 'transclusion', props: { target: safeTarget, alias: safeAlias, section: safeSection } }],
            anchor,
            'after',
        );
    }, [editor]);

    const normalizePendingLinkTitle = useCallback((rawTitle) => {
        return String(rawTitle || '')
            .replace(/^\[\[/, '')
            .split('|')[0]
            .trim();
    }, []);

    const createMissingPageAndInsertLink = useCallback(async ({ rawTitle, tableId = null, mode = 'wiki', section = '' }) => {
        const safeTitle = normalizePendingLinkTitle(rawTitle);
        const safeSection = String(section || '').trim();
        if (!safeTitle) return;

        const baseMetadata = { title: safeTitle };
        if (tableId) {
            baseMetadata.table_id = tableId;
            baseMetadata.database_table_id = tableId;
        }

        try {
            const response = await axios.post('/api/vault/pages', {
                title: safeTitle,
                content: '',
                is_database: false,
                metadata: baseMetadata,
            });

            const createdId = String(response?.data?.id || '').trim();

            if (mode === 'transclusion') {
                insertTransclusion(createdId || safeTitle, safeTitle, safeSection);
            } else {
                await insertWikiLink(safeTitle, safeSection, createdId);
            }

            // Delay sidebar refresh so editor autosave can persist the newly inserted link first.
            if (onRefreshNotes) {
                window.setTimeout(() => {
                    try {
                        onRefreshNotes();
                    } catch {
                        // ignore refresh failures
                    }
                }, 1400);
            }

            toast.success(`Pagina creada: ${safeTitle}`);
        } catch (error) {
            console.error('Error creant pagina des del wikilink:', error);
            toast.error('No s\'ha pogut crear la pagina');
        }
    }, [insertTransclusion, insertWikiLink, normalizePendingLinkTitle, onRefreshNotes]);

    useEffect(() => {
        if (!editor || isParsing) return;
        const sub = editor.onChange(() => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => handleSave(), 700);
        });
        return () => { 
            if (typeof sub === 'function') sub(); 
            else if (sub && sub.remove) sub.remove(); 
            
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
                
                // Flush save on unmount - move to in-flight registry
                const markdownContent = blocksToRichMarkdown(editor.document);
                const currentMetadata = metadataRef.current;
                const data = { 
                    title: currentMetadata?.title || "Sense títol", 
                    content: markdownContent, 
                    metadata: currentMetadata 
                };

                const savePromise = axios.patch(`/api/vault/pages/${noteFilename}`, data);
                
                inFlightSaves.set(noteFilename, {
                    content: markdownContent,
                    metadata: currentMetadata,
                    promise: savePromise,
                    timestamp: Date.now()
                });

                // Fire and forget, but keep in registry
                savePromise.finally(() => {
                    const currentRecord = inFlightSaves.get(noteFilename);
                    if (currentRecord && currentRecord.promise === savePromise) {
                        // Keep the data in registry for a short grace period (1s) to prevent race conditions 
                        // with concurrent fetch operations in the dashboard
                        setTimeout(() => {
                           if (inFlightSaves.get(noteFilename)?.promise === savePromise) {
                               inFlightSaves.delete(noteFilename);
                           }
                        }, 1000);
                    }
                }).catch(e => console.error("Unmount save failed", e));
            }
        };
    }, [editor, isParsing, handleSave]);

    if (isParsing || !editorReady) return <div className="flex items-center justify-center h-[500px] text-[var(--text-tertiary)]/60"><Loader2 className="animate-spin mr-2" size={20} /> Carregant editor...</div>;

    return (
        <VaultEditorContext.Provider value={contextValue}>
            <style>{`
                /* === Editor layout and surface === */
                .bn-editor {
                    padding-left: 0 !important;
                    padding-right: 0 !important;
                    background: transparent !important;
                }
                .bn-container,
                .bn-mantine,
                .bn-root {
                    background: transparent !important;
                }

                /* === 1. Heading sizes: mai més grans que el títol de la pàgina (text-4xl ≈ 2.25rem) === */
                .bn-editor [data-content-type="heading"] h1,
                .bn-editor .bn-block-content[data-content-type="heading"] [data-level="1"] h1,
                .bn-editor h1.bn-inline-content {
                    font-size: 1.75rem !important;
                    line-height: 1.3 !important;
                    font-weight: 700 !important;
                    margin: 0.6em 0 0.3em !important;
                }
                .bn-editor [data-content-type="heading"] h2,
                .bn-editor .bn-block-content[data-content-type="heading"] [data-level="2"] h2,
                .bn-editor h2.bn-inline-content {
                    font-size: 1.4rem !important;
                    line-height: 1.3 !important;
                    font-weight: 600 !important;
                    margin: 0.5em 0 0.25em !important;
                }
                .bn-editor [data-content-type="heading"] h3,
                .bn-editor .bn-block-content[data-content-type="heading"] [data-level="3"] h3,
                .bn-editor h3.bn-inline-content {
                    font-size: 1.15rem !important;
                    line-height: 1.4 !important;
                    font-weight: 600 !important;
                    margin: 0.4em 0 0.2em !important;
                }

                /* === 2. Background colors: only on text, not full block === */
                /* Override BlockNote's 3-selector system:
                   1. [data-background-color=X] on .bn-block-content
                   2. .bn-block:has(>.bn-block-content[data-background-color=X]) on parent
                   3. [data-style-type=backgroundColor][data-value=X] on inline spans */
                .bn-editor .bn-block:has(> .bn-block-content[data-background-color]:not([data-background-color="default"])) {
                    background-color: transparent !important;
                }
                .bn-editor .bn-block-content[data-background-color]:not([data-background-color="default"]) {
                    background-color: transparent !important;
                }
                .bn-editor [data-background-color]:not([data-background-color="default"]):not(.bn-block):not(.bn-block-content) {
                    background-color: transparent !important;
                }
                /* Apply background only on inline-content (the text element) */
                .bn-editor .bn-block-content[data-background-color="gray"] .bn-inline-content,
                .bn-editor .bn-block:has(> .bn-block-content[data-background-color="gray"]) .bn-inline-content { background-color: #ebeced !important; display: inline !important; padding: 2px 6px !important; border-radius: 4px !important; }
                .bn-editor .bn-block-content[data-background-color="brown"] .bn-inline-content,
                .bn-editor .bn-block:has(> .bn-block-content[data-background-color="brown"]) .bn-inline-content { background-color: #e9e5e3 !important; display: inline !important; padding: 2px 6px !important; border-radius: 4px !important; }
                .bn-editor .bn-block-content[data-background-color="red"] .bn-inline-content,
                .bn-editor .bn-block:has(> .bn-block-content[data-background-color="red"]) .bn-inline-content { background-color: #fbe4e4 !important; display: inline !important; padding: 2px 6px !important; border-radius: 4px !important; }
                .bn-editor .bn-block-content[data-background-color="orange"] .bn-inline-content,
                .bn-editor .bn-block:has(> .bn-block-content[data-background-color="orange"]) .bn-inline-content { background-color: #f6e9d9 !important; display: inline !important; padding: 2px 6px !important; border-radius: 4px !important; }
                .bn-editor .bn-block-content[data-background-color="yellow"] .bn-inline-content,
                .bn-editor .bn-block:has(> .bn-block-content[data-background-color="yellow"]) .bn-inline-content { background-color: #fbf3db !important; display: inline !important; padding: 2px 6px !important; border-radius: 4px !important; }
                .bn-editor .bn-block-content[data-background-color="green"] .bn-inline-content,
                .bn-editor .bn-block:has(> .bn-block-content[data-background-color="green"]) .bn-inline-content { background-color: #ddedea !important; display: inline !important; padding: 2px 6px !important; border-radius: 4px !important; }
                .bn-editor .bn-block-content[data-background-color="blue"] .bn-inline-content,
                .bn-editor .bn-block:has(> .bn-block-content[data-background-color="blue"]) .bn-inline-content { background-color: #ddebf1 !important; display: inline !important; padding: 2px 6px !important; border-radius: 4px !important; }
                .bn-editor .bn-block-content[data-background-color="purple"] .bn-inline-content,
                .bn-editor .bn-block:has(> .bn-block-content[data-background-color="purple"]) .bn-inline-content { background-color: #eae4f2 !important; display: inline !important; padding: 2px 6px !important; border-radius: 4px !important; }
                .bn-editor .bn-block-content[data-background-color="pink"] .bn-inline-content,
                .bn-editor .bn-block:has(> .bn-block-content[data-background-color="pink"]) .bn-inline-content { background-color: #f4dfeb !important; display: inline !important; padding: 2px 6px !important; border-radius: 4px !important; }

                /* === 3. Column layout (via @blocknote/xl-multi-column) === */
                /* The package handles flex layout natively. We only add subtle Gnosi styling. */
                [data-content-type="columnList"] {
                    gap: 1.5rem !important;
                }
                [data-content-type="column"] + [data-content-type="column"] {
                    border-left: 1px dashed rgba(var(--gnosi-primary-rgb), 0.1);
                    padding-left: 1.5rem !important;
                }

                /* === 4. Links: visible and differentiated by destination === */
                .bn-editor .bn-inline-content a,
                .bn-editor .bn-block-content a,
                .bn-container .bn-inline-content a,
                .bn-container .bn-block-content a {
                    font-weight: 600 !important;
                    text-decoration-line: underline !important;
                    text-decoration-thickness: 1.5px !important;
                    text-underline-offset: 2px !important;
                    transition: color 120ms ease, text-decoration-color 120ms ease;
                }
                .bn-editor .bn-inline-content a:hover,
                .bn-editor .bn-block-content a:hover,
                .bn-container .bn-inline-content a:hover,
                .bn-container .bn-block-content a:hover {
                    text-decoration-thickness: 2px !important;
                }

                /* Internal app links */
                .bn-editor .bn-inline-content a[href^="/"],
                .bn-editor .bn-inline-content a[href^="#"],
                .bn-editor .bn-inline-content a[href*="localhost:5173"],
                .bn-editor .bn-inline-content a[href*="127.0.0.1:5173"],
                .bn-editor .bn-inline-content a[href*="/vault/page/"],
                .bn-container .bn-inline-content a[href^="/"],
                .bn-container .bn-inline-content a[href^="#"],
                .bn-container .bn-inline-content a[href*="localhost:5173"],
                .bn-container .bn-inline-content a[href*="127.0.0.1:5173"],
                .bn-container .bn-inline-content a[href*="/vault/page/"] {
                    color: var(--gnosi-primary) !important;
                    text-decoration-color: color-mix(in srgb, var(--gnosi-primary) 70%, transparent) !important;
                }

                /* Vault wiki links: extra visual identity over regular internal links */
                .bn-editor .bn-inline-content a[href*="/vault/page/"],
                .bn-editor .bn-inline-content a[href*="localhost:5173/vault/page/"],
                .bn-editor .bn-inline-content a[href*="127.0.0.1:5173/vault/page/"],
                .bn-container .bn-inline-content a[href*="/vault/page/"],
                .bn-container .bn-inline-content a[href*="localhost:5173/vault/page/"],
                .bn-container .bn-inline-content a[href*="127.0.0.1:5173/vault/page/"] {
                    color: #38bdf8 !important;
                    background: color-mix(in srgb, #38bdf8 14%, transparent) !important;
                    border-radius: 6px !important;
                    padding: 0 0.2em !important;
                    text-decoration-style: solid !important;
                    text-decoration-color: color-mix(in srgb, #38bdf8 75%, transparent) !important;
                }

                /* Local bridge links (localhost:4771) */
                .bn-editor .bn-inline-content a[href*="localhost:4771"],
                .bn-container .bn-inline-content a[href*="localhost:4771"] {
                    color: #22c55e !important;
                    text-decoration-style: dashed !important;
                    text-decoration-color: color-mix(in srgb, #22c55e 70%, transparent) !important;
                }

                /* External web links */
                .bn-editor .bn-inline-content a[href^="http"]:not([href*="localhost:5173"]):not([href*="127.0.0.1:5173"]):not([href*="localhost:4771"]),
                .bn-container .bn-inline-content a[href^="http"]:not([href*="localhost:5173"]):not([href*="127.0.0.1:5173"]):not([href*="localhost:4771"]) {
                    color: #f59e0b !important;
                    text-decoration-style: wavy !important;
                    text-decoration-color: color-mix(in srgb, #f59e0b 70%, transparent) !important;
                }
                .bn-editor .bn-inline-content a[href^="http"]:not([href*="localhost:5173"]):not([href*="127.0.0.1:5173"]):not([href*="localhost:4771"])::after,
                .bn-container .bn-inline-content a[href^="http"]:not([href*="localhost:5173"]):not([href*="127.0.0.1:5173"]):not([href*="localhost:4771"])::after {
                    content: " ↗";
                    font-size: 0.8em;
                    opacity: 0.8;
                }

                /* === Toggle marker === */
                .bn-toggle summary::-webkit-details-marker { display: none; }
            `}</style>
            <BlockNoteView editor={editor} slashMenu={false} theme={effectiveTheme}>
                <SuggestionMenuController
                    triggerCharacter="/"
                    getItems={async (query) => {
                        if (!editor) return [];
                        const defaultItems = getDefaultReactSlashMenuItems(editor);
                        const vaultItems = buildSlashCommandCatalog({ allTables: contextValue?.allTables || [], editor }).map(item => ({
                            title: item.title,
                            onItemClick: item.onItemClick,
                            aliases: item.aliases,
                            group: item.group || "Base de dades",
                            icon: <Database size={18} />,
                            subtext: item.subtext || item.description,
                        }));
                        const layoutItems = buildColumnLayoutCatalog({ editor }).map(item => ({
                            title: item.title, onItemClick: item.onItemClick, aliases: item.aliases, group: item.group, icon: <Columns size={18} />, subtext: item.subtext
                        }));
                        const quickLinkItems = [
                            {
                                title: "Enllac extern",
                                onItemClick: () => editor.insertInlineContent("[Text de l'enllac](https://)"),
                                aliases: ["link", "url", "web", "external"],
                                group: "Enllacos",
                                icon: <ExternalLink size={18} />,
                                subtext: "Format markdown [Text](https://)",
                            },
                            {
                                title: "Enllac intern (wiki)",
                                onItemClick: () => insertWikiLink("Nom de nota"),
                                aliases: ["wiki", "internal", "nota", "[[]]"],
                                group: "Enllacos",
                                icon: <MessageSquare size={18} />,
                                subtext: "Insereix format [[Nota]]",
                            },
                            {
                                title: "Enllac a apartat",
                                onItemClick: () => editor.insertInlineContent("[[Nom de nota#Apartat]]"),
                                aliases: ["wiki section", "apartat", "anchor", "#"],
                                group: "Enllacos",
                                icon: <MessageSquare size={18} />,
                                subtext: "Format [[Nota#Apartat]]",
                            },
                            {
                                title: "Enllac wiki amb alias",
                                onItemClick: () => editor.insertInlineContent("[[Nom de nota#Apartat|Alias]]"),
                                aliases: ["wiki alias", "display", "etiqueta"],
                                group: "Enllacos",
                                icon: <MessageSquare size={18} />,
                                subtext: "Format [[Nota#Apartat|Alias]]",
                            },
                            {
                                title: "Transclusio Obsidian",
                                onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, {
                                    type: 'transclusion',
                                    props: { target: '', alias: '', section: '' },
                                }),
                                aliases: ["transclusion", "embed", "![[", "obsidian"],
                                group: "Enllacos",
                                icon: <Maximize2 size={18} />,
                                subtext: "Insereix bloc ![[Nota]]",
                            },
                            {
                                title: "Transclusio d'apartat",
                                onItemClick: () => editor.insertInlineContent("![[Nom de nota#Apartat]]"),
                                aliases: ["transclusion section", "embed section", "![[#"],
                                group: "Enllacos",
                                icon: <Maximize2 size={18} />,
                                subtext: "Format ![[Nota#Apartat]]",
                            },
                            {
                                title: "Transclusio amb alias",
                                onItemClick: () => editor.insertInlineContent("![[Nom de nota#Apartat|Alias]]"),
                                aliases: ["transclusion alias", "embed alias"],
                                group: "Enllacos",
                                icon: <Maximize2 size={18} />,
                                subtext: "Format ![[Nota#Apartat|Alias]]",
                            },
                        ];
                        const allItems = [...defaultItems, ...vaultItems, ...layoutItems, ...quickLinkItems];
                        if (!query) return allItems.slice(0, 12);
                        const lowerQuery = String(query || "").toLowerCase();
                        return allItems.filter(item => {
                            const title = String(item?.title || "").toLowerCase();
                            const aliases = Array.isArray(item?.aliases) ? item.aliases : [];
                            return title.includes(lowerQuery)
                                || aliases.some(alias => String(alias || "").toLowerCase().includes(lowerQuery));
                        });
                    }}
                />
                <SuggestionMenuController
                    triggerCharacter="["
                    getItems={async (query) => {
                        if (!editor) return [];
                        const rawQuery = String(query || "").trim();
                        const [noteQuery, sectionQueryRaw = ''] = rawQuery.split('#');
                        const pendingTitle = normalizePendingLinkTitle(noteQuery);
                        const search = pendingTitle.toLowerCase();
                        const sectionQuery = sectionQueryRaw.trim();
                        const filteredNotes = normalizedLinkableNotes.filter(note => {
                            if (!search) return true;
                            const noteTitle = String(note.title || "").toLowerCase();
                            const noteId = String(note.id || "").toLowerCase();
                            return noteTitle.includes(search) || noteId.includes(search);
                        }).slice(0, 20);

                        const titleCount = new Map();
                        filteredNotes.forEach((note) => {
                            const key = note.title;
                            titleCount.set(key, (titleCount.get(key) || 0) + 1);
                        });

                        const hasExactMatch = pendingTitle
                            ? normalizedLinkableNotes.some((note) => {
                                const noteTitle = String(note.title || '').toLowerCase();
                                const noteId = String(note.id || '').toLowerCase();
                                const wanted = pendingTitle.toLowerCase();
                                return noteTitle === wanted || noteId === wanted;
                            })
                            : true;

                        const tableOptions = (contextValue?.allTables || [])
                            .filter((table) => table?.id && String(table?.id).trim().toLowerCase() !== 'wiki');

                        const createItems = (!hasExactMatch && pendingTitle)
                            ? [
                                {
                                    title: `Crear al Wiki: ${pendingTitle}`,
                                    aliases: [pendingTitle, 'crear', 'wiki', 'nova pagina'],
                                    group: 'Crear pagina',
                                    icon: <Plus size={18} />,
                                    subtext: `Crear i enllacar [[${pendingTitle}${sectionQuery ? `#${sectionQuery}` : ''}]]`,
                                    onItemClick: () => createMissingPageAndInsertLink({
                                        rawTitle: pendingTitle,
                                        tableId: null,
                                        mode: 'wiki',
                                        section: sectionQuery,
                                    }),
                                },
                                ...tableOptions.map((table) => ({
                                    title: `Crear a taula ${table.name}: ${pendingTitle}`,
                                    aliases: [pendingTitle, 'crear', 'taula', table.name || table.id],
                                    group: 'Crear pagina',
                                    icon: <Database size={18} />,
                                    subtext: `Crear registre a ${table.name}`,
                                    onItemClick: () => createMissingPageAndInsertLink({
                                        rawTitle: pendingTitle,
                                        tableId: table.id,
                                        mode: 'wiki',
                                        section: sectionQuery,
                                    }),
                                })),
                            ]
                            : [];

                        if (rawQuery.includes('#')) {
                            const headingItems = [];
                            for (const note of filteredNotes.slice(0, 5)) {
                                const headings = await getNoteHeadings(note.id);
                                const filteredHeadings = headings.filter((h) => {
                                    if (!sectionQuery) return true;
                                    const title = String(h?.title || '').toLowerCase();
                                    const path = String(h?.path || '').toLowerCase();
                                    const query = sectionQuery.toLowerCase();
                                    return title.includes(query) || path.includes(query);
                                });

                                for (const heading of filteredHeadings.slice(0, 8)) {
                                    const headingTitle = String(heading?.title || '').trim();
                                    if (!headingTitle) continue;

                                    const headingPath = String(heading?.path || '').trim();
                                    const level = Number(heading?.level || 1);
                                    const isBlockRef = String(heading?.kind || '') === 'block' || headingTitle.startsWith('^');
                                    const blockPreview = String(heading?.preview || '').trim();
                                    const hierarchy = isBlockRef
                                        ? (headingPath ? `${headingPath} > ${headingTitle}` : headingTitle)
                                        : (headingPath ? `${headingPath} > ${headingTitle}` : headingTitle);
                                    const displayTitle = titleCount.get(note.title) > 1
                                        ? `${note.title} (${formatNoteDisambiguator(note.id)}) # ${hierarchy}`
                                        : `${note.title} # ${hierarchy}`;

                                    headingItems.push({
                                        title: `${isBlockRef ? 'B' : `H${level}`} · ${displayTitle}`,
                                        aliases: [note.id, note.title, headingTitle, hierarchy, blockPreview, 'wiki', 'section', 'block'],
                                        group: 'Enllacos interns',
                                        icon: <MessageSquare size={18} />,
                                        subtext: isBlockRef
                                            ? `[[${note.title}#${headingTitle}]]`
                                            : `[[${note.title}#${headingTitle}]]`,
                                        onItemClick: () => insertWikiLink(note.title, headingTitle, note.id, rawQuery),
                                    });
                                }
                            }

                            if (headingItems.length > 0) {
                                return [...headingItems.slice(0, 20), ...createItems].slice(0, 30);
                            }
                        }

                        const noteItems = filteredNotes.map(note => ({
                            title: titleCount.get(note.title) > 1 ? `${note.title} (${formatNoteDisambiguator(note.id)})` : note.title,
                            aliases: [note.id, "wiki", "internal"],
                            group: "Enllacos interns",
                            icon: <MessageSquare size={18} />,
                            subtext: note.id,
                            onItemClick: () => insertWikiLink(note.title, sectionQuery, note.id, rawQuery),
                        }));

                        return [...noteItems, ...createItems].slice(0, 30);
                    }}
                />
                <SuggestionMenuController
                    triggerCharacter="!"
                    getItems={async (query) => {
                        if (!editor) return [];
                        const normalized = String(query || '');
                        
                        // Si l'usuari escriu ![[, traiem el prefix per cercar només el títol
                        const rawQuery = normalized.replace(/^\[\[/, '').trim();
                        const [noteQuery, sectionQueryRaw = ''] = rawQuery.split('#');
                        const pendingTitle = normalizePendingLinkTitle(noteQuery);
                        const search = noteQuery.toLowerCase();
                        const sectionQuery = sectionQueryRaw.trim();
                        const filteredNotes = normalizedLinkableNotes.filter((note) => {
                            if (!search) return true;
                            const noteTitle = String(note.title || '').toLowerCase();
                            const noteId = String(note.id || '').toLowerCase();
                            return noteTitle.includes(search) || noteId.includes(search);
                        }).slice(0, 20);

                        const titleCount = new Map();
                        filteredNotes.forEach((note) => {
                            const key = note.title;
                            titleCount.set(key, (titleCount.get(key) || 0) + 1);
                        });

                        const hasExactMatch = pendingTitle
                            ? normalizedLinkableNotes.some((note) => {
                                const noteTitle = String(note.title || '').toLowerCase();
                                const noteId = String(note.id || '').toLowerCase();
                                const wanted = pendingTitle.toLowerCase();
                                return noteTitle === wanted || noteId === wanted;
                            })
                            : true;

                        const tableOptions = (contextValue?.allTables || [])
                            .filter((table) => table?.id && String(table?.id).trim().toLowerCase() !== 'wiki');

                        const createItems = (!hasExactMatch && pendingTitle)
                            ? [
                                {
                                    title: `Crear transclusio al Wiki: ${pendingTitle}`,
                                    aliases: [pendingTitle, 'crear', 'transclusion', 'wiki'],
                                    group: 'Crear pagina',
                                    icon: <Plus size={18} />,
                                    subtext: `Crear i inserir ![[${pendingTitle}${sectionQuery ? `#${sectionQuery}` : ''}]]`,
                                    onItemClick: () => createMissingPageAndInsertLink({
                                        rawTitle: pendingTitle,
                                        tableId: null,
                                        mode: 'transclusion',
                                        section: sectionQuery,
                                    }),
                                },
                                ...tableOptions.map((table) => ({
                                    title: `Crear transclusio a ${table.name}: ${pendingTitle}`,
                                    aliases: [pendingTitle, 'crear', 'transclusion', table.name || table.id],
                                    group: 'Crear pagina',
                                    icon: <Database size={18} />,
                                    subtext: `Crear registre a ${table.name} i inserir transclusio`,
                                    onItemClick: () => createMissingPageAndInsertLink({
                                        rawTitle: pendingTitle,
                                        tableId: table.id,
                                        mode: 'transclusion',
                                        section: sectionQuery,
                                    }),
                                })),
                            ]
                            : [];

                        if (rawQuery.includes('#')) {
                            const headingItems = [];
                            for (const note of filteredNotes.slice(0, 5)) {
                                const headings = await getNoteHeadings(note.id);
                                const filteredHeadings = headings.filter((h) => {
                                    if (!sectionQuery) return true;
                                    const title = String(h?.title || '').toLowerCase();
                                    const path = String(h?.path || '').toLowerCase();
                                    const query = sectionQuery.toLowerCase();
                                    return title.includes(query) || path.includes(query);
                                });

                                for (const heading of filteredHeadings.slice(0, 8)) {
                                    const headingTitle = String(heading?.title || '').trim();
                                    if (!headingTitle) continue;

                                    const headingPath = String(heading?.path || '').trim();
                                    const level = Number(heading?.level || 1);
                                    const isBlockRef = String(heading?.kind || '') === 'block' || headingTitle.startsWith('^');
                                    const blockPreview = String(heading?.preview || '').trim();
                                    const hierarchy = headingPath ? `${headingPath} > ${headingTitle}` : headingTitle;
                                    const displayTitle = titleCount.get(note.title) > 1
                                        ? `${note.title} (${formatNoteDisambiguator(note.id)}) # ${hierarchy}`
                                        : `${note.title} # ${hierarchy}`;

                                    headingItems.push({
                                        title: `${isBlockRef ? 'B' : `H${level}`} · ${displayTitle}`,
                                        aliases: [note.id, note.title, headingTitle, hierarchy, blockPreview, 'transclusion', 'section', 'block'],
                                        group: 'Transclusions',
                                        icon: <Maximize2 size={18} />,
                                        subtext: isBlockRef
                                            ? `![[${note.id}#${headingTitle}]] · ${blockPreview || 'Bloc referenciat'}`
                                            : `![[${note.id}#${headingTitle}]]`,
                                        onItemClick: () => insertTransclusion(note.id, note.title, headingTitle),
                                    });
                                }
                            }

                            if (headingItems.length > 0) {
                                return [...headingItems.slice(0, 20), ...createItems].slice(0, 30);
                            }
                        }

                        const transclusionItems = filteredNotes.map((note) => ({
                            title: titleCount.get(note.title) > 1 ? `${note.title} (${formatNoteDisambiguator(note.id)})` : note.title,
                            aliases: [note.id, 'transclusion', 'embed', '![['],
                            group: 'Transclusions',
                            icon: <Maximize2 size={18} />,
                            subtext: sectionQuery ? `![[${note.id}#${sectionQuery}]]` : `![[${note.id}]]`,
                            onItemClick: () => insertTransclusion(note.id, note.title, sectionQuery),
                        }));

                        return [...transclusionItems, ...createItems].slice(0, 30);
                    }}
                />
            </BlockNoteView>
        </VaultEditorContext.Provider>
    );
};

export function BlockEditor({ noteFilename, initialContent, initialMetadata = {}, onUpdate, allTables = [], onEditSchema, onCreateRecord, onDeletePage = () => {}, onOpenParallel = () => {}, idToTitle = {}, registry = { databases: [], tables: [], views: [] }, onRefreshNotes = () => {}, historyOpenSignal = 0, isCodeView = false }) {
    const { t } = useTranslation();
    const { effectiveTheme } = useTheme();
    const [metadata, setMetadata] = useState(initialMetadata);
    
    // Save status and metadata reference for stable autosave
    const [saveStatus, setSaveStatus] = useState('idle'); // 'idle', 'saving', 'saved', 'error'
    const metadataRef = useRef(metadata);
    useEffect(() => {
        metadataRef.current = metadata;
    }, [metadata]);

    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [isAddingProp, setIsAddingProp] = useState(false);
    const [newPropName, setNewPropName] = useState("");
    const [incomingLinks, setIncomingLinks] = useState([]);
    const [incomingLinksLoading, setIncomingLinksLoading] = useState(false);
    const [unlinkedMentions, setUnlinkedMentions] = useState([]);
    const [unlinkedMentionsLoading, setUnlinkedMentionsLoading] = useState(false);
    const [linkMentionsBusy, setLinkMentionsBusy] = useState(false);
    const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);
    const [isLinksInfoOpen, setIsLinksInfoOpen] = useState(false);
    
    // Icon and Cover Pickers State
    const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
    const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);
    const iconTriggerRef = useRef(null);
    const coverTriggerRef = useRef(null);
    const headerHoverRef = useRef(null);
    const [isHeaderHovered, setIsHeaderHovered] = useState(false);

    const contextValue = useMemo(() => ({ allTables, onEditSchema, onCreateRecord, onDeletePage, onOpenParallel, idToTitle, registry: registry || { databases: [], tables: [], views: [] } }), [allTables, onEditSchema, onCreateRecord, onDeletePage, onOpenParallel, idToTitle, registry]);
    const handleSaveMetadata = useCallback(async (updatedMetadata) => {
        if (!noteFilename) return;
        const currentMetadata = updatedMetadata || metadataRef.current;
        setSaveStatus('saving');
        try {
            const data = { 
                title: currentMetadata?.title || "Sense títol", 
                metadata: currentMetadata 
            };
            await axios.patch(`/api/vault/pages/${noteFilename}`, data);
            setSaveStatus('saved');
            if (onRefreshNotes) onRefreshNotes();
            setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 3000);
        } catch (err) {
            console.error("Error al desar metadades:", err);
            setSaveStatus('error');
        }
    }, [noteFilename, onRefreshNotes]);
    const handleTitleChange = (e) => { const nextTitle = e.target.value; const nextMeta = { ...metadata, title: nextTitle }; setMetadata(nextMeta); handleSaveMetadata(nextMeta); };
    const handleMetaChange = (key, value) => { const nextMeta = { ...metadata, [key]: value }; setMetadata(nextMeta); handleSaveMetadata(nextMeta); };
    const handleRemoveProperty = (key) => { const nextMeta = { ...metadata }; delete nextMeta[key]; setMetadata(nextMeta); handleSaveMetadata(nextMeta); };
    const rawTableId = metadata.table_id || metadata.database_table_id || metadata.resolved_table_id;
    const currentTableId = String(rawTableId || '').toLowerCase() === 'wiki' ? null : rawTableId;
    const isDashworksJson = metadata?.is_dashworks === true || String(metadata?.content_format || '').toLowerCase() === 'json';
    const currentTable = (allTables || []).find(t => t.id === currentTableId);
    const properties = (currentTable?.properties || []).filter(prop => {
        const normalizedName = String(prop?.name || '').toLowerCase();
        return (
            prop.type !== 'title' &&
            normalizedName !== 'títol' &&
            normalizedName !== 'title' &&
            normalizedName !== 'cover' &&
            normalizedName !== 'cover_manual' &&
            normalizedName !== 'icon' &&
            !normalizedName.startsWith('favorite') &&
            !normalizedName.startsWith('icon_') &&
            !normalizedName.startsWith('cover_')
        );
    });

    const internalKeys = ['title', 'table_id', 'database_id', 'database_table_id', 'id', 'parent_id', 'source_id', 'resolved_table_id', 'last_modified', 'created_time', 'last_edited_time', 'source_parent_id', 'is_default_template', 'path', 'filename', 'cover', 'cover_manual', 'icon'];
    const adhocProperties = Object.keys(metadata).filter(key => {
        const normalizedKey = String(key || '').toLowerCase();
        return (
            !internalKeys.includes(key) &&
            !normalizedKey.startsWith('favorite') &&
            !normalizedKey.startsWith('icon_') &&
            !normalizedKey.startsWith('cover_') &&
            !properties.find(p => p.name === key)
        );
    });

    const handleAddAdhocProperty = () => {
        if (!newPropName.trim()) { setIsAddingProp(false); return; }
        handleMetaChange(newPropName.trim(), "");
        setNewPropName("");
        setIsAddingProp(false);
    };

    const outgoingLinks = useMemo(() => {
        return extractOutgoingPageLinks(initialContent, idToTitle, noteFilename);
    }, [initialContent, idToTitle, noteFilename]);

    const openLinkedPage = useCallback((pageId) => {
        const safeId = String(pageId || '').trim();
        if (!safeId) return;
        onOpenParallel(safeId);
    }, [onOpenParallel]);

    const formatIncomingDisambiguator = useCallback((pageId) => {
        const safeId = String(pageId || '').trim();
        if (!safeId) return 'sense-id';
        if (safeId.length <= 14) return safeId;
        return `${safeId.slice(0, 8)}...${safeId.slice(-4)}`;
    }, []);

    const incomingTitleCounts = useMemo(() => {
        const counts = new Map();
        for (const link of incomingLinks) {
            const normalized = String(link?.title || '').trim().toLowerCase();
            if (!normalized) continue;
            counts.set(normalized, (counts.get(normalized) || 0) + 1);
        }
        return counts;
    }, [incomingLinks]);

    const currentTitleNormalized = useMemo(() => {
        return String(metadata?.title || '').trim().toLowerCase();
    }, [metadata?.title]);

    const formatIncomingLinkLabel = useCallback((link) => {
        const title = String(link?.title || '').trim();
        const id = String(link?.id || '').trim();
        if (!title) return id || 'sense-titol';

        const normalized = title.toLowerCase();
        const repeatedTitle = (incomingTitleCounts.get(normalized) || 0) > 1;
        const sameTitleAsCurrent = Boolean(currentTitleNormalized) && normalized === currentTitleNormalized;

        if (repeatedTitle || sameTitleAsCurrent) {
            return `${title} (${formatIncomingDisambiguator(id)})`;
        }

        return title;
    }, [incomingTitleCounts, currentTitleNormalized, formatIncomingDisambiguator]);

    useEffect(() => {
        let cancelled = false;

        const loadIncomingLinks = async () => {
            if (!noteFilename) {
                setIncomingLinks([]);
                return;
            }

            setIncomingLinksLoading(true);
            try {
                const response = await axios.get('/api/vault/backlinks', { params: { id: noteFilename } });
                if (cancelled) return;

                const dedup = new Map();
                for (const item of Array.isArray(response?.data) ? response.data : []) {
                    const id = String(item?.id || '').trim();
                    if (!id || id === String(noteFilename || '').trim() || dedup.has(id)) continue;
                    dedup.set(id, {
                        id,
                        title: String(item?.title || idToTitle?.[id] || id),
                    });
                }

                setIncomingLinks(
                    Array.from(dedup.values()).sort((a, b) => a.title.localeCompare(b.title))
                );
            } catch (error) {
                if (!cancelled) {
                    console.error('Error carregant backlinks:', error);
                    setIncomingLinks([]);
                }
            } finally {
                if (!cancelled) {
                    setIncomingLinksLoading(false);
                }
            }
        };

        loadIncomingLinks();
        return () => {
            cancelled = true;
        };
    }, [noteFilename, idToTitle]);

    useEffect(() => {
        let cancelled = false;

        const loadUnlinkedMentions = async () => {
            if (!noteFilename) {
                setUnlinkedMentions([]);
                return;
            }

            setUnlinkedMentionsLoading(true);
            try {
                const response = await axios.get('/api/vault/unlinked-mentions', { params: { id: noteFilename } });
                if (cancelled) return;
                const items = Array.isArray(response?.data) ? response.data : [];
                setUnlinkedMentions(items);
            } catch (error) {
                if (!cancelled) {
                    console.error('Error carregant mencions sense enllac:', error);
                    setUnlinkedMentions([]);
                }
            } finally {
                if (!cancelled) {
                    setUnlinkedMentionsLoading(false);
                }
            }
        };

        loadUnlinkedMentions();
        return () => {
            cancelled = true;
        };
    }, [noteFilename]);

    const handleLinkMentions = useCallback(async (sourceId = '') => {
        if (!noteFilename) return;
        setLinkMentionsBusy(true);
        try {
            const payload = {
                target_id: noteFilename,
                source_id: sourceId || null,
            };
            const response = await axios.post('/api/vault/link-unlinked-mentions', payload);
            const changed = Number(response?.data?.notes_changed || 0);
            const replacements = Number(response?.data?.total_replacements || 0);

            if (changed > 0) {
                toast.success(`Mencions enllacades: ${replacements} en ${changed} nota(es)`);
            } else {
                toast('No hi havia mencions pendents per enllacar.');
            }

            const mentionsRes = await axios.get('/api/vault/unlinked-mentions', { params: { id: noteFilename } });
            setUnlinkedMentions(Array.isArray(mentionsRes?.data) ? mentionsRes.data : []);

            const backlinksRes = await axios.get('/api/vault/backlinks', { params: { id: noteFilename } });
            const dedup = new Map();
            for (const item of Array.isArray(backlinksRes?.data) ? backlinksRes.data : []) {
                const id = String(item?.id || '').trim();
                if (!id || id === String(noteFilename || '').trim() || dedup.has(id)) continue;
                dedup.set(id, {
                    id,
                    title: String(item?.title || idToTitle?.[id] || id),
                });
            }
            setIncomingLinks(Array.from(dedup.values()).sort((a, b) => a.title.localeCompare(b.title)));

            if (onRefreshNotes) onRefreshNotes();
        } catch (error) {
            console.error('Error enllacant mencions pendents:', error);
            toast.error('No s\'han pogut enllacar les mencions pendents');
        } finally {
            setLinkMentionsBusy(false);
        }
    }, [noteFilename, idToTitle, onRefreshNotes]);

    useEffect(() => {
        if (historyOpenSignal > 0) {
            setIsHistoryOpen(true);
        }
    }, [historyOpenSignal]);

    return (
        <div className="w-full flex justify-center bg-[var(--bg-primary)] min-h-full transition-colors duration-300">
            <div className="max-w-4xl w-full flex flex-col min-h-full bg-[var(--bg-primary)] relative transition-colors duration-300">
                {/* 1. Cover Image Header */}
                <div 
                    className="relative w-full group/cover mt-4"
                    onMouseEnter={() => setIsHeaderHovered(true)}
                    onMouseLeave={() => setIsHeaderHovered(false)}
                    ref={headerHoverRef}
                >
                    <div className={`w-full overflow-hidden transition-all duration-300 bg-[var(--bg-secondary)]/30 ${metadata.cover ? 'h-64' : 'h-12'}`}>
                        {metadata.cover && (
                            <img 
                                src={normalizeVaultAssetUrl(metadata.cover)} 
                                alt="Cover" 
                                className="w-full h-full object-cover animate-in fade-in duration-500"
                                onError={(e) => { e.target.style.display = 'none'; }}
                            />
                        )}
                        
                        {/* Cover Actions Overlay */}
                        <div className={`absolute bottom-4 right-8 flex items-center gap-2 transition-opacity duration-200 ${isHeaderHovered ? 'opacity-100' : 'opacity-0'}`}>
                            {!metadata.icon && (
                                <button 
                                    onClick={() => setIsIconPickerOpen(true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-primary)]/80 hover:bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-sm backdrop-blur-md rounded-md text-xs font-semibold text-[var(--text-secondary)] transition-all"
                                >
                                    <Smile size={14} />
                                    Afegir icona
                                </button>
                            )}
                            <button 
                                ref={coverTriggerRef}
                                onClick={() => setIsCoverPickerOpen(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-primary)]/80 hover:bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-sm backdrop-blur-md rounded-md text-xs font-semibold text-[var(--text-secondary)] transition-all"
                            >
                                <LayoutPanelLeft size={14} />
                                {metadata.cover ? 'Canviar portada' : 'Afegir portada'}
                            </button>
                            {metadata.cover && (
                                <button 
                                    onClick={() => handleMetaChange('cover', '')}
                                    className="p-1.5 bg-[var(--bg-primary)]/80 hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] border border-[var(--border-primary)] shadow-sm backdrop-blur-md rounded-md text-[var(--text-tertiary)] transition-all"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Page Icon (Absolute positioned floating over cover/header) */}
                    <div className="absolute -bottom-10 left-12 group/icon z-10">
                        <div 
                            ref={iconTriggerRef}
                            onClick={() => setIsIconPickerOpen(true)}
                            className={`relative flex items-center justify-center bg-[var(--bg-primary)] border-4 border-[var(--bg-primary)] rounded-3xl shadow-sm cursor-pointer hover:bg-[var(--bg-secondary)] transition-all group-hover/icon:scale-105 active:scale-95 ${metadata.icon ? 'w-24 h-24' : 'w-24 h-24 opacity-0 group-hover/cover:opacity-100'}`}
                        >
                            {metadata.icon ? (
                                <IconRenderer icon={metadata.icon} size={64} />
                            ) : (
                                <div className="flex flex-col items-center gap-1 text-[var(--text-tertiary)]/40 hover:text-[var(--gnosi-primary)]">
                                    <Plus size={24} />
                                    <span className="text-[10px] font-bold uppercase tracking-wider">Icona</span>
                                </div>
                            )}

                            {/* Remove Icon Button */}
                            {metadata.icon && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleMetaChange('icon', ''); }}
                                    className="absolute -top-2 -right-2 p-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-full text-[var(--text-tertiary)] hover:text-[var(--status-error)] opacity-0 group-hover/icon:opacity-100 transition-opacity shadow-md"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="px-12 pt-20 pb-2">
                    <div className="mb-4 space-y-1.5">
                        <div className="flex items-center justify-between gap-4 group/title mb-6">
                            <input 
                                type="text" 
                                value={metadata.title || ""} 
                                onChange={handleTitleChange} 
                                placeholder="Sense títol" 
                                className="flex-1 text-4xl font-bold border-none outline-none placeholder:[var(--text-tertiary)]/20 text-[var(--text-primary)] bg-transparent" 
                            />
                            <div className="flex items-center gap-2 shrink-0 animate-in fade-in duration-300 min-w-[80px] justify-end">
                                {saveStatus === 'saving' && (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--gnosi-primary)]/5 text-[var(--gnosi-primary)]/60 text-[10px] font-bold uppercase tracking-wider">
                                        <Loader2 size={12} className="animate-spin" />
                                        Desant
                                    </div>
                                )}
                                {saveStatus === 'saved' && (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--status-success)]/5 text-[var(--status-success)]/60 text-[10px] font-bold uppercase tracking-wider">
                                        <CheckSquare size={12} />
                                        Desat
                                    </div>
                                )}
                                {saveStatus === 'error' && (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--status-error)]/5 text-[var(--status-error)]/60 text-[10px] font-bold uppercase tracking-wider">
                                        <X size={12} />
                                        Error
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-0.5 items-center px-1 mb-1.5">
                            <div className="col-span-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setIsPropertiesOpen((prev) => !prev)}
                                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-secondary)]/60 transition-colors"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Settings size={14} className="text-[var(--text-secondary)]/80" />
                                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/85">
                                            Propietats
                                        </div>
                                        <div className="text-[11px] text-[var(--text-tertiary)]/80 truncate">
                                            Esquema {properties.length} · Locals {adhocProperties.length}
                                        </div>
                                    </div>
                                    {isPropertiesOpen ? (
                                        <ChevronDown size={14} className="text-[var(--text-tertiary)]/80 shrink-0" />
                                    ) : (
                                        <ChevronRight size={14} className="text-[var(--text-tertiary)]/80 shrink-0" />
                                    )}
                                </button>
                                {isPropertiesOpen && (
                                <div className="p-3 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]/35">
                                <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-0.5 items-center">
                                    {/* 1. Propietats de l'Esquema */}
                                    {properties.map(prop => (
                                        <React.Fragment key={prop.name}>
                                            <div className="flex items-center gap-1.5 group py-1 h-8">
                                                <div className="p-1.5 rounded-md bg-[var(--bg-secondary)] text-[var(--text-tertiary)]/60 group-hover:bg-[var(--gnosi-primary)]/10 group-hover:text-[var(--gnosi-primary)] transition-colors">
                                                    {prop.type === 'date' ? <Calendar size={14} /> : (prop.type === 'select' ? <Tag size={14} /> : (prop.type === 'number' ? <Hash size={14} /> : <Type size={14} />))}
                                                </div>
                                                <span className="text-sm text-[var(--text-secondary)] font-medium truncate">{prop.name}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 group h-8">
                                                {prop.type === 'multi_select' ? (
                                                    <MultiSelectPills value={metadata[prop.name]} onChange={val => handleMetaChange(prop.name, val)} options={prop.options || []} idToTitle={idToTitle || {}} placeholder="Afegir opcions..." onCreate={val => { const nextOptions = [...(prop.options || []), val]; onEditSchema({ ...currentTable, properties: (properties || []).map(p => p.name === prop.name ? { ...p, options: nextOptions } : p) }); handleMetaChange(prop.name, [...(Array.isArray(metadata[prop.name]) ? metadata[prop.name] : []), val]); }} />
                                                ) : prop.type === 'select' ? (
                                                    <select value={metadata[prop.name] || ""} onChange={e => handleMetaChange(prop.name, e.target.value)} className="w-full bg-[var(--bg-secondary)]/50 border border-transparent hover:border-[var(--border-primary)] rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:bg-[var(--bg-primary)] focus:border-[var(--gnosi-primary)]/40 transition-all font-medium h-7">
                                                        <option value="">Buit</option>
                                                        {(prop.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                    </select>
                                                ) : (
                                                    <input type={prop.type === 'number' ? 'number' : (prop.type === 'date' ? 'date' : 'text')} value={metadata[prop.name] || ""} onChange={e => handleMetaChange(prop.name, e.target.value)} placeholder="Buit" className="w-full bg-transparent border-none rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] transition-all placeholder:[var(--text-tertiary)]/20 font-medium h-7" />
                                                )}
                                                {!currentTable && (
                                                    <button onClick={() => handleRemoveProperty(prop.name)} className="opacity-0 group-hover:opacity-100 p-1.5 text-[var(--text-tertiary)]/40 hover:text-[var(--status-error)] transition-all shrink-0" title="Eliminar propietat"><X size={14} /></button>
                                                )}
                                            </div>
                                        </React.Fragment>
                                    ))}

                                    {/* 2. Propietats Locals (Ad-hoc / Obsidian style) */}
                                    {adhocProperties.map(key => (
                                        <React.Fragment key={key}>
                                            <div className="flex items-center gap-1.5 group py-1 h-8">
                                                <div className="p-1.5 rounded-md bg-[var(--bg-secondary)] text-[var(--gnosi-primary)]/40 group-hover:bg-[var(--gnosi-primary)]/10 transition-colors border border-[var(--gnosi-primary)]/10"><Settings size={14} /></div>
                                                <span className="text-sm text-[var(--text-secondary)] font-medium truncate italic">{key}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 group h-8">
                                                <input 
                                                    type="text" 
                                                    value={metadata[key] || ""} 
                                                    onChange={e => handleMetaChange(key, e.target.value)} 
                                                    placeholder="Buit (local)" 
                                                    className="w-full bg-transparent border-none rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] transition-all placeholder:[var(--text-tertiary)]/20 font-medium h-7" 
                                                />
                                                {!currentTable && (
                                                    <button onClick={() => handleRemoveProperty(key)} className="opacity-0 group-hover:opacity-100 p-1.5 text-[var(--text-tertiary)]/40 hover:text-[var(--status-error)] transition-all shrink-0" title="Eliminar propietat local"><X size={14} /></button>
                                                )}
                                            </div>
                                        </React.Fragment>
                                    ))}

                                    {/* 3. Accions */}
                                    <div className="col-span-2 flex gap-2.5 mt-1.5">
                                        {!currentTable && (!isAddingProp ? (
                                            <button
                                                onClick={() => setIsAddingProp(true)}
                                                className="btn btn-gnosi-primary flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold"
                                            >
                                                <Plus size={14} /> Afegir propietat
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                                                <input
                                                    autoFocus
                                                    className="bg-[var(--bg-secondary)] border border-[var(--gnosi-primary)]/30 rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                                                    placeholder="Nom de la clau (ex: Autor)"
                                                    value={newPropName}
                                                    onChange={e => setNewPropName(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleAddAdhocProperty()}
                                                    onBlur={() => !newPropName && setIsAddingProp(false)}
                                                />
                                                <button onClick={handleAddAdhocProperty} className="p-1.5 bg-[var(--gnosi-primary)] text-white rounded-lg hover:brightness-110 transition-all"><Plus size={16} /></button>
                                                <button onClick={() => { setIsAddingProp(false); setNewPropName(""); }} className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--status-error)] transition-all"><X size={16} /></button>
                                            </div>
                                        ))}
                                        {currentTable && (
                                            <button onClick={() => onEditSchema(currentTable)} className="btn btn-gnosi-primary flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold">
                                                <Settings size={14} /> Gestionar Camps
                                            </button>
                                        )}
                                    </div>
                                </div>
                                </div>
                            )}
                            </div>

                            <div className="col-span-2 mt-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setIsLinksInfoOpen((prev) => !prev)}
                                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-secondary)]/60 transition-colors"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Link2 size={14} className="text-[var(--text-secondary)]/80" />
                                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/85">
                                            Enllacos i mencions
                                        </div>
                                        <div className="text-[11px] text-[var(--text-tertiary)]/80 truncate">
                                            Sortints {outgoingLinks.length} · Entrants {incomingLinks.length} · Pendents {unlinkedMentions.length}
                                        </div>
                                    </div>
                                    {isLinksInfoOpen ? (
                                        <ChevronDown size={14} className="text-[var(--text-tertiary)]/80 shrink-0" />
                                    ) : (
                                        <ChevronRight size={14} className="text-[var(--text-tertiary)]/80 shrink-0" />
                                    )}
                                </button>

                                {isLinksInfoOpen && (
                                    <div className="p-3 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]/35">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-3">
                                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/80 mb-2">
                                                <Link2 size={13} />
                                                Enllaca a ({outgoingLinks.length})
                                            </div>
                                            {outgoingLinks.length === 0 ? (
                                                <div className="text-xs text-[var(--text-tertiary)]/70">Cap enllac sortint detectat.</div>
                                            ) : (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {outgoingLinks.map((link, idx) => (
                                                        link.id ? (
                                                            <button
                                                                type="button"
                                                                key={`${link.id}-${idx}`}
                                                                onClick={() => openLinkedPage(link.id)}
                                                                className="px-2.5 py-1 text-xs rounded-full border border-[var(--gnosi-primary)]/30 bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] hover:brightness-110 transition-all"
                                                                title="Obrir en panell paral.lel"
                                                            >
                                                                {link.title}
                                                            </button>
                                                        ) : (
                                                            <span
                                                                key={`${link.title}-${idx}`}
                                                                className="px-2.5 py-1 text-xs rounded-full border border-[var(--border-primary)] text-[var(--text-tertiary)]/80"
                                                                title="Enllac no resolt"
                                                            >
                                                                {link.title}
                                                            </span>
                                                        )
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-3">
                                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/80 mb-2">
                                                <Share2 size={13} />
                                                Enllacat per ({incomingLinks.length})
                                            </div>
                                            {incomingLinksLoading ? (
                                                <div className="text-xs text-[var(--text-tertiary)]/70 flex items-center gap-1.5">
                                                    <Loader2 size={12} className="animate-spin" />
                                                    Carregant backlinks...
                                                </div>
                                            ) : incomingLinks.length === 0 ? (
                                                <div className="text-xs text-[var(--text-tertiary)]/70">Ningu referencia aquesta pagina encara.</div>
                                            ) : (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {incomingLinks.map((link) => (
                                                        <button
                                                            type="button"
                                                            key={link.id}
                                                            onClick={() => openLinkedPage(link.id)}
                                                            className="px-2.5 py-1 text-xs rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--gnosi-primary)]/40 hover:text-[var(--gnosi-primary)] transition-all"
                                                            title="Obrir en panell paral.lel"
                                                        >
                                                            {formatIncomingLinkLabel(link)}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-3 md:col-span-2">
                                            <div className="flex items-center justify-between gap-2 mb-2">
                                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/80">
                                                    <AtSign size={13} />
                                                    Mencions sense enllac ({unlinkedMentions.length})
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleLinkMentions('')}
                                                    disabled={linkMentionsBusy || unlinkedMentionsLoading || unlinkedMentions.length === 0}
                                                    className="px-2.5 py-1 text-xs rounded-md border border-[var(--gnosi-primary)]/40 bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] disabled:opacity-50"
                                                >
                                                    {linkMentionsBusy ? 'Enllacant...' : 'Enllacar totes'}
                                                </button>
                                            </div>

                                            {unlinkedMentionsLoading ? (
                                                <div className="text-xs text-[var(--text-tertiary)]/70 flex items-center gap-1.5">
                                                    <Loader2 size={12} className="animate-spin" />
                                                    Cercant mencions...
                                                </div>
                                            ) : unlinkedMentions.length === 0 ? (
                                                <div className="text-xs text-[var(--text-tertiary)]/70">No hi ha mencions pendents per convertir a enllac.</div>
                                            ) : (
                                                <div className="space-y-1.5">
                                                    {unlinkedMentions.slice(0, 12).map((mention) => (
                                                        <div key={mention.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-[var(--border-primary)]/70 bg-[var(--bg-primary)]/60">
                                                            <button
                                                                type="button"
                                                                onClick={() => openLinkedPage(mention.id)}
                                                                className="text-left flex-1 min-w-0"
                                                                title="Obrir nota font"
                                                            >
                                                                <div className="text-xs font-semibold text-[var(--text-primary)] truncate">{mention.title}</div>
                                                                <div className="text-[11px] text-[var(--text-tertiary)]/80 truncate">{mention.snippet || 'Sense fragment disponible'}</div>
                                                            </button>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <span className="text-[11px] text-[var(--text-secondary)]/80">{mention.count}x</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleLinkMentions(String(mention.id || ''))}
                                                                    disabled={linkMentionsBusy}
                                                                    className="px-2 py-1 text-[11px] rounded-md border border-[var(--gnosi-primary)]/30 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 disabled:opacity-50"
                                                                >
                                                                    Enllacar
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="relative min-h-[500px] px-12 pb-8">
                    <ErrorBoundary>
                        {isDashworksJson ? (
                            <DashworksJsonEditor
                                noteFilename={noteFilename}
                                initialContent={initialContent}
                                metadata={metadata}
                                onUpdate={onUpdate}
                                onRefreshNotes={onRefreshNotes}
                                effectiveTheme={effectiveTheme}
                            />
                        ) : isCodeView ? (
                            <MarkdownCodeEditor
                                noteFilename={noteFilename}
                                initialContent={initialContent}
                                metadata={metadata}
                                onUpdate={onUpdate}
                                onRefreshNotes={onRefreshNotes}
                            />
                        ) : (
                            <EditorInner 
                                noteFilename={noteFilename} 
                                initialContent={initialContent} 
                                metadata={metadata} 
                                onUpdate={onUpdate} 
                                idToTitle={idToTitle} 
                                onRefreshNotes={onRefreshNotes} 
                                effectiveTheme={effectiveTheme} 
                                contextValue={contextValue} 
                                saveStatus={saveStatus}
                                setSaveStatus={setSaveStatus}
                                metadataRef={metadataRef}
                            />
                        )}
                    </ErrorBoundary>
                </div>
            </div>
            <PageHistory pageId={noteFilename} open={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} onRestore={() => window.location.reload()} />

            {/* Pickers Portals */}
            <IconPicker 
                isOpen={isIconPickerOpen} 
                onClose={() => setIsIconPickerOpen(false)} 
                onSelectIcon={(icon) => handleMetaChange('icon', icon)}
                currentIcon={metadata.icon}
                triggerRef={iconTriggerRef}
            />
            <CoverPicker 
                isOpen={isCoverPickerOpen} 
                onClose={() => setIsCoverPickerOpen(false)} 
                onSelectCover={(cover) => handleMetaChange('cover', cover)}
                currentCover={metadata.cover}
                triggerRef={coverTriggerRef}
            />
        </div>
    );
}

export default BlockEditor;
