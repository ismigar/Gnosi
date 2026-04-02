import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
    FileText, 
    Calendar, 
    Clock, 
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
    MessageSquare
} from 'lucide-react';
import axios from 'axios';
import { 
    useCreateBlockNote,
    getDefaultReactSlashMenuItems,
    SuggestionMenuController,
    createReactBlockSpec
} from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/react/style.css";
import { VaultViewHeader } from './VaultViewHeader';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import PageHistory from './PageHistory';

import { VaultEditorContext } from './VaultEditorContext';
import { buildSlashCommandCatalog, buildColumnLayoutCatalog } from './slashMenuUtils';

const MultiSelectPills = ({ value, onChange, options, idToTitle, placeholder, onCreate, fieldKey }) => {
    const { t } = useTranslation();
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
                            placeholder={t("Search...")}
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
                                {t('Create "{{searchTerm}}"', { searchTerm })}
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
                    <div className="text-[10px] font-bold text-[var(--text-tertiary)]/40 px-3 py-2 uppercase tracking-wider">{t("Select Table")}</div>
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

const InlineDatabase = ({ block, editor }) => {
    const { t } = useTranslation();
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
                    <h3 className="text-sm font-semibold text-[var(--text-secondary)]">{t("Configure view")}</h3>
                    <p className="text-xs text-[var(--text-tertiary)]/60 mt-1">{t("Select a database to start")}</p>
                </div>
                <SingleSelectPill 
                    value={activeTableId} 
                    onChange={handleTableChange} 
                    options={(allTables || []).map(t => t.id)} 
                    idToTitle={Object.fromEntries((allTables || []).map(t => [t.id, t.name]))} 
                    placeholder={t("Choose table...")} 
                />
            </div>
        );
    }
    return (
        <div className="p-8 text-center text-[var(--text-tertiary)]/60 text-[11px] italic border border-[var(--border-primary)] rounded-lg bg-[var(--bg-primary)] shadow-sm my-6">
            {t("Online data editor will be available in a future update.")}
        </div>
    );
};

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static contextType = VaultEditorContext;
    static getDerivedStateFromError(error) { return { hasError: true, error }; }
    componentDidCatch(error, errorInfo) { console.error("ErrorBoundary caught an error", error, errorInfo); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-12 border-2 border-dashed border-[var(--status-error)]/30 rounded-xl bg-[var(--status-error)]/5 flex flex-col items-center gap-4 text-center my-10">
                    <div className="p-4 bg-[var(--status-error)]/10 rounded-full text-[var(--status-error)]"><X size={32} /></div>
                    <div className="max-w-md">
                        <h3 className="text-lg font-bold text-[var(--text-primary)]">{this.props.t ? this.props.t("An error occurred in the editor") : "An error occurred in the editor"}</h3>
                        <p className="text-sm text-[var(--text-tertiary)] mt-1">{this.props.t ? this.props.t("The content of this page contains unsupported or malformed blocks.") : "The content of this page contains unsupported or malformed blocks."}</p>
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

const EditorInner = ({ noteFilename, initialContent, metadata, onUpdate, idToTitle, onRefreshNotes, effectiveTheme, contextValue }) => {
    const { t } = useTranslation();
    const schema = useMemo(() => {
        const specs = {
            database: createReactBlockSpec({
                type: "database",
                propSchema: { database_table_id: { default: "" }, viewId: { default: "" }, filters: { default: "" }, sort: { default: "" }, search: { default: "" }, visibleProperties: { default: "" }, viewType: { default: "table" } },
                content: "none",
            }, { render: (props) => <InlineDatabase block={props.block} editor={props.editor} /> }),
            columnList: createReactBlockSpec({
                type: "columnList",
                propSchema: { backgroundColor: { default: "default" } },
                content: "none",
            }, { render: (props) => <div className="bn-column-list flex w-full gap-8 my-4" ref={props.contentRef} /> }),
            column: createReactBlockSpec({
                type: "column",
                propSchema: { backgroundColor: { default: "default" } },
                content: "none",
            }, { render: (props) => <div className="flex-1 min-w-[100px]" ref={props.contentRef} /> }),
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
            ) })
        };
        return BlockNoteSchema.create({
            blockSpecs: {
                ...defaultBlockSpecs,
                database: { ...specs.database(), group: "bnBlock" },
                columnList: { ...specs.columnList(), group: "bnBlock" },
                column: { ...specs.column(), group: "bnBlock" },
                toggle: { ...specs.toggle(), group: "bnBlock" },
            },
            inlineContentSpecs: defaultInlineContentSpecs,
            styleSpecs: defaultStyleSpecs,
        });
    }, []);

    const sanitizeBlocks = useCallback((blocks) => {
        if (!Array.isArray(blocks)) return blocks;
        return blocks.map(block => {
            let sanitizedBlock = { ...block };
            
            // 1. Legacy type mapping (Notion -> Modern BlockNote)
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

            // 2. Remove content if the block is one of our strict containers
            if (['columnList', 'column', 'database'].includes(sanitizedBlock.type)) {
                delete sanitizedBlock.content;
            }
            
            // 3. General safety rule for Notion data:
            // If it has content as empty array and has children, BlockNote prefers only children
            if (Array.isArray(sanitizedBlock.content) && sanitizedBlock.content.length === 0 && sanitizedBlock.children && sanitizedBlock.children.length > 0) {
                delete sanitizedBlock.content;
            }

            // Recursive traversal
            if (sanitizedBlock.children) {
                sanitizedBlock.children = sanitizeBlocks(sanitizedBlock.children);
            }
            return sanitizedBlock;
        });
    }, []);

    const editor = useCreateBlockNote({
        schema,
        initialContent: (() => {
            if (!initialContent) return undefined;
            if (typeof initialContent === 'object') return sanitizeBlocks(initialContent);
            try {
                const parsed = JSON.parse(initialContent);
                if (!Array.isArray(parsed)) return undefined;
                return sanitizeBlocks(parsed);
            } catch (e) {
                console.warn("Error parsing initial content:", e);
                return undefined;
            }
        })(),
    });

    const [editorReady, setEditorReady] = useState(false);
    useEffect(() => { if (editor) { const timer = setTimeout(() => setEditorReady(true), 100); return () => clearTimeout(timer); } }, [editor]);

    const saveTimerRef = useRef(null);
    const handleSave = useCallback(async (updatedContent, updatedMetadata) => {
        if (!noteFilename || !editor) return;
        try {
            const data = { title: updatedMetadata?.title || metadata?.title || t("Untitled"), content: updatedContent || JSON.stringify(editor.document), metadata: updatedMetadata || metadata };
            await axios.patch(`/api/vault/pages/${noteFilename}`, data);
            if (onUpdate) onUpdate(data.content, { metadata: data.metadata, title: data.title });
            if (onRefreshNotes) onRefreshNotes();
        } catch (err) { console.error("Error saving automatically:", err); }
    }, [noteFilename, metadata, editor, onUpdate, onRefreshNotes]);

    useEffect(() => {
        if (!editor) return;
        const sub = editor.onChange(() => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => handleSave(JSON.stringify(editor.document), metadata), 1000);
        });
        return () => { if (typeof sub === 'function') sub(); else if (sub && sub.remove) sub.remove(); if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [editor, handleSave, metadata]);

    if (!editorReady) return <div className="flex items-center justify-center h-[500px] text-[var(--text-tertiary)]/60"><Loader2 className="animate-spin mr-2" size={20} /> {t("Loading editor...")}</div>;

    return (
        <VaultEditorContext.Provider value={contextValue}>
            <BlockNoteView editor={editor} slashMenu={false} theme={effectiveTheme}>
                <SuggestionMenuController
                    triggerCharacter="/"
                    getItems={async (query) => {
                        if (!editor) return [];
                        const defaultItems = getDefaultReactSlashMenuItems(editor);
                        const vaultItems = buildSlashCommandCatalog({ allTables: contextValue.allTables, editor, t });
                        const layoutItems = buildColumnLayoutCatalog({ editor, t });
                        const allItems = [...defaultItems, ...vaultItems, ...layoutItems];
                        if (!query) return allItems.slice(0, 12);
                        const lowerQuery = query.toLowerCase();
                        return allItems.filter(item => item.title.toLowerCase().includes(lowerQuery) || (item.aliases && item.aliases.some(alias => alias.toLowerCase().includes(lowerQuery))));
                    }}
                />
            </BlockNoteView>
        </VaultEditorContext.Provider>
    );
};

export function BlockEditor({ noteFilename, initialContent, initialMetadata = {}, onUpdate, allTables = [], onEditSchema, onCreateRecord, onDeletePage = () => {}, onOpenParallel = () => {}, idToTitle = {}, registry = { databases: [], tables: [], views: [] }, onRefreshNotes = () => {} }) {
    const { t } = useTranslation();
    const { effectiveTheme } = useTheme();
    const [metadata, setMetadata] = useState(initialMetadata);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const contextValue = useMemo(() => ({ allTables, onEditSchema, onCreateRecord, onDeletePage, onOpenParallel, idToTitle, registry: registry || { databases: [], tables: [], views: [] } }), [allTables, onEditSchema, onCreateRecord, onDeletePage, onOpenParallel, idToTitle, registry]);
    const handleSaveMetadata = useCallback(async (updatedMetadata) => { if (!noteFilename) return; try { const data = { title: updatedMetadata?.title || metadata?.title || t("Untitled"), metadata: updatedMetadata || metadata }; await axios.patch(`/api/vault/pages/${noteFilename}`, data); if (onRefreshNotes) onRefreshNotes(); } catch (err) { console.error("Error saving metadata:", err); } }, [noteFilename, metadata, onRefreshNotes, t]);
    const handleTitleChange = (e) => { const nextTitle = e.target.value; const nextMeta = { ...metadata, title: nextTitle }; setMetadata(nextMeta); handleSaveMetadata(nextMeta); };
    const handleMetaChange = (key, value) => { const nextMeta = { ...metadata, [key]: value }; setMetadata(nextMeta); handleSaveMetadata(nextMeta); };
    const handleRemoveProperty = (key) => { const nextMeta = { ...metadata }; delete nextMeta[key]; setMetadata(nextMeta); handleSaveMetadata(nextMeta); };
    const currentTableId = metadata.table_id || metadata.database_table_id;
    const currentTable = (allTables || []).find(t => t.id === currentTableId);
    const properties = currentTable?.properties || [];
    return (
        <div className="w-full flex justify-center bg-[var(--bg-primary)] min-h-full transition-colors duration-300">
            <div className="max-w-4xl w-full py-12 px-8 min-h-full bg-[var(--bg-primary)] relative transition-colors duration-300">
                <div className="mb-10 space-y-1.5">
                    <input type="text" value={metadata.title || ""} onChange={handleTitleChange} placeholder={t("Untitled")} className="w-full text-4xl font-bold border-none outline-none placeholder:[var(--text-tertiary)]/30 text-[var(--text-primary)] mb-6 bg-transparent" />
                    <div className="absolute top-12 right-8 flex gap-2">
                         <button onClick={() => setIsHistoryOpen(true)} className="p-2 text-[var(--text-tertiary)]/60 hover:text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 rounded-full transition-all" title={t("Version history")}><Clock size={20} /></button>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1 items-center px-1">
                        {properties.map(prop => {
                            const value = metadata[prop.name];
                            const Icon = prop.type === 'date' ? Calendar : (prop.type === 'select' ? Tag : (prop.type === 'number' ? Hash : Type));
                            return (
                                <React.Fragment key={prop.name}>
                                    <div className="flex items-center gap-2 group py-1.5 h-9"><div className="p-1.5 rounded-md bg-[var(--bg-secondary)] text-[var(--text-tertiary)]/60 group-hover:bg-[var(--gnosi-primary)]/10 group-hover:text-[var(--gnosi-primary)] transition-colors"><Icon size={14} /></div><span className="text-sm text-[var(--text-secondary)] font-medium truncate">{prop.name}</span></div>
                                    <div className="flex items-center gap-2 group h-9">
                                        {prop.type === 'multi_select' ? (
                                            <MultiSelectPills value={value} onChange={val => handleMetaChange(prop.name, val)} options={prop.options || []} idToTitle={idToTitle || {}} placeholder={t("Add options...")} onCreate={val => { const nextOptions = [...(prop.options || []), val]; onEditSchema({ ...currentTable, properties: (properties || []).map(p => p.name === prop.name ? { ...p, options: nextOptions } : p) }); handleMetaChange(prop.name, [...(Array.isArray(value) ? value : []), val]); }} />
                                        ) : prop.type === 'select' ? (
                                            <select value={value || ""} onChange={e => handleMetaChange(prop.name, e.target.value)} className="w-full bg-[var(--bg-secondary)]/50 border border-transparent hover:border-[var(--border-primary)] rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:bg-[var(--bg-primary)] focus:border-[var(--gnosi-primary)]/40 transition-all font-medium h-8">
                                                <option value="">{t("Empty")}</option>
                                                {(prop.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                            </select>
                                        ) : (
                                            <input type={prop.type === 'number' ? 'number' : (prop.type === 'date' ? 'date' : 'text')} value={value || ""} onChange={e => handleMetaChange(prop.name, e.target.value)} placeholder={t("Empty")} className="w-full bg-transparent border-none rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] transition-all placeholder:[var(--text-tertiary)]/20 font-medium h-8" />
                                        )}
                                        <button onClick={() => handleRemoveProperty(prop.name)} className="opacity-0 group-hover:opacity-100 p-1.5 text-[var(--text-tertiary)]/40 hover:text-[var(--status-error)] transition-all shrink-0" title={t("Delete property")}><X size={14} /></button>
                                    </div>
                                </React.Fragment>
                            );
                        })}
                        <button onClick={() => onEditSchema(currentTable)} className="btn-gnosi btn-gnosi-primary !text-[10px] !py-1 !px-3 mt-2"><Plus size={14} /> {t("ADD PROPERTY")}</button>
                    </div>
                </div>
                <div className="relative -mx-10 min-h-[500px]">
                    <ErrorBoundary>
                        <EditorInner noteFilename={noteFilename} initialContent={initialContent} metadata={metadata} onUpdate={onUpdate} idToTitle={idToTitle} onRefreshNotes={onRefreshNotes} effectiveTheme={effectiveTheme} contextValue={contextValue} />
                    </ErrorBoundary>
                </div>
            </div>
            <PageHistory pageId={noteFilename} open={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} onRestore={() => window.location.reload()} />
        </div>
    );
}

const BlockEditorWithTranslation = (props) => {
    const { t } = useTranslation();
    return <BlockEditor {...props} t={t} />;
};

export default BlockEditorWithTranslation;
