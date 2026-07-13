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
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { MediaPicker } from './MediaPicker';
import { FilesystemPickerModal } from '../FilesystemPickerModal';
import { fileUrlToSentinel } from './markdown-mapper';
import { toast } from '../../lib/toast';
import { interpolateNamePattern, toAssetPreviewUrl } from '../../lib/fileResource';

/**
 * Ensure a File's bytes are readable before uploading, DOWNLOADING it first if
 * it's an online-only cloud placeholder.
 *
 * A file that lives online-only on OneDrive / iCloud Drive (a "dataless"
 * placeholder) can be picked in a file dialog — name and size come from local
 * metadata — but has no local bytes. In the browser, reading it blocks while
 * the OS hydrates it from the cloud, and that read is itself what triggers the
 * download. So we must NOT fail fast: a short deadline forced the user to retry
 * (the first attempt kicked off the download, the second finally succeeded).
 * Instead we poll a small slice until it becomes readable, giving the cloud
 * time to hydrate it, and signal `onDownloading` the moment it's clearly not
 * instant so the UI can show a "downloading" hint.
 *
 * A local file resolves on the first read (no delay). When the cloud IS
 * serving, reading triggers hydration and the poll succeeds within a few
 * seconds. When the cloud provider is wedged/offline it can't be fetched at
 * all, so we cap the wait at `maxWaitMs` and throw `Error('unreadable-file')`
 * — the caller then redirects to "Disc local", where the backend can retry the
 * download. (A long cap would just spin forever on a wedged OneDrive.)
 */
const assertFileReadable = async (
    file,
    { onDownloading, maxWaitMs = 20000, pollMs = 2000 } = {},
) => {
    if (!file || typeof file.slice !== 'function') return;
    // One slice read → true if readable, false on error/timeout. Each attempt
    // re-triggers the OS hydration of the placeholder.
    const tryReadSlice = (timeoutMs) => new Promise((resolve) => {
        let settled = false;
        const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
        const slice = file.slice(0, 4096);
        const p = typeof slice.arrayBuffer === 'function'
            ? slice.arrayBuffer()
            : new Promise((res, rej) => {
                const reader = new FileReader();
                reader.onload = () => res();
                reader.onerror = () => rej(reader.error || new Error('read error'));
                reader.readAsArrayBuffer(slice);
            });
        p.then(() => done(true), () => done(false));
        setTimeout(() => done(false), timeoutMs);
    });
    const start = performance.now();
    let announced = false;
    for (;;) {
        if (await tryReadSlice(4000)) return;
        if (performance.now() - start >= maxWaitMs) throw new Error('unreadable-file');
        // First failed read → not instantly readable → it's online-only and the
        // download has been kicked off; tell the UI so it can show progress.
        if (!announced) { announced = true; onDownloading?.(); }
        await new Promise((r) => setTimeout(r, pollMs));
    }
};

/**
 * Map an upload failure to a user-facing message. An online-only file
 * (OneDrive / iCloud) is the common non-obvious cause: either the readability
 * probe rejected (`unreadable-file`), or the transfer itself timed out because
 * the browser couldn't hydrate the placeholder fast enough. Both get an
 * actionable hint instead of a raw "timeout exceeded".
 */
const uploadErrorMessage = (e, t) => {
    if (e?.message === 'unreadable-file') {
        return t(
            'insert.error_unreadable_file',
            "No s'ha pogut llegir el fitxer. Si és online-only (OneDrive o iCloud), fes-lo disponible localment (Finder → «Mantén en aquest dispositiu») i torna-ho a provar.",
        );
    }
    const code = e?.code;
    const isTimeout = code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(String(e?.message || ''));
    if (isTimeout) {
        return t(
            'insert.error_upload_timeout',
            "La pujada ha trigat massa. Si el fitxer és online-only (OneDrive o iCloud), fes-lo disponible localment i torna-ho a provar.",
        );
    }
    return e?.response?.data?.detail || e?.response?.data?.error || e?.message || t('errors.unknown', 'Error desconegut');
};

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
    // When opened for a configured `files` field (not for inline content
    // or image fields detected by name), the upload and the link must respect
    // the field's config: destination (`storageFolder`, e.g. 'library') and
    // renamed according to `namePattern` interpolated with the row's metadata.
    fileField = null, // { propertyName, storageFolder, namePattern, fileMode } | null
    rowMetadata = {},
    imageField = false, // shows alt/title/caption/credit inputs (composite image field)
    initialImageMeta = null, // { alt, title, caption, credit } to pre-fill
}) => {
    const { t } = useTranslation();
    // Tabs that make sense depending on context: no field (inline content
    // or image fields detected by name) → all; called from a `files` field
    // → only those consistent with its `file_mode` (link = link from disk;
    // upload = upload, or link+rename an existing file).
    const allowedTabs = useMemo(() => {
        if (!fileField) return TABS.map(tb => tb.id);
        return fileField.fileMode === 'link' ? ['local'] : ['upload', 'local'];
    }, [fileField]);
    const fieldInitialTab = fileField
        ? (fileField.fileMode === 'link' ? 'local' : 'upload')
        : initialTab;
    const [tab, setTab] = useState(fieldInitialTab);
    const [selected, setSelected] = useState(null);
    const [mode, setMode] = useState('link');
    const [busy, setBusy] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const [uploadFile, setUploadFile] = useState(initialFile);
    const [uploadProgress, setUploadProgress] = useState(0);
    // True while we wait for an online-only file to download from the cloud
    // (OneDrive/iCloud) before uploading it — drives the "downloading" hint.
    const [materializing, setMaterializing] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    // Metadata for the composite image field (alt/title/caption/credit).
    const [imgMeta, setImgMeta] = useState({});
    useEffect(() => {
        if (open) setImgMeta(initialImageMeta || {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    // Src of the image already present in the field (if any). Allows showing it and saving
    // only the metadata (alt/title/…) without having to re-select it.
    const currentSrc = imageField ? (initialImageMeta?.src || '') : '';
    const uploadInputRef = useRef(null);
    const confirmBtnRef = useRef(null);
    // Ref to the modal panel: delimits the focus-trap and the scope of Enter.
    const panelRef = useRef(null);

    useEffect(() => {
        if (!selected?.kind) return;
        setMode((current) => modeAvailableFor(selected.kind, current) ? current : defaultModeFor(selected.kind));
    }, [selected?.kind]);

    useEffect(() => {
        if (!open) {
            setSelected(null);
            setUrlInput('');
            setUploadFile(null);
            setUploadProgress(0);
            setBusy(false);
            setPickerOpen(false);
            setTab(fieldInitialTab);
        }
    }, [open, fieldInitialTab]);

    // If the active tab stops making sense (e.g. we arrive with 'upload'
    // but the field is in 'link' mode), we jump to the first allowed one.
    useEffect(() => {
        if (open && !allowedTabs.includes(tab)) setTab(allowedTabs[0]);
    }, [open, allowedTabs, tab]);

    useEffect(() => {
        if (open && initialFile) {
            setTab('upload');
            setUploadFile(initialFile);
            const kind = detectUrlKind(initialFile.name) || 'file';
            setSelected({ source: 'upload-pending', name: initialFile.name, kind });
        }
    }, [open, initialFile]);

    // Each tab manages its own selection. When switching tabs, the
    // previous tab's selection stops being valid: without this reset, a
    // dragged file (selected='upload-pending') remained active after
    // switching to "Local Disk" and the Insert button ended up uploading to Assets
    // anyway. The "Upload" tab recovers the upload-pending selection as long as there is
    // an `uploadFile`; the other tabs stay null until the user
    // picks something there (handleSelectVault / handleSelectLocal /
    // handleUrlChange), which also disables the Insert button.
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
            // A folder cannot be served or embedded: it only makes sense to
            // link it. handleConfirm converts it to the file:// sentinel
            // so that useFileLinkInterceptor opens it in Finder when clicked.
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

    // Configured `files` field: upload/link route through the property's endpoints
    // (destination + renaming according to the schema) instead of the generic assets/upload.
    const isFieldUpload = Boolean(fileField?.propertyName && tableId);
    const resolvedName = fileField?.namePattern
        ? interpolateNamePattern(fileField.namePattern, rowMetadata)
        : '';

    const performUpload = useCallback(async (file) => {
        // Online-only cloud placeholders (OneDrive/iCloud) have no local bytes:
        // assertFileReadable triggers the download and waits for it (showing a
        // "downloading" hint) so the upload works on the FIRST try. A local file
        // passes through instantly.
        try {
            await assertFileReadable(file, { onDownloading: () => setMaterializing(true) });
        } finally {
            setMaterializing(false);
        }
        const formData = new FormData();
        formData.append('file', file);
        let url;
        if (isFieldUpload) {
            const params = new URLSearchParams({
                table_id: tableId,
                property_name: fileField.propertyName,
                storage_folder: fileField.storageFolder || 'assets',
            });
            if (resolvedName) params.set('target_name', resolvedName);
            url = `/api/vault/upload-property-file?${params.toString()}`;
        } else {
            url = tableId ? `/api/vault/assets/upload?table_id=${encodeURIComponent(tableId)}` : '/api/vault/assets/upload';
        }
        const { data } = await axios.post(url, formData, {
            // File uploads carry an unbounded payload and the backend writes it
            // straight to disk — slow when the Vault lives on OneDrive (warmup +
            // materialization). The global 30s cap in pageEtagInterceptor targets
            // slow external/IMAP calls, not local uploads, so a ~20MB PDF was
            // aborting with "timeout of 30000ms exceeded". Disable the cap here;
            // onUploadProgress already gives the UI a liveness signal.
            timeout: 0,
            onUploadProgress: (evt) => {
                if (evt.total) setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
            },
        });
        // Library/free return an absolute path (url=null); assets returns a served URL.
        return data?.url || data?.path;
    }, [tableId, isFieldUpload, fileField, resolvedName]);

    const registerLocalFile = useCallback(async (path) => {
        // Configured `files` field: links by renaming on disk according to the pattern
        // (Zotero style), preserving the original destination. Otherwise, it only records
        // the file to serve it (inline content / image fields).
        // The backend may materialize (download) an online-only file here, which
        // can take tens of seconds — bypass the global 30s axios cap (see
        // pageEtagInterceptor) so the request isn't aborted mid-download.
        if (isFieldUpload) {
            const { data } = await axios.post('/api/vault/link-existing-file', {
                file_path: path,
                target_name: resolvedName,
            }, { timeout: 0 });
            return data?.url || data?.path;
        }
        const { data } = await axios.post('/api/vault/local-file/register', { file_path: path }, { timeout: 0 });
        return data?.url;
    }, [isFieldUpload, resolvedName]);

    // Upload of MULTIPLE files at once — only for `files` fields. Uploads
    // all of them and inserts them directly (without going through the preview/single-item
    // file). The path for a SINGLE file (handlePickUploadFile) remains untouched; for
    // image/inline-content fields, `multiple` is disabled, so it never
    // reaches here with >1 file.
    const handlePickUploadFiles = async (fileList) => {
        const files = Array.from(fileList || []).filter(Boolean);
        if (files.length === 0) return;
        if (!(isFieldUpload && files.length > 1)) {
            handlePickUploadFile(files[0]);
            return;
        }
        setBusy(true);
        try {
            const urls = [];
            for (const f of files) {
                const u = await performUpload(f);
                if (u) urls.push(u);
            }
            if (!urls.length) throw new Error(t('insert.error_no_upload', "No s'ha pogut pujar cap fitxer"));
            onInsert?.({ urls, kind: 'file' });
            onClose?.();
        } catch (e) {
            const msg = uploadErrorMessage(e, t);
            toast.error(t('insert.error', { defaultValue: 'Error inserint: {{msg}}', msg }));
        } finally {
            setBusy(false);
        }
    };

    const handleUploadDrop = (e) => {
        e.preventDefault();
        handlePickUploadFiles(e.dataTransfer?.files);
    };

    const canInsert = useMemo(() => {
        if (!selected) {
            // Image field with a current image and no new file: it can be saved
            // anyway (only the metadata changes, the src is kept).
            return Boolean(imageField && currentSrc);
        }
        if (selected.source === 'upload-pending' && !uploadFile) return false;
        if (selected.source === 'url' && !urlInput.trim()) return false;
        return modeAvailableFor(selected.kind, mode);
    }, [selected, uploadFile, urlInput, mode, imageField, currentSrc]);

    // When choosing/dragging a file (or picking one from disk), move focus to the
    // "Insert" button so it can be confirmed directly with Enter. We don't do this
    // for URL (the user is still typing) nor for the vault search.
    useEffect(() => {
        if (!open || busy) return;
        const fileSource = selected?.source === 'upload-pending'
            || selected?.source === 'local'
            || selected?.source === 'local-folder';
        if (fileSource && canInsert) confirmBtnRef.current?.focus();
    }, [open, busy, canInsert, selected?.source]);

    const handleConfirm = useCallback(async () => {
        // Image field with no new file selected: saves only the metadata
        // (alt/title/caption/credit), keeping the field's current image.
        if (!selected && imageField && currentSrc) {
            onInsert?.({ metadataOnly: true, imageMeta: imgMeta });
            onClose?.();
            return;
        }
        if (!selected) return;
        setBusy(true);
        try {
            let finalUrl = selected.url || '';
            if (selected.source === 'upload-pending' && uploadFile) {
                finalUrl = await performUpload(uploadFile);
            } else if (selected.source === 'local' && selected.path) {
                finalUrl = await registerLocalFile(selected.path);
            } else if (selected.source === 'local-folder' && selected.path) {
                // The sentinel passes Tiptap's validation (it's https://) and
                // useFileLinkInterceptor converts it back to file:// to open
                // the folder in Finder. blocksToRichMarkdown stores it as
                // file:// on disk.
                finalUrl = fileUrlToSentinel(`file://${selected.path}`);
            }
            if (!finalUrl) {
                throw new Error(t('insert.error_no_url', "No s'ha pogut obtenir la URL final"));
            }
            onInsert?.({ url: finalUrl, mode, kind: selected.kind, name: selected.name, imageMeta: imageField ? imgMeta : undefined });
            onClose?.();
        } catch (e) {
            if (e?.message === 'unreadable-file') {
                // Online-only file the browser can't read: switch to "Disc local",
                // where the backend receives the path and can download it (like
                // Office/Adobe). uploadFile is still set, so the "locate on disk"
                // UI shows pre-filled and, once located, the backend materializes it.
                setTab('local');
                toast.error(t('insert.error_unreadable_switch_local', "Aquest fitxer és online-only. Localitza'l a «Disc local» i Gnosi el baixarà automàticament."));
            } else {
                toast.error(t('insert.error', { defaultValue: 'Error inserint: {{msg}}', msg: uploadErrorMessage(e, t) }));
            }
        } finally {
            setBusy(false);
        }
    }, [selected, uploadFile, mode, performUpload, registerLocalFile, onInsert, onClose, t, imageField, imgMeta, currentSrc]);

    // Canonical keyboard: Esc closes, Enter confirms the insertion (mirrors the button
    // "Insert": disabled if !canInsert or busy), Tab does focus-trap inside the
    // panel. CAPTURE on window to override BlockNote's stopPropagation
    // (ProseMirror). When the internal FilesystemPickerModal is open (pickerOpen)
    // we hand the keyboard over to it: it has its own Esc + focus-trap (it's a sibling outside
    // of panelRef), so here we disable Esc and the trap to avoid fighting
    // with its own.
    useModalKeyboard({
        isOpen: open,
        onClose,
        onConfirm: handleConfirm,
        confirmDisabled: !canInsert || busy,
        containerRef: panelRef,
        trapFocus: !pickerOpen,
        closeOnEscape: !pickerOpen,
    });

    if (!open) return null;

    const SelectedKindMeta = selected?.kind && KIND_META[selected.kind];

    return (
        <>
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div ref={panelRef} className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] max-h-[760px] flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-primary)]">
                        <h2 className="text-base font-semibold flex items-center gap-2">
                            <Frame size={18} />
                            {t('insert.title', { defaultValue: 'Insereix contingut' })}
                        </h2>
                        <button onClick={onClose} className="p-1.5 rounded hover:bg-[var(--bg-secondary)]" aria-label={t('common.close', 'Tanca')}>
                            <X size={16} />
                        </button>
                    </div>

                    <div className={`flex border-b border-[var(--border-primary)] ${allowedTabs.length <= 1 ? 'hidden' : ''}`}>
                        {TABS.filter(({ id }) => allowedTabs.includes(id)).map(({ id, icon: Icon, labelKey, labelDefault }) => (
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

                    {imageField && currentSrc && !selected && (
                        <div className="px-5 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 flex items-center gap-3">
                            <img
                                src={toAssetPreviewUrl(currentSrc)}
                                alt=""
                                className="w-10 h-10 rounded object-cover border border-[var(--border-primary)] shrink-0 bg-[var(--bg-secondary)]"
                            />
                            <div className="min-w-0">
                                <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                                    {t('insert.current_image', { defaultValue: 'Imatge actual' })}: {currentSrc.split('/').pop()}
                                </div>
                                <div className="text-[11px] text-[var(--text-tertiary)]">
                                    {t('insert.current_image_hint', { defaultValue: "Edita els camps de sota i desa, o tria'n una de nova per substituir-la." })}
                                </div>
                            </div>
                        </div>
                    )}

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
                                    // There is a dragged/chosen file: the browser does NOT
                                    // gives the absolute path, so to link it without
                                    // copying, it needs to be located on disk. We explain this so that
                                    // it doesn't seem like we're asking to "search again" for no reason.
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
                                            <div className="text-sm font-medium">{isFieldUpload
                                                ? t('insert.drop_or_click_multi', { defaultValue: 'Arrossega fitxers aquí o clica per triar-ne (pots triar-ne diversos)' })
                                                : t('insert.drop_or_click', { defaultValue: 'Arrossega un fitxer aquí o clica per triar-lo' })}</div>
                                            <div className="text-xs text-[var(--text-tertiary)]">
                                                {isFieldUpload && fileField?.storageFolder === 'library'
                                                    ? (resolvedName
                                                        ? t('insert.upload_target_library_named', { defaultValue: 'Es desarà a Library com a «{{name}}»', name: resolvedName })
                                                        : t('insert.upload_target_library', { defaultValue: 'El fitxer es desarà a Library' }))
                                                    : t('insert.upload_target', { defaultValue: 'El fitxer es copiarà dins el Vault (Assets/)' })}
                                            </div>
                                        </>
                                    )}
                                    <input
                                        ref={uploadInputRef}
                                        type="file"
                                        multiple={isFieldUpload}
                                        className="hidden"
                                        onChange={(e) => handlePickUploadFiles(e.target.files)}
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
                                    data-autofocus="true"
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
                                                    <span className="font-medium">{t(`insert.kind_${selected.kind}`, SelectedKindMeta.label)}</span>
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

                        {busy && (materializing || selected?.source === 'local' || selected?.source === 'local-folder') && (
                            <div className="flex items-center gap-1.5 text-xs text-[var(--gnosi-primary)]">
                                <Loader2 size={12} className="animate-spin" />
                                {t('insert.materializing', { defaultValue: 'Baixant el fitxer de OneDrive si cal… (pot trigar)' })}
                            </div>
                        )}
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

                            {imageField && (
                                <div className="flex-1 grid grid-cols-2 gap-1.5 mr-3 max-w-lg">
                                    <input value={imgMeta.alt || ''} onChange={(e) => setImgMeta((m) => ({ ...m, alt: e.target.value }))}
                                        placeholder={t('insert.img_alt', { defaultValue: 'Alt text (accessibilitat)' })}
                                        className="px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]" />
                                    <input value={imgMeta.title || ''} onChange={(e) => setImgMeta((m) => ({ ...m, title: e.target.value }))}
                                        placeholder={t('insert.img_title', { defaultValue: 'Títol (opcional)' })}
                                        className="px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]" />
                                    <input value={imgMeta.caption || ''} onChange={(e) => setImgMeta((m) => ({ ...m, caption: e.target.value }))}
                                        placeholder={t('insert.img_caption', { defaultValue: 'Peu de foto (opcional)' })}
                                        className="px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]" />
                                    <input value={imgMeta.credit || ''} onChange={(e) => setImgMeta((m) => ({ ...m, credit: e.target.value }))}
                                        placeholder={t('insert.img_credit', { defaultValue: 'Crèdit (opcional)' })}
                                        className="px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]" />
                                </div>
                            )}
                            <div className="flex gap-2 ml-auto">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 rounded-lg text-sm border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]"
                                >
                                    {t('common.cancel', { defaultValue: 'Cancel·la' })}
                                </button>
                                <button
                                    ref={confirmBtnRef}
                                    onClick={handleConfirm}
                                    disabled={!canInsert || busy}
                                    className="px-4 py-2 rounded-lg text-sm bg-[var(--gnosi-primary)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {busy && <Loader2 size={14} className="animate-spin" />}
                                    {(!selected && imageField && currentSrc)
                                        ? t('insert.save_meta', { defaultValue: 'Desa' })
                                        : t('insert.confirm', { defaultValue: 'Insereix' })}
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
