import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
    X,
    Database as DatabaseIcon,
    HardDrive,
    Upload as UploadIcon,
    Link2,
    Loader2,
    File as FileIcon,
    FileText,
    Image as ImageIcon,
    Video,
    Music,
    Globe,
    Frame,
    AlertCircle,
    FolderOpen,
    Folder,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MediaPicker } from './MediaPicker';
import { FilesystemPickerModal } from '../FilesystemPickerModal';
import { fileUrlToSentinel } from './markdown-mapper';
import { toast } from '../../lib/toast';

const KIND_META = {
    image: { Icon: ImageIcon, label: 'Imatge' },
    video: { Icon: Video, label: 'Vídeo' },
    audio: { Icon: Music, label: 'Àudio' },
    pdf: { Icon: FileText, label: 'PDF' },
    doc: { Icon: FileText, label: 'Document' },
    file: { Icon: FileIcon, label: 'Fitxer' },
    folder: { Icon: Folder, label: 'Carpeta' },
    youtube: { Icon: Video, label: 'YouTube' },
    vimeo: { Icon: Video, label: 'Vimeo' },
    web: { Icon: Globe, label: 'Pàgina web' },
};

const detectUrlKind = (url) => {
    if (!url) return null;
    const lower = url.toLowerCase().split('?')[0].split('#')[0];
    if (lower.endsWith('.pdf')) return 'pdf';
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|tiff)$/i.test(lower)) return 'image';
    if (/\.(mp4|webm|ogv|mov|m4v|mkv)$/i.test(lower)) return 'video';
    if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(lower)) return 'audio';
    if (/\.(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|txt|md|rtf)$/i.test(lower)) return 'doc';
    try {
        const u = new URL(url, window.location.origin);
        const host = u.hostname.replace(/^www\./, '');
        if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') return 'youtube';
        if (host === 'vimeo.com' || host === 'player.vimeo.com') return 'vimeo';
        if (u.protocol === 'http:' || u.protocol === 'https:') return 'web';
    } catch { /* relative path */ }
    return 'file';
};

const detectPathKind = (path) => {
    if (!path) return 'file';
    const name = path.split('/').pop() || path;
    return detectUrlKind(name) || 'file';
};

const defaultModeFor = (kind) => {
    if (kind === 'pdf' || kind === 'youtube' || kind === 'vimeo' || kind === 'web') return 'frame';
    if (kind === 'image' || kind === 'video' || kind === 'audio') return 'block';
    return 'link';
};

const modeAvailableFor = (kind, mode) => {
    if (!kind) return true;
    if (mode === 'block') {
        return ['image', 'video', 'audio', 'pdf', 'doc', 'file'].includes(kind);
    }
    if (mode === 'frame') {
        return ['pdf', 'youtube', 'vimeo', 'web', 'image', 'video', 'audio'].includes(kind);
    }
    return true;
};

const TABS = [
    { id: 'vault', icon: DatabaseIcon, labelKey: 'insert.tab_vault', labelDefault: 'Vault' },
    { id: 'local', icon: HardDrive, labelKey: 'insert.tab_local', labelDefault: 'Disc local' },
    { id: 'upload', icon: UploadIcon, labelKey: 'insert.tab_upload', labelDefault: 'Puja' },
    { id: 'url', icon: Link2, labelKey: 'insert.tab_url', labelDefault: 'URL' },
];

export const InsertContentModal = ({
    open,
    onClose,
    onInsert,
    initialFile = null,
    initialTab = 'vault',
    tableId = null,
}) => {
    const { t } = useTranslation();
    const [tab, setTab] = useState(initialTab);
    const [selected, setSelected] = useState(null);
    const [mode, setMode] = useState('link');
    const [busy, setBusy] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const [uploadFile, setUploadFile] = useState(initialFile);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [pickerOpen, setPickerOpen] = useState(false);
    const uploadInputRef = useRef(null);

    useEffect(() => {
        if (!selected?.kind) return;
        setMode((current) => modeAvailableFor(selected.kind, current) ? current : defaultModeFor(selected.kind));
    }, [selected?.kind]);

    useEffect(() => {
        if (!open) return undefined;
        const handler = (e) => {
            if (e.key === 'Escape' && !pickerOpen) {
                e.stopPropagation();
                e.preventDefault();
                onClose?.();
            }
        };
        // Capture phase: BlockNote (ProseMirror) atrapa Esc al bubble phase.
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [open, onClose, pickerOpen]);

    useEffect(() => {
        if (!open) {
            setSelected(null);
            setUrlInput('');
            setUploadFile(null);
            setUploadProgress(0);
            setBusy(false);
            setPickerOpen(false);
            setTab(initialTab);
        }
    }, [open, initialTab]);

    useEffect(() => {
        if (open && initialFile) {
            setTab('upload');
            setUploadFile(initialFile);
            const kind = detectUrlKind(initialFile.name) || 'file';
            setSelected({ source: 'upload-pending', name: initialFile.name, kind });
        }
    }, [open, initialFile]);

    // Cada tab gestiona la seva pròpia selecció. En canviar de tab, la
    // selecció del tab anterior deixa de ser vàlida: sense aquest reset, un
    // fitxer arrossegat (selected='upload-pending') seguia actiu després de
    // passar a "Disc local" i el botó Insereix acabava pujant a Assets
    // igualment. El tab "Puja" recupera la selecció upload-pending mentre hi
    // hagi un `uploadFile`; els altres tabs queden a null fins que l'usuari
    // hi triï alguna cosa (handleSelectVault / handleSelectLocal /
    // handleUrlChange), cosa que també desactiva el botó Insereix.
    useEffect(() => {
        if (tab === 'upload') {
            if (uploadFile) {
                const kind = detectUrlKind(uploadFile.name) || 'file';
                setSelected({ source: 'upload-pending', name: uploadFile.name, kind });
            } else {
                setSelected(null);
            }
        } else {
            setSelected(null);
        }
    }, [tab, uploadFile]);

    const handleSelectVault = useCallback((item) => {
        if (!item?.url) return;
        const kind = item.kind || detectUrlKind(item.url) || 'file';
        setSelected({
            source: 'vault',
            url: item.url,
            name: item.filename || item.name || item.url,
            kind,
        });
    }, []);

    const handleSelectLocal = useCallback((absolutePath, { isDir = false } = {}) => {
        if (!absolutePath) return;
        const name = absolutePath.split('/').pop() || absolutePath;
        if (isDir) {
            // Una carpeta no es pot servir ni incrustar: només té sentit
            // enllaçar-la. handleConfirm la converteix al sentinel file://
            // perquè useFileLinkInterceptor l'obri al Finder en clicar-la.
            setSelected({ source: 'local-folder', path: absolutePath, name, kind: 'folder' });
        } else {
            const kind = detectPathKind(absolutePath);
            setSelected({ source: 'local', path: absolutePath, name, kind });
        }
        setPickerOpen(false);
    }, []);

    const handleUrlChange = useCallback((value) => {
        setUrlInput(value);
        const trimmed = value.trim();
        if (!trimmed) {
            setSelected(null);
            return;
        }
        const kind = detectUrlKind(trimmed) || 'web';
        const filename = (() => {
            try {
                const u = new URL(trimmed, window.location.origin);
                const last = u.pathname.split('/').filter(Boolean).pop();
                return decodeURIComponent(last || u.hostname || trimmed);
            } catch { return trimmed; }
        })();
        setSelected({ source: 'url', url: trimmed, name: filename, kind });
    }, []);

    const handlePickUploadFile = useCallback((file) => {
        if (!file) return;
        setUploadFile(file);
        const kind = detectUrlKind(file.name) || 'file';
        setSelected({ source: 'upload-pending', name: file.name, kind });
    }, []);

    const handleUploadDrop = useCallback((e) => {
        e.preventDefault();
        const f = e.dataTransfer?.files?.[0];
        if (f) handlePickUploadFile(f);
    }, [handlePickUploadFile]);

    const performUpload = useCallback(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        const url = tableId ? `/api/vault/assets/upload?table_id=${encodeURIComponent(tableId)}` : '/api/vault/assets/upload';
        const { data } = await axios.post(url, formData, {
            onUploadProgress: (evt) => {
                if (evt.total) setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
            },
        });
        return data?.url;
    }, [tableId]);

    const registerLocalFile = useCallback(async (path) => {
        const { data } = await axios.post('/api/vault/local-file/register', { file_path: path });
        return data?.url;
    }, []);

    const canInsert = useMemo(() => {
        if (!selected) return false;
        if (selected.source === 'upload-pending' && !uploadFile) return false;
        if (selected.source === 'url' && !urlInput.trim()) return false;
        return modeAvailableFor(selected.kind, mode);
    }, [selected, uploadFile, urlInput, mode]);

    const handleConfirm = useCallback(async () => {
        if (!selected) return;
        setBusy(true);
        try {
            let finalUrl = selected.url || '';
            if (selected.source === 'upload-pending' && uploadFile) {
                finalUrl = await performUpload(uploadFile);
            } else if (selected.source === 'local' && selected.path) {
                finalUrl = await registerLocalFile(selected.path);
            } else if (selected.source === 'local-folder' && selected.path) {
                // El sentinel passa la validació de Tiptap (és https://) i
                // useFileLinkInterceptor el reconverteix a file:// per obrir
                // la carpeta al Finder. blocksToRichMarkdown el desa com a
                // file:// al disc.
                finalUrl = fileUrlToSentinel(`file://${selected.path}`);
            }
            if (!finalUrl) {
                throw new Error("No s'ha pogut obtenir la URL final");
            }
            onInsert?.({ url: finalUrl, mode, kind: selected.kind, name: selected.name });
            onClose?.();
        } catch (e) {
            const msg = e?.response?.data?.detail || e?.response?.data?.error || e?.message || 'Error desconegut';
            toast.error(t('insert.error', { defaultValue: 'Error inserint: {{msg}}', msg }));
        } finally {
            setBusy(false);
        }
    }, [selected, uploadFile, mode, performUpload, registerLocalFile, onInsert, onClose, t]);

    if (!open) return null;

    const SelectedKindMeta = selected?.kind && KIND_META[selected.kind];

    return (
        <>
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] max-h-[760px] flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-primary)]">
                        <h2 className="text-base font-semibold flex items-center gap-2">
                            <Frame size={18} />
                            {t('insert.title', { defaultValue: 'Insereix contingut' })}
                        </h2>
                        <button onClick={onClose} className="p-1.5 rounded hover:bg-[var(--bg-secondary)]" aria-label="Close">
                            <X size={16} />
                        </button>
                    </div>

                    <div className="flex border-b border-[var(--border-primary)]">
                        {TABS.map(({ id, icon: Icon, labelKey, labelDefault }) => (
                            <button
                                key={id}
                                onClick={() => setTab(id)}
                                className={`px-4 py-2.5 text-sm flex items-center gap-2 border-b-2 transition-colors ${
                                    tab === id
                                        ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]'
                                        : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                                }`}
                            >
                                <Icon size={14} />
                                {t(labelKey, { defaultValue: labelDefault })}
                            </button>
                        ))}
                    </div>

                    <div className="flex-1 overflow-hidden p-4">
                        {tab === 'vault' && (
                            <div className="h-full">
                                <MediaPicker onSelect={handleSelectVault} onCancel={() => {}} />
                            </div>
                        )}

                        {tab === 'local' && (
                            <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-8">
                                <FolderOpen size={48} className="text-[var(--text-tertiary)]" />
                                {uploadFile ? (
                                    // Hi ha un fitxer arrossegat/triat: el navegador NO en
                                    // dóna la ruta absoluta, així que per enllaçar-lo sense
                                    // copiar cal localitzar-lo al disc. Ho expliquem perquè
                                    // no sembli que es demana "tornar a buscar" sense motiu.
                                    <div>
                                        <div className="text-sm font-semibold">
                                            {t('insert.local_relocate_title', { defaultValue: 'Localitza «{{name}}» al disc', name: uploadFile.name })}
                                        </div>
                                        <div className="text-xs text-[var(--text-tertiary)] mt-1 max-w-md">
                                            {t('insert.local_relocate_hint', { defaultValue: "El navegador no comparteix la ruta dels fitxers arrossegats. Per enllaçar-lo sense copiar-lo, localitza'l. O torna a «Puja» per copiar-lo al Vault." })}
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div className="text-sm font-semibold">{t('insert.local_intro', { defaultValue: 'Navega pel disc fins al fitxer o carpeta' })}</div>
                                        <div className="text-xs text-[var(--text-tertiary)] mt-1">{t('insert.local_subtitle', { defaultValue: 'Pots cercar entre carpetes i tot el contingut del Mac' })}</div>
                                    </div>
                                )}
                                {(selected?.source === 'local' || selected?.source === 'local-folder') && (
                                    <div className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] text-xs font-mono break-all max-w-full">
                                        {selected.path}
                                    </div>
                                )}
                                <button
                                    onClick={() => setPickerOpen(true)}
                                    className="px-4 py-2 rounded-lg bg-[var(--gnosi-primary)] text-white text-sm hover:opacity-90 flex items-center gap-2"
                                >
                                    <FolderOpen size={14} />
                                    {(selected?.source === 'local' || selected?.source === 'local-folder')
                                        ? t('insert.local_change', { defaultValue: 'Canvia la selecció' })
                                        : t('insert.local_open', { defaultValue: 'Obre el navegador de fitxers' })}
                                </button>
                            </div>
                        )}

                        {tab === 'upload' && (
                            <div className="h-full flex flex-col gap-3">
                                <div
                                    onDrop={handleUploadDrop}
                                    onDragOver={(e) => e.preventDefault()}
                                    onClick={() => uploadInputRef.current?.click()}
                                    className="flex-1 border-2 border-dashed border-[var(--border-primary)] rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[var(--gnosi-primary)]/40 hover:bg-[var(--bg-secondary)]/30 transition-colors"
                                >
                                    <UploadIcon size={32} className="text-[var(--text-tertiary)]" />
                                    {uploadFile ? (
                                        <>
                                            <div className="text-sm font-medium">{uploadFile.name}</div>
                                            <div className="text-xs text-[var(--text-tertiary)]">
                                                {(uploadFile.size / 1024 / 1024).toFixed(2)} MB
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="text-sm font-medium">{t('insert.drop_or_click', { defaultValue: 'Arrossega un fitxer aquí o clica per triar-lo' })}</div>
                                            <div className="text-xs text-[var(--text-tertiary)]">
                                                {t('insert.upload_target', { defaultValue: 'El fitxer es copiarà dins el Vault (Assets/)' })}
                                            </div>
                                        </>
                                    )}
                                    <input
                                        ref={uploadInputRef}
                                        type="file"
                                        className="hidden"
                                        onChange={(e) => handlePickUploadFile(e.target.files?.[0])}
                                    />
                                </div>
                                {busy && uploadProgress > 0 && uploadProgress < 100 && (
                                    <div className="h-1.5 bg-[var(--bg-secondary)] rounded overflow-hidden">
                                        <div className="h-full bg-[var(--gnosi-primary)] transition-all" style={{ width: `${uploadProgress}%` }} />
                                    </div>
                                )}
                            </div>
                        )}

                        {tab === 'url' && (
                            <div className="h-full flex flex-col gap-3">
                                <input
                                    type="url"
                                    autoFocus
                                    value={urlInput}
                                    onChange={(e) => handleUrlChange(e.target.value)}
                                    placeholder="https://…"
                                    className="px-4 py-3 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/40"
                                />
                                <div className="flex-1 rounded-lg border border-dashed border-[var(--border-primary)] flex items-center justify-center text-sm text-[var(--text-tertiary)] p-4">
                                    {selected?.url ? (
                                        <div className="text-center space-y-2">
                                            {SelectedKindMeta && (
                                                <div className="flex items-center justify-center gap-2 text-[var(--text-primary)]">
                                                    <SelectedKindMeta.Icon size={20} />
                                                    <span className="font-medium">{SelectedKindMeta.label}</span>
                                                </div>
                                            )}
                                            <div className="text-xs break-all opacity-70">{selected.url}</div>
                                            {(selected.kind === 'youtube' || selected.kind === 'vimeo' || selected.kind === 'pdf') && (
                                                <div className="text-xs text-[var(--gnosi-primary)] font-medium">
                                                    {t('insert.frame_recommended', { defaultValue: '→ Frame incrustat recomanat' })}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <span>{t('insert.url_hint', { defaultValue: "Enganxa una URL externa per veure'n una previsualització" })}</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-[var(--border-primary)] px-5 py-3 space-y-3">
                        <div className="flex items-center gap-2 text-sm">
                            {selected ? (
                                <>
                                    <div className="flex items-center gap-2 text-[var(--text-secondary)] min-w-0">
                                        {SelectedKindMeta?.Icon && <SelectedKindMeta.Icon size={14} className="shrink-0" />}
                                        <span className="truncate" title={selected.name}>{selected.name}</span>
                                    </div>
                                    <div className="text-[var(--text-tertiary)] text-xs ml-auto shrink-0">
                                        {selected.source === 'vault' && t('insert.from_vault', { defaultValue: 'Del Vault' })}
                                        {selected.source === 'local' && t('insert.from_local', { defaultValue: 'Disc local' })}
                                        {selected.source === 'local-folder' && t('insert.from_local_folder', { defaultValue: 'Carpeta local' })}
                                        {selected.source === 'upload-pending' && t('insert.will_upload', { defaultValue: 'Es pujarà al confirmar' })}
                                        {selected.source === 'url' && t('insert.from_url', { defaultValue: 'URL externa' })}
                                    </div>
                                </>
                            ) : (
                                <span className="text-[var(--text-tertiary)] text-xs">{t('insert.no_selection', { defaultValue: 'Tria un fitxer o introdueix una URL' })}</span>
                            )}
                        </div>

                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider">{t('insert.mode', { defaultValue: 'Mode' })}</span>
                                {[
                                    { value: 'link', label: t('insert.mode_link', { defaultValue: 'Enllaç' }) },
                                    { value: 'frame', label: t('insert.mode_frame', { defaultValue: 'Frame' }) },
                                    { value: 'block', label: t('insert.mode_block', { defaultValue: 'Bloc' }) },
                                ].map(opt => {
                                    const disabled = selected?.kind ? !modeAvailableFor(selected.kind, opt.value) : false;
                                    const active = mode === opt.value;
                                    return (
                                        <button
                                            key={opt.value}
                                            disabled={disabled}
                                            onClick={() => setMode(opt.value)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                                active
                                                    ? 'bg-[var(--gnosi-primary)] text-white'
                                                    : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)]/70 text-[var(--text-primary)]'
                                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                                        >
                                            {opt.label}
                                        </button>
                                    );
                                })}
                                {selected?.kind && !modeAvailableFor(selected.kind, mode) && (
                                    <span className="text-[10px] text-[var(--status-warning)] flex items-center gap-1">
                                        <AlertCircle size={11} />
                                        {t('insert.mode_unavailable', { defaultValue: 'Mode no compatible amb el tipus' })}
                                    </span>
                                )}
                            </div>

                            <div className="flex gap-2 ml-auto">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 rounded-lg text-sm border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]"
                                >
                                    {t('common.cancel', { defaultValue: 'Cancel·la' })}
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={!canInsert || busy}
                                    className="px-4 py-2 rounded-lg text-sm bg-[var(--gnosi-primary)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {busy && <Loader2 size={14} className="animate-spin" />}
                                    {t('insert.confirm', { defaultValue: 'Insereix' })}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <FilesystemPickerModal
                isOpen={pickerOpen}
                mode="any"
                initialQuery={uploadFile?.name || ''}
                onClose={() => setPickerOpen(false)}
                onSelect={handleSelectLocal}
            />
        </>
    );
};

InsertContentModal.displayName = 'InsertContentModal';
