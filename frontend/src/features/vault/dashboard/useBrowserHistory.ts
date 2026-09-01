import { useState } from 'react';
import { useNavigationType, type NavigateFunction } from 'react-router-dom';
import { record } from './readers';
export function browserHistoryIndex(): number {
    if (typeof window === 'undefined')
        return 0;
    const index = record(window.history.state).idx;
    return typeof index === 'number' ? index : 0;
}
export function historyMaximum(maximum: number, index: number, navigationType: string): number {
    return navigationType === 'PUSH' ? index : Math.max(maximum, index);
}
export function useBrowserHistory(navigate: NavigateFunction) {
    const navigationType = useNavigationType();
    const index = browserHistoryIndex();
    const [previous, setPrevious] = useState({ index, navigationType, maximum: index });
    const maximum = historyMaximum(previous.maximum, index, navigationType);
    if (previous.index !== index || previous.navigationType !== navigationType) {
        setPrevious({ index, navigationType, maximum });
    }
    const canGoBack = index > 0;
    const canGoForward = index < maximum;
    return {
        canGoBack, canGoForward,
        handleNavigationBack: () => { if (canGoBack)
            void navigate(-1); },
        handleNavigationForward: () => { if (canGoForward)
            void navigate(1); },
    };
}
