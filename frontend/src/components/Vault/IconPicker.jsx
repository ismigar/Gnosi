import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import EmojiPicker from 'emoji-picker-react';
import { icons } from 'lucide-react';
import { Search, Upload, Link2, X, Loader2, Smile } from 'lucide-react';
import axios from 'axios';
import { useTheme } from '../../hooks/useTheme';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

const NOTION_COLORS = [
    { name: 'default', color: '#37352f', label: 'Default' },
    { name: 'gray', color: '#787774', label: 'Gray' },
    { name: 'brown', color: '#976d57', label: 'Brown' },
    { name: 'orange', color: '#d9730d', label: 'Orange' },
    { name: 'yellow', color: '#dfab01', label: 'Yellow' },
    { name: 'green', color: '#0f7b6c', label: 'Green' },
    { name: 'blue', color: '#0b6e99', label: 'Blue' },
    { name: 'purple', color: '#6940a5', label: 'Purple' },
    { name: 'pink', color: '#ad1a72', label: 'Pink' },
    { name: 'red', color: '#e03e3e', label: 'Red' },
];

const FALLBACK_LUCIDE_ICONS = [
    'FileText', 'BookOpen', 'BookMarked', 'NotebookPen', 'Pencil', 'PenSquare',
    'StickyNote', 'Folder', 'FolderOpen', 'Archive', 'Tag', 'Bookmark',
    'Star', 'Heart', 'Lightbulb', 'Target', 'Brain', 'GraduationCap',
    'Calendar', 'Clock', 'AlarmClock', 'CheckCircle2', 'ListChecks',
    'MessageSquare', 'Mail', 'Phone', 'Globe', 'Link2', 'Search',
    'Camera', 'Image', 'Music', 'Video', 'Mic', 'MapPin', 'Home',
    'Building2', 'Users', 'User', 'Key', 'Shield', 'Wrench', 'Settings',
    'Database', 'BarChart3', 'PieChart', 'Activity', 'Zap', 'Sparkles',
];

export const IconPicker = ({ isOpen, onClose, onSelectIcon, currentIcon, triggerRef }) => {
    const { t } = useTranslation();
    const { effectiveTheme } = useTheme();
    const [activeTab, setActiveTab] = useState('emoji');
    const [selectedColor, setSelectedColor] = useState('default');
    const [searchTerm, setSearchTerm] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [linkInput, setLinkInput] = useState('');
    const pickerRef = useRef(null);
    const fileInputRef = useRef(null);

    // Get all available Lucide icons dynamically
    const availableIcons = useMemo(() => {
        const iconNames = Object.keys(icons)
            .filter((key) => key[0] && key[0].match(/[A-Z]/))
            .sort();

        if (iconNames.length === 0) {
            console.warn('IconPicker: lucide icon registry is empty, using fallback list.');
            return FALLBACK_LUCIDE_ICONS;
        }

        return iconNames;
    }, []);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target) && triggerRef.current && !triggerRef.current.contains(e.target)) {
                onClose();
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose, triggerRef]);

    if (!isOpen) return null;

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);
        
        setIsUploading(true);
        try {
            const res = await axios.post('/api/vault/upload-cover', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            onSelectIcon(res.data.url);
            onClose();
            toast.success(t('Icon uploaded successfully'));
        } catch (error) {
            console.error(error);
            toast.error(t('Error uploading icon'));
        } finally {
            setIsUploading(false);
        }
    };

    const filteredIcons = availableIcons.filter(name =>
        name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const renderPopover = () => {
        let top = 0;
        let left = 48;

        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            top = rect.bottom + 8;
            left = rect.left;
        }

        return (
            <div
                ref={pickerRef}
                className="fixed z-[9999] w-[350px] bg-[var(--bg-primary)] rounded-lg shadow-2xl border border-[var(--border-primary)] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
                style={{ top: `${top}px`, left: `${left}px`, maxHeight: '500px' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Tabs */}
                <div className="flex items-center gap-1 font-medium text-xs text-[var(--text-secondary)]/60 border-b border-[var(--border-primary)] px-2 pt-2 bg-[var(--bg-secondary)] shrink-0">
                    <button
                        className={`px-3 py-1.5 border-b-2 transition-colors ${activeTab === 'emoji' ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]' : 'border-transparent hover:text-[var(--text-primary)]'}`}
                        onClick={() => setActiveTab('emoji')}
                    >
                        {t('Emoji')}
                    </button>
                    <button
                        className={`px-3 py-1.5 border-b-2 transition-colors ${activeTab === 'icons' ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]' : 'border-transparent hover:text-[var(--text-primary)]'}`}
                        onClick={() => setActiveTab('icons')}
                    >
                        {t('Icons')}
                    </button>
                    <button
                        className={`px-3 py-1.5 border-b-2 transition-colors ${activeTab === 'custom' ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]' : 'border-transparent hover:text-[var(--text-primary)]'}`}
                        onClick={() => setActiveTab('custom')}
                    >
                        {t('Custom')}
                    </button>
                    <div className="flex-1" />
                    {currentIcon && (
                        <button
                            onClick={() => { onSelectIcon(''); onClose(); }}
                            className="text-[10px] text-[var(--status-error)] hover:text-[var(--status-error)]/80 hover:bg-[var(--status-error)]/10 px-2 py-1 rounded transition-colors mr-1 font-bold"
                        >
                            {t('Remove')}
                        </button>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
                    {activeTab === 'emoji' && (
                        <div className="emoji-picker-container">
                            <EmojiPicker
                                onEmojiClick={(emojiData) => {
                                    onSelectIcon(emojiData.emoji);
                                    onClose();
                                }}
                                autoFocusSearch={true}
                                theme={effectiveTheme}
                                skinTonesDisabled={true}
                                width="100%"
                                height={400}
                                previewConfig={{ showPreview: false }}
                            />
                        </div>
                    )}

                    {activeTab === 'icons' && (
                        <div className="flex flex-col h-[400px]">
                            {/* Toolbar (Search + Colors) */}
                            <div className="p-2 border-b border-[var(--border-primary)] flex flex-col gap-2 shrink-0">
                                <div className="relative">
                                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]/60" />
                                    <input
                                        autoFocus
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        placeholder={t('Search icons...')}
                                        className="w-full pl-8 pr-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-xs outline-none focus:border-[var(--gnosi-primary)] transition-all text-[var(--text-primary)] shadow-sm"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-1.5 justify-center py-1">
                                    {NOTION_COLORS.map(c => (
                                        <button
                                            key={c.name}
                                            onClick={() => setSelectedColor(c.name)}
                                            className={`w-5 h-5 rounded-full border-2 transition-all ${selectedColor === c.name ? 'border-[var(--gnosi-primary)] scale-110' : 'border-transparent hover:scale-105'}`}
                                            style={{ backgroundColor: c.color }}
                                            title={c.label}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Icons Grid */}
                            <div className="flex-1 overflow-y-auto p-2">
                                <div className="grid grid-cols-6 gap-1">
                                    {filteredIcons.map(name => {
                                        const IconComp = icons[name];
                                        const colorObj = NOTION_COLORS.find(c => c.name === selectedColor);
                                        return (
                                            <button
                                                key={name}
                                                onClick={() => {
                                                    onSelectIcon(`lucide:${name}:${selectedColor}`);
                                                    onClose();
                                                }}
                                                className="aspect-square flex items-center justify-center rounded hover:bg-[var(--bg-secondary)] transition-colors text-[var(--text-secondary)] p-2"
                                                title={name}
                                            >
                                                {IconComp && <IconComp size={20} color={colorObj?.color} />}
                                            </button>
                                        );
                                    })}
                                </div>
                                {filteredIcons.length === 0 && (
                                    <div className="text-center text-[var(--text-tertiary)]/60 text-xs py-10">{t('No icons')}</div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'custom' && (
                        <div className="flex flex-col gap-6">
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-bold text-[var(--text-tertiary)]/60 uppercase tracking-widest">{t('Upload File')}</span>
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
                                    className="w-full border border-dashed border-[var(--border-primary)] hover:border-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/5 rounded-lg py-6 flex flex-col items-center gap-2 transition-all"
                                >
                                    {isUploading ? <Loader2 size={24} className="animate-spin text-[var(--gnosi-primary)]" /> : <Upload size={24} className="text-[var(--text-tertiary)]/60" />}
                                    <span className="text-xs text-[var(--text-secondary)]/60">{isUploading ? t('Uploading...') : t('Click to upload')}</span>
                                </button>
                            </div>

                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-bold text-[var(--text-tertiary)]/60 uppercase tracking-widest">{t('Content link')}</span>
                                <div className="flex gap-2">
                                    <input
                                        value={linkInput}
                                        onChange={(e) => setLinkInput(e.target.value)}
                                        placeholder="https://..."
                                        className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded px-3 py-1.5 text-xs outline-none focus:border-[var(--gnosi-primary)] transition-all text-[var(--text-primary)]"
                                    />
                                    <button
                                        onClick={() => {
                                            if (linkInput.trim()) {
                                                onSelectIcon(linkInput.trim());
                                                onClose();
                                            }
                                        }}
                                        className="bg-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/90 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors shadow-sm"
                                    >
                                        {t('Mount')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return typeof document !== 'undefined' ? createPortal(renderPopover(), document.body) : null;
};
