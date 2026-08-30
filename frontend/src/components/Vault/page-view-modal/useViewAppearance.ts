import type { useViewStateResult } from './useViewState';
import type { ViewAppearance } from './types';

export function useViewAppearance({
    setCardSize, setGalleryPreview, setCoverField, setImageFit,
    setGroupBy, setGroupSort, setGroupSortDir, setDateField,
    setEndDateField, setCalendarView, setColorField, setRowHeight,
    setFeedPillLimit, setFeedExcerptLines, setFeedFocus, setSummaryModel,
    setChartType, setXField, setYField, setAggregation,
    cardSize, galleryPreview, coverField, imageFit,
    groupBy, groupSort, groupSortDir, dateField,
    endDateField, calendarView, colorField, rowHeight,
    feedPillLimit, feedExcerptLines, feedFocus, summaryModel,
    chartType, xField, yField, aggregation,
    viewType
}: Pick<
    useViewStateResult,
    'setCardSize'
    | 'setGalleryPreview'
    | 'setCoverField'
    | 'setImageFit'
    | 'setGroupBy'
    | 'setGroupSort'
    | 'setGroupSortDir'
    | 'setDateField'
    | 'setEndDateField'
    | 'setCalendarView'
    | 'setColorField'
    | 'setRowHeight'
    | 'setFeedPillLimit'
    | 'setFeedExcerptLines'
    | 'setFeedFocus'
    | 'setSummaryModel'
    | 'setChartType'
    | 'setXField'
    | 'setYField'
    | 'setAggregation'
    | 'cardSize'
    | 'galleryPreview'
    | 'coverField'
    | 'imageFit'
    | 'groupBy'
    | 'groupSort'
    | 'groupSortDir'
    | 'dateField'
    | 'endDateField'
    | 'calendarView'
    | 'colorField'
    | 'rowHeight'
    | 'feedPillLimit'
    | 'feedExcerptLines'
    | 'feedFocus'
    | 'summaryModel'
    | 'chartType'
    | 'xField'
    | 'yField'
    | 'aggregation'
    | 'viewType'
>) {
    const applyTypeOptions = (v: ViewAppearance | null | undefined) => {
        setCardSize(v?.cardSize || 'medium');
        setGalleryPreview(v?.galleryPreview || 'cover');
        setCoverField(v?.coverField || v?.cover_field || '');
        setImageFit(v?.imageFit || v?.image_fit || 'contain');
        setGroupBy(v?.groupBy || v?.group_by || '');
        setGroupSort(v?.groupSort || v?.group_sort || 'catalog');
        setGroupSortDir(v?.groupSortDir || v?.group_sort_dir || 'asc');
        setDateField(v?.dateField || v?.date_field || '');
        setEndDateField(v?.endDateField || v?.end_date_field || '');
        setCalendarView(v?.calendarView || v?.calendar_view || 'dayGridMonth');
        setColorField(v?.colorField || v?.color_field || '');
        setRowHeight(v?.rowHeight || v?.row_height || 'normal');
        setFeedPillLimit(Number(v?.pillLimit ?? v?.pill_limit) || 5);
        setFeedExcerptLines(Number(v?.excerptLines ?? v?.excerpt_lines) || 6);
        setFeedFocus(Boolean(v?.feedFocus ?? v?.feed_focus));
        setSummaryModel(v?.summaryModel || v?.summary_model || '');
        setChartType(v?.chartType || v?.chart_type || 'bar');
        setXField(v?.xField || v?.x_field || '');
        setYField(v?.yField || v?.y_field || '');
        setAggregation(v?.aggregation || (v?.yField || v?.y_field ? 'sum' : 'count'));
    };
    const resetTypeOptions = () => {
        setCardSize('medium');
        setGalleryPreview('cover');
        setCoverField('');
        setImageFit('contain');
        setGroupBy('');
        setGroupSort('catalog');
        setGroupSortDir('asc');
        setDateField('');
        setEndDateField('');
        setCalendarView('dayGridMonth');
        setColorField('');
        setRowHeight('normal');
        setFeedPillLimit(5);
        setFeedExcerptLines(6);
        setFeedFocus(false);
        setSummaryModel('');
        setChartType('bar');
        setXField('');
        setYField('');
        setAggregation('count');
    };
    const buildViewExtras = (src?: ViewAppearance | null) => {
        // Without `src` it takes the modal's current state; with `src` (an
        // existing view) it extracts the same fields with the same defaults,
        // tolerating camelCase (registry) and snake_case (embedded section). This way
        // change detection and saving use exactly the same shape.
        const s = src || { cardSize, galleryPreview, coverField, imageFit, groupBy, groupSort, groupSortDir, dateField, endDateField, calendarView, colorField, rowHeight, feedPillLimit, feedExcerptLines, feedFocus, summaryModel, chartType, xField, yField, aggregation };
        const extras: Record<string, unknown> = {};
        if (viewType === 'gallery') {
            extras.cardSize = s.cardSize || 'medium';
            extras.galleryPreview = s.galleryPreview || 'cover';
            extras.coverField = s.coverField || s.cover_field || '';
            extras.imageFit = s.imageFit || s.image_fit || 'contain';
            extras.groupBy = s.groupBy || s.group_by || '';
            extras.groupSort = s.groupSort || s.group_sort || 'catalog';
            extras.groupSortDir = s.groupSortDir || s.group_sort_dir || 'asc';
        } else if (viewType === 'board') {
            extras.groupBy = s.groupBy || s.group_by || '';
            extras.groupSort = s.groupSort || s.group_sort || 'catalog';
            extras.groupSortDir = s.groupSortDir || s.group_sort_dir || 'asc';
        } else if (viewType === 'calendar') {
            extras.dateField = s.dateField || s.date_field || '';
            extras.calendarView = s.calendarView || s.calendar_view || 'dayGridMonth';
        } else if (viewType === 'timeline') {
            extras.dateField = s.dateField || s.date_field || '';
            extras.endDateField = s.endDateField || s.end_date_field || '';
            extras.colorField = s.colorField || s.color_field || '';
        } else if (viewType === 'chart') {
            extras.chartType = s.chartType || s.chart_type || 'bar';
            extras.xField = s.xField || s.x_field || '';
            extras.yField = s.yField || s.y_field || '';
            extras.aggregation = s.aggregation || ((s.yField || s.y_field) ? 'sum' : 'count');
        } else if (viewType === 'feed') {
            extras.pillLimit = Number(s.pillLimit ?? s.pill_limit ?? s.feedPillLimit) || 5;
            extras.excerptLines = Number(s.excerptLines ?? s.excerpt_lines ?? s.feedExcerptLines) || 6;
            extras.feedFocus = Boolean(s.feedFocus ?? s.feed_focus);
            extras.summaryModel = s.summaryModel || s.summary_model || '';
        } else if (viewType === 'table' || viewType === 'list') {
            extras.rowHeight = s.rowHeight || s.row_height || 'normal';
            extras.groupBy = s.groupBy || s.group_by || '';
            extras.groupSort = s.groupSort || s.group_sort || 'catalog';
            extras.groupSortDir = s.groupSortDir || s.group_sort_dir || 'asc';
        }
        return extras;
    };
    return { applyTypeOptions, resetTypeOptions, buildViewExtras };
}
export type useViewAppearanceResult = ReturnType<typeof useViewAppearance>;
