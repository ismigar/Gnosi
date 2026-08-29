import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, Link2, Upload, Search, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { toast } from '../../lib/toast';
import { logError } from '../../lib/notifyError';
import {
    searchUnsplashCovers,
    uploadVaultCover,
} from '../../shared/api/vault-icons';

const PREDEFINED_COVERS = {
    'Colors i Degradats': [
        'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?q=80&w=2070&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1557672172-298e090bd0f1?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1557682250-33bd709cbe85?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1557683316-973673baf926?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop'
    ],
    'Espai i Natura': [
        'https://images.unsplash.com/photo-1614730321146-b6fa6a46bcb4?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1464802686167-b939a6910659?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?q=80&w=1000&auto=format&fit=crop'
    ],
    'Arquitectura i Textures': [
        'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1513694203232-719a280e022f?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1518640467707-6811f4a6ab73?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1506815340623-ac72147171d7?q=80&w=1000&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=1000&auto=format&fit=crop'
    ]
};

export const CoverPicker = ({ isOpen, onClose, onSelectCover, currentCover, triggerRef }) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState('gallery');
    const [linkInput, setLinkInput] = useState('');
    const pickerRef = useRef(null);
    const fileInputRef = useRef(null);

    // Upload state
    const [isUploading, setIsUploading] = useState(false);

    // Unsplash state
    const [unsplashQuery, setUnsplashQuery] = useState('');
    const [unsplashResults, setUnsplashResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target) && triggerRef.current && !triggerRef.current.contains(e.target)) {
                onClose();
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose, triggerRef]);

    // Unsplash debounce and search
    useEffect(() => {
        if (activeTab !== 'unsplash') return;

        const delayDebounceFn = setTimeout(() => {
            if (unsplashQuery.trim()) {
                fetchUnsplash(unsplashQuery);
            } else {
                setUnsplashResults([]); // Clear if empty
            }
        }, 500);

        return () => clearTimeout(delayDebounceFn);
    }, [unsplashQuery, activeTab]);

    const fetchUnsplash = async (query) => {
        setIsSearching(true);
        try {
            const response = await searchUnsplashCovers(query);
            setUnsplashResults(response.results || []);
        } catch (error) {
            logError('cover-picker', error);
            toast.error(t('cover_picker.toast.unsplash_error'));
        } finally {
            setIsSearching(false);
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const response = await uploadVaultCover(file);
            onSelectCover(response.url);
            onClose();
            toast.success(t('cover_picker.toast.upload_success'));
        } catch (error) {
            logError('cover-picker', error);
            toast.error(t('cover_picker.toast.upload_error'));
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // Esc closes the cover popover (the URL input's Enter is kept intact).
    useModalKeyboard({ isOpen, onClose });

    if (!isOpen) return null;

    const renderPopover = () => {
        let top = 60;
        let right = 20;

        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            top = rect.bottom + 8;
            right = window.innerWidth - rect.right;
        }

        return (
            <div
                ref={pickerRef}
                className="fixed z-[var(--z-popover)] w-96 bg-[var(--bg-primary)] rounded-lg shadow-2xl border border-[var(--border-primary)] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
                style={{ top: `${top}px`, right: `${right}px`, maxHeight: '600px' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Tabs Header */}
                <div className="flex items-center gap-1 font-medium text-sm text-[var(--text-secondary)]/60 border-b border-[var(--border-primary)] px-2 pt-2 bg-[var(--bg-secondary)]/50">
                    <button
                        className={`px-3 py-1.5 border-b-2 transition-colors ${activeTab === 'gallery' ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]' : 'border-transparent hover:text-[var(--text-primary)]'}`}
                        onClick={() => setActiveTab('gallery')}
                    >
                        {t('cover_picker.tabs.gallery')}
                    </button>
                    <button
                        className={`px-3 py-1.5 border-b-2 transition-colors ${activeTab === 'upload' ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]' : 'border-transparent hover:text-[var(--text-primary)]'}`}
                        onClick={() => setActiveTab('upload')}
                    >
                        {t('cover_picker.tabs.upload')}
                    </button>
                    <button
                        className={`px-3 py-1.5 border-b-2 transition-colors ${activeTab === 'link' ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]' : 'border-transparent hover:text-[var(--text-primary)]'}`}
                        onClick={() => setActiveTab('link')}
                    >
                        {t('cover_picker.tabs.link')}
                    </button>
                    <button
                        className={`px-3 py-1.5 border-b-2 transition-colors ${activeTab === 'unsplash' ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]' : 'border-transparent hover:text-[var(--text-primary)]'}`}
                        onClick={() => setActiveTab('unsplash')}
                    >
                        {t('cover_picker.tabs.unsplash')}
                    </button>

                    <div className="flex-1" />
                    {currentCover && (
                        <button
                            onClick={() => { onSelectCover(''); onClose(); }}
                            className="text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 px-2 py-1 rounded transition-colors mr-1"
                        >
                            {t('cover_picker.delete_button')}
                        </button>
                    )}
                </div>

                {/* Tab Content: Gallery */}
                {activeTab === 'gallery' && (
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4 max-h-[400px]">
                        {Object.entries(PREDEFINED_COVERS).map(([groupName, images]) => (
                            <div key={groupName}>
                                <div className="text-xs font-semibold text-[var(--text-secondary)]/60 mb-2 uppercase tracking-wider">
                                    {groupName === 'Colors i Degradats' ? t('cover_picker.groups.colors') :
                                     groupName === 'Espai i Natura' ? t('cover_picker.groups.nature') :
                                     groupName === 'Arquitectura i Textures' ? t('cover_picker.groups.architecture') :
                                     groupName}
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    {images.map((img, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => { onSelectCover(img); onClose(); }}
                                            className="h-16 rounded cursor-pointer border border-transparent hover:border-[var(--gnosi-primary)] hover:shadow-md transition-all relative overflow-hidden group bg-[var(--bg-secondary)]"
                                        >
                                            <img src={img} alt="cover option" className="w-full h-full object-cover" loading="lazy" />
                                            <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Tab Content: Upload */}
                {activeTab === 'upload' && (
                    <div className="p-4 flex flex-col gap-4 text-center">
                        <p className="text-xs text-[var(--text-secondary)]/60 mb-2">{t('cover_picker.upload_instruction')}</p>
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                            className="mx-auto w-full max-w-[200px] border border-[var(--border-primary)] hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] bg-[var(--bg-primary)] shadow-sm flex items-center justify-center gap-2 py-2 rounded-md font-bold text-sm transition-all text-[var(--text-secondary)]"
                        >
                            {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                            {isUploading ? t('cover_picker.uploading') : t('cover_picker.choose_image')}
                        </button>
                    </div>
                )}

                {/* Tab Content: Link */}
                {activeTab === 'link' && (
                    <div className="p-4 flex flex-col gap-3">
                        <p className="text-xs text-[var(--text-secondary)]/60">{t('cover_picker.link_instruction')}</p>
                        <div className="flex gap-2">
                            <input
                                autoFocus
                                value={linkInput}
                                onChange={(e) => setLinkInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && linkInput.trim()) {
                                        onSelectCover(linkInput.trim());
                                        onClose();
                                    }
                                }}
                                placeholder="https://..."
                                className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--gnosi-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)]/20 transition-all text-[var(--text-primary)]"
                            />
                            <button
                                onClick={() => {
                                    if (linkInput.trim()) {
                                        onSelectCover(linkInput.trim());
                                        onClose();
                                    }
                                }}
                                className="bg-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/90 text-white px-3 py-1.5 rounded text-sm font-bold transition-colors shadow-sm"
                            >
                                {t('cover_picker.apply_button')}
                            </button>
                        </div>
                    </div>
                )}

                {/* Tab Content: Unsplash */}
                {activeTab === 'unsplash' && (
                    <div className="flex flex-col h-[400px]">
                        <div className="p-3 border-b border-[var(--border-primary)] shadow-sm relative z-10">
                            <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]/60" />
                                <input
                                    autoFocus
                                    value={unsplashQuery}
                                    onChange={(e) => setUnsplashQuery(e.target.value)}
                                    placeholder={t('cover_picker.search_placeholder')}
                                    className="w-full pl-9 pr-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-sm outline-none focus:border-[var(--gnosi-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)]/20 transition-all text-[var(--text-primary)]"
                                />
                                {isSearching && <Loader2 size={14} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-[var(--gnosi-primary)]" />}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 relative bg-[var(--bg-secondary)]/30">
                            {unsplashResults.length === 0 && !isSearching && unsplashQuery.trim() !== '' && (
                                <div className="text-center text-[var(--text-secondary)]/60 text-sm py-4">{t('cover_picker.no_results')}</div>
                            )}
                            {unsplashResults.length === 0 && !unsplashQuery.trim() && (
                                <div className="text-center text-[var(--text-tertiary)]/60 text-sm py-8 flex flex-col items-center gap-2">
                                    <ImageIcon size={32} className="opacity-50" />
                                    <span>{t('cover_picker.unsplash_instruction')}</span>
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                                {unsplashResults.map((img) => (
                                    <div
                                        key={img.id}
                                        onClick={() => { onSelectCover(img.url); onClose(); }}
                                        className="h-20 rounded cursor-pointer border border-transparent hover:border-[var(--gnosi-primary)] hover:shadow-md transition-all relative overflow-hidden group bg-[var(--bg-secondary)]"
                                    >
                                        <img src={img.thumb} alt="unsplash result" className="w-full h-full object-cover" loading="lazy" />
                                        <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <a
                                            href={img.author_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="absolute bottom-1 left-1 opacity-0 group-hover:opacity-100 text-[9px] text-white/90 truncate w-[90%] hover:underline drop-shadow-md"
                                        >
                                            {img.author}
                                        </a>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="p-2 text-center text-[10px] text-[var(--text-tertiary)]/60 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)]">
                            {t('cover_picker.unsplash_footer')}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return typeof document !== 'undefined' ? createPortal(renderPopover(), document.body) : null;
};
