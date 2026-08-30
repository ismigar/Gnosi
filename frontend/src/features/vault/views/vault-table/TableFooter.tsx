import type { TableController } from './useTableController';

export function TableFooter({ model }: { model: TableController; }) {
  const { t, dynamicColumns, showModifiedColumn, aggregations, setAggregations, calculateAggregation } = model;
  return (<tfoot className="bg-[var(--bg-primary)] text-[11px] text-[var(--text-secondary)] font-medium">
    <tr>
      <td className="w-10 sticky left-0 bg-[var(--bg-primary)] z-20 border-r border-[var(--border-primary)]"></td>
      <td className="py-2 px-4 sticky left-10 bg-[var(--bg-secondary)] z-20 border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)]">
        <div className="flex flex-col">
          <select
            className="bg-transparent border-none p-0 focus:ring-0 cursor-pointer hover:text-indigo-600"
            value={aggregations['title'] || 'none'}
            onChange={(e) => { setAggregations({ ...aggregations, title: e.currentTarget.value }); }}
          >
            <option value="none">({t('table.none')})</option>
            <option value="count">{t('table.agg_count', "Count")}</option>
          </select>
          {aggregations['title'] && aggregations['title'] !== 'none' && (
            <span className="text-[var(--text-primary)] font-bold">{calculateAggregation('title', 'title')}</span>
          )}
        </div>
      </td>
      {dynamicColumns.map(([key, type]) => (
        <td key={key} className="py-2 px-4 border-r border-[var(--border-primary)]">
          <div className="flex flex-col">
            <select
              className="bg-transparent border-none p-0 focus:ring-0 cursor-pointer hover:text-indigo-600"
              value={aggregations[key] || 'none'}
              onChange={(e) => { setAggregations({ ...aggregations, [key]: e.currentTarget.value }); }}
            >
              <option value="none">({t('table.none')})</option>
              <option value="count">{t('table.agg_count', "Count")}</option>
              {(type === 'number' || type === 'formula' || type === 'rollup') && (
                <>
                  <option value="sum">{t('view.agg_sum', "Sum")}</option>
                  <option value="avg">{t('view.agg_avg', "Average")}</option>
                  <option value="min">{t('view.agg_min', "Min")}</option>
                  <option value="max">{t('view.agg_max', "Max")}</option>
                </>
              )}
              {(type === 'date' || type === 'datetime' || type === 'period') && (
                <>
                  <option value="earliest">{t('table.earliest')}</option>
                  <option value="latest">{t('table.latest')}</option>
                </>
              )}
            </select>
            {aggregations[key] && aggregations[key] !== 'none' && (
              <span className="text-[var(--text-primary)] font-bold">{calculateAggregation(key, type)}</span>
            )}
          </div>
        </td>
      ))}
      {showModifiedColumn && (
        <td className="py-2 px-4 border-l border-[var(--border-primary)]">
          <div className="flex flex-col">
            <select
              className="bg-transparent border-none p-0 focus:ring-0 cursor-pointer hover:text-indigo-600"
              value={aggregations['last_modified'] || 'none'}
              onChange={(e) => { setAggregations({ ...aggregations, last_modified: e.currentTarget.value }); }}
            >
              <option value="none">({t('table.none')})</option>
              <option value="count">{t('table.agg_count', "Count")}</option>
              <option value="earliest">{t('table.earliest')}</option>
              <option value="latest">{t('table.latest')}</option>
            </select>
            {aggregations['last_modified'] && aggregations['last_modified'] !== 'none' && (
              <span className="text-[var(--text-primary)] font-bold">{calculateAggregation('last_modified', 'date')}</span>
            )}
          </div>
        </td>
      )}
    </tr>
  </tfoot>);
}
