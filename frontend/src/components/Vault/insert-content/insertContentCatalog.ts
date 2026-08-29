import {
    Database as DatabaseIcon,
    File as FileIcon,
    FileText,
    Folder,
    Globe,
    HardDrive,
    Image as ImageIcon,
    Link2,
    Music,
    Upload as UploadIcon,
    Video,
    type LucideIcon,
} from 'lucide-react';

import type { InsertContentTab } from './insertContentTypes';


export interface ContentKindMeta {
    readonly Icon: LucideIcon;
    readonly label: string;
}


export interface InsertContentTabDefinition {
    readonly Icon: LucideIcon;
    readonly id: InsertContentTab;
    readonly labelDefault: string;
    readonly labelKey: string;
}


export const CONTENT_KIND_META: Readonly<Record<string, ContentKindMeta>> = {
    audio: { Icon: Music, label: 'Audio' },
    doc: { Icon: FileText, label: 'Document' },
    file: { Icon: FileIcon, label: 'File' },
    folder: { Icon: Folder, label: 'Folder' },
    image: { Icon: ImageIcon, label: 'Image' },
    pdf: { Icon: FileText, label: 'PDF' },
    video: { Icon: Video, label: 'Video' },
    vimeo: { Icon: Video, label: 'Vimeo' },
    web: { Icon: Globe, label: 'Web page' },
    youtube: { Icon: Video, label: 'YouTube' },
};


export const INSERT_CONTENT_TABS: readonly InsertContentTabDefinition[] = [
    {
        Icon: DatabaseIcon,
        id: 'vault',
        labelDefault: 'Vault',
        labelKey: 'insert.tab_vault',
    },
    {
        Icon: HardDrive,
        id: 'local',
        labelDefault: 'Disc local',
        labelKey: 'insert.tab_local',
    },
    {
        Icon: UploadIcon,
        id: 'upload',
        labelDefault: 'Puja',
        labelKey: 'insert.tab_upload',
    },
    {
        Icon: Link2,
        id: 'url',
        labelDefault: 'URL',
        labelKey: 'insert.tab_url',
    },
];
