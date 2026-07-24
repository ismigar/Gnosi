/**
 * RichLinkInsert.jsx
 *
 * Rich link insertion component. Three modes (external URL,
 * local file:// link, embed). Modal design: the component always renders
 * and its visibility is controlled via `open`/`onClose` props from
 * the parent component (typically the BlockEditor with a state).
 *
 * Insertion:
 *   - URL: inline link href=…
 *   - Local: inline file://… link  (nothing is uploaded; the path points to disk)
 *   - Embed: image/video/audio/file block (external URL or local upload)
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FolderOpen, Image as ImageIcon, X, Globe, FileText, Upload, Link as LinkIcon } from 'lucide-react';
import { toast } from '../../lib/toast';
import { useTranslation } from 'react-i18next';
import { fileUrlToSentinel } from './markdown-mapper';
import { FilesystemPickerModal } from '../FilesystemPickerModal';

const TABS = [
    { key: 'url', icon: Globe, labelKey: 'editor.link_tab_url', fallback: 'URL' },
    { key: 'local', icon: FolderOpen, labelKey: 'editor.link_tab_local', fallback: 'Local' },
    { key: 'embed', icon: ImageIcon, labelKey: 'editor.link_tab_embed', fallback: 'Embed' },
];

function toFileUrl(rawPath) {
    const p = String(rawPath || '').trim();
    if (!p) return '';
    if (/^file:\/\//i.test(p)) return p;
    if (/^[a-zA-Z]:[\\/]/.test(p)) return 'file:///' + p.replace(/\\/g, '/');
    if (p.startsWith('//') || p.startsWith('\\\\')) return 'file:' + p.replace(/\\/g, '/');
    if (p.startsWith('/')) return 'file://' + p;
    return p;
}

function basenameOf(path) {
    const cleaned = String(path || '').replace(/[\\/]+$/, '');
    const parts = cleaned.split(/[\\/]/);
    return parts[parts.length - 1] || cleaned;
}

function detectEmbedKind(url) {
    const u = String(url || '').toLowerCase().split('?')[0];
    if (/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(u)) return 'image';
    if (/\.(mp4|webm|ogv|mov|m4v)$/.test(u)) return 'video';
    if (/\.(mp3|wav|ogg|m4a|flac)$/.test(u)) return 'audio';
    return 'file';
}

/**
 * Rich link insertion modal.
 * @param {{ open: boolean, onClose: () => void, editor: any, uploadFile: (file: File) => Promise<string> }} props
 */
export function RichLinkInsertModal({ open, onClose, editor, uploadFile }) {
    const { t } = useTranslation();
    const [tab, setTab] = useState('url');
    const [url, setUrl] = useState('');
    const [linkText, setLinkText] = useState('');
    const [busy, setBusy] = useState(false);
    const [localPath, setLocalPath] = useState('');
    // Mode within the Local tab: 'link' (file://) or 'upload' (uploads to Assets)
    const [localMode, setLocalMode] = useState('link');
    // Picker UI to avoid manually copy-pasting the path. null or 'file'/'folder'.
    const [pickerMode, setPickerMode] = useState(null);
    // Drag-and-drop al mode "Pujar a Assets"
    const [dragOver, setDragOver] = useState(false);
    const uploadInputRef = useRef(null);

    // Reset and selection capture on open/close
    useEffect(() => {
        if (open) {
            try {
                const sel = editor?.getSelectedText?.() || '';
                setLinkText(sel);
            } catch { /* noop */ }
        } else {
            setUrl('');
            setLinkText('');
            setLocalPath('');
            setLocalMode('link');
            setTab('url');
        }
    }, [open, editor]);

    // Keyboard navigation:
    //   - Escape: closes the modal
    //   - ⌘/Ctrl+1/2/3: salta a URL/Local/Embed
    //   - ⌘/Ctrl+←/→: previous/next tab (cyclic)
    //   - Within the Local tab: ⌘/Ctrl+L/U toggles between "Link" and "Upload"
    // Without `preventDefault` the browser's ⌘+1..9 would switch tabs;
    // the user expects shortcuts inside the modal to stay within the modal.
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === 'Escape') { onClose?.(); return; }
            const mod = e.metaKey || e.ctrlKey;
            if (!mod) return;
            const order = TABS.map(t => t.key); // ['url','local','embed']
            if (e.key === '1' || e.key === '2' || e.key === '3') {
                const idx = Number(e.key) - 1;
                if (order[idx]) {
                    e.preventDefault();
                    setTab(order[idx]);
                }
                return;
            }
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                setTab(prev => {
                    const i = order.indexOf(prev);
                    const delta = e.key === 'ArrowRight' ? 1 : -1;
                    return order[(i + delta + order.length) % order.length];
                });
                return;
            }
            const k = String(e.key || '').toLowerCase();
            if (k === 'l' || k === 'u') {
                // Only makes sense in the Local tab
                if (tab === 'local') {
                    e.preventDefault();
                    setLocalMode(k === 'l' ? 'link' : 'upload');
                }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose, tab]);

    const insertInlineLink = useCallback((href, label) => {
        if (!editor) return;
        const text = (label || href).trim() || href;
        try {
            // BlockNote: the content of a link must be an array of inline content
            // objects (not a string), otherwise file:// links may not persist
            // properly in the internal document.
            editor.insertInlineContent([
                { type: 'link', href, content: [{ type: 'text', text, styles: {} }] },
            ]);
        } catch (err) {
            console.error('insertInlineLink error', err);
            // Fallback: we insert it as literal markdown and let BlockNote
            // it gets re-parsed on the next content reload.
            try {
                editor.insertInlineContent(`[${text}](${href})`);
            } catch (err2) {
                console.error('insertInlineLink fallback error', err2);
            }
        }
    }, [editor]);

    const insertEmbedBlock = useCallback((href, kind) => {
        if (!editor) return;
        const blockType = kind || detectEmbedKind(href);
        try {
            editor.insertBlocks(
                [{ type: blockType, props: { url: href } }],
                editor.getTextCursorPosition().block,
                'after'
            );
        } catch (err) {
            insertInlineLink(href, href);
            console.warn('embed block insertion failed, fallback to link', err);
        }
    }, [editor, insertInlineLink]);

    const handleUploadFile = useCallback(async (file) => {
        if (!file) return;
        if (!uploadFile) {
            toast.error(t('editor.upload_unavailable', { defaultValue: "File upload unavailable" }));
            return;
        }
        setBusy(true);
        try {
            const href = await uploadFile(file);
            insertInlineLink(href, linkText || file.name);
            onClose?.();
        } catch (err) {
            console.error('upload error', err);
            toast.error(t('editor.upload_failed', { defaultValue: "Error uploading the file" }));
        } finally {
            setBusy(false);
        }
    }, [uploadFile, t, insertInlineLink, linkText, onClose]);

    const handleSubmitUrl = (e) => {
        e?.preventDefault?.();
        const trimmed = url.trim();
        if (!trimmed) return;
        insertInlineLink(trimmed, linkText);
        onClose?.();
    };

    const handleSubmitEmbedUrl = (e) => {
        e?.preventDefault?.();
        const trimmed = url.trim();
        if (!trimmed) return;
        insertEmbedBlock(trimmed);
        onClose?.();
    };

    const handleFileEmbed = async (file) => {
        if (!file) return;
        if (!uploadFile) {
            toast.error(t('editor.upload_unavailable', { defaultValue: "File upload unavailable" }));
            return;
        }
        setBusy(true);
        try {
            const href = await uploadFile(file);
            const kind = file.type.startsWith('image/') ? 'image'
                : file.type.startsWith('video/') ? 'video'
                : file.type.startsWith('audio/') ? 'audio'
                : 'file';
            insertEmbedBlock(href, kind);
            onClose?.();
        } catch (err) {
            console.error('upload error', err);
            toast.error(t('editor.upload_failed', { defaultValue: "Error uploading the file" }));
        } finally {
            setBusy(false);
        }
    };

    if (!open) return null;

    return (
        <div
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                backdropFilter: 'blur(2px)',
            }}
        >
            <div
                style={{
                    background: 'var(--bg-primary, #fff)',
                    border: '1px solid var(--border-primary, #ddd)',
                    borderRadius: 10,
                    boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
                    width: 420,
                    padding: 16,
                    color: 'var(--text-primary, #111)',
                }}
            >
                <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border-primary, #eee)' }}>
                    {/* eslint-disable-next-line no-unused-vars -- `Icon` is used in the JSX further down, but some versions of the react plugin do not detect it with renamed destructuring */}
                    {TABS.map(({ key, icon: Icon, labelKey, fallback }) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setTab(key)}
                            style={{
                                flex: 1,
                                padding: '8px 8px',
                                background: tab === key ? 'var(--bg-tertiary, #f3f4f6)' : 'transparent',
                                border: 'none',
                                borderBottom: tab === key ? '2px solid var(--gnosi, #4f46e5)' : '2px solid transparent',
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                gap: 6, fontSize: 13, color: 'var(--text-primary)',
                            }}
                        >
                            <Icon size={14} />
                            <span>{t(labelKey, { defaultValue: fallback })}</span>
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => onClose?.()}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 8px' }}
                        title={t('common.close', { defaultValue: "Close" })}
                    >
                        <X size={16} />
                    </button>
                </div>

                {tab === 'url' && (
                    <form onSubmit={handleSubmitUrl} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <input
                            autoFocus type="url" placeholder={t('editor.link_url_placeholder', "https://example.com")}
                            value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle}
                        />
                        <input
                            type="text"
                            placeholder={t('editor.link_text_optional', { defaultValue: "Displayed text (optional)" })}
                            value={linkText} onChange={(e) => setLinkText(e.target.value)} style={inputStyle}
                        />
                        <button type="submit" className="btn btn-gnosi-primary" style={btnStyle}>
                            {t('editor.insert_link', { defaultValue: "Insert link" })}
                        </button>
                    </form>
                )}

                {tab === 'local' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* Toggle between "Link (file://)" and "Upload to Assets" */}
                        <div
                            role="tablist"
                            style={{
                                display: 'flex',
                                background: 'var(--bg-secondary, #f3f4f6)',
                                borderRadius: 8,
                                padding: 3,
                                gap: 2,
                            }}
                        >
                            <button
                                type="button"
                                role="tab"
                                aria-selected={localMode === 'link'}
                                onClick={() => setLocalMode('link')}
                                style={toggleSegmentStyle(localMode === 'link')}
                            >
                                <LinkIcon size={13} style={{ marginRight: 5 }} />
                                {t('editor.link_local_mode_link', { defaultValue: "Link (file://)" })}
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={localMode === 'upload'}
                                onClick={() => setLocalMode('upload')}
                                style={toggleSegmentStyle(localMode === 'upload')}
                            >
                                <Upload size={13} style={{ marginRight: 5 }} />
                                {t('editor.link_local_mode_upload', { defaultValue: "Upload to Assets" })}
                            </button>
                        </div>

                        {/* MODE 1: file:// link (nothing is uploaded) */}
                        {localMode === 'link' && (
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    const fileHref = toFileUrl(localPath);
                                    if (!fileHref) return;
                                    // The href that goes to BlockNote is the sentinel
                                    // (https://gnosi-file-protocol.local/...) because
                                    // file:// doesn't pass Tiptap's validation and
                                    // gets deleted. It is reverted upon serialization.
                                    const href = fileUrlToSentinel(fileHref);
                                    insertInlineLink(href, linkText || basenameOf(localPath));
                                    onClose?.();
                                }}
                                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                            >
                                <p style={{ fontSize: 12, color: 'var(--text-secondary, #666)', margin: 0 }}>
                                    {t('editor.link_local_help', {
                                        defaultValue: "Paste an absolute path from your system, or choose a file/folder. A file:// link will be generated (nothing is uploaded).",
                                    })}
                                </p>
                                <input
                                    autoFocus type="text" placeholder="/Users/.../document.pdf"
                                    value={localPath} onChange={(e) => setLocalPath(e.target.value)} style={inputStyle}
                                />
                                <input
                                    type="text"
                                    placeholder={t('editor.link_text_optional', { defaultValue: "Displayed text (optional)" })}
                                    value={linkText} onChange={(e) => setLinkText(e.target.value)} style={inputStyle}
                                />
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {/* File picker: opens a custom explorer served by
                                        /api/system/browse (the browser does not expose the absolute path
                                        with <input type="file">; the backend in Docker cannot open
                                        native dialogs). The returned path is already the host's. */}
                                    <button
                                        type="button"
                                        onClick={() => setPickerMode('file')}
                                        style={{ ...btnStyle, flex: 1, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                                    >
                                        <FileText size={14} style={{ marginRight: 4 }} />
                                        {t('editor.link_local_pick_file', { defaultValue: "File…" })}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setPickerMode('folder')}
                                        style={{ ...btnStyle, flex: 1, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                                    >
                                        <FolderOpen size={14} style={{ marginRight: 4 }} />
                                        {t('editor.link_local_pick_folder', { defaultValue: "Folder…" })}
                                    </button>
                                </div>
                                <button
                                    type="submit" disabled={!localPath.trim()}
                                    className="btn btn-gnosi-primary"
                                    style={{ ...btnStyle, opacity: localPath.trim() ? 1 : 0.5 }}
                                >
                                    {t('editor.insert_link', { defaultValue: "Insert link" })}
                                </button>
                            </form>
                        )}

                        {/* MODE 2: Uploads the file to Assets and links to the returned URL */}
                        {localMode === 'upload' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <p style={{ fontSize: 12, color: 'var(--text-secondary, #666)', margin: 0 }}>
                                    {t('editor.link_upload_help', {
                                        defaultValue: "Select a file to upload it to the Vault's Assets. It will be accessible from any synced device.",
                                    })}
                                </p>
                                <input
                                    type="text"
                                    placeholder={t('editor.link_text_optional', { defaultValue: "Displayed text (optional)" })}
                                    value={linkText} onChange={(e) => setLinkText(e.target.value)} style={inputStyle}
                                />
                                <input
                                    ref={uploadInputRef}
                                    type="file"
                                    style={{ display: 'none' }}
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        await handleUploadFile(file);
                                    }}
                                />
                                {/* Drop zone: the browser does not expose the absolute path of the
                                    dragged file, but it does give the File. For the
                                    "Upload to Assets" mode this is enough (it is uploaded directly
                                    to the backend and the internal link is inserted). */}
                                <div
                                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); }}
                                    onDragLeave={() => setDragOver(false)}
                                    onDrop={async (e) => {
                                        e.preventDefault();
                                        setDragOver(false);
                                        const file = e.dataTransfer.files?.[0];
                                        if (file) await handleUploadFile(file);
                                    }}
                                    onClick={() => !busy && uploadInputRef.current?.click()}
                                    style={{
                                        border: `2px dashed ${dragOver ? 'var(--gnosi, #4f46e5)' : 'var(--border-primary, #d4d4d8)'}`,
                                        borderRadius: 10,
                                        padding: '22px 14px',
                                        textAlign: 'center',
                                        background: dragOver ? 'rgba(79, 70, 229, 0.06)' : 'var(--bg-secondary, #fafafa)',
                                        cursor: busy ? 'wait' : 'pointer',
                                        transition: 'all 0.15s ease',
                                        opacity: busy ? 0.6 : 1,
                                    }}
                                >
                                    <Upload size={22} style={{ color: dragOver ? 'var(--gnosi, #4f46e5)' : 'var(--text-tertiary, #888)', marginBottom: 6 }} />
                                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                                        {busy
                                            ? t('common.loading', { defaultValue: "Loading..." })
                                            : t('editor.link_upload_drop_title', { defaultValue: "Drag a file here" })}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary, #888)', marginTop: 4 }}>
                                        {t('editor.link_upload_drop_or_click', { defaultValue: "or click to choose it" })}
                                    </div>
                                </div>
                                <p style={{ fontSize: 11, color: 'var(--text-tertiary, #888)', margin: 0, fontStyle: 'italic' }}>
                                    {t('editor.link_upload_note_folder', {
                                        defaultValue: "Folders cannot be uploaded; use the \"Link\" mode for folders.",
                                    })}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {tab === 'embed' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <form onSubmit={handleSubmitEmbedUrl} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <label style={labelStyle}>
                                {t('editor.embed_url_label', { defaultValue: "Embed from a URL" })}
                            </label>
                            <input
                                type="url" placeholder={t('editor.embed_url_placeholder', "https://… (image, video, file)")}
                                value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle}
                            />
                            <button type="submit" className="btn btn-gnosi-primary" style={btnStyle}>
                                {t('editor.embed_insert', { defaultValue: 'Embed' })}
                            </button>
                        </form>
                        <div style={{ borderTop: '1px solid var(--border-primary, #eee)', paddingTop: 8 }}>
                            <label style={labelStyle}>
                                {t('editor.embed_local_label', { defaultValue: "Or upload a local file" })}
                            </label>
                            <input
                                type="file" accept="image/*,video/*,audio/*,application/pdf"
                                onChange={(e) => handleFileEmbed(e.target.files?.[0])}
                                style={{ marginTop: 6, fontSize: 12 }}
                            />
                            {busy && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('common.loading', { defaultValue: "Loading..." })}</p>}
                        </div>
                    </div>
                )}
            </div>

            <FilesystemPickerModal
                isOpen={pickerMode !== null}
                mode={pickerMode || 'file'}
                onClose={() => setPickerMode(null)}
                onSelect={(absoluteHostPath) => {
                    setLocalPath(absoluteHostPath);
                    setPickerMode(null);
                }}
            />
        </div>
    );
}

const inputStyle = {
    width: '100%', padding: '8px 10px',
    border: '1px solid var(--border-primary, #ddd)', borderRadius: 6,
    background: 'var(--bg-secondary, #fafafa)', color: 'var(--text-primary, #111)',
    fontSize: 13, boxSizing: 'border-box',
};

const btnStyle = {
    padding: '8px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: 6,
};

const labelStyle = {
    fontSize: 12, color: 'var(--text-secondary, #666)', fontWeight: 500,
};

const toggleSegmentStyle = (active) => ({
    flex: 1,
    padding: '7px 10px',
    border: 'none',
    borderRadius: 6,
    background: active ? 'var(--bg-primary, #fff)' : 'transparent',
    color: active ? 'var(--text-primary, #111)' : 'var(--text-secondary, #666)',
    fontWeight: active ? 600 : 500,
    fontSize: 12,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
    transition: 'background 0.15s, box-shadow 0.15s',
});

export default RichLinkInsertModal;
