import {Image as ImageIcon, FileText, Folder, Library, Database, Music, Video, HardDrive, type LucideIcon} from 'lucide-react';
export const NON_IMAGE_THUMB: Readonly<Record<string, {Icon: LucideIcon; labelKey: string; accent: string} | undefined>> = {
  video: { Icon: Video, labelKey: 'media.thumb_video', accent: 'text-rose-400' },
  pdf:   { Icon: FileText, labelKey: 'media.thumb_pdf', accent: 'text-orange-400' },
  audio: { Icon: Music, labelKey: 'media.thumb_audio', accent: 'text-cyan-400' },
  other: { Icon: HardDrive, labelKey: 'media.thumb_other', accent: 'text-slate-400' },
};

export const ROOT_META: Readonly<Record<string, {Icon: LucideIcon; labelKey?: string; allLabelKey?: string} | undefined>> = {
  images: { Icon: ImageIcon, labelKey: 'media.root_images', allLabelKey: 'media.all_images' },
  assets: { Icon: Folder, labelKey: 'media.root_assets', allLabelKey: 'media.all_assets' },
  library: { Icon: Library, labelKey: 'media.root_library', allLabelKey: 'media.all_library' },
  vault: { Icon: Database, labelKey: 'media.root_vault', allLabelKey: 'media.all_vault' },
};

export const KIND_OPTIONS = [
  { key: 'image', labelKey: 'media.kind_image', Icon: ImageIcon },
  { key: 'video', labelKey: 'media.kind_video', Icon: Video },
  { key: 'audio', labelKey: 'media.kind_audio', Icon: Music },
  { key: 'pdf', labelKey: 'media.kind_pdf', Icon: FileText },
  { key: 'other', labelKey: 'media.kind_other', Icon: HardDrive },
];

// mtime range presets. `days=null` = custom (date input).
export const DATE_PRESETS = [
  { key: 'all', labelKey: 'media.date_all', days: 0 },
  { key: '7d', labelKey: 'media.date_7d', days: 7 },
  { key: '30d', labelKey: 'media.date_30d', days: 30 },
  { key: '365d', labelKey: 'media.date_year', days: 365 },
  { key: 'custom', labelKey: 'media.date_custom', days: null },
];

export const SIZE_PRESETS = [
  { key: 'all', labelKey: 'media.size_all', min: null, max: null },
  { key: 'small', label: '<500 KB', min: null, max: 500 },
  { key: 'medium', label: '500 KB – 5 MB', min: 500, max: 5120 },
  { key: 'large', label: '>5 MB', min: 5120, max: null },
];

export const SORT_OPTIONS = [
  { key: 'mtime', labelKey: 'media.sort_mtime' },
  { key: 'filename', labelKey: 'media.sort_filename' },
  { key: 'size', labelKey: 'media.sort_size' },
  { key: 'kind', labelKey: 'media.sort_kind' },
];
