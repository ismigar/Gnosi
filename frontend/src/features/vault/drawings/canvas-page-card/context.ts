import { createContext } from 'react';


export interface CanvasPageContextValue {
    readonly onOpenPage: ((pageId: string) => void) | null;
}


export const CanvasPageContext = createContext<CanvasPageContextValue>({
    onOpenPage: null,
});
