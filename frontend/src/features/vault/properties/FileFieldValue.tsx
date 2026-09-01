import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    FileText, Film, Music, File as FileIcon, Link as LinkIcon, ExternalLink, Image as ImageIcon, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ImageHoverPreview } from '../../../shared/ui/previews/ImageHoverPreview';
import {
    parseFileEntries, fileKindFromValue, toServedAssetUrl, toAssetPreviewUrl, openFileResource,
} from '../../../shared/resources/fileResource';

/**
 * FileFieldValue — READ-only render of a `files`-type field.
 *
 * Shows each file as a chip (icon based on type, or thumbnail with hover for
 * images) + clean name + "Open" button. Editing is not handled here: in the
 * table, clicking the cell opens the MediaPicker; that's why the chip body
 * lets the click propagate and only the "Open" button stops it.
 *
 * Props:
 *   value    — field value (path/URL string or array)
 *   field    — field name (for image `alt`)
 *   variant  — 'table' | 'gallery' | 'feed' | 'detail' (controls sizes)
 *   onRemove — optional `(idx) => void`. If passed, each chip shows an "X"
 *              to remove that file (the index corresponds to `parseFileEntries`).
 */

type FileKind = 'audio' | 'document' | 'file' | 'image' | 'url' | 'video';
type FileFieldVariant = 'detail' | 'feed' | 'gallery' | 'table';

interface FileEntry {
    readonly label: string;
    readonly target: string;
}

interface VariantStyle {
    readonly icon: number;
    readonly max: string;
    readonly text: string;
    readonly thumb: string;
}

export interface FileFieldValueProps {
    readonly field?: string;
    readonly onRemove?: (index: number) => unknown;
    readonly value: unknown;
    readonly variant?: FileFieldVariant;
}

const KIND_ICON: Readonly<Record<FileKind, LucideIcon>> = {
    image: ImageIcon,
    document: FileText,
    video: Film,
    audio: Music,
    url: LinkIcon,
    file: FileIcon,
};

const VARIANT: Readonly<Record<FileFieldVariant, VariantStyle>> = {
    table:   { icon: 13, text: 'text-xs',     max: 'max-w-[150px]', thumb: 'w-7 h-5' },
    gallery: { icon: 12, text: 'text-[11px]', max: 'max-w-[130px]', thumb: 'w-6 h-5' },
    feed:    { icon: 14, text: 'text-sm',     max: 'max-w-[220px]', thumb: 'w-9 h-6' },
    detail:  { icon: 14, text: 'text-sm',     max: 'max-w-[320px]', thumb: 'w-9 h-6' },
};

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function normalizeFileEntries(value: unknown): FileEntry[] {
    const parsedEntries: unknown = parseFileEntries(value);
    if (!isUnknownArray(parsedEntries)) return [];
    return parsedEntries.flatMap((entry) => {
        if (
            typeof entry === 'object'
            && entry !== null
            && 'label' in entry
            && typeof entry.label === 'string'
            && 'target' in entry
            && typeof entry.target === 'string'
        ) {
            return [{ label: entry.label, target: entry.target }];
        }
        return [];
    });
}

function normalizeFileKind(value: string): FileKind {
    const kind: unknown = fileKindFromValue(value);
    if (
        kind === 'audio'
        || kind === 'document'
        || kind === 'image'
        || kind === 'url'
        || kind === 'video'
    ) {
        return kind;
    }
    return 'file';
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function FileFieldValue({
    value,
    field = '',
    variant = 'table',
    onRemove,
}: FileFieldValueProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const entries = normalizeFileEntries(value);
    const size = VARIANT[variant];

    if (entries.length === 0) {
        if (variant === 'detail') {
            return <span className="text-sm text-[var(--text-tertiary)]">{t('common.empty')}</span>;
        }
        return null;
    }

    const wrapClass = variant === 'table'
        ? 'flex flex-col items-start gap-1 overflow-hidden'
        : (variant === 'detail' || variant === 'feed'
            ? 'flex flex-wrap items-center gap-1.5'
            : 'flex items-center gap-1.5 overflow-hidden');

    return (
        <div className={wrapClass}>
            {entries.map((entry, idx) => {
                const kind = normalizeFileKind(entry.target);
                const previewUrl = kind === 'image'
                    ? normalizeString(toAssetPreviewUrl(entry.target))
                    : '';
                const servedTarget = normalizeString(toServedAssetUrl(entry.target));
                const openTarget = servedTarget || entry.target;
                const Icon = KIND_ICON[kind];

                const handleOpen = (e: MouseEvent<HTMLButtonElement>): void => {
                    e.stopPropagation();
                    openFileResource(openTarget, { title: entry.label, navigate, t });
                };

                return (
                    <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 max-w-full overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-1.5 py-0.5"
                        title={entry.target}
                    >
                        {previewUrl ? (
                            <ImageHoverPreview
                                src={previewUrl}
                                alt={entry.label || field}
                                thumbClassName={`${size.thumb} object-cover rounded border border-[var(--border-primary)] shrink-0`}
                            />
                        ) : (
                            <Icon size={size.icon} className="shrink-0 text-[var(--gnosi-primary)]" />
                        )}
                        <span className={`truncate ${size.max} ${size.text} text-[var(--text-secondary)]`}>
                            {entry.label}
                        </span>
                        <button
                            type="button"
                            onClick={handleOpen}
                            className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] transition-colors"
                            title={t('files.open', { defaultValue: "Open" })}
                        >
                            <ExternalLink size={size.icon} />
                        </button>
                        {onRemove && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemove(idx);
                                }}
                                className="shrink-0 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                                title={t('common.delete', { defaultValue: "Delete" })}
                            >
                                <X size={size.icon} />
                            </button>
                        )}
                    </span>
                );
            })}
        </div>
    );
}

export default FileFieldValue;
