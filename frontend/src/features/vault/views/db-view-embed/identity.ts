import type { TFunction } from 'i18next';
import type { EmbedBlock, EmbedContext } from './types';
export interface EmbedIdentity {
    block?: EmbedBlock;
    ctx: EmbedContext;
    t: TFunction;
    pageId: string | null;
    viewId: string;
    headingProp: string;
    headingLevelProp: number;
}
