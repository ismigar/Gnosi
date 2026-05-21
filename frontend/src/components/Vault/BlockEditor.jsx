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
    Smile,
    Quote,
} from 'lucide-react';
import axios from 'axios';
import {
    useCreateBlockNote,
    getDefaultReactSlashMenuItems,
    SuggestionMenuController,
    createReactBlockSpec,
    createReactInlineContentSpec,
} from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import { withMultiColumn, multiColumnDropCursor } from "@blocknote/xl-multi-column";
import "@blocknote/mantine/style.css";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/react/style.css";
import { useTranslation, Trans } from 'react-i18next';
import { useApi } from '../../hooks/use-api';
import { VaultViewHeader } from './VaultViewHeader';
import { toast } from '../../lib/toast';
import { notifyError, logError } from '../../lib/notifyError';
import { useTheme } from '../../hooks/useTheme';
import PageHistory from './PageHistory';
import { IconPicker } from './IconPicker';
import { CoverPicker } from './CoverPicker';
import { IconRenderer } from './IconRenderer';

import { VaultEditorContext } from './VaultEditorContext';
import { DbViewEmbed } from './DbViewEmbed';
import { EmbedRenderer } from './EmbedRenderer';
import { WikilinkInline } from './WikilinkInline';
import { CiteInline } from './CiteInline';
import { CitePicker } from './CitePicker';
import { MetadataLookupModal } from './MetadataLookupModal';
import { BibliographyBlock } from './BibliographyBlock';
import { buildSlashCommandCatalog, buildColumnLayoutCatalog } from './slashMenuUtils';
import { PageViewModal } from './PageViewModal';
import { FileAttachmentField } from './FileAttachmentField';
import { FileFieldValue } from './FileFieldValue';
import { AutoriaEditor, AutoriaDisplay } from './AutoriaField';
import { dedupeAuthors } from './autoriaUtils';
import { blocksToRichMarkdown, richMarkdownToBlocks } from './markdown-mapper';
import { InsertContentModal } from './InsertContentModal';
import { blocknoteCa } from '../../locales/blocknote/ca';

// Tipus de bloc nadiu de BlockNote per a un fitxer. `image`/`video`/`audio`
// tenen representació inline òbvia; qualsevol altra cosa és `file`.
const nativeBlockTypeFor = (file) => {
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    if (type.startsWith('image/') || /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff)$/.test(name)) return 'image';
    if (type.startsWith('video/') || /\.(mp4|webm|ogv|mov|m4v|mkv)$/.test(name)) return 'video';
    if (type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac)$/.test(name)) return 'audio';
    return 'file';
};

// Mèdia "visual": BlockNote la puja i en fa un bloc nadiu directament, sense
// interrompre amb cap modal (cas dominant: arrossegar captures). La resta de
// fitxers (PDF, documents, arxius genèrics) passa pel modal d'inserció
// unificat perquè hi ha una decisió real a prendre (enllaç / frame / bloc,
// Vault / local / pujada).
const isVisualMediaFile = (file) => nativeBlockTypeFor(file) !== 'file';

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

// Avantpassat desplaçable més proper d'un node (o l'element d'scroll del
// document si no n'hi ha cap).
const getScrollableAncestor = (node) => {
    let el = node?.parentElement || null;
    while (el) {
        const overflowY = getComputedStyle(el).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
            return el;
        }
        el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
};

// Auto-grow d'un <textarea>: posar height:auto el col·lapsa un instant per
// poder mesurar el scrollHeight real del contingut. Si el textarea és enmig
// d'un document llarg, aquest col·lapse momentani fa que el navegador
// "persegueixi" el cursor i desplaci el contenidor a cada tecla (la línia
// editada va caient cap al capdavall de la pantalla). Desem i restaurem el
// scrollTop de l'avantpassat dins del mateix tick, abans del paint → sense
// parpelleig.
const autoGrowTextarea = (el) => {
    if (!el) return;
    const scroller = getScrollableAncestor(el);
    const prevTop = scroller ? scroller.scrollTop : 0;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (scroller && scroller.scrollTop !== prevTop) {
        scroller.scrollTop = prevTop;
    }
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
        .replace(/[#>*_`~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

import { inFlightSaves } from './editorState';

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

const MultiSelectPills = ({ value, onChange, options, idToTitle, placeholder, onCreate, single = false }) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const containerRef = useRef(null);
    const listRef = useRef(null);
    const currentValues = useMemo(() => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
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

    // Mode single: mostrem totes les opcions al dropdown (incloent la
    // seleccionada) perquè l'usuari pugui substituir-la sense haver de
    // deseleccionar primer. Mode multi: amaguem les ja seleccionades
    // perquè ja apareixen com a pills.
    const filteredOptions = (options || []).filter(opt =>
        (idToTitle[opt] || opt).toLowerCase().includes(searchTerm.toLowerCase()) &&
        (single || !currentValues.includes(opt))
    );
    const canCreate = Boolean(
        searchTerm && !(options || []).includes(searchTerm) && onCreate
    );
    const totalItems = filteredOptions.length + (canCreate ? 1 : 0);

    // Reseteja l'índex marcat quan canvia la cerca o s'obre el dropdown:
    // mantenir el highlight desactualitzat trauria la fletxa de lloc i,
    // sobretot, Enter podria seleccionar una opció diferent de la primera
    // visible.
    useEffect(() => { setHighlightedIndex(0); }, [searchTerm, isOpen]);

    // Scroll automàtic dins del dropdown perquè l'opció marcada sempre
    // sigui visible quan es navega amb fletxes en una llista llarga.
    useEffect(() => {
        if (!listRef.current) return;
        const el = listRef.current.querySelector(`[data-idx="${highlightedIndex}"]`);
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
        }
    }, [highlightedIndex]);

    const toggleValue = (val) => {
        if (single) {
            // Substituir; si l'opció clicada era la seleccionada, deseleccionar.
            const isCurrent = currentValues[0] === val;
            onChange(isCurrent ? '' : val);
            setIsOpen(false);
            return;
        }
        const next = currentValues.includes(val)
            ? currentValues.filter(v => v !== val)
            : [...currentValues, val];
        onChange(next);
    };

    const handleCreate = () => {
        if (!canCreate) return;
        onCreate(searchTerm);
        setSearchTerm('');
        if (single) setIsOpen(false);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (totalItems === 0) return;
            setHighlightedIndex(i => Math.min(i + 1, totalItems - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIndex < filteredOptions.length) {
                toggleValue(filteredOptions[highlightedIndex]);
            } else if (canCreate) {
                handleCreate();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setIsOpen(false);
        }
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
                            onKeyDown={handleKeyDown}
                        />
                    </div>
                    <div ref={listRef} className="overflow-y-auto flex-1 custom-scrollbar">
                        {filteredOptions.map((opt, idx) => {
                            const isHighlighted = idx === highlightedIndex;
                            return (
                                <div
                                    key={opt}
                                    data-idx={idx}
                                    onClick={() => toggleValue(opt)}
                                    onMouseEnter={() => setHighlightedIndex(idx)}
                                    className={`p-2.5 text-sm rounded-lg cursor-pointer transition-colors flex items-center justify-between group ${
                                        isHighlighted
                                            ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                            : 'text-[var(--text-secondary)] hover:bg-[var(--gnosi-primary)]/10 hover:text-[var(--gnosi-primary)]'
                                    }`}
                                >
                                    <span>{idToTitle[opt] || opt}</span>
                                    <Plus size={14} className={isHighlighted ? '' : 'opacity-0 group-hover:opacity-100'} />
                                </div>
                            );
                        })}
                        {canCreate && (
                            <button
                                data-idx={filteredOptions.length}
                                onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
                                onClick={handleCreate}
                                className={`btn-gnosi btn-gnosi-primary !text-xs !py-2 w-full mt-2 ${
                                    highlightedIndex === filteredOptions.length ? 'ring-2 ring-[var(--gnosi-primary)]/40' : ''
                                }`}
                            >
                                <Plus size={14} />
                                {t('common.create')} "{searchTerm}"
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const SingleSelectPill = ({ value, onChange, options, idToTitle, placeholder }) => {
    const { t } = useTranslation();
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
                    <div className="text-[10px] font-bold text-[var(--text-tertiary)]/40 px-3 py-2 uppercase tracking-wider">{t('editor.select_table')}</div>
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
    const { t } = useTranslation();
    const context = React.useContext(VaultEditorContext);
    const { allTables } = context || {};
    const [activeTableId, setActiveTableId] = useState(block.props.database_table_id);

    const handleTableChange = (id) => {
        setActiveTableId(id);
        editor.updateBlock(block, { props: { ...block.props, database_table_id: id } });
    };

    if (!activeTableId) {
        return (
            <div className="p-12 border-2 border-dashed border-[var(--border-primary)] rounded-xl flex flex-col items-center justify-center gap-4 bg-[var(--bg-secondary)]/30 group-hover:border-[var(--gnosi-primary)]/30 transition-colors">
                <div className="p-4 bg-[var(--gnosi-primary)]/10 rounded-2xl"><Database size={32} className="text-[var(--gnosi-primary)]/60" /></div>
                <div className="text-center">
                    <h3 className="text-sm font-semibold text-[var(--text-secondary)]">{t('editor.configure_view')}</h3>
                    <p className="text-xs text-[var(--text-tertiary)]/60 mt-1">{t('editor.select_database_to_start')}</p>
                </div>
                <SingleSelectPill 
                    value={activeTableId} 
                    onChange={handleTableChange} 
                    options={(allTables || []).map(t => t.id)} 
                    idToTitle={Object.fromEntries((allTables || []).map(t => [t.id, t.name]))} 
                    placeholder={t('editor.choose_table')} 
                />
            </div>
        );
    }
    return (
        <div ref={ref} className="bn-database-container">
            <div className="p-8 text-center text-[var(--text-tertiary)]/60 text-[11px] italic border border-[var(--border-primary)] rounded-lg bg-[var(--bg-primary)] shadow-sm my-6">
                {t('editor.inline_database_future')}
            </div>
        </div>
    );
});
InlineDatabase.displayName = 'InlineDatabase';

// Module-level constant: keys that the editor manages internally (never shown
// as ad-hoc properties). Lifted here so we don't re-allocate this array on
// every render of BlockEditor — it's frozen for the lifetime of the bundle.
const INTERNAL_METADATA_KEYS = Object.freeze([
    'title', 'table_id', 'database_id', 'database_table_id', 'id',
    'parent_id', 'source_id', 'resolved_table_id', 'last_modified',
    'created_time', 'last_edited_time', 'source_parent_id',
    'is_default_template', 'is_template', 'path', 'filename',
    'cover', 'cover_manual', 'icon',
]);
const INTERNAL_METADATA_KEY_SET = new Set(INTERNAL_METADATA_KEYS);

const TransclusionEmbed = React.forwardRef(({ block }, ref) => {
    const { t } = useTranslation();
    const context = React.useContext(VaultEditorContext);
    const { idToTitle = {}, onOpenParallel = () => {}, onOpenPage = () => {} } = context || {};
    const target = String(block?.props?.target || '').trim();
    const alias = String(block?.props?.alias || '').trim();
    const section = String(block?.props?.section || '').trim();
    const [error, setError] = useState('');

    const resolvedId = useMemo(() => {
        if (!target) return null;
        if (idToTitle[target]) return target;

        const lowerTarget = target.toLowerCase();
        const byTitle = Object.entries(idToTitle).find(([, title]) => String(title || '').toLowerCase() === lowerTarget);
        return byTitle?.[0] || null;
    }, [target, idToTitle]);

    const displayTitle = alias || idToTitle[resolvedId] || target || t('editor.transclusion');
    const [preview, setPreview] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        const loadPreview = async () => {
            if (!resolvedId) {
                setError(t('editor.note_not_found'));
                return;
            }

            try {
                const response = await axios.get(
                    `/api/vault/pages/${encodeURIComponent(resolvedId)}`,
                    { signal: controller.signal },
                );
                const raw = String(response?.data?.content || '');
                const scopedSection = section ? extractSectionPreview(raw, section) : '';
                const clean = scopedSection || markdownToPlainText(raw);

                if (controller.signal.aborted) return;

                if (section && !scopedSection) {
                    setError(t('editor.section_not_found'));
                    return;
                }

                setPreview(clean.slice(0, 300) || t('editor.no_content'));
            } catch (error) {
                if (controller.signal.aborted || error?.name === 'CanceledError' || axios.isCancel?.(error)) return;
                setError(t('editor.preview_load_error'));
            }
        };

        loadPreview();
        return () => {
            controller.abort();
        };
    }, [resolvedId, section, t]);

    // Resol entre obrir al tab actual (click normal) o en paral·lel (cmd-click).
    // Convenció igual que els wikilinks: la transclusió és un link visual a una
    // altra nota, així que un click hauria d'obrir-la com un link normal.
    const openTarget = (e) => {
        if (!resolvedId) return;
        if ((e.metaKey || e.ctrlKey) && onOpenParallel) {
            onOpenParallel(resolvedId);
        } else if (onOpenPage) {
            onOpenPage(resolvedId);
        } else if (onOpenParallel) {
            onOpenParallel(resolvedId);
        }
    };
    return (
        <div
            ref={ref}
            className="my-4 p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 cursor-pointer hover:border-[var(--gnosi-primary)]/40 transition-colors"
            onClick={openTarget}
            title={resolvedId ? t('editor.open_embedded_note') : t('editor.note_unresolved')}
        >
            <div className="flex items-center gap-2 text-[var(--gnosi-primary)] text-xs font-semibold uppercase tracking-wider mb-2">
                <Maximize2 size={13} />
                {t('editor.transclusion')}
            </div>
            <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">{displayTitle}</div>
            {section ? <div className="text-[11px] text-[var(--gnosi-primary)] mb-1">#{section}</div> : null}
            <div className="text-xs text-[var(--text-tertiary)] leading-relaxed">{preview}</div>
            <div className="p-4 bg-[var(--bg-secondary)]/20 border border-dashed border-[var(--border-primary)] rounded-lg flex flex-col items-center gap-3 mt-3">
                <button
                    onClick={(e) => { e.stopPropagation(); openTarget(e); }}
                    className="text-xs font-semibold text-[var(--gnosi-primary)] hover:underline flex items-center gap-1.5"
                >
                    <ExternalLink size={14} />
                    {resolvedId ? t('editor.open_embedded_note') : t('editor.note_unresolved')}
                </button>
                {error && <div className="text-[10px] text-[var(--status-error)] italic">{error}</div>}
            </div>
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
                        <h3 className="text-lg font-bold text-[var(--text-primary)]">S'ha produït un error</h3>
                        <p className="text-sm text-[var(--text-tertiary)] mt-1">Hi ha blocs no suportats o s'ha produït un error a l'editor.</p>
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
    const { t } = useTranslation();
    // Defensiva: si initialContent NO és string (algun update upstream l'ha
    // emboirat com a objecte) intentem extreure'n una versió raonable abans
    // que el textarea mostri "[object Object]".
    const safeInitial = (() => {
        if (typeof initialContent === 'string') return initialContent;
        if (initialContent == null) return '';
        if (typeof initialContent === 'object') {
            if (typeof initialContent.content === 'string') return initialContent.content;
            try { return JSON.stringify(initialContent, null, 2); } catch { return ''; }
        }
        return String(initialContent);
    })();
    const [markdownText, setMarkdownText] = useState(safeInitial);
    const saveTimerRef = useRef(null);
    const textareaRef = useRef(null);
    // Dirty flag — only autosave when the USER has edited the text. Without
    // this, opening any note triggers a PATCH 900ms later with the exact
    // content the server just sent us, which races against external edits
    // (sync from another device) and produces spurious 409 etag conflicts.
    const hasUserEditedRef = useRef(false);

    // Auto-grow del textarea: la pàgina té un sol scroll vertical (el del
    // contenidor), no un d'intern. Després de cada canvi de text, ajustem
    // l'alçada al contingut real preservant la posició d'scroll.
    useEffect(() => {
        autoGrowTextarea(textareaRef.current);
    }, [markdownText]);

    useEffect(() => {
        // Switching to a different note: reset content AND clear dirty flag.
        // Reaprofitem la coerció defensiva (mai escriure "[object Object]").
        const safe = (() => {
            if (typeof initialContent === 'string') return initialContent;
            if (initialContent == null) return '';
            if (typeof initialContent === 'object') {
                if (typeof initialContent.content === 'string') return initialContent.content;
                try { return JSON.stringify(initialContent, null, 2); } catch { return ''; }
            }
            return String(initialContent);
        })();
        setMarkdownText(safe);
        hasUserEditedRef.current = false;
    }, [initialContent, noteFilename]);

    const saveMarkdown = useCallback(async (nextText, { silent = true } = {}) => {
        if (!noteFilename) return false;

        try {
            const data = {
                title: metadata?.title || t('editor.untitled'),
                content: nextText,
                metadata: metadata || {},
            };
            await axios.patch(`/api/vault/pages/${noteFilename}`, data);
            if (onUpdate) onUpdate(noteFilename, data.content, { metadata: data.metadata, title: data.title });
            if (onRefreshNotes) onRefreshNotes();
            if (!silent) toast.success(t('editor.markdown_saved'));
            return true;
        } catch (err) {
            // Always log, but only toast for user-initiated saves. Silent
            // (autosave) failures still surface in the console + app-error
            // event so they're investigable.
            if (silent) logError('save-markdown', err);
            else notifyError('save-markdown', err, t('editor.markdown_save_error'));
            return false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- t() is stable
    }, [noteFilename, metadata, onUpdate, onRefreshNotes]);

    useEffect(() => {
        if (!hasUserEditedRef.current) return;  // skip the open-note pseudo-edit
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
        <div>
            <textarea
                ref={textareaRef}
                value={markdownText}
                onChange={(e) => { hasUserEditedRef.current = true; setMarkdownText(e.target.value); }}
                onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && String(e.key || '').toLowerCase() === 's') {
                        e.preventDefault();
                        void handleForceSave();
                    }
                }}
                spellCheck={false}
                rows={1}
                className="w-full bg-transparent p-0 font-mono text-sm leading-6 text-[var(--text-primary)] outline-none resize-none border-0 focus:ring-0 overflow-hidden"
            />
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
    setSaveStatus,
    metadataRef,
    onOpenPageViewModal,
    isEditable = true,
}) {
    const { t } = useTranslation();
    const schema = useMemo(() => {
        const specs = {
            database: createReactBlockSpec({
                type: "database",
                propSchema: { database_table_id: { default: "" }, viewId: { default: "" }, filters: { default: "" }, sort: { default: "" }, search: { default: "" }, visibleProperties: { default: "" }, viewType: { default: "table" } },
                content: "none",
            }, { render: (props) => <InlineDatabase block={props.block} editor={props.editor} /> }),
            gnosi_view: createReactBlockSpec({
                type: "gnosi_view",
                propSchema: { view_id: { default: "" }, heading: { default: "" }, heading_level: { default: "1" } },
                content: "none",
            }, { render: (props) => <DbViewEmbed block={props.block} /> }),
            transclusion: createReactBlockSpec({
                type: "transclusion",
                propSchema: { target: { default: "" }, alias: { default: "" }, section: { default: "" } },
                content: "none",
            }, { render: (props) => <TransclusionEmbed block={props.block} /> }),
            embed: createReactBlockSpec({
                type: "embed",
                propSchema: { url: { default: "" }, caption: { default: "" } },
                content: "none",
            }, { render: (props) => <EmbedRenderer block={props.block} editor={props.editor} /> }),
            // Block que renderitza la bibliografia del document segons les
            // cites `[@key]` que conté. Vegeu BibliographyBlock.jsx.
            bibliography: createReactBlockSpec({
                type: "bibliography",
                propSchema: {
                    style: { default: "apa" },
                    locale: { default: "ca-AD" },
                },
                content: "none",
            }, { render: (props) => <BibliographyBlock block={props.block} editor={props.editor} /> }),
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
                    <WikilinkInline
                        title={props.inlineContent.props.title}
                        target={props.inlineContent.props.target}
                        idToTitle={contextValue.idToTitle}
                        onOpenInCurrentTab={contextValue.onOpenInCurrentTab}
                        onOpenInNewTab={contextValue.onOpenInNewTab || contextValue.onOpenPage}
                        onOpenParallel={contextValue.onOpenParallel}
                    />
                )
            }),
            // Citation `[@key]`: chip clicable que enllaça amb una entrada
            // de Recursos pel seu camp `Citation Key`. Vegeu CiteInline.jsx
            // per al render i resolució async via /api/vault/resolve-by-citation-key.
            cite: createReactInlineContentSpec({
                type: "cite",
                propSchema: {
                    citationKey: { default: "" },
                },
                content: "none",
            }, {
                render: (props) => (
                    <CiteInline citationKey={props.inlineContent.props.citationKey} />
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
                gnosi_view: { ...specs.gnosi_view(), group: "bnBlock" },
                transclusion: { ...specs.transclusion(), group: "bnBlock" },
                embed: { ...specs.embed(), group: "bnBlock" },
                bibliography: { ...specs.bibliography(), group: "bnBlock" },
                toggle: { ...specs.toggle(), group: "bnBlock" },
                alert: { ...specs.alert(), group: "bnBlock" },
            },
            inlineContentSpecs: {
                ...defaultInlineContentSpecs,
                wikilink: specs.wikilink,
                cite: specs.cite,
            },
            styleSpecs: defaultStyleSpecs,
        });
        return withMultiColumn(baseSchema);
    }, [contextValue]);

    const sanitizeBlocks = useCallback((blocks) => {
        if (!Array.isArray(blocks)) return blocks;
        return blocks.map(block => {
            let sanitizedBlock = { ...block };

            if (!sanitizedBlock.id) {
                sanitizedBlock.id = (typeof crypto !== 'undefined' && crypto?.randomUUID)
                    ? crypto.randomUUID()
                    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
            }
            
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

            if (['columnList', 'column', 'database', 'transclusion', 'gnosi_view', 'embed'].includes(sanitizedBlock.type)) {
                delete sanitizedBlock.content;
            }
            
            if (Array.isArray(sanitizedBlock.content) && sanitizedBlock.content.length === 0 && sanitizedBlock.children && sanitizedBlock.children.length > 0) {
                delete sanitizedBlock.content;
            }

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
        if (!id) return 'no-id';
        if (id.length <= 14) return id;
        return `${id.slice(0, 8)}...${id.slice(-4)}`;
    }, []);

    const tableId = metadata?.table_id || metadata?.database_table_id || '';

    // Ref estable: el valor de tableId pot canviar entre renders però les
    // callbacks que el llegeixen (uploadFileToAssetsDirect, etc.) han de
    // mantenir SEMPRE la mateixa referència perquè useCreateBlockNote no
    // recreï l'editor (cosa que esborraria el contingut en curs d'edició).
    const tableIdRef = useRef(tableId);
    useEffect(() => { tableIdRef.current = tableId; }, [tableId]);

    // Estat per al modal d'inserció unificat (InsertContentModal). Retorna
    // { url, mode, kind, name } perquè el caller decideixi com representar-ho
    // al document (enllaç, bloc nadiu o frame).
    const [pendingInsert, setPendingInsert] = useState(null);
    const pendingInsertRef = useRef(null);
    useEffect(() => { pendingInsertRef.current = pendingInsert; }, [pendingInsert]);

    // Picker de citacions (Cmd+Shift+I). El render es fa al final del
    // component via <CitePicker /> i la inserció s'enruta a `insertCitation`.
    const [isCitePickerOpen, setIsCitePickerOpen] = useState(false);
    // Modal per omplir metadades des de DOI/ISBN/arXiv/URL. Apareix com a
    // botó al panell Propietats si l'editor és editable. Mai escriu sense
    // confirmació explícita (modal mostra cada camp amb checkbox).
    const [isMetadataLookupOpen, setIsMetadataLookupOpen] = useState(false);

    const requestInsertContent = useCallback(({ initialFile = null, initialTab = 'vault' } = {}) => {
        const prev = pendingInsertRef.current;
        if (prev?.reject) {
            try { prev.reject(new Error('superseded')); } catch { /* noop */ }
        }
        return new Promise((resolve, reject) => {
            setPendingInsert({ initialFile, initialTab, resolve, reject });
        });
    }, []);

    // Pujada silenciosa a Assets. La fa servir el `uploadFile` de BlockNote
    // per al cas dominant (imatge/vídeo/àudio arrossegada o enganxada): es
    // puja i es converteix en bloc nadiu directament, sense modal. Els
    // fitxers no-visuals (PDF, documents, arxius) NO arriben aquí perquè els
    // intercepten abans els handlers onDrop/onPaste del wrapper i els porten
    // al modal d'inserció unificat.
    const uploadFileToAssetsDirect = useCallback(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        const tid = tableIdRef.current;
        const url = tid ? `/api/vault/assets/upload?table_id=${encodeURIComponent(tid)}` : '/api/vault/assets/upload';
        const res = await fetch(url, { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        return data.url;
    }, []);

    const editor = useCreateBlockNote({
        schema,
        initialContent: blocks || undefined,
        dropCursor: multiColumnDropCursor,
        uploadFile: uploadFileToAssetsDirect,
        dictionary: blocknoteCa,
        tables: {
            splitCells: true,
            cellBackgroundColor: true,
            cellTextColor: true,
            headers: true,
        },
    });

    // Ref a `applyInsertResult` perquè el listener de l'atall `/+` (definit
    // dins d'un useEffect aïllat) en pugui llegir la versió més recent sense
    // re-registrar-se a cada render.
    const applyInsertResultRef = useRef(null);
    // Flag per evitar entrar en bucle: l'`onChange` es dispara també quan
    // esborrem el `/+` per obrir el modal.
    const plusShortcutBusyRef = useRef(false);

    // Atall `/+` → modal d'inserció. BlockNote no permet caràcters
    // no-alfanumèrics al query del slash menu, així que un àlies "+" no
    // s'arriba a consultar. Tampoc serveix un `onKeyDown` al wrapper de
    // React perquè ProseMirror ja ha processat el `+` quan l'esdeveniment
    // arriba (l'insereix al doc abans de bombollejar). Per això ho fem
    // reactivament: després de cada canvi del document, si el text del
    // bloc actual acaba en `/+`, esborrem els dos caràcters i obrim el
    // modal. Hi ha un flicker mínim del `+` però és imperceptible.
    useEffect(() => {
        if (!editor || typeof editor.onChange !== 'function') return undefined;
        const textOfBlock = (block) => {
            const c = block?.content;
            if (typeof c === 'string') return c;
            if (!Array.isArray(c)) return '';
            return c.map(n => (n?.type === 'text' && typeof n.text === 'string') ? n.text : '').join('');
        };
        const handler = () => {
            if (plusShortcutBusyRef.current) return;
            try {
                const pos = editor.getTextCursorPosition?.();
                const block = pos?.block;
                if (!block) return;
                const text = textOfBlock(block);
                if (!text.endsWith('/+')) return;
                plusShortcutBusyRef.current = true;
                const trimmed = text.slice(0, -2);
                editor.updateBlock(block.id, { content: trimmed || [] });
                setTimeout(() => { plusShortcutBusyRef.current = false; }, 0);
                const anchor = editor.getTextCursorPosition?.()?.block || block;
                requestInsertContent({ initialTab: 'vault' })
                    .then(result => {
                        if (result?.url) applyInsertResultRef.current?.(result, anchor);
                    })
                    .catch(err => {
                        if (!String(err?.message || '').match(/cancelled|superseded/)) {
                            console.warn('plus shortcut cancelled:', err?.message);
                        }
                    });
            } catch (err) {
                console.warn('plus shortcut error:', err?.message);
                plusShortcutBusyRef.current = false;
            }
        };
        return editor.onChange(handler);
    }, [editor, requestInsertContent]);

    // Ref al `<div>` que envolta el BlockNoteView. S'hi registren listeners
    // nadius de drop/paste en capture phase (vegeu el useEffect més avall,
    // després de la declaració de `editorReady`).
    const editorWrapperRef = useRef(null);

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
                    logError('load-initial-content', e);
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

    // Shortcut global Cmd+Shift+I / Ctrl+Shift+I → obre el CitePicker.
    // Nota: A Chromium en Windows/Linux aquesta combinació també obre el
    // DevTools del navegador (el navegador la captura abans que la pàgina).
    // A Mac (Cmd+Shift+I) sí està lliure perquè DevTools usa Cmd+Opt+I.
    // Per als usuaris Win/Linux: serveix el slash command `/cite` com a alternativa.
    useEffect(() => {
        if (!editor) return undefined;
        const onKeyDown = (e) => {
            const isMod = e.metaKey || e.ctrlKey;
            if (!isMod || !e.shiftKey) return;
            const key = String(e.key || '').toLowerCase();
            if (key !== 'i') return;
            // No interceptar si l'usuari està a un input/textarea fora de
            // l'editor (cerca global, modal de propietats…)
            const tag = String(document.activeElement?.tagName || '').toLowerCase();
            const isEditableField = tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable;
            if (isEditableField) {
                // Permetem només si l'element editable forma part del BlockEditor
                const wrapper = editorWrapperRef.current;
                const inEditor = wrapper && wrapper.contains(document.activeElement);
                if (!inEditor) return;
            }
            e.preventDefault();
            e.stopPropagation();
            setIsCitePickerOpen(true);
        };
        // Capture phase per arribar abans que ProseMirror o altres handlers
        // bloquegin la propagació amb un keydown propi.
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [editor]);

    // Intercepció de fitxers arrossegats/enganxats al CAPTURE phase. Un
    // `onDrop`/`onPaste` de React al wrapper s'executa massa tard: ProseMirror
    // (dins el wrapper) processa l'event al bubble phase i ja ha creat el
    // bloc `file` nadiu abans que el handler React pugui interceptar-lo. El
    // capture phase va de fora cap a dins, així que un listener nadiu al
    // wrapper s'executa ABANS que ProseMirror i pot aturar l'event amb
    // stopPropagation. Depèn de `editorReady` perquè el <div> amb el ref
    // només es munta quan l'editor està a punt.
    useEffect(() => {
        const wrapper = editorWrapperRef.current;
        if (!wrapper || !editor || !editorReady) return undefined;

        // Visuals (imatge/vídeo/àudio) → bloc nadiu directe; la resta (PDF,
        // document, arxiu) → modal d'inserció unificat amb el fitxer
        // pre-carregat al tab "Puja".
        const processFiles = async (files) => {
            for (const file of files) {
                try {
                    const anchor = editor.getTextCursorPosition?.()?.block;
                    if (isVisualMediaFile(file)) {
                        const url = await uploadFileToAssetsDirect(file);
                        if (url) applyInsertResultRef.current?.({ url, mode: 'block', kind: nativeBlockTypeFor(file), name: file.name }, anchor);
                        continue;
                    }
                    const result = await requestInsertContent({ initialFile: file, initialTab: 'upload' });
                    if (result?.url) applyInsertResultRef.current?.(result, anchor);
                } catch (err) {
                    if (!String(err?.message || '').match(/cancelled|superseded/)) {
                        console.error('file insert failed', err);
                    }
                }
            }
        };

        const onDropCapture = (e) => {
            const files = Array.from(e.dataTransfer?.files || []);
            if (!files.length) return;
            // Si TOT són visuals, no interceptem: BlockNote ho gestiona
            // (bloc nadiu directe, cas dominant). Només capturem si hi ha
            // almenys un fitxer no-visual.
            if (files.every(isVisualMediaFile)) return;
            e.preventDefault();
            e.stopPropagation();
            processFiles(files);
        };

        const onPasteCapture = (e) => {
            const files = Array.from(e.clipboardData?.files || []);
            if (!files.length) return;
            if (files.every(isVisualMediaFile)) return;
            e.preventDefault();
            e.stopPropagation();
            processFiles(files);
        };

        wrapper.addEventListener('drop', onDropCapture, true);
        wrapper.addEventListener('paste', onPasteCapture, true);
        return () => {
            wrapper.removeEventListener('drop', onDropCapture, true);
            wrapper.removeEventListener('paste', onPasteCapture, true);
        };
    }, [editor, editorReady, requestInsertContent, uploadFileToAssetsDirect]);

    // (interceptor de file:// mogut al wrapper BlockEditor perquè estigui
    // actiu sempre, independent del mode de visualització)

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
                title: currentMetadata?.title || t('editor.untitled'), 
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

            await savePromise;
            
            const currentRecord = inFlightSaves.get(noteFilename);
            if (currentRecord && currentRecord.promise === savePromise) {
                inFlightSaves.delete(noteFilename);
            }

            setSaveStatus('saved');
            // El contracte de handleEditorUpdate al pare és (pageId, content, payload).
            // Si passem 'data' (objecte) com a content, tab.content esdevé un objecte
            // i el toggle MD el toString-eja a "[object Object]" + perd la nota.
            if (onUpdate) onUpdate(noteFilename, data.content, { title: data.title, metadata: data.metadata });

            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            
            setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 3000);
        } catch (err) {
            notifyError('autosave', err, t('editor.autosave_error'));
            setSaveStatus('error');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- metadataRef is a ref (stable); setSaveStatus is stable
    }, [noteFilename, editor, isParsing, editorReady, onUpdate, t]);

    const expandBracketRange = (text, start, end) => {
        const source = String(text || '');
        let safeStart = Math.max(0, Number(start) || 0);
        let safeEnd = Math.max(safeStart, Number(end) || safeStart);

        let leftExtra = 0;
        while (safeStart > 0 && source[safeStart - 1] === '[' && leftExtra < 2) {
            safeStart -= 1;
            leftExtra += 1;
        }

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
            const itemEnd = cursor + (text ? text.length : 1);

            if (!text) {
                if (itemEnd <= rangeStart || itemStart >= rangeEnd) {
                    next.push(item);
                } else if (!injected) {
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

                const expanded = expandBracketRange(plainText, replaceStart, replaceEnd);
                const inlineReplaced = replaceTokenInInlineArray(inline, expanded.start, expanded.end, wikilinkItem);
                
                if (inlineReplaced) {
                    editor.updateBlock(currentBlock, { content: inlineReplaced });
                    if (typeof handleSave === 'function') setTimeout(() => handleSave(), 100);
                    return;
                }
            } catch (e) {
                console.warn("Atomic replacement failed", e);
            }
        }

        editor.insertInlineContent([wikilinkItem]);
        if (typeof handleSave === 'function') setTimeout(() => handleSave(), 100);
    }, [editor, handleSave]);


    // Inserció programàtica d'una cita `[@key]` a la posició actual del
    // cursor. Es fa servir des del CitePicker (Cmd+Shift+I) i des del slash
    // menu (`/cite`). Tria entre l'inline-content nadiu `cite` (chip
    // renderitzat) i el text Markdown `[@key]` (que el parser converteix
    // al carregar la pàgina): preferim l'inline directe perquè dona
    // resposta visual immediata.
    const insertCitation = useCallback((citationKey) => {
        if (!editor) return;
        const safe = String(citationKey || '').trim();
        if (!safe) return;
        try {
            editor.insertInlineContent([
                { type: 'cite', props: { citationKey: safe } },
                ' ',
            ]);
            if (typeof handleSave === 'function') setTimeout(() => handleSave(), 100);
        } catch (err) {
            // Si l'editor no té l'spec `cite` registrat (cas defensiu),
            // caiem al text Markdown que el parser detectarà al re-load.
            console.warn('insertCitation fallback to markdown:', err?.message);
            try {
                editor.insertInlineContent(`[@${safe}] `);
                if (typeof handleSave === 'function') setTimeout(() => handleSave(), 100);
            } catch (err2) {
                console.error('insertCitation fallback failed:', err2?.message);
            }
        }
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
                    // Si replaceBlocks/updateBlock fallen (per exemple, el bloc
                    // ja no existeix per cancel·lació), continuem al fallback
                    // de sota que insereix una transclusion al final del doc.
                    console.debug('transclusion inline replace fallback:', error?.message);
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

            if (onRefreshNotes) {
                window.setTimeout(() => {
                    try {
                        onRefreshNotes();
                    } catch (e) {
                        console.debug('onRefreshNotes failed:', e?.message);
                    }
                }, 1400);
            }

            if (response.data?.filename) {
                const safeTitle = response.data.title || String(response.data.filename).replace(/\.md$/, '');
                toast.success(t('editor.page_created', { title: safeTitle }));
            }
        } catch (error) {
            notifyError('page-create', error, t('editor.page_create_error'));
        }
    }, [insertTransclusion, insertWikiLink, normalizePendingLinkTitle, onRefreshNotes, t]);

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

                const markdownContent = blocksToRichMarkdown(editor.document);
                // eslint-disable-next-line react-hooks/exhaustive-deps -- want the latest metadata at unmount, not the captured value
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

                // Propaga el canvi al pare quan el flush d'unmount té èxit:
                // si l'usuari edita i tanca la pestanya abans del debounce
                // (700ms), `handleSave` no s'ha cridat i `pages`/`tabs` del
                // pare quedarien stale; la vista mostraria el contingut
                // anterior fins a un refresh manual.
                savePromise.then(() => {
                    if (onUpdate) onUpdate(noteFilename, markdownContent, { title: data.title, metadata: currentMetadata });
                }).finally(() => {
                    const currentRecord = inFlightSaves.get(noteFilename);
                    if (currentRecord && currentRecord.promise === savePromise) {
                        setTimeout(() => {
                           if (inFlightSaves.get(noteFilename)?.promise === savePromise) {
                               inFlightSaves.delete(noteFilename);
                           }
                        }, 1000);
                    }
                }).catch(e => logError('unmount-save', e));
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- metadataRef is a ref; noteFilename is captured via handleSave closure
    }, [editor, isParsing, handleSave]);

    if (isParsing || !editorReady) return <div className="flex items-center justify-center h-[500px] text-[var(--text-tertiary)]/60"><Loader2 className="animate-spin mr-2" size={20} /> {t('editor.loading_editor')}</div>;

    // Detecta si una cadena és una URL "encastable": YouTube, Vimeo o PDF
    // online. Retorna el "kind" detectat o null. Útil per al paste handler
    // que suggereix convertir un enllaç inline en bloc embed.
    const detectEmbeddableUrl = (text) => {
        const trimmed = String(text || '').trim();
        if (!trimmed) return null;
        // Acceptem només si l'enganxat és JUST una URL (no text amb URL al mig)
        if (/\s/.test(trimmed)) return null;
        try {
            const u = new URL(trimmed);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
            const host = u.hostname.replace(/^www\./, '');
            if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') return 'youtube';
            if (host === 'vimeo.com' || host === 'player.vimeo.com') return 'vimeo';
            const lowerPath = u.pathname.toLowerCase();
            if (lowerPath.endsWith('.pdf')) return 'pdf';
        } catch { /* not a URL */ }
        return null;
    };

    // Aplica un resultat del modal d'inserció unificat al document.
    // - mode='link'  → enllaç inline `[name](url)`
    // - mode='frame' → bloc `embed` (iframe / viewer)
    // - mode='block' → bloc nadiu BlockNote segons el kind (image/video/audio/file)
    const applyInsertResult = ({ url, mode, kind, name }, anchor = null) => {
        if (!url) return;
        const safeName = name || url;
        if (mode === 'frame') {
            const block = { type: 'embed', props: { url, caption: '' } };
            const target = anchor || editor.getTextCursorPosition().block;
            editor.insertBlocks([block], target, 'after');
            return;
        }
        if (mode === 'block') {
            const nativeType = ['image', 'video', 'audio'].includes(kind) ? kind : 'file';
            const block = { type: nativeType, props: { url, name: safeName } };
            const target = anchor || editor.getTextCursorPosition().block;
            editor.insertBlocks([block], target, 'after');
            return;
        }
        // mode === 'link' (defecte)
        editor.insertInlineContent([
            { type: 'link', href: url, content: [{ type: 'text', text: safeName, styles: {} }] },
        ]);
    };
    // Mantenim la ref al closure més recent perquè l'`useEffect` de l'atall
    // `/+` (registrat un sol cop quan es crea l'editor) pugui invocar-lo.
    applyInsertResultRef.current = applyInsertResult;

    const providerValue = { ...contextValue, requestInsertContent };
    return (
        <VaultEditorContext.Provider value={providerValue}>
            <style>{`
                .bn-editor {
                    padding-left: 0 !important;
                    padding-right: 0 !important;
                    background: transparent !important;
                    /* BlockNote/Mantine usa #3F3F3F per defecte (gris). Forcem
                       el color del text al token primari del tema (--text-primary)
                       perquè el contingut es vegi negre tant en mode clar com
                       contrastat blanc en mode fosc. Aplicat amb !important
                       perquè la cascada del tema Mantine és molt específica. */
                    color: var(--text-primary) !important;
                }
                .bn-editor *,
                .bn-editor [data-content-type] {
                    /* Heretem el color a tots els blocs (paragraph, heading,
                       list, table cells, etc.). Excloem nodes amb color propi
                       gestionats per BlockNote (text colors, link colors). */
                    color: inherit;
                }
                .bn-container,
                .bn-mantine,
                .bn-root {
                    background: transparent !important;
                }

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

                .bn-editor .bn-block:has(> .bn-block-content[data-background-color]:not([data-background-color="default"])) {
                    background-color: transparent !important;
                }
                .bn-editor .bn-block-content[data-background-color]:not([data-background-color="default"]) {
                    background-color: transparent !important;
                }
                .bn-editor [data-background-color]:not([data-background-color="default"]):not(.bn-block):not(.bn-block-content):not(th):not(td) {
                    background-color: transparent !important;
                }
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

                /* Cel·les de capçalera (<th>) de taules: fons gris i text en negreta per defecte */
                .bn-editor [data-content-type="table"] th {
                    background-color: #ebeced !important;
                    font-weight: 700 !important;
                }
                .bn-editor [data-content-type="table"] th *,
                .bn-editor [data-content-type="table"] th .bn-inline-content,
                .bn-editor [data-content-type="table"] th p,
                .bn-editor [data-content-type="table"] th a,
                .bn-editor [data-content-type="table"] th span {
                    font-weight: 700 !important;
                }
                /* Quan una cel·la (capçalera o normal) té un color assignat,
                   pintar-lo directament a la cel·la i mantenir-ne la negreta si és <th>.
                   Anul·lem també el "highlight" inline per evitar doble fons. */
                .bn-editor [data-content-type="table"] th[data-background-color="gray"],
                .bn-editor [data-content-type="table"] td[data-background-color="gray"] { background-color: #ebeced !important; }
                .bn-editor [data-content-type="table"] th[data-background-color="brown"],
                .bn-editor [data-content-type="table"] td[data-background-color="brown"] { background-color: #e9e5e3 !important; }
                .bn-editor [data-content-type="table"] th[data-background-color="red"],
                .bn-editor [data-content-type="table"] td[data-background-color="red"] { background-color: #fbe4e4 !important; }
                .bn-editor [data-content-type="table"] th[data-background-color="orange"],
                .bn-editor [data-content-type="table"] td[data-background-color="orange"] { background-color: #f6e9d9 !important; }
                .bn-editor [data-content-type="table"] th[data-background-color="yellow"],
                .bn-editor [data-content-type="table"] td[data-background-color="yellow"] { background-color: #fbf3db !important; }
                .bn-editor [data-content-type="table"] th[data-background-color="green"],
                .bn-editor [data-content-type="table"] td[data-background-color="green"] { background-color: #ddedea !important; }
                .bn-editor [data-content-type="table"] th[data-background-color="blue"],
                .bn-editor [data-content-type="table"] td[data-background-color="blue"] { background-color: #ddebf1 !important; }
                .bn-editor [data-content-type="table"] th[data-background-color="purple"],
                .bn-editor [data-content-type="table"] td[data-background-color="purple"] { background-color: #eae4f2 !important; }
                .bn-editor [data-content-type="table"] th[data-background-color="pink"],
                .bn-editor [data-content-type="table"] td[data-background-color="pink"] { background-color: #f4dfeb !important; }
                .bn-editor [data-content-type="table"] th[data-background-color] .bn-inline-content,
                .bn-editor [data-content-type="table"] td[data-background-color] .bn-inline-content {
                    background-color: transparent !important;
                    padding: 0 !important;
                    border-radius: 0 !important;
                }

                [data-content-type="columnList"] {
                    gap: 1.5rem !important;
                }
                [data-content-type="column"] + [data-content-type="column"] {
                    border-left: 1px dashed rgba(var(--gnosi-primary-rgb), 0.1);
                    padding-left: 1.5rem !important;
                }

                .bn-editor .bn-block-group .bn-block-group > .bn-block-outer::before,
                .bn-container .bn-block-group .bn-block-group > .bn-block-outer::before {
                    border-left: none !important;
                    background: none !important;
                }

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

                .bn-editor .bn-inline-content a[href*="localhost:4771"],
                .bn-container .bn-inline-content a[href*="localhost:4771"] {
                    color: #22c55e !important;
                    text-decoration-style: dashed !important;
                    text-decoration-color: color-mix(in srgb, #22c55e 70%, transparent) !important;
                }

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

                .bn-toggle summary::-webkit-details-marker { display: none; }
            `}</style>
            <div
                ref={editorWrapperRef}
                onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
                onPaste={(e) => {
                    // NOTA: la intercepció de FITXERS enganxats es fa amb un
                    // listener nadiu en capture phase (vegeu el useEffect
                    // `editorWrapperRef`), no aquí — ProseMirror processa el
                    // paste abans que aquest handler React. Aquest `onPaste`
                    // només cobreix el cas de TEXT: una URL "encastable".
                    //
                    // Quan l'usuari enganxa una URL "encastable" (YouTube,
                    // Vimeo, PDF online), deixem que BlockNote faci el seu
                    // paste normal (enllaç inline) i, en paral·lel, mostrem
                    // un toast suggerint convertir-la en frame. NO bloquegem
                    // el paste perquè el cas "enllaç" segueix sent vàlid;
                    // només oferim un atall per al cas comú on l'usuari volia
                    // veure el reproductor.
                    const text = e.clipboardData?.getData?.('text/plain');
                    const kind = detectEmbeddableUrl(text);
                    if (!kind) return;
                    const url = String(text).trim();
                    const insertFrame = () => {
                        try {
                            const anchor = editor.getTextCursorPosition().block;
                            editor.insertBlocks([{ type: 'embed', props: { url, caption: '' } }], anchor, 'after');
                        } catch (err) {
                            console.warn('paste→frame insert failed:', err?.message);
                        }
                    };
                    toast.custom((tToast) => (
                        <div className="px-4 py-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg flex items-center gap-3 max-w-md">
                            <div className="text-xs text-[var(--text-secondary)]">
                                {kind === 'pdf'
                                    ? t('editor.paste_pdf_detected', { defaultValue: 'PDF detectat. Vols veure\'l incrustat com a frame?' })
                                    : t('editor.paste_video_detected', { defaultValue: 'Vídeo detectat. Vols veure\'l incrustat com a frame?' })}
                            </div>
                            <button
                                onClick={() => { insertFrame(); toast.dismiss(tToast.id); }}
                                className="px-3 py-1.5 rounded-md bg-[var(--gnosi-primary)] text-white text-xs font-medium hover:opacity-90 shrink-0"
                            >
                                {t('editor.paste_convert_frame', { defaultValue: 'Inserir frame' })}
                            </button>
                            <button
                                onClick={() => toast.dismiss(tToast.id)}
                                className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shrink-0"
                            >
                                {t('common.dismiss', { defaultValue: 'Descarta' })}
                            </button>
                        </div>
                    ), { duration: 8000 });
                }}
            >
            <BlockNoteView
                editor={editor}
                editable={isEditable}
                slashMenu={false}
                theme={effectiveTheme}
            >
                <SuggestionMenuController
                    triggerCharacter="/"
                    getItems={async (query) => {
                        if (!editor) return [];
                        // El bloc "Fitxer" per defecte és redundant amb "/+" (Insereix contingut).
                        const defaultItems = getDefaultReactSlashMenuItems(editor).filter((item) => item.key !== 'file');
                        const vaultItems = buildSlashCommandCatalog({ allTables: contextValue?.allTables || [], onOpenPageView: (tableId = '') => { onOpenPageViewModal?.(tableId); } }).map(item => ({
                            title: item.title,
                            onItemClick: item.onItemClick,
                            aliases: item.aliases,
                            group: item.group || t('editor.database_group'),
                            icon: <Database size={18} />,
                            subtext: item.subtext || item.description,
                        }));
                        const layoutItems = buildColumnLayoutCatalog({ editor }).map(item => ({
                            title: item.title, onItemClick: item.onItemClick, aliases: item.aliases, group: item.group, icon: <Columns size={18} />, subtext: item.subtext
                        }));
                        const quickLinkItems = [
                            {
                                title: t('editor.insert_content', { defaultValue: 'Insereix contingut…' }),
                                onItemClick: async () => {
                                    const anchor = editor.getTextCursorPosition().block;
                                    try {
                                        const result = await requestInsertContent({ initialTab: 'vault' });
                                        if (result?.url) applyInsertResult(result, anchor);
                                    } catch (err) {
                                        if (!String(err?.message || '').match(/cancelled|superseded/)) {
                                            console.warn('insert content cancelled:', err?.message);
                                        }
                                    }
                                },
                                aliases: ["+", "insereix", "insert", "enllac", "link", "rich", "url", "file", "local", "embed", "fitxer", "media", "pdf", "video", "image", "frame", "iframe", "youtube", "vimeo", "audio"],
                                group: t('editor.links_group'),
                                icon: <Link2 size={18} />,
                                subtext: t('editor.insert_content_subtext', { defaultValue: 'Modal unificat: Vault, disc local, pujada o URL' }),
                            },
                            {
                                title: t('editor.internal_link'),
                                onItemClick: () => insertWikiLink(t('editor.note_name_placeholder')),
                                aliases: ["wiki", "internal", "note", "[[]]"],
                                group: t('editor.links_group'),
                                icon: <MessageSquare size={18} />,
                                subtext: t('editor.insert_wiki_link_format'),
                            },
                            {
                                title: t('editor.link_to_section'),
                                onItemClick: () => editor.insertInlineContent(`[[${t('editor.note_section_placeholder')}]]`),
                                aliases: ["wiki section", "section", "anchor", "#"],
                                group: t('editor.links_group'),
                                icon: <MessageSquare size={18} />,
                                subtext: t('editor.wiki_section_format'),
                            },
                            {
                                title: t('editor.wiki_link_with_alias'),
                                onItemClick: () => editor.insertInlineContent(`[[${t('editor.note_alias_placeholder')}]]`),
                                aliases: ["wiki alias", "display", "label"],
                                group: t('editor.links_group'),
                                icon: <MessageSquare size={18} />,
                                subtext: t('editor.wiki_alias_format'),
                            },
                            {
                                title: t('editor.insert_citation', { defaultValue: 'Insereix cita…' }),
                                onItemClick: () => setIsCitePickerOpen(true),
                                aliases: ["cite", "citation", "cita", "@", "[@", "ref", "bib", "bibliography", "reference"],
                                group: t('editor.links_group'),
                                icon: <Quote size={18} />,
                                subtext: t('editor.insert_citation_subtext', {
                                    defaultValue: 'Picker (⌘⇧I) — cerca per autor, títol o citation key',
                                }),
                            },
                            {
                                title: t('editor.insert_bibliography', { defaultValue: 'Bibliografia automàtica' }),
                                onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, {
                                    type: 'bibliography',
                                    props: { style: 'apa', locale: 'ca-AD' },
                                }),
                                aliases: ["bibliography", "bib", "refs", "references", "bibliografia"],
                                group: t('editor.links_group'),
                                icon: <Quote size={18} />,
                                subtext: t('editor.insert_bibliography_subtext', {
                                    defaultValue: 'Genera la llista de referències a partir de les cites del document',
                                }),
                            },
                            {
                                title: t('editor.obsidian_transclusion'),
                                onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, {
                                    type: 'transclusion',
                                    props: { target: '', alias: '', section: '' },
                                }),
                                aliases: ["transclusion", "![[", "obsidian"],
                                group: t('editor.links_group'),
                                icon: <Maximize2 size={18} />,
                                subtext: t('editor.insert_transclusion_format'),
                            },
                            {
                                title: t('editor.section_transclusion'),
                                onItemClick: () => editor.insertInlineContent(`![[${t('editor.note_section_transclusion_placeholder')}]]`),
                                aliases: ["transclusion section", "![[#"],
                                group: t('editor.links_group'),
                                icon: <Maximize2 size={18} />,
                                subtext: t('editor.section_transclusion_format'),
                            },
                            {
                                title: t('editor.transclusion_with_alias'),
                                onItemClick: () => editor.insertInlineContent(`![[${t('editor.transclusion_alias_placeholder')}]]`),
                                aliases: ["transclusion alias"],
                                group: t('editor.links_group'),
                                icon: <Maximize2 size={18} />,
                                subtext: t('editor.transclusion_alias_format'),
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
                                    title: t('editor.create_at_wiki', { title: pendingTitle }),
                                    aliases: [pendingTitle, 'create', 'wiki', 'new page'],
                                    group: t('editor.create_page'),
                                    icon: <Plus size={18} />,
                                    subtext: t('editor.create_and_link', { title: pendingTitle, section: sectionQuery ? `#${sectionQuery}` : '' }),
                                    onItemClick: () => createMissingPageAndInsertLink({
                                        rawTitle: pendingTitle,
                                        tableId: null,
                                        mode: 'wiki',
                                        section: sectionQuery,
                                    }),
                                },
                                ...tableOptions.map((table) => ({
                                    title: t('editor.create_in_table', { table: table.name, title: pendingTitle }),
                                    aliases: [pendingTitle, 'create', 'table', table.name || table.id],
                                    group: t('editor.create_page'),
                                    icon: <Database size={18} />,
                                    subtext: t('editor.create_record_in', { table: table.name }),
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
                                        group: t('editor.internal_links'),
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
                            group: t('editor.internal_links'),
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
                                    title: t('editor.create_transclusion_at_wiki', { title: pendingTitle }),
                                    aliases: [pendingTitle, 'create', 'transclusion', 'wiki'],
                                    group: t('editor.create_page'),
                                    icon: <Plus size={18} />,
                                    subtext: t('editor.create_and_insert_transclusion', { title: pendingTitle, section: sectionQuery ? `#${sectionQuery}` : '' }),
                                    onItemClick: () => createMissingPageAndInsertLink({
                                        rawTitle: pendingTitle,
                                        tableId: null,
                                        mode: 'transclusion',
                                        section: sectionQuery,
                                    }),
                                },
                                ...tableOptions.map((table) => ({
                                    title: t('editor.create_transclusion_in_table', { table: table.name, title: pendingTitle }),
                                    aliases: [pendingTitle, 'create', 'transclusion', table.name || table.id],
                                    group: t('editor.create_page'),
                                    icon: <Database size={18} />,
                                    subtext: t('editor.create_record_and_insert_transclusion', { table: table.name }),
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
            </div>
            <InsertContentModal
                open={Boolean(pendingInsert)}
                initialFile={pendingInsert?.initialFile || null}
                initialTab={pendingInsert?.initialTab || 'vault'}
                tableId={tableIdRef.current}
                onInsert={(result) => {
                    const p = pendingInsertRef.current;
                    setPendingInsert(null);
                    try { p?.resolve?.(result); } catch { /* noop */ }
                }}
                onClose={() => {
                    const p = pendingInsertRef.current;
                    setPendingInsert(null);
                    try { p?.reject?.(new Error('cancelled')); } catch { /* noop */ }
                }}
            />
            <CitePicker
                isOpen={isCitePickerOpen}
                onClose={() => setIsCitePickerOpen(false)}
                onSelect={(item) => {
                    if (item?.citation_key) {
                        insertCitation(item.citation_key);
                    }
                }}
            />
            <MetadataLookupModal
                isOpen={isMetadataLookupOpen}
                onClose={() => setIsMetadataLookupOpen(false)}
                currentMetadata={metadata}
                onApply={(patch) => {
                    // Aplica camp per camp via handleMetaChange — així
                    // disparem el debounce de save i actualitzem la UI alhora.
                    Object.entries(patch).forEach(([k, v]) => {
                        handleMetaChange(k, v);
                    });
                }}
            />
        </VaultEditorContext.Provider>
    );
};

export function BlockEditor({ noteFilename, initialContent, initialMetadata = {}, onUpdate, allTables = [], allNotes = [], onEditSchema, onAddSchemaOption, onCreateRecord, onDeletePage = () => {}, onOpenParallel = () => {}, onOpenPage = () => {}, onOpenInCurrentTab = null, onOpenInNewTab = null, idToTitle = {}, registry = { databases: [], tables: [], views: [] }, onRefreshNotes = () => {}, onUpdatePageMetadata, historyOpenSignal = 0, isCodeView = false, isEditLocked = false }) {
    const { t } = useTranslation();
    const { apiFetch, role } = useApi();
    const isViewerRole = role === 'viewer';
    const isAdmin = role === 'admin' || role === 'owner';
    // `isViewer`/`isEditor` representen la combinació: rol-viewer O candau de
    // l'usuari (`isEditLocked` per pàgina). Quan l'usuari tanca el candau,
    // l'editor es comporta com si fos un viewer per aquesta pàgina concreta.
    const isViewer = isViewerRole || isEditLocked;
    const isEditor = !isEditLocked && (role === 'editor' || isAdmin);
    const { effectiveTheme } = useTheme();

    const isEditable = !isViewer;
    const [metadata, setMetadata] = useState(initialMetadata);
    // (interceptor de file:// està al hook useFileLinkInterceptor invocat a App.jsx)
    
    const [saveStatus, setSaveStatus] = useState('idle');
    const metadataRef = useRef(metadata);
    useEffect(() => {
        metadataRef.current = metadata;
    }, [metadata]);

    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [isPageViewModalOpen, setIsPageViewModalOpen] = useState(false);
    const [pageViewPreselectedTable, setPageViewPreselectedTable] = useState('');
    const [pageViewEditingBlock, setPageViewEditingBlock] = useState(null);
    const [isAddingProp, setIsAddingProp] = useState(false);
    const [newPropName, setNewPropName] = useState("");
    const [incomingLinks, setIncomingLinks] = useState([]);
    const [incomingLinksLoading, setIncomingLinksLoading] = useState(false);
    const [unlinkedMentions, setUnlinkedMentions] = useState([]);
    const [unlinkedMentionsLoading, setUnlinkedMentionsLoading] = useState(false);
    const [linkMentionsBusy, setLinkMentionsBusy] = useState(false);
    const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);
    const [isLinksInfoOpen, setIsLinksInfoOpen] = useState(false);
    
    const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
    const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false);
    const iconTriggerRef = useRef(null);
    const coverTriggerRef = useRef(null);
    const headerHoverRef = useRef(null);
    const titleInputRef = useRef(null);
    const [isHeaderHovered, setIsHeaderHovered] = useState(false);

    const openPageViewModalFromContext = useCallback((tableId = '', editingBlock = null) => {
        setPageViewPreselectedTable(tableId);
        setPageViewEditingBlock(editingBlock);
        setIsPageViewModalOpen(true);
    }, []);

    const contextValue = useMemo(() => ({ allTables, onEditSchema, onCreateRecord, onDeletePage, onOpenParallel, onOpenPage, onOpenInCurrentTab, onOpenInNewTab, idToTitle, registry: registry || { databases: [], tables: [], views: [] }, pageId: noteFilename, onOpenPageViewModal: openPageViewModalFromContext }), [allTables, onEditSchema, onCreateRecord, onDeletePage, onOpenParallel, onOpenPage, onOpenInCurrentTab, onOpenInNewTab, idToTitle, registry, noteFilename, openPageViewModalFromContext]);
    // Performs the actual PATCH. Don't call this directly from key-by-key
    // events — use handleSaveMetadata (debounced) or pass {immediate:true}.
    const _doSaveMetadata = useCallback(async (currentMetadata) => {
        if (!noteFilename) return;
        setSaveStatus('saving');
        try {
            const data = {
                title: currentMetadata?.title || t('editor.untitled'),
                metadata: currentMetadata
            };
            await axios.patch(`/api/vault/pages/${noteFilename}`, data);
            setSaveStatus('saved');
            // Notifica el pare perquè el `tabs[i].title` i el breadcrumb
            // segueixin el rename. Sense això, canvis al títol via panell de
            // propietats o input del header només es propagaven via
            // `onRefreshNotes` (lent, fetch sencer); la pestanya quedava
            // mostrant el títol antic fins al pròxim recàrrec.
            if (onUpdate) onUpdate(noteFilename, undefined, { title: data.title, metadata: data.metadata });
            if (onRefreshNotes) onRefreshNotes();
            setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 3000);
        } catch (err) {
            // Metadata-save failures used to be silent (console.error only).
            // They mean a property edit, title rename, or icon/cover change
            // didn't persist — important for the user to know. The UI error
            // badge still shows; we add a deduplicated toast so the user
            // doesn't think the change was saved.
            notifyError('save-metadata', err, t('editor.markdown_save_error'));
            setSaveStatus('error');
        }
    }, [noteFilename, onUpdate, onRefreshNotes, t]);

    // Debounced metadata save. Without this, every keystroke on the title or
    // every option toggle on a multi-select fires its own PATCH; on slow
    // networks the requests overlap and a faster late save can be clobbered
    // by a slower earlier one (no ordering guarantee). The dedicated ref
    // ensures only the last user action triggers a real network call.
    const metaSaveTimerRef = useRef(null);
    const handleSaveMetadata = useCallback((updatedMetadata, options = {}) => {
        const currentMetadata = updatedMetadata || metadataRef.current;
        if (options.immediate) {
            if (metaSaveTimerRef.current) clearTimeout(metaSaveTimerRef.current);
            metaSaveTimerRef.current = null;
            void _doSaveMetadata(currentMetadata);
            return;
        }
        if (metaSaveTimerRef.current) clearTimeout(metaSaveTimerRef.current);
        metaSaveTimerRef.current = setTimeout(() => {
            metaSaveTimerRef.current = null;
            void _doSaveMetadata(currentMetadata);
        }, 600);
    }, [_doSaveMetadata]);

    // Flush any pending debounced save when the note changes or the editor
    // unmounts — otherwise the user's last keystroke can be lost.
    useEffect(() => {
        return () => {
            if (metaSaveTimerRef.current) {
                clearTimeout(metaSaveTimerRef.current);
                metaSaveTimerRef.current = null;
                // Best-effort flush of the latest metadata snapshot.
                void _doSaveMetadata(metadataRef.current);
            }
        };
    }, [noteFilename, _doSaveMetadata]);

    const handleTitleChange = (e) => { const nextTitle = e.target.value; const nextMeta = { ...metadata, title: nextTitle }; setMetadata(nextMeta); handleSaveMetadata(nextMeta); };

    useEffect(() => {
        autoGrowTextarea(titleInputRef.current);
    }, [metadata.title]);
    const handleMetaChange = (key, value) => {
        const nextMeta = { ...metadata, [key]: value };
        setMetadata(nextMeta);
        // Icona i portada són accions discretes (un sol click): salta el
        // debounce i actualitza el sidebar de seguida amb un patch optimista
        // perquè la nova icona aparegui immediatament a la barra lateral.
        const isDiscrete = key === 'icon' || key === 'cover';
        if (isDiscrete && onUpdatePageMetadata && noteFilename) {
            onUpdatePageMetadata(noteFilename, { [key]: value });
        }
        handleSaveMetadata(nextMeta, isDiscrete ? { immediate: true } : undefined);
    };
    // Removing a property is a structural change → save immediately so the
    // server-side state can never have a "stale" property removed only
    // locally if the user navigates away within 600ms.
    const handleRemoveProperty = (key) => { const nextMeta = { ...metadata }; delete nextMeta[key]; setMetadata(nextMeta); handleSaveMetadata(nextMeta, { immediate: true }); };
    const rawTableId = metadata.table_id || metadata.database_table_id || metadata.resolved_table_id;
    const currentTableId = String(rawTableId || '').toLowerCase() === 'wiki' ? null : rawTableId;
    const currentTable = (allTables || []).find(t => t.id === currentTableId);
    // Les opcions de `select`/`multi_select` viuen al backend dins de
    // `prop.config.options`; alguns paths legacy les escrivien al top-level
    // `prop.options`. Aquest helper les unifica perquè el dropdown sempre
    // mostri les ja definides al schema, independentment d'on vinguin.
    const getPropOptions = (prop) => {
        if (!prop) return [];
        if (Array.isArray(prop.options) && prop.options.length > 0) return prop.options;
        if (prop.config && Array.isArray(prop.config.options)) return prop.config.options;
        return [];
    };
    // `properties` is the filtered schema list shown above the body. Memoized
    // because the title input rerenders on every keystroke and recomputing
    // this 10-key filter for every table with 100+ properties was visible in
    // profiling.
    const properties = useMemo(() => {
        return (currentTable?.properties || []).filter(prop => {
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
    }, [currentTable]);

    // `adhocProperties` is the list of metadata keys that aren't part of the
    // schema. Memoized for the same reason; also we rebuild a Set for O(1)
    // schema lookup instead of `properties.find` per key (was O(n*m)).
    const adhocProperties = useMemo(() => {
        const schemaNames = new Set(properties.map(p => p.name));
        return Object.keys(metadata).filter(key => {
            const normalizedKey = String(key || '').toLowerCase();
            return (
                !INTERNAL_METADATA_KEY_SET.has(key) &&
                !normalizedKey.endsWith('_manual') &&
                !normalizedKey.startsWith('favorite') &&
                !normalizedKey.startsWith('icon_') &&
                !normalizedKey.startsWith('cover_') &&
                !schemaNames.has(key)
            );
        });
    }, [metadata, properties]);

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
        if (!safeId) return 'no-id';
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
        if (!title) return id || 'untitled';

        const normalized = title.toLowerCase();
        const repeatedTitle = (incomingTitleCounts.get(normalized) || 0) > 1;
        const sameTitleAsCurrent = Boolean(currentTitleNormalized) && normalized === currentTitleNormalized;

        if (repeatedTitle || sameTitleAsCurrent) {
            return `${title} (${formatIncomingDisambiguator(id)})`;
        }

        return title;
    }, [incomingTitleCounts, currentTitleNormalized, formatIncomingDisambiguator]);

    useEffect(() => {
        const controller = new AbortController();

        const loadIncomingLinks = async () => {
            if (!noteFilename) {
                setIncomingLinks([]);
                return;
            }

            setIncomingLinksLoading(true);
            try {
                const response = await axios.get('/api/vault/backlinks', {
                    params: { id: noteFilename },
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;

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
                if (controller.signal.aborted || error?.name === 'CanceledError' || axios.isCancel?.(error)) return;
                logError('load-backlinks', error);
                setIncomingLinks([]);
            } finally {
                if (!controller.signal.aborted) {
                    setIncomingLinksLoading(false);
                }
            }
        };

        loadIncomingLinks();
        return () => {
            controller.abort();
        };
    }, [noteFilename, idToTitle]);

    useEffect(() => {
        const controller = new AbortController();

        const loadUnlinkedMentions = async () => {
            if (!noteFilename) {
                setUnlinkedMentions([]);
                return;
            }

            setUnlinkedMentionsLoading(true);
            try {
                const response = await axios.get('/api/vault/unlinked-mentions', {
                    params: { id: noteFilename },
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;
                const items = Array.isArray(response?.data) ? response.data : [];
                setUnlinkedMentions(items);
            } catch (error) {
                if (controller.signal.aborted || error?.name === 'CanceledError' || axios.isCancel?.(error)) return;
                logError('load-unlinked-mentions', error);
                setUnlinkedMentions([]);
            } finally {
                if (!controller.signal.aborted) {
                    setUnlinkedMentionsLoading(false);
                }
            }
        };

        loadUnlinkedMentions();
        return () => {
            controller.abort();
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
                toast.success(t('editor.mentions_linked', { count: replacements, notes: changed }));
            } else {
                toast(t('editor.no_pending_mentions'));
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
            notifyError('link-mentions', error, t('editor.link_mentions_error'));
        } finally {
            setLinkMentionsBusy(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- t() is stable
    }, [noteFilename, idToTitle, onRefreshNotes]);

    useEffect(() => {
        if (historyOpenSignal > 0) {
            setIsHistoryOpen(true);
        }
    }, [historyOpenSignal]);

    // Listen for optimistic-concurrency conflicts from the etag interceptor.
    // The backend returns 409 with `etag_mismatch` when the .md on disk has
    // changed since this client GET'd it (typical case in personal mode:
    // user edited the same note on the phone and OneDrive synced). We show a
    // non-destructive toast offering to reload — never auto-overwrite.
    useEffect(() => {
        const handler = (ev) => {
            const { pageId, message } = ev.detail || {};
            // Ignore conflicts for other pages (other tabs etc.)
            if (pageId && pageId !== noteFilename) return;
            toast.error(
                message ||
                "El fitxer s'ha modificat fora d'aquesta finestra. Recarrega per veure els canvis.",
                {
                    duration: 8000,
                    id: `etag-conflict-${noteFilename}`,
                },
            );
        };
        window.addEventListener('pageEtagConflict', handler);
        return () => window.removeEventListener('pageEtagConflict', handler);
    }, [noteFilename]);

    return (
        <div className="w-full flex justify-center bg-[var(--bg-primary)] min-h-full transition-colors duration-300">
            <div className="max-w-4xl w-full flex flex-col min-h-full bg-[var(--bg-primary)] relative transition-colors duration-300">
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
                        
                        <div className={`absolute bottom-4 right-8 flex items-center gap-2 transition-opacity duration-200 ${isHeaderHovered ? 'opacity-100' : 'opacity-0'}`}>
                            {!metadata.icon && (
                                <button 
                                    onClick={() => setIsIconPickerOpen(true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-primary)]/80 hover:bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-sm backdrop-blur-md rounded-md text-xs font-semibold text-[var(--text-secondary)] transition-all"
                                >
                                    <Smile size={14} />
                                    {t('editor.add_icon')}
                                </button>
                            )}
                            <button 
                                ref={coverTriggerRef}
                                onClick={() => setIsCoverPickerOpen(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-primary)]/80 hover:bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-sm backdrop-blur-md rounded-md text-xs font-semibold text-[var(--text-secondary)] transition-all"
                            >
                                <LayoutPanelLeft size={14} />
                                {metadata.cover ? t('editor.change_cover') : t('editor.add_cover')}
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
                                    <span className="text-[10px] font-bold uppercase tracking-wider">{t('common.icon')}</span>
                                </div>
                            )}

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
                            <textarea
                                ref={titleInputRef}
                                rows={1}
                                value={metadata.title || ""}
                                onChange={handleTitleChange}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); } }}
                                placeholder={t('editor.untitled')}
                                className="flex-1 text-4xl font-bold border-none outline-none placeholder:[var(--text-tertiary)]/20 text-[var(--text-primary)] bg-transparent resize-none overflow-hidden leading-tight break-words"
                            />
                            <div className="flex items-center gap-2 shrink-0 animate-in fade-in duration-300 justify-end">
                                {/* El toggle MD/Normal s'ha consolidat al menú "page options"
                                    del VaultShell (botó MoreHorizontal a la barra superior)
                                    perquè col·lisionava amb el títol llarg de la pàgina i
                                    duplicava la mateixa funció al menu dropdown. */}
                                {saveStatus === 'saving' && (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--gnosi-primary)]/5 text-[var(--gnosi-primary)]/60 text-[10px] font-bold uppercase tracking-wider">
                                        <Loader2 size={12} className="animate-spin" />
                                        {t('editor.saving')}
                                    </div>
                                )}
                                {saveStatus === 'saved' && (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--status-success)]/5 text-[var(--status-success)]/60 text-[10px] font-bold uppercase tracking-wider">
                                        <CheckSquare size={12} />
                                        {t('editor.saved')}
                                    </div>
                                )}
                                {saveStatus === 'error' && (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--status-error)]/5 text-[var(--status-error)]/60 text-[10px] font-bold uppercase tracking-wider">
                                        <X size={12} />
                                        {t('editor.save_error')}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-0.5 items-center px-1 mb-1.5">
                            <div className="col-span-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 overflow-hidden">
                                <div className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[var(--bg-secondary)]/60 transition-colors">
                                    <button
                                        type="button"
                                        onClick={() => setIsPropertiesOpen((prev) => !prev)}
                                        className="flex-1 flex items-center gap-2 min-w-0 text-left"
                                    >
                                        <Settings size={14} className="text-[var(--text-secondary)]/80" />
                                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/85">
                                            {t('common.properties')}
                                        </div>
                                        <div className="text-[11px] text-[var(--text-tertiary)]/80 truncate">
                                            {t('common.schema')} {properties.length} · {t('common.local')} {adhocProperties.length}
                                        </div>
                                    </button>
                                    {/* Botó d'enrichment per identificador (DOI/ISBN/arXiv/URL).
                                        Sempre present si l'editor és editable. */}
                                    {isEditable && (
                                        <button
                                            type="button"
                                            onClick={() => setIsMetadataLookupOpen(true)}
                                            className="text-[11px] px-2 py-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--gnosi-primary)] transition-colors shrink-0 flex items-center gap-1"
                                            title={t('metadata_lookup.button_title', { defaultValue: 'Omplir metadades des de DOI/ISBN/arXiv/URL' })}
                                        >
                                            <Search size={12} />
                                            {t('metadata_lookup.button', { defaultValue: 'Omplir' })}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setIsPropertiesOpen((prev) => !prev)}
                                        className="shrink-0"
                                    >
                                        {isPropertiesOpen ? (
                                            <ChevronDown size={14} className="text-[var(--text-tertiary)]/80" />
                                        ) : (
                                            <ChevronRight size={14} className="text-[var(--text-tertiary)]/80" />
                                        )}
                                    </button>
                                </div>
                                {isPropertiesOpen && (
                                <div className="p-3 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]/35">
                                <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-0.5 items-center">
                                    {properties.map(prop => (
                                        <React.Fragment key={prop.name}>
                                            <div className={`flex items-center gap-1.5 group py-1 h-8 ${['files', 'autoria', 'relation', 'multi_select', 'select'].includes(prop.type) ? 'self-start' : ''}`}>
                                                <div className="p-1.5 rounded-md bg-[var(--bg-secondary)] text-[var(--text-tertiary)]/60 group-hover:bg-[var(--gnosi-primary)]/10 group-hover:text-[var(--gnosi-primary)] transition-colors">
                                                    {prop.type === 'date' ? <Calendar size={14} /> : (prop.type === 'select' ? <Tag size={14} /> : (prop.type === 'number' ? <Hash size={14} /> : <Type size={14} />))}
                                                </div>
                                                <span className="text-sm text-[var(--text-secondary)] font-medium truncate">{prop.name}</span>
                                            </div>
                                            <div className={`flex items-center gap-1.5 group ${['files', 'autoria', 'relation', 'multi_select', 'select'].includes(prop.type) ? 'min-h-[2rem] py-1' : 'h-8'}`}>
                                                {prop.type === 'relation' ? (() => {
                                                    const relatedTableId = prop.relation_database_id;
                                                    const relatedNotes = allNotes.filter(n => {
                                                        const nTableId = n.resolved_table_id || n.metadata?.table_id || n.metadata?.database_table_id;
                                                        return nTableId === relatedTableId;
                                                    });
                                                    const options = relatedNotes.map(n => n.id);
                                                    const relatedMap = { ...idToTitle, ...Object.fromEntries(relatedNotes.map(n => [n.id, n.title || idToTitle[n.id] || n.id])) };
                                                    return (
                                                        <MultiSelectPills
                                                            value={metadata[prop.name]}
                                                            onChange={val => isEditor && handleMetaChange(prop.name, val)}
                                                            options={options}
                                                            idToTitle={relatedMap}
                                                            placeholder={isEditor ? t('editor.add_options') : t('common.empty')}
                                                        />
                                                    );
                                                })() : prop.type === 'multi_select' ? (
                                                    <MultiSelectPills
                                                        value={metadata[prop.name]}
                                                        onChange={val => isEditor && handleMetaChange(prop.name, val)}
                                                        options={getPropOptions(prop)}
                                                        idToTitle={idToTitle || {}}
                                                        placeholder={isEditor ? t('editor.add_options') : t('common.empty')}
                                                        onCreate={val => {
                                                            if (!isEditor) return;
                                                            const nextOptions = [...getPropOptions(prop), val];
                                                            // Persisteix l'opció al schema (PATCH a la taula)
                                                            // i selecciona-la al registre actual. Si el handler
                                                            // no existeix, el valor només queda al metadata.
                                                            if (onAddSchemaOption && currentTableId && prop.id) {
                                                                onAddSchemaOption(currentTableId, prop.id, nextOptions);
                                                            }
                                                            handleMetaChange(prop.name, [...(Array.isArray(metadata[prop.name]) ? metadata[prop.name] : []), val]);
                                                        }}
                                                    />
                                                ) : prop.type === 'select' ? (
                                                    <MultiSelectPills
                                                        single
                                                        value={metadata[prop.name]}
                                                        onChange={val => isEditor && handleMetaChange(prop.name, val)}
                                                        options={getPropOptions(prop)}
                                                        idToTitle={idToTitle || {}}
                                                        placeholder={isEditor ? t('editor.add_options') : t('common.empty')}
                                                        onCreate={val => {
                                                            if (!isEditor) return;
                                                            const nextOptions = [...getPropOptions(prop), val];
                                                            if (onAddSchemaOption && currentTableId && prop.id) {
                                                                onAddSchemaOption(currentTableId, prop.id, nextOptions);
                                                            }
                                                            handleMetaChange(prop.name, val);
                                                        }}
                                                    />
                                                ) : prop.type === 'autoria' ? (
                                                    isEditor ? (
                                                        <AutoriaEditor
                                                            value={metadata[prop.name]}
                                                            suggestions={dedupeAuthors((allNotes || []).map(n => n.metadata?.[prop.name]))}
                                                            onSave={val => handleMetaChange(prop.name, val)}
                                                        />
                                                    ) : (
                                                        <AutoriaDisplay value={metadata[prop.name]} emptyText={t('common.empty')} />
                                                    )
                                                ) : prop.type === 'files' ? (
                                                    <div className="w-full">
                                                        {isEditor ? (
                                                            <FileAttachmentField
                                                                tableId={rawTableId}
                                                                propertyName={prop.name}
                                                                storageFolder={prop.storage_folder || 'assets'}
                                                                namePattern={prop.name_pattern || ''}
                                                                rowMetadata={metadata}
                                                                value={metadata[prop.name] || ''}
                                                                onChange={val => handleMetaChange(prop.name, val)}
                                                                apiFetch={apiFetch}
                                                            />
                                                        ) : (
                                                            <FileFieldValue value={metadata[prop.name]} field={prop.name} variant="detail" />
                                                        )}
                                                    </div>
                                                ) : (
                                                    <input disabled={!isEditor} type={prop.type === 'number' ? 'number' : (prop.type === 'date' ? 'date' : 'text')} value={metadata[prop.name] || ""} onChange={e => handleMetaChange(prop.name, e.target.value)} placeholder={t('common.empty')} className="w-full bg-transparent border-none rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] transition-all placeholder:[var(--text-tertiary)]/20 font-medium h-7 disabled:cursor-not-allowed" />
                                                )}
                                                {!currentTable && (
                                                    <button onClick={() => handleRemoveProperty(prop.name)} className="opacity-0 group-hover:opacity-100 p-1.5 text-[var(--text-tertiary)]/40 hover:text-[var(--status-error)] transition-all shrink-0" title={t('editor.remove_property')}><X size={14} /></button>
                                                )}
                                            </div>
                                        </React.Fragment>
                                    ))}

                                    {adhocProperties.map(key => (
                                        <React.Fragment key={key}>
                                            <div className="flex items-center gap-1.5 group py-1 h-8">
                                                <div className="p-1.5 rounded-md bg-[var(--bg-secondary)] text-[var(--gnosi-primary)]/40 group-hover:bg-[var(--gnosi-primary)]/10 transition-colors border border-[var(--gnosi-primary)]/10"><Settings size={14} /></div>
                                                <span className="text-sm text-[var(--text-secondary)] font-medium truncate italic">{key}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 group h-8">
                                                <input 
                                                    disabled={!isEditor}
                                                    type="text" 
                                                    value={metadata[key] || ""} 
                                                    onChange={e => handleMetaChange(key, e.target.value)} 
                                                    placeholder={t('editor.empty_local')} 
                                                    className="w-full bg-transparent border-none rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] transition-all placeholder:[var(--text-tertiary)]/20 font-medium h-7 disabled:cursor-not-allowed" 
                                                />
                                                {!currentTable && (
                                                    <button onClick={() => handleRemoveProperty(key)} className="opacity-0 group-hover:opacity-100 p-1.5 text-[var(--text-tertiary)]/40 hover:text-[var(--status-error)] transition-all shrink-0" title={t('editor.remove_local_property')}><X size={14} /></button>
                                                )}
                                            </div>
                                        </React.Fragment>
                                    ))}

                                    <div className="col-span-2 flex gap-2.5 mt-1.5">
                                        {!currentTable && (!isAddingProp ? (
                                            <button
                                                onClick={() => setIsAddingProp(true)}
                                                className="btn btn-gnosi-primary flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold"
                                            >
                                                <Plus size={14} /> {t('editor.add_property')}
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                                                <input
                                                    autoFocus
                                                    className="bg-[var(--bg-secondary)] border border-[var(--gnosi-primary)]/30 rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                                                    placeholder={t('editor.property_name_placeholder')}
                                                    value={newPropName}
                                                    onChange={e => setNewPropName(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleAddAdhocProperty()}
                                                    onBlur={() => !newPropName && setIsAddingProp(false)}
                                                />
                                                <button onClick={handleAddAdhocProperty} className="p-1.5 bg-[var(--gnosi-primary)] text-white rounded-lg hover:brightness-110 transition-all"><Plus size={16} /></button>
                                                <button onClick={() => { setIsAddingProp(false); setNewPropName(""); }} className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--status-error)] transition-all"><X size={16} /></button>
                                            </div>
                                        ))}
                                        {currentTable && isEditor && (
                                            <button onClick={() => onEditSchema(currentTable)} className="btn btn-gnosi-primary flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold">
                                                <Settings size={14} /> {t('editor.manage_fields')}
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
                                            {t('editor.links_and_mentions')}
                                        </div>
                                        <div className="text-[11px] text-[var(--text-tertiary)]/80 truncate">
                                            {t('editor.outgoing')} {outgoingLinks.length} · {t('editor.incoming')} {incomingLinks.length} · {t('editor.pending')} {unlinkedMentions.length}
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
                                                {t('editor.links_to')} ({outgoingLinks.length})
                                            </div>
                                            {outgoingLinks.length === 0 ? (
                                                <div className="text-xs text-[var(--text-tertiary)]/70">{t('editor.no_outgoing_links')}</div>
                                            ) : (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {outgoingLinks.map((link, idx) => (
                                                        link.id ? (
                                                            <button
                                                                type="button"
                                                                key={`${link.id}-${idx}`}
                                                                onClick={() => openLinkedPage(link.id)}
                                                                className="px-2.5 py-1 text-xs rounded-full border border-[var(--gnosi-primary)]/30 bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] hover:brightness-110 transition-all"
                                                                title={t('editor.open_parallel_tooltip')}
                                                            >
                                                                {link.title}
                                                            </button>
                                                        ) : (
                                                            <span
                                                                key={`${link.title}-${idx}`}
                                                                className="px-2.5 py-1 text-xs rounded-full border border-[var(--border-primary)] text-[var(--text-tertiary)]/80"
                                                                title={t('editor.unresolved_link')}
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
                                                {t('editor.linked_by')} ({incomingLinks.length})
                                            </div>
                                            {incomingLinksLoading ? (
                                                <div className="text-xs text-[var(--text-tertiary)]/70 flex items-center gap-1.5">
                                                    <Loader2 size={12} className="animate-spin" />
                                                    {t('editor.loading_backlinks')}
                                                </div>
                                            ) : incomingLinks.length === 0 ? (
                                                <div className="text-xs text-[var(--text-tertiary)]/70">{t('editor.no_backlinks')}</div>
                                            ) : (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {incomingLinks.map((link) => (
                                                        <button
                                                            type="button"
                                                            key={link.id}
                                                            onClick={() => openLinkedPage(link.id)}
                                                            className="px-2.5 py-1 text-xs rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--gnosi-primary)]/40 hover:text-[var(--gnosi-primary)] transition-all"
                                                            title={t('editor.open_parallel_tooltip')}
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
                                                    {t('editor.unlinked_mentions')} ({unlinkedMentions.length})
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleLinkMentions('')}
                                                    disabled={linkMentionsBusy || unlinkedMentionsLoading || unlinkedMentions.length === 0}
                                                    className="px-2.5 py-1 text-xs rounded-md border border-[var(--gnosi-primary)]/40 bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] disabled:opacity-50"
                                                >
                                                    {linkMentionsBusy ? t('editor.linking') : t('editor.link_all')}
                                                </button>
                                            </div>

                                            {unlinkedMentionsLoading ? (
                                                <div className="text-xs text-[var(--text-tertiary)]/70 flex items-center gap-1.5">
                                                    <Loader2 size={12} className="animate-spin" />
                                                    {t('editor.searching_mentions')}
                                                </div>
                                            ) : unlinkedMentions.length === 0 ? (
                                                <div className="text-xs text-[var(--text-tertiary)]/70">{t('editor.no_unlinked_mentions')}</div>
                                            ) : (
                                                <div className="space-y-1.5">
                                                    {unlinkedMentions.slice(0, 12).map((mention) => (
                                                        <div key={mention.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-[var(--border-primary)]/70 bg-[var(--bg-primary)]/60">
                                                            <button
                                                                type="button"
                                                                onClick={() => openLinkedPage(mention.id)}
                                                                className="text-left flex-1 min-w-0"
                                                                title={t('editor.open_source_note')}
                                                            >
                                                                <div className="text-xs font-semibold text-[var(--text-primary)] truncate">{mention.title}</div>
                                                                <div className="text-[11px] text-[var(--text-tertiary)]/80 truncate">{mention.snippet || t('editor.no_snippet')}</div>
                                                            </button>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <span className="text-[11px] text-[var(--text-secondary)]/80">{mention.count}x</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleLinkMentions(String(mention.id || ''))}
                                                                    disabled={linkMentionsBusy}
                                                                    className="px-2 py-1 text-[11px] rounded-md border border-[var(--gnosi-primary)]/30 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 disabled:opacity-50"
                                                                >
                                                                    {t('editor.link_action')}
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
                        {isCodeView ? (
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
                                onUpdatePageMetadata={onUpdatePageMetadata}
                                effectiveTheme={effectiveTheme}
                                contextValue={contextValue}
                                saveStatus={saveStatus}
                                setSaveStatus={setSaveStatus}
                                metadataRef={metadataRef}
                                isEditable={isEditable}
                                onOpenPageViewModal={contextValue.openPageViewModalFromContext}
                            />
                        )}
                    </ErrorBoundary>
                </div>
            </div>
            <PageHistory pageId={noteFilename} open={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} onRestore={() => window.location.reload()} />
            <PageViewModal
                isOpen={isPageViewModalOpen}
                onClose={(changed) => {
                    setIsPageViewModalOpen(false);
                    setPageViewPreselectedTable('');
                    setPageViewEditingBlock(null);
                    if (changed) onRefreshNotes?.();
                }}
                pageId={noteFilename}
                allTables={allTables}
                apiFetch={apiFetch}
                preselectedTableId={pageViewPreselectedTable}
                editingBlock={pageViewEditingBlock}
            />

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
