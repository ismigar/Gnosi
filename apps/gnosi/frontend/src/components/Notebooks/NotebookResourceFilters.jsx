import React from 'react';
import { useTranslation } from 'react-i18next';

const FILTER_GROUPS = [
    {
        key: 'type',
        facet: 'types',
        labelKey: 'notebooks.filter_type',
        label: 'Type',
        allKey: 'notebooks.filter_all_types',
        allLabel: 'All types',
    },
    {
        key: 'author',
        facet: 'authors',
        labelKey: 'notebooks.filter_author',
        label: 'Author',
        allKey: 'notebooks.filter_all_authors',
        allLabel: 'All authors',
    },
    {
        key: 'tag',
        facet: 'tags',
        labelKey: 'notebooks.filter_tag',
        label: 'Tag',
        allKey: 'notebooks.filter_all_tags',
        allLabel: 'All tags',
    },
];

export default function NotebookResourceFilters({ facets, filters, onChange, disabled = false }) {
    const { t } = useTranslation();
    const visibleGroups = FILTER_GROUPS.filter((group) => facets[group.facet]?.length);
    if (!visibleGroups.length) return null;

    const hasActiveFilters = FILTER_GROUPS.some((group) => filters[group.key]);
    return (
        <fieldset className="notebook-resource-filters" disabled={disabled}>
            <legend>{t('notebooks.filters_label', 'Resource filters')}</legend>
            <div className="notebook-resource-filters__controls">
                {visibleGroups.map((group) => (
                    <label key={group.key} className="notebook-resource-filter">
                        <span>{t(group.labelKey, group.label)}</span>
                        <select
                            value={filters[group.key] || ''}
                            onChange={(event) => onChange(group.key, event.target.value)}
                        >
                            <option value="">{t(group.allKey, group.allLabel)}</option>
                            {facets[group.facet].map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.value} ({option.count})
                                </option>
                            ))}
                        </select>
                    </label>
                ))}
                {hasActiveFilters && (
                    <button
                        type="button"
                        className="notebook-resource-filters__clear"
                        onClick={() => onChange('', '')}
                    >
                        {t('notebooks.clear_filters', 'Clear filters')}
                    </button>
                )}
            </div>
        </fieldset>
    );
}
