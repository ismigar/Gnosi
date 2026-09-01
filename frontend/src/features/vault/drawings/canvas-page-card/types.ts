import type { TLShape } from 'tldraw';


export const PAGE_CARD_TYPE = 'page-card' as const;


declare module '@tldraw/tlschema' {
    interface TLGlobalShapePropsMap {
        [PAGE_CARD_TYPE]: {
            h: number;
            pageId: string;
            pageTitle: string;
            w: number;
        };
    }
}


export type PageCardShape = TLShape<typeof PAGE_CARD_TYPE>;


export interface PageCardData {
    readonly content: string;
    readonly title: string;
}
