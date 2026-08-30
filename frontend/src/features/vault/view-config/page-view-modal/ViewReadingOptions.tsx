import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';

export function ViewReadingOptions({
    viewType, t, setRowHeight, rowHeight,
    feedPillLimit, setFeedPillLimit, feedExcerptLines, setFeedExcerptLines,
    feedFocus, setFeedFocus, summaryModel, setSummaryModel,
    summaryModels
}: Pick<
    useViewStateResult & ModalInput,
    'viewType'
    | 't'
    | 'setRowHeight'
    | 'rowHeight'
    | 'feedPillLimit'
    | 'setFeedPillLimit'
    | 'feedExcerptLines'
    | 'setFeedExcerptLines'
    | 'feedFocus'
    | 'setFeedFocus'
    | 'summaryModel'
    | 'setSummaryModel'
    | 'summaryModels'
>) {
    return (<>                            {(viewType === 'table' || viewType === 'list') && (
        <div className="border-t border-[var(--border-primary)] pt-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.table_options', "Table options")}</p>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.row_height', "Row height")}</label>
            <div className="grid grid-cols-3 gap-2">
                {[{ value: 'compact', label: t('view.row_compact', "Compact") }, { value: 'normal', label: t('view.row_normal', 'Normal') }, { value: 'tall', label: t('view.row_tall', "Tall") }].map(opt => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => { setRowHeight(opt.value); }}
                        className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${rowHeight === opt.value
                                ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                            }`}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
        </div>
    )}
        {viewType === 'feed' && (
            <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.feed_options', "Feed options")}</p>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('feed.visible_tags', 'Visible tags')}</label>
                        <select value={feedPillLimit} onChange={event => { setFeedPillLimit(Number(event.target.value)); }} className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]">
                            <option value="3">3</option>
                            <option value="5">5</option>
                            <option value="8">8</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('feed.excerpt_length', 'Excerpt length')}</label>
                        <select value={feedExcerptLines} onChange={event => { setFeedExcerptLines(Number(event.target.value)); }} className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]">
                            <option value="3">3</option>
                            <option value="6">6</option>
                            <option value="9">9</option>
                        </select>
                    </div>
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] cursor-pointer">
                    <input type="checkbox" checked={feedFocus} onChange={event => { setFeedFocus(event.target.checked); }} className="accent-[var(--gnosi-primary)]" />
                    {t('feed.focus_feed', 'Focus feed')}
                </label>
                <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('feed.summary_model', 'Summary model')}</label>
                    <select value={summaryModel} onChange={event => { setSummaryModel(event.target.value); }} disabled={!summaryModels.length} className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)] disabled:opacity-50">
                        <option value="">{t('feed.summary_model_placeholder', 'Select an active model')}</option>
                        {summaryModels.map(model => <option key={`${model.provider}:${model.model_id}`} value={`${model.provider}:${model.model_id}`}>{model.provider}: {model.model_id}</option>)}
                    </select>
                </div>
            </div>
        )}</>);
}
