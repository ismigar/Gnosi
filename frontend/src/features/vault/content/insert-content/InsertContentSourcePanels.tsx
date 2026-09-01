import { createElement, useRef, type ComponentType, type DragEvent } from 'react';
import {
    FolderOpen,
    Upload as UploadIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MediaPicker } from '../../../media/picker/MediaPicker';
import { CONTENT_KIND_META } from './insertContentCatalog';
import type { VaultMediaSelection } from './insertContentTypes';
import type { InsertContentController } from './useInsertContentController';


interface TypedMediaPickerProps {
    readonly onCancel: () => void;
    readonly onSelect: (item: VaultMediaSelection) => void;
}


interface SourcePanelProps {
    readonly modal: InsertContentController;
}


const TypedMediaPicker = MediaPicker as unknown as ComponentType<TypedMediaPickerProps>;


function VaultSourcePanel({ modal }: SourcePanelProps) {
    return (
        <div className="h-full">
            <TypedMediaPicker
                onCancel={() => undefined}
                onSelect={modal.actions.selectVault}
            />
        </div>
    );
}


function LocalSourcePanel({ modal }: SourcePanelProps) {
    const { t } = useTranslation();
    const { selected, uploadFile } = modal.state;
    const hasLocalSelection = selected?.source === 'local'
        || selected?.source === 'local-folder'
        || selected?.source === 'local-multi';
    return (
        <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-8">
            <FolderOpen size={48} className="text-[var(--text-tertiary)]" />
            {uploadFile ? (
                <div>
                    <div className="text-sm font-semibold">
                        {t('insert.local_relocate_title', {
                            defaultValue: 'Locate “{{name}}” on disk',
                            name: uploadFile.name,
                        })}
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-1 max-w-md">
                        {t('insert.local_relocate_hint', {
                            defaultValue: 'The browser doesn\'t share the path of dragged files. To link it without copying it, locate it. Or go back to “Upload” to copy it into the Vault.',
                        })}
                    </div>
                </div>
            ) : (
                <div>
                    <div className="text-sm font-semibold">
                        {t('insert.local_intro', {
                            defaultValue: 'Browse the disk to the file or folder',
                        })}
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-1">
                        {t('insert.local_subtitle', {
                            defaultValue: 'You can search folders and all the Mac\'s content',
                        })}
                    </div>
                </div>
            )}
            {(selected?.source === 'local' || selected?.source === 'local-folder') ? (
                <div className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] text-xs font-mono break-all max-w-full">
                    {selected.path}
                </div>
            ) : null}
            {selected?.source === 'local-multi' ? (
                <div className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] text-xs font-mono break-all max-w-full text-left max-h-32 overflow-y-auto">
                    {selected.paths.map((path) => <div key={path}>{path}</div>)}
                </div>
            ) : null}
            <button
                className="px-4 py-2 rounded-lg bg-[var(--gnosi-primary)] text-white text-sm hover:opacity-90 flex items-center gap-2"
                onClick={modal.actions.openPicker}
                type="button"
            >
                <FolderOpen size={14} />
                {hasLocalSelection
                    ? t('insert.local_change', { defaultValue: 'Change selection' })
                    : t('insert.local_open', { defaultValue: 'Open the file browser' })}
            </button>
        </div>
    );
}


function UploadSourcePanel({ modal }: SourcePanelProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const { busy, uploadFile, uploadProgress } = modal.state;
    const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
        event.preventDefault();
        modal.actions.dropUploadFiles(event.dataTransfer.files);
    };
    return (
        <div className="h-full flex flex-col gap-3">
            <div
                className="flex-1 border-2 border-dashed border-[var(--border-primary)] rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[var(--gnosi-primary)]/40 hover:bg-[var(--bg-secondary)]/30 transition-colors"
                onClick={() => {
                    inputRef.current?.click();
                }}
                onDragOver={(event) => {
                    event.preventDefault();
                }}
                onDrop={handleDrop}
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
                    <UploadInstructions modal={modal} />
                )}
                <input
                    ref={inputRef}
                    className="hidden"
                    multiple={modal.isFieldUpload}
                    onChange={(event) => {
                        void modal.actions.pickUploadFiles(event.target.files);
                    }}
                    type="file"
                />
            </div>
            {busy && uploadProgress > 0 && uploadProgress < 100 ? (
                <div className="h-1.5 bg-[var(--bg-secondary)] rounded overflow-hidden">
                    <div
                        className="h-full bg-[var(--gnosi-primary)] transition-all"
                        style={{ width: `${String(uploadProgress)}%` }}
                    />
                </div>
            ) : null}
        </div>
    );
}


function UploadInstructions({ modal }: SourcePanelProps) {
    const { t } = useTranslation();
    const storageFolder = modal.fileField?.storageFolder;
    let target = t('insert.upload_target', {
        defaultValue: 'The file will be copied into the Vault (Assets/)',
    });
    if (modal.isFreeStorage) {
        target = modal.resolvedName
            ? t('insert.upload_target_free_named', {
                defaultValue: 'You\'ll choose the destination folder; it will be saved as “{{name}}”',
                name: modal.resolvedName,
            })
            : t('insert.upload_target_free', {
                defaultValue: 'You\'ll choose the destination folder in the next step',
            });
    } else if (modal.isFieldUpload && storageFolder === 'library') {
        target = modal.resolvedName
            ? t('insert.upload_target_library_named', {
                defaultValue: 'It will be saved to the Library as “{{name}}”',
                name: modal.resolvedName,
            })
            : t('insert.upload_target_library', {
                defaultValue: 'The file will be saved to the Library',
            });
    }
    return (
        <>
            <div className="text-sm font-medium">
                {modal.isFieldUpload
                    ? t('insert.drop_or_click_multi', {
                        defaultValue: 'Drag files here or click to choose (you can pick several)',
                    })
                    : t('insert.drop_or_click', {
                        defaultValue: 'Drag a file here or click to choose one',
                    })}
            </div>
            <div className="text-xs text-[var(--text-tertiary)]">{target}</div>
        </>
    );
}


function UrlSourcePanel({ modal }: SourcePanelProps) {
    const { t } = useTranslation();
    const selected = modal.state.selected?.source === 'url' ? modal.state.selected : null;
    const kindMeta = selected ? CONTENT_KIND_META[selected.kind] : undefined;
    return (
        <div className="h-full flex flex-col gap-3">
            <input
                className="px-4 py-3 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/40"
                data-autofocus="true"
                onChange={(event) => {
                    modal.actions.setUrl(event.target.value);
                }}
                placeholder="https://…"
                type="url"
                value={modal.state.urlInput}
            />
            <div className="flex-1 rounded-lg border border-dashed border-[var(--border-primary)] flex items-center justify-center text-sm text-[var(--text-tertiary)] p-4">
                {selected ? (
                    <div className="text-center space-y-2">
                        {kindMeta ? (
                            <div className="flex items-center justify-center gap-2 text-[var(--text-primary)]">
                                {createElement(kindMeta.Icon, { size: 20 })}
                                <span className="font-medium">
                                    {t(`insert.kind_${selected.kind}`, kindMeta.label)}
                                </span>
                            </div>
                        ) : null}
                        <div className="text-xs break-all opacity-70">{selected.url}</div>
                        {selected.kind === 'youtube' || selected.kind === 'vimeo' || selected.kind === 'pdf' ? (
                            <div className="text-xs text-[var(--gnosi-primary)] font-medium">
                                {t('insert.frame_recommended', {
                                    defaultValue: '→ Embedded frame recommended',
                                })}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <span>{t('insert.url_hint', {
                        defaultValue: 'Paste an external URL to see a preview',
                    })}</span>
                )}
            </div>
        </div>
    );
}


export function InsertContentSourcePanels({ modal }: SourcePanelProps) {
    if (modal.tab === 'vault') return <VaultSourcePanel modal={modal} />;
    if (modal.tab === 'local') return <LocalSourcePanel modal={modal} />;
    if (modal.tab === 'upload') return <UploadSourcePanel modal={modal} />;
    return <UrlSourcePanel modal={modal} />;
}
