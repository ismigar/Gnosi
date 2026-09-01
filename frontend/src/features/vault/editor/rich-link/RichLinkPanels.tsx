import { FileText, FolderOpen, Link as LinkIcon, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BUTTON_STYLE, INPUT_STYLE, LABEL_STYLE, toggleSegmentStyle } from './richLinkStyles';
import type { useRichLinkInsert } from './useRichLinkInsert';


type RichLinkController = ReturnType<typeof useRichLinkInsert>;


export function RichLinkUrlPanel({
    viewModel,
}: {
    readonly viewModel: RichLinkController;
}) {
    const { t } = useTranslation();
    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                viewModel.insertUrl();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
            <input
                autoFocus
                onChange={(event) => {
                    viewModel.setUrl(event.target.value);
                }}
                placeholder={t('editor.link_url_placeholder', 'https://example.com')}
                style={INPUT_STYLE}
                type="url"
                value={viewModel.url}
            />
            <input
                onChange={(event) => {
                    viewModel.setLinkText(event.target.value);
                }}
                placeholder={t('editor.link_text_optional', {
                    defaultValue: 'Displayed text (optional)',
                })}
                style={INPUT_STYLE}
                type="text"
                value={viewModel.linkText}
            />
            <button className="btn btn-gnosi-primary" style={BUTTON_STYLE} type="submit">
                {t('editor.insert_link', { defaultValue: 'Insert link' })}
            </button>
        </form>
    );
}


export function RichLinkLocalPanel({
    viewModel,
}: {
    readonly viewModel: RichLinkController;
}) {
    const { t } = useTranslation();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
                role="tablist"
                style={{
                    background: 'var(--bg-secondary, #f3f4f6)',
                    borderRadius: 8,
                    display: 'flex',
                    gap: 2,
                    padding: 3,
                }}
            >
                <button
                    aria-selected={viewModel.localMode === 'link'}
                    onClick={() => {
                        viewModel.setLocalMode('link');
                    }}
                    role="tab"
                    style={toggleSegmentStyle(viewModel.localMode === 'link')}
                    type="button"
                >
                    <LinkIcon size={13} style={{ marginRight: 5 }} />
                    {t('editor.link_local_mode_link', {
                        defaultValue: 'Link (file://)',
                    })}
                </button>
                <button
                    aria-selected={viewModel.localMode === 'upload'}
                    onClick={() => {
                        viewModel.setLocalMode('upload');
                    }}
                    role="tab"
                    style={toggleSegmentStyle(viewModel.localMode === 'upload')}
                    type="button"
                >
                    <Upload size={13} style={{ marginRight: 5 }} />
                    {t('editor.link_local_mode_upload', {
                        defaultValue: 'Upload to Assets',
                    })}
                </button>
            </div>
            {viewModel.localMode === 'link' ? (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        viewModel.insertLocalLink();
                    }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                    <p style={{
                        color: 'var(--text-secondary, #666)',
                        fontSize: 12,
                        margin: 0,
                    }}>
                        {t('editor.link_local_help', {
                            defaultValue: 'Paste an absolute path from your system, or choose a file/folder. A file:// link will be generated (nothing is uploaded).',
                        })}
                    </p>
                    <input
                        autoFocus
                        onChange={(event) => {
                            viewModel.setLocalPath(event.target.value);
                        }}
                        placeholder="/Users/.../document.pdf"
                        style={INPUT_STYLE}
                        type="text"
                        value={viewModel.localPath}
                    />
                    <input
                        onChange={(event) => {
                            viewModel.setLinkText(event.target.value);
                        }}
                        placeholder={t('editor.link_text_optional', {
                            defaultValue: 'Displayed text (optional)',
                        })}
                        style={INPUT_STYLE}
                        type="text"
                        value={viewModel.linkText}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button
                            onClick={() => {
                                viewModel.setPickerMode('file');
                            }}
                            style={{
                                ...BUTTON_STYLE,
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-primary)',
                                flex: 1,
                            }}
                            type="button"
                        >
                            <FileText size={14} style={{ marginRight: 4 }} />
                            {t('editor.link_local_pick_file', { defaultValue: 'File…' })}
                        </button>
                        <button
                            onClick={() => {
                                viewModel.setPickerMode('folder');
                            }}
                            style={{
                                ...BUTTON_STYLE,
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-primary)',
                                flex: 1,
                            }}
                            type="button"
                        >
                            <FolderOpen size={14} style={{ marginRight: 4 }} />
                            {t('editor.link_local_pick_folder', {
                                defaultValue: 'Folder…',
                            })}
                        </button>
                    </div>
                    <button
                        className="btn btn-gnosi-primary"
                        disabled={!viewModel.localPath.trim()}
                        style={{
                            ...BUTTON_STYLE,
                            opacity: viewModel.localPath.trim() ? 1 : 0.5,
                        }}
                        type="submit"
                    >
                        {t('editor.insert_link', { defaultValue: 'Insert link' })}
                    </button>
                </form>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{
                        color: 'var(--text-secondary, #666)',
                        fontSize: 12,
                        margin: 0,
                    }}>
                        {t('editor.link_upload_help', {
                            defaultValue: "Select a file to upload it to the Vault's Assets. It will be accessible from any synced device.",
                        })}
                    </p>
                    <input
                        onChange={(event) => {
                            viewModel.setLinkText(event.target.value);
                        }}
                        placeholder={t('editor.link_text_optional', {
                            defaultValue: 'Displayed text (optional)',
                        })}
                        style={INPUT_STYLE}
                        type="text"
                        value={viewModel.linkText}
                    />
                    <input
                        disabled={viewModel.busy}
                        id="rich-link-upload-input"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void viewModel.uploadLinkFile(file);
                        }}
                        style={{ display: 'none' }}
                        type="file"
                    />
                    <label
                        htmlFor="rich-link-upload-input"
                        onDragLeave={() => {
                            viewModel.setDragOver(false);
                        }}
                        onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'copy';
                            viewModel.setDragOver(true);
                        }}
                        onDrop={(event) => {
                            event.preventDefault();
                            viewModel.setDragOver(false);
                            const file = event.dataTransfer.files[0];
                            if (file) void viewModel.uploadLinkFile(file);
                        }}
                        style={{
                            background: viewModel.dragOver
                                ? 'rgba(79, 70, 229, 0.06)'
                                : 'var(--bg-secondary, #fafafa)',
                            border: `2px dashed ${viewModel.dragOver
                                ? 'var(--gnosi, #4f46e5)'
                                : 'var(--border-primary, #d4d4d8)'}`,
                            borderRadius: 10,
                            cursor: viewModel.busy ? 'wait' : 'pointer',
                            opacity: viewModel.busy ? 0.6 : 1,
                            padding: '22px 14px',
                            textAlign: 'center',
                            transition: 'all 0.15s ease',
                        }}
                    >
                        <Upload size={22} style={{
                            color: viewModel.dragOver
                                ? 'var(--gnosi, #4f46e5)'
                                : 'var(--text-tertiary, #888)',
                            marginBottom: 6,
                        }} />
                        <div style={{
                            color: 'var(--text-primary)',
                            fontSize: 13,
                            fontWeight: 500,
                        }}>
                            {viewModel.busy
                                ? t('common.loading', { defaultValue: 'Loading...' })
                                : t('editor.link_upload_drop_title', {
                                    defaultValue: 'Drag a file here',
                                })}
                        </div>
                        <div style={{
                            color: 'var(--text-tertiary, #888)',
                            fontSize: 11,
                            marginTop: 4,
                        }}>
                            {t('editor.link_upload_drop_or_click', {
                                defaultValue: 'or click to choose it',
                            })}
                        </div>
                    </label>
                    <p style={{
                        color: 'var(--text-tertiary, #888)',
                        fontSize: 11,
                        fontStyle: 'italic',
                        margin: 0,
                    }}>
                        {t('editor.link_upload_note_folder', {
                            defaultValue: 'Folders cannot be uploaded; use the "Link" mode for folders.',
                        })}
                    </p>
                </div>
            )}
        </div>
    );
}


export function RichLinkEmbedPanel({
    viewModel,
}: {
    readonly viewModel: RichLinkController;
}) {
    const { t } = useTranslation();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    viewModel.insertEmbedUrl();
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
                <label style={LABEL_STYLE}>
                    {t('editor.embed_url_label', { defaultValue: 'Embed from a URL' })}
                </label>
                <input
                    onChange={(event) => {
                        viewModel.setUrl(event.target.value);
                    }}
                    placeholder={t(
                        'editor.embed_url_placeholder',
                        'https://… (image, video, file)',
                    )}
                    style={INPUT_STYLE}
                    type="url"
                    value={viewModel.url}
                />
                <button className="btn btn-gnosi-primary" style={BUTTON_STYLE} type="submit">
                    {t('editor.embed_insert', { defaultValue: 'Embed' })}
                </button>
            </form>
            <div style={{
                borderTop: '1px solid var(--border-primary, #eee)',
                paddingTop: 8,
            }}>
                <label style={LABEL_STYLE}>
                    {t('editor.embed_local_label', {
                        defaultValue: 'Or upload a local file',
                    })}
                </label>
                <input
                    accept="image/*,video/*,audio/*,application/pdf"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void viewModel.uploadEmbedFile(file);
                    }}
                    style={{ fontSize: 12, marginTop: 6 }}
                    type="file"
                />
                {viewModel.busy ? (
                    <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        {t('common.loading', { defaultValue: 'Loading...' })}
                    </p>
                ) : null}
            </div>
        </div>
    );
}
