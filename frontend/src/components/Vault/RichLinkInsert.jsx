/**
 * RichLinkInsert.jsx
 *
 * Component d'inserció d'enllaços enriquits. Tres modes (URL externa,
 * enllaç local file://, embed). Disseny modal: el component es renderitza
 * sempre i la seva visibilitat es controla via props `open`/`onClose` des
 * del component pare (típicament el BlockEditor amb un state).
 *
 * Inserció:
 *   - URL: enllaç inline href=…
 *   - Local: enllaç inline file://…  (sense pujar res; la ruta apunta al disc)
 *   - Embed: bloc image/video/audio/file (URL externa o pujada local)
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FolderOpen, Image as ImageIcon, X, Globe, FileText, Upload, Link as LinkIcon } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { fileUrlToSentinel } from './markdown-mapper';

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
 * Modal d'inserció d'enllaç ric.
 * @param {{ open: boolean, onClose: () => void, editor: any, uploadFile: (file: File) => Promise<string> }} props
 */
export function RichLinkInsertModal({ open, onClose, editor, uploadFile }) {
    const { t } = useTranslation();
    const [tab, setTab] = useState('url');
    const [url, setUrl] = useState('');
    const [linkText, setLinkText] = useState('');
    const [busy, setBusy] = useState(false);
    const [localPath, setLocalPath] = useState('');
    // Mode dins la pestanya Local: 'link' (file://) o 'upload' (puja a Assets)
    const [localMode, setLocalMode] = useState('link');
    const fileInputRef = useRef(null);
    const uploadInputRef = useRef(null);

    // Reset i captura de selecció a l'obrir/tancar
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

    // Tanca amb Escape
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const insertInlineLink = useCallback((href, label) => {
        if (!editor) return;
        const text = (label || href).trim() || href;
        try {
            // BlockNote: el content d'un link ha de ser un array d'inline content
            // objects (no un string), si no els links file:// poden no persistir
            // bé al document interno.
            editor.insertInlineContent([
                { type: 'link', href, content: [{ type: 'text', text, styles: {} }] },
            ]);
        } catch (err) {
            console.error('insertInlineLink error', err);
            // Fallback: inserim com a markdown literal i deixem que BlockNote
            // el reparseji al següent reload del contingut.
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
            toast.error(t('editor.upload_unavailable', { defaultValue: 'Pujada de fitxers no disponible' }));
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
            toast.error(t('editor.upload_failed', { defaultValue: 'Error pujant el fitxer' }));
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
                        title={t('common.close', { defaultValue: 'Tanca' })}
                    >
                        <X size={16} />
                    </button>
                </div>

                {tab === 'url' && (
                    <form onSubmit={handleSubmitUrl} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <input
                            autoFocus type="url" placeholder="https://exemple.com"
                            value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle}
                        />
                        <input
                            type="text"
                            placeholder={t('editor.link_text_optional', { defaultValue: 'Text mostrat (opcional)' })}
                            value={linkText} onChange={(e) => setLinkText(e.target.value)} style={inputStyle}
                        />
                        <button type="submit" className="btn btn-gnosi-primary" style={btnStyle}>
                            {t('editor.insert_link', { defaultValue: 'Inserir enllaç' })}
                        </button>
                    </form>
                )}

                {tab === 'local' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* Toggle entre "Enllaçar (file://)" i "Pujar a Assets" */}
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
                                {t('editor.link_local_mode_link', { defaultValue: 'Enllaçar (file://)' })}
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={localMode === 'upload'}
                                onClick={() => setLocalMode('upload')}
                                style={toggleSegmentStyle(localMode === 'upload')}
                            >
                                <Upload size={13} style={{ marginRight: 5 }} />
                                {t('editor.link_local_mode_upload', { defaultValue: 'Pujar a Assets' })}
                            </button>
                        </div>

                        {/* MODE 1: Enllaç file:// (no es puja res) */}
                        {localMode === 'link' && (
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    const fileHref = toFileUrl(localPath);
                                    if (!fileHref) return;
                                    // El href que va al BlockNote és el sentinel
                                    // (https://gnosi-file-protocol.local/...) perquè
                                    // file:// no passa la validació de Tiptap i
                                    // s'esborra. Es reverteix en serialitzar.
                                    const href = fileUrlToSentinel(fileHref);
                                    insertInlineLink(href, linkText || basenameOf(localPath));
                                    onClose?.();
                                }}
                                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                            >
                                <p style={{ fontSize: 12, color: 'var(--text-secondary, #666)', margin: 0 }}>
                                    {t('editor.link_local_help', {
                                        defaultValue: "Enganxa una ruta absoluta del teu sistema, o tria fitxer/carpeta. Es generarà un enllaç file:// (no es puja res).",
                                    })}
                                </p>
                                <input
                                    autoFocus type="text" placeholder="/Users/.../document.pdf"
                                    value={localPath} onChange={(e) => setLocalPath(e.target.value)} style={inputStyle}
                                />
                                <input
                                    type="text"
                                    placeholder={t('editor.link_text_optional', { defaultValue: 'Text mostrat (opcional)' })}
                                    value={linkText} onChange={(e) => setLinkText(e.target.value)} style={inputStyle}
                                />
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {/* Picker de fitxer: <input type="file"> simple — NO desencadena
                                        el diàleg "Penjar X fitxers" perquè és un sol fitxer i no es puja. */}
                                    <input
                                        ref={fileInputRef} type="file" style={{ display: 'none' }}
                                        onChange={(e) => {
                                            const f = e.target.files?.[0]; if (!f) return;
                                            setLocalPath(prev => prev || f.name);
                                            toast(t('editor.link_local_browser_path_hint', {
                                                defaultValue: "El navegador no et dóna la ruta absoluta. Completa-la al camp.",
                                            }), { icon: 'ℹ️' });
                                        }}
                                    />
                                    <button
                                        type="button" onClick={() => fileInputRef.current?.click()}
                                        style={{ ...btnStyle, flex: 1, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                                    >
                                        <FileText size={14} style={{ marginRight: 4 }} />
                                        {t('editor.link_local_pick_file', { defaultValue: 'Fitxer…' })}
                                    </button>
                                    {/* Picker de carpeta: usem File System Access API quan estigui
                                        disponible (Chrome/Edge) per evitar el diàleg "Penjar X fitxers"
                                        que provoca <input webkitdirectory>. Fallback: amaguem el botó. */}
                                    {typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && (
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    const handle = await window.showDirectoryPicker();
                                                    if (!handle?.name) return;
                                                    setLocalPath(prev => prev || handle.name);
                                                    toast(t('editor.link_local_browser_path_hint', {
                                                        defaultValue: "El navegador no et dóna la ruta absoluta. Completa-la al camp.",
                                                    }), { icon: 'ℹ️' });
                                                } catch (err) {
                                                    if (err?.name !== 'AbortError') {
                                                        console.warn('showDirectoryPicker error', err);
                                                    }
                                                }
                                            }}
                                            style={{ ...btnStyle, flex: 1, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                                        >
                                            <FolderOpen size={14} style={{ marginRight: 4 }} />
                                            {t('editor.link_local_pick_folder', { defaultValue: 'Carpeta…' })}
                                        </button>
                                    )}
                                </div>
                                <button
                                    type="submit" disabled={!localPath.trim()}
                                    className="btn btn-gnosi-primary"
                                    style={{ ...btnStyle, opacity: localPath.trim() ? 1 : 0.5 }}
                                >
                                    {t('editor.insert_link', { defaultValue: 'Inserir enllaç' })}
                                </button>
                            </form>
                        )}

                        {/* MODE 2: Puja el fitxer a Assets i fa enllaç a la URL retornada */}
                        {localMode === 'upload' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <p style={{ fontSize: 12, color: 'var(--text-secondary, #666)', margin: 0 }}>
                                    {t('editor.link_upload_help', {
                                        defaultValue: 'Selecciona un fitxer per pujar-lo a Assets del vault. Quedarà accessible des de qualsevol dispositiu sincronitzat.',
                                    })}
                                </p>
                                <input
                                    type="text"
                                    placeholder={t('editor.link_text_optional', { defaultValue: 'Text mostrat (opcional)' })}
                                    value={linkText} onChange={(e) => setLinkText(e.target.value)} style={inputStyle}
                                />
                                <input
                                    ref={uploadInputRef}
                                    type="file"
                                    style={{ display: 'none' }}
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        if (!uploadFile) {
                                            toast.error(t('editor.upload_unavailable', { defaultValue: 'Pujada de fitxers no disponible' }));
                                            return;
                                        }
                                        setBusy(true);
                                        try {
                                            const href = await uploadFile(file);
                                            insertInlineLink(href, linkText || file.name);
                                            onClose?.();
                                        } catch (err) {
                                            console.error('upload error', err);
                                            toast.error(t('editor.upload_failed', { defaultValue: 'Error pujant el fitxer' }));
                                        } finally {
                                            setBusy(false);
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => uploadInputRef.current?.click()}
                                    className="btn btn-gnosi-primary"
                                    style={{ ...btnStyle, opacity: busy ? 0.6 : 1 }}
                                >
                                    <Upload size={14} style={{ marginRight: 6 }} />
                                    {busy
                                        ? t('common.loading', { defaultValue: 'Pujant…' })
                                        : t('editor.link_upload_pick', { defaultValue: 'Triar fitxer i pujar' })}
                                </button>
                                <p style={{ fontSize: 11, color: 'var(--text-tertiary, #888)', margin: 0, fontStyle: 'italic' }}>
                                    {t('editor.link_upload_note_folder', {
                                        defaultValue: 'Les carpeges no es poden pujar; usa el mode "Enllaçar" per a carpetes.',
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
                                {t('editor.embed_url_label', { defaultValue: "Embed des d'una URL" })}
                            </label>
                            <input
                                type="url" placeholder="https://… (imatge, vídeo, fitxer)"
                                value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle}
                            />
                            <button type="submit" className="btn btn-gnosi-primary" style={btnStyle}>
                                {t('editor.embed_insert', { defaultValue: 'Embed' })}
                            </button>
                        </form>
                        <div style={{ borderTop: '1px solid var(--border-primary, #eee)', paddingTop: 8 }}>
                            <label style={labelStyle}>
                                {t('editor.embed_local_label', { defaultValue: 'O puja un fitxer local' })}
                            </label>
                            <input
                                type="file" accept="image/*,video/*,audio/*,application/pdf"
                                onChange={(e) => handleFileEmbed(e.target.files?.[0])}
                                style={{ marginTop: 6, fontSize: 12 }}
                            />
                            {busy && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('common.loading', { defaultValue: 'Pujant…' })}</p>}
                        </div>
                    </div>
                )}
            </div>
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
