import { viewHeightMode } from '../../../../shared/records/model/viewHeight';
import type { useViewController } from './useViewController';

export function ViewHeightOptions({ heightMode, setHeightMode, viewType, t }: Pick<
    ReturnType<typeof useViewController>, 'heightMode' | 'setHeightMode' | 'viewType' | 't'
>) {
    const selected = viewHeightMode(heightMode, viewType);
    return <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-[var(--text-secondary)]">
            {t('view.height_label', 'Height within a page')}
        </legend>
        <div className="flex flex-wrap gap-2">
            {(['limited', 'content'] as const).map(mode => <button
                key={mode}
                type="button"
                aria-pressed={selected === mode}
                onClick={() => { setHeightMode(mode); }}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition-all ${selected === mode
                    ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                    : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
            >{mode === 'limited'
                    ? t('view.height_limited', 'Limited')
                    : t('view.height_content', 'Fit content')}
            </button>)}
        </div>
        <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">
            {selected === 'limited'
                ? t('view.height_limited_hint', 'Grows up to 70% of the window height, then scrolls within the view.')
                : t('view.height_content_hint', 'Grows with the content. Scroll the page to read everything in sequence.')}
        </p>
    </fieldset>;
}
