import { useTranslation } from 'react-i18next';

import {
    metadataDisplayText,
    type MetadataEntry,
    type MetadataRecord,
} from './metadataLookupModel';
import type { useMetadataLookup } from './useMetadataLookup';


type LookupController = ReturnType<typeof useMetadataLookup>;


function MetadataRow({
    currentMetadata,
    entry,
    onSelectedChange,
    selected,
}: {
    readonly currentMetadata: MetadataRecord;
    readonly entry: MetadataEntry;
    readonly onSelectedChange: (key: string, selected: boolean) => void;
    readonly selected: boolean;
}) {
    const { t } = useTranslation();
    const [key, value] = entry;
    const current = currentMetadata[key];
    const currentText = metadataDisplayText(current);
    const proposed = metadataDisplayText(value);
    const different = currentText !== proposed;
    return (
        <tr className="border-t border-[var(--border-secondary)] hover:bg-[var(--bg-hover)]">
            <td className="px-3 py-2">
                <input
                    checked={selected}
                    onChange={(event) => {
                        onSelectedChange(key, event.target.checked);
                    }}
                    type="checkbox"
                />
            </td>
            <td className="px-3 py-2 font-medium text-[var(--text-primary)] align-top">
                {key}
            </td>
            <td className="px-3 py-2 text-[var(--text-tertiary)] align-top break-words max-w-xs">
                {currentText || (
                    <em className="opacity-60">
                        {t('common.empty', { defaultValue: 'Empty' })}
                    </em>
                )}
            </td>
            <td className={`px-3 py-2 align-top break-words max-w-md ${different
                ? 'text-[var(--text-primary)] font-medium'
                : 'text-[var(--text-tertiary)]'}`}>
                {proposed}
            </td>
        </tr>
    );
}


export function MetadataLookupResults({
    controller,
    currentMetadata,
}: {
    readonly controller: LookupController;
    readonly currentMetadata: MetadataRecord;
}) {
    const { t } = useTranslation();
    const {
        grouped,
        loading,
        result,
        selectedFields,
        setSelectedFields,
    } = controller;
    const { fieldEntries, otherEntries, relevantEntries, zoteroType } = grouped;
    const allSelected = fieldEntries.length > 0 && fieldEntries.every(
        ([key]) => selectedFields[key],
    );
    const groupedDisplay = Boolean(zoteroType && relevantEntries.length > 0);
    const renderRows = (entries: readonly MetadataEntry[]) => entries.map((entry) => (
        <MetadataRow
            currentMetadata={currentMetadata}
            entry={entry}
            key={entry[0]}
            onSelectedChange={(key, selected) => {
                setSelectedFields((current) => ({ ...current, [key]: selected }));
            }}
            selected={Boolean(selectedFields[entry[0]])}
        />
    ));
    return (
        <div className="flex-1 overflow-y-auto">
            {result && fieldEntries.length === 0 && !loading ? (
                <div className="px-4 py-8 text-center text-sm text-[var(--text-tertiary)]">
                    {result.error ?? t('metadata_lookup.no_data', {
                        defaultValue: 'No data found.',
                    })}
                </div>
            ) : null}
            {fieldEntries.length > 0 ? (
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)] uppercase">
                        <tr>
                            <th className="px-3 py-2 text-left w-8">
                                <input
                                    checked={allSelected}
                                    onChange={(event) => {
                                        setSelectedFields(Object.fromEntries(
                                            fieldEntries.map(([key]) => [
                                                key,
                                                event.target.checked,
                                            ]),
                                        ));
                                    }}
                                    type="checkbox"
                                />
                            </th>
                            <th className="px-3 py-2 text-left">
                                {t('metadata_lookup.field', { defaultValue: 'Field' })}
                            </th>
                            <th className="px-3 py-2 text-left">
                                {t('metadata_lookup.current', { defaultValue: 'Current' })}
                            </th>
                            <th className="px-3 py-2 text-left">
                                {t('metadata_lookup.proposed', { defaultValue: 'Proposed' })}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedDisplay ? (
                            <tr className="bg-[var(--bg-secondary)]/40">
                                <td className="px-3 py-1.5 text-[11px] font-semibold uppercase text-[var(--text-secondary)] tracking-wide" colSpan={4}>
                                    {t('metadata_lookup.relevant_for', {
                                        defaultValue: 'Fields of the type',
                                    })}
                                    <span className="ml-1 text-[var(--text-tertiary)] font-normal normal-case">
                                        ({relevantEntries.length})
                                    </span>
                                </td>
                            </tr>
                        ) : null}
                        {renderRows(relevantEntries)}
                        {groupedDisplay && otherEntries.length > 0 ? (
                            <tr className="bg-[var(--bg-secondary)]/40">
                                <td className="px-3 py-1.5 text-[11px] font-semibold uppercase text-[var(--text-tertiary)] tracking-wide" colSpan={4}>
                                    {t('metadata_lookup.other_fields', {
                                        defaultValue: 'Other fields',
                                    })}
                                    <span className="ml-1 font-normal normal-case">
                                        ({otherEntries.length})
                                        {' — '}
                                        {t(
                                            'metadata_lookup.not_native',
                                            "the type doesn't carry them natively",
                                        )}
                                    </span>
                                </td>
                            </tr>
                        ) : null}
                        {renderRows(otherEntries)}
                    </tbody>
                </table>
            ) : null}
        </div>
    );
}
