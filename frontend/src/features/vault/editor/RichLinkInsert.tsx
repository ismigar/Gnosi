import { FolderOpen, Globe, Image as ImageIcon, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FilesystemPickerModal } from '../../../shared/ui/filesystem-picker/FilesystemPickerModal';
import {
    RichLinkEmbedPanel,
    RichLinkLocalPanel,
    RichLinkUrlPanel,
} from './rich-link/RichLinkPanels';
import type { RichLinkEditor, RichLinkTab } from './rich-link/richLinkModel';
import { useRichLinkInsert } from './rich-link/useRichLinkInsert';


export interface RichLinkInsertModalProps {
    readonly editor?: RichLinkEditor | null;
    readonly onClose: () => void;
    readonly open: boolean;
    readonly uploadFile?: (file: File) => Promise<string>;
}


interface RichLinkTabDefinition {
    readonly fallback: string;
    readonly icon: LucideIcon;
    readonly key: RichLinkTab;
    readonly labelKey: string;
}


const TABS: readonly RichLinkTabDefinition[] = [
    { fallback: 'URL', icon: Globe, key: 'url', labelKey: 'editor.link_tab_url' },
    {
        fallback: 'Local',
        icon: FolderOpen,
        key: 'local',
        labelKey: 'editor.link_tab_local',
    },
    {
        fallback: 'Embed',
        icon: ImageIcon,
        key: 'embed',
        labelKey: 'editor.link_tab_embed',
    },
];


export function RichLinkInsertModal({
    editor,
    onClose,
    open,
    uploadFile,
}: RichLinkInsertModalProps) {
    if (!open) return null;
    return (
        <RichLinkInsertContent
            editor={editor}
            onClose={onClose}
            uploadFile={uploadFile}
        />
    );
}


function RichLinkInsertContent({
    editor,
    onClose,
    uploadFile,
}: Omit<RichLinkInsertModalProps, 'open'>) {
    const { t } = useTranslation();
    const viewModel = useRichLinkInsert({ editor, onClose, uploadFile });
    return (
        <div
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            style={{
                alignItems: 'center',
                backdropFilter: 'blur(2px)',
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                inset: 0,
                justifyContent: 'center',
                position: 'fixed',
                zIndex: 'var(--z-modal)',
            }}
        >
            <div style={{
                background: 'var(--bg-primary, #fff)',
                border: '1px solid var(--border-primary, #ddd)',
                borderRadius: 10,
                boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
                color: 'var(--text-primary, #111)',
                padding: 16,
                width: 420,
            }}>
                <div style={{
                    borderBottom: '1px solid var(--border-primary, #eee)',
                    display: 'flex',
                    gap: 4,
                    marginBottom: 12,
                }}>
                    {TABS.map(({ fallback, icon: Icon, key, labelKey }) => (
                        <button
                            key={key}
                            onClick={() => {
                                viewModel.setTab(key);
                            }}
                            style={{
                                alignItems: 'center',
                                background: viewModel.tab === key
                                    ? 'var(--bg-tertiary, #f3f4f6)'
                                    : 'transparent',
                                border: 'none',
                                borderBottom: viewModel.tab === key
                                    ? '2px solid var(--gnosi, #4f46e5)'
                                    : '2px solid transparent',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                display: 'flex',
                                flex: 1,
                                fontSize: 13,
                                gap: 6,
                                justifyContent: 'center',
                                padding: '8px',
                            }}
                            type="button"
                        >
                            <Icon size={14} />
                            <span>{t(labelKey, { defaultValue: fallback })}</span>
                        </button>
                    ))}
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '0 8px',
                        }}
                        title={t('common.close', { defaultValue: 'Close' })}
                        type="button"
                    >
                        <X size={16} />
                    </button>
                </div>
                {viewModel.tab === 'url'
                    ? <RichLinkUrlPanel viewModel={viewModel} />
                    : null}
                {viewModel.tab === 'local'
                    ? <RichLinkLocalPanel viewModel={viewModel} />
                    : null}
                {viewModel.tab === 'embed'
                    ? <RichLinkEmbedPanel viewModel={viewModel} />
                    : null}
            </div>
            <FilesystemPickerModal
                isOpen={viewModel.pickerMode !== null}
                mode={viewModel.pickerMode ?? 'file'}
                onClose={() => {
                    viewModel.setPickerMode(null);
                }}
                onSelect={(absoluteHostPath) => {
                    viewModel.setLocalPath(absoluteHostPath);
                    viewModel.setPickerMode(null);
                }}
            />
        </div>
    );
}


export default RichLinkInsertModal;
