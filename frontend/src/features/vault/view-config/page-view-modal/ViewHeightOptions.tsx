import { useId, useState } from 'react';
import { viewHeightMode, viewHeightPercent } from '../../../../shared/records/model/viewHeight';
import type { useViewController } from './useViewController';

export function ViewHeightOptions({ heightMode, setHeightMode, heightPercent, setHeightPercent, viewType, t }: Pick<
    ReturnType<typeof useViewController>, 'heightMode' | 'setHeightMode' | 'heightPercent' | 'setHeightPercent' | 'viewType' | 't'
>) {
    const selected = viewHeightMode(heightMode, viewType);
    const inputId = useId();
    const [edit, setEdit] = useState<{ base: number; value: string } | null>(null);
    const draft = edit?.base === heightPercent ? edit.value : String(heightPercent);
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
        {selected === 'limited' && <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor={inputId} className="text-xs font-semibold text-[var(--text-secondary)]">
                {t('view.height_percent', 'Maximum window height (%)')}
            </label>
            <input id={inputId} type="number" min={1} max={100} step={1} value={draft}
                className="w-20 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                onChange={event => {
                    const value = event.target.value;
                    const percent = Number(value);
                    const valid = value !== '' && Number.isInteger(percent) && percent >= 1 && percent <= 100;
                    setEdit({ base: valid ? percent : heightPercent, value });
                    if (valid) setHeightPercent(percent);
                }}
                onBlur={() => {
                    const percent = draft === '' ? heightPercent : viewHeightPercent(Number(draft));
                    setHeightPercent(percent);
                    setEdit(null);
                }}
            />
        </div>}
        <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">
            {selected === 'limited'
                ? t('view.height_limited_hint', { percent: heightPercent, defaultValue: 'Grows up to {{percent}}% of the window height, then scrolls within the view.' })
                : t('view.height_content_hint', 'Grows with the content. Scroll the page to read everything in sequence.')}
        </p>
    </fieldset>;
}
