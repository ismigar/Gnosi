declare module 'citeproc' {
    export interface CiteprocSystem {
        retrieveItem: (id: string) => unknown;
        retrieveLocale: (language: string) => string;
    }

    export interface CitationCluster {
        readonly citationItems: readonly { readonly id: string }[];
        readonly properties: { readonly noteIndex: number };
    }

    export type CitationClusterResult = readonly [
        unknown,
        readonly (readonly [number, string, string])[],
    ];

    export type BibliographyResult = readonly [
        Readonly<Record<string, unknown>>,
        readonly string[],
    ];

    export class Engine {
        constructor(system: CiteprocSystem, style: string, language?: string);
        sys: CiteprocSystem;
        makeBibliography(): BibliographyResult | false | null;
        processCitationCluster(
            citation: CitationCluster,
            citationsPre: readonly unknown[],
            citationsPost: readonly unknown[],
        ): CitationClusterResult;
        updateItems(ids: readonly string[]): void;
    }

    const CSL: { readonly Engine: typeof Engine };
    export default CSL;
}
