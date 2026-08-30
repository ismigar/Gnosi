import { describe, expect, it } from 'vitest';

import {
    duplicateReferenceBreakdown,
    referenceExportFilename,
} from './referenceImportModel';


describe('referenceImportModel', () => {
    it('formats non-zero duplicate reasons in stable order', () => {
        expect(duplicateReferenceBreakdown({
            created: 1,
            errors: [],
            format: 'bibtex',
            items: [],
            skip_summary: { citation_key: 2, doi: 1, isbn: 0, title: 3 },
            skipped: 6,
            skipped_details: [],
            skipped_keys: [],
        })).toEqual(['2 per clau', '1 per DOI', '3 per títol']);
    });

    it('maps export formats to their public filename extensions', () => {
        expect(referenceExportFilename('bibtex')).toBe('recursos.bib');
        expect(referenceExportFilename('ris')).toBe('recursos.ris');
    });
});
