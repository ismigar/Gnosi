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
 * FileFieldValue — render de LECTURA d'un camp de tipus `files`.
 *
 * Mostra cada fitxer com un chip (icona segons tipus o thumbnail amb hover per
 * a imatges) + nom net + botó "Obrir". L'edició no es gestiona aquí: a la
 * taula, el clic a la cel·la obre el MediaPicker; per això el cos del chip
 * deixa propagar el clic i només el botó "Obrir" l'atura.
 *
 * Props:
 *   value    — valor del camp (string de path/URL o array)
 *   field    — nom del camp (per a `alt` d'imatges)
 *   variant  — 'table' | 'gallery' | 'feed' | 'detail' (controla mides)
 *   onRemove — opcional `(idx) => void`. Si es passa, cada chip mostra una "X"
 *              per treure aquell fitxer (l'índex correspon a `parseFileEntries`).
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

    const wrapClass = variant === 'detail' || variant === 'feed'
        ? 'flex flex-wrap items-center gap-1.5'
        : 'flex items-center gap-1.5 overflow-hidden';

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
                            title={t('files.open', { defaultValue: 'Obrir' })}
                        >
                            <ExternalLink size={size.icon} />
                        </button>
                        {onRemove && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
                                className="shrink-0 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                                title={t('common.delete', { defaultValue: 'Elimina' })}
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
