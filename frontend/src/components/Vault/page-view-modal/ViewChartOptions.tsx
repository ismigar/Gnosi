import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldsResult } from './useViewFields';
import type { useViewFieldLabelsResult } from './useViewFieldLabels';
import type { useViewOptionsResult } from './useViewOptions';

export function ViewChartOptions({
    viewType, t, selectedTable, chartType,
    setChartType, xField, setXField, sortedTableFields,
    fieldLabel, aggregation, setAggregation, yField,
    setYField, numericFieldOptions
}: Pick<
    useViewStateResult & ModalInput & useViewFieldsResult & useViewFieldLabelsResult & useViewOptionsResult,
    'viewType'
    | 't'
    | 'selectedTable'
    | 'chartType'
    | 'setChartType'
    | 'xField'
    | 'setXField'
    | 'sortedTableFields'
    | 'fieldLabel'
    | 'aggregation'
    | 'setAggregation'
    | 'yField'
    | 'setYField'
    | 'numericFieldOptions'
>) {
    return (<>                            {viewType === 'chart' && (
        <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.chart_options', "Chart options")}</p>
            {!selectedTable ? (
                <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
            ) : (
                <>
                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.chart_type', "Chart type")}</label>
                        <select
                            value={chartType}
                            onChange={e => { setChartType(e.target.value); }}
                            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                        >
                            <option value="bar">{t('view.chart_bar', "Bars")}</option>
                            <option value="hbar">{t('view.chart_hbar', "Horizontal bars")}</option>
                            <option value="line">{t('view.chart_line', "Line")}</option>
                            <option value="pie">{t('view.chart_pie', "Pie")}</option>
                            <option value="donut">{t('view.chart_donut', 'Donut')}</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.chart_x', "Group by (X axis)")}</label>
                        <select
                            value={xField}
                            onChange={e => { setXField(e.target.value); }}
                            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                        >
                            <option value="">{t('view.pick_field', "— Pick a field —")}</option>
                            {sortedTableFields.map(f => (
                                <option key={f.name} value={f.name}>{f.displayName || fieldLabel(f.name)}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.aggregation', "Aggregation function")}</label>
                        <select
                            value={aggregation}
                            onChange={e => { setAggregation(e.target.value); }}
                            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                        >
                            <option value="count">{t('view.agg_count', "Count (number of rows)")}</option>
                            <option value="sum">{t('view.agg_sum', "Sum")}</option>
                            <option value="avg">{t('view.agg_avg', "Average")}</option>
                            <option value="min">{t('view.agg_min', "Min")}</option>
                            <option value="max">{t('view.agg_max', "Max")}</option>
                        </select>
                    </div>
                    {aggregation !== 'count' && (
                        <div>
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.chart_y', "Value field (Y axis)")}</label>
                            <select
                                value={yField}
                                onChange={e => { setYField(e.target.value); }}
                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                            >
                                <option value="">{t('view.pick_numeric', "— Pick a numeric field —")}</option>
                                {numericFieldOptions.map(f => (
                                    <option key={f.name} value={f.name}>{f.displayName || fieldLabel(f.name)}</option>
                                ))}
                            </select>
                            {numericFieldOptions.length === 0 && (
                                <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{t('view.no_numeric', "No numeric field in the table; use “Count”.")}</p>
                            )}
                        </div>
                    )}
                    {!xField && (
                        <p className="text-[11px] text-[var(--text-tertiary)]">{t('view.chart_pick_x', "Pick the grouping field to see the chart.")}</p>
                    )}
                </>
            )}
        </div>
    )}</>);
}
