import type {
    ImportReferencesResult,
    ReferenceExportFormat,
} from '../../../../shared/api/citation-io';


const duplicateLabels: Readonly<Record<string, string>> = {
    citation_key: 'per clau',
    doi: 'per DOI',
    isbn: 'per ISBN',
    title: 'per títol',
};


export function duplicateReferenceBreakdown(
    result: ImportReferencesResult,
): string[] {
    return Object.entries(duplicateLabels).flatMap(([key, label]) => {
        const count = result.skip_summary[key] ?? 0;
        return count > 0 ? [`${String(count)} ${label}`] : [];
    });
}


export function referenceExportFilename(format: ReferenceExportFormat): string {
    return `recursos.${format === 'bibtex' ? 'bib' : 'ris'}`;
}
