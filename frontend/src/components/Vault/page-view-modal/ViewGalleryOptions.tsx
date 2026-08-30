import { CARD_SIZES, GALLERY_PREVIEWS } from './constants';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldLabelsResult } from './useViewFieldLabels';
import type { useViewOptionsResult } from './useViewOptions';

export function ViewGalleryOptions({
    viewType, t, setCardSize, cardSize,
    setGalleryPreview, galleryPreview, coverField, setCoverField,
    coverFieldOptions, fieldLabel, setImageFit, imageFit
}: Pick<
    useViewStateResult & ModalInput & useViewOptionsResult & useViewFieldLabelsResult,
    'viewType'
    | 't'
    | 'setCardSize'
    | 'cardSize'
    | 'setGalleryPreview'
    | 'galleryPreview'
    | 'coverField'
    | 'setCoverField'
    | 'coverFieldOptions'
    | 'fieldLabel'
    | 'setImageFit'
    | 'imageFit'
>) {
    return (<>                            {viewType === 'gallery' && (
        <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.gallery_options', "Gallery options")}</p>
            <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.card_size', "Card size")}</label>
                <div className="grid grid-cols-3 gap-2">
                    {CARD_SIZES.map(cs => (
                        <button
                            key={cs.value}
                            type="button"
                            onClick={() => { setCardSize(cs.value); }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${cardSize === cs.value
                                    ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                    : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                }`}
                        >
                            {t(`view.card_${cs.value}`, cs.label)}
                        </button>
                    ))}
                </div>
            </div>
            <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.card_preview', "Card preview")}</label>
                <div className="grid grid-cols-2 gap-2">
                    {GALLERY_PREVIEWS.map(gp => (
                        <button
                            key={gp.value}
                            type="button"
                            onClick={() => { setGalleryPreview(gp.value); }}
                            title={t(`view.gp_${gp.value}_hint`, gp.hint)}
                            className={`text-left px-2.5 py-2 rounded-lg border transition-all ${galleryPreview === gp.value
                                    ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10'
                                    : 'border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
                                }`}
                        >
                            <span className={`block text-xs font-semibold ${galleryPreview === gp.value ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}>{t(`view.gp_${gp.value}`, gp.label)}</span>
                            <span className="block text-[10px] text-[var(--text-tertiary)] leading-tight mt-0.5">{t(`view.gp_${gp.value}_hint`, gp.hint)}</span>
                        </button>
                    ))}
                </div>
            </div>
            <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.cover_field', "Cover field")}</label>
                <select
                    value={coverField}
                    onChange={e => { setCoverField(e.target.value); }}
                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                >
                    <option value="">{t('view.cover_default', "Page cover (default)")}</option>
                    {coverFieldOptions.map(f => (
                        <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                    ))}
                </select>
                <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{t('view.cover_hint', "Where each card's image comes from (only if the preview is “Cover”).")}</p>
            </div>
            <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.image_fit', "Image fit")}</label>
                <div className="grid grid-cols-2 gap-2">
                    {[{ value: 'contain', label: t('view.fit_contain', "Whole") }, { value: 'cover', label: t('view.fit_cover', "Fill") }].map(opt => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => { setImageFit(opt.value); }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${imageFit === opt.value
                                    ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                    : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )}</>);
}
