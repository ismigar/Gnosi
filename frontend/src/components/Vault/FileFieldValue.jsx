import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    FileText, Film, Music, File as FileIcon, Link as LinkIcon, ExternalLink, Image as ImageIcon, X,
} from 'lucide-react';
import { ImageHoverPreview } from './ImageHoverPreview';
import {
    parseFileEntries, fileKindFromValue, toServedAssetUrl, toAssetPreviewUrl, openFileResource,
} from '../../lib/fileResource';

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

const KIND_ICON = {
    image: ImageIcon,
    document: FileText,
    video: Film,
    audio: Music,
    url: LinkIcon,
    file: FileIcon,
};

const VARIANT = {
    table:   { icon: 13, text: 'text-xs',     max: 'max-w-[150px]', thumb: 'w-7 h-5' },
    gallery: { icon: 12, text: 'text-[11px]', max: 'max-w-[130px]', thumb: 'w-6 h-5' },
    feed:    { icon: 14, text: 'text-sm',     max: 'max-w-[220px]', thumb: 'w-9 h-6' },
    detail:  { icon: 14, text: 'text-sm',     max: 'max-w-[320px]', thumb: 'w-9 h-6' },
};

export function FileFieldValue({ value, field = '', variant = 'table', onRemove }) {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const entries = parseFileEntries(value);
    const size = VARIANT[variant] || VARIANT.table;

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
                const kind = fileKindFromValue(entry.target);
                const previewUrl = kind === 'image' ? toAssetPreviewUrl(entry.target) : '';
                const openTarget = toServedAssetUrl(entry.target) || entry.target;
                const Icon = KIND_ICON[kind] || FileIcon;

                const handleOpen = (e) => {
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
                                onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
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
