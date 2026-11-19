import type { TLBaseShape } from '@bigbluebutton/tldraw';

export const PAGE_CARD_TYPE = 'page-card' as const;

export type PageCardShape = TLBaseShape<typeof PAGE_CARD_TYPE, {
    w: number;
    h: number;
    pageId: string;
    pageTitle: string;
}>;

export interface PageCardData {
    readonly content: string;
    readonly title: string;
}
