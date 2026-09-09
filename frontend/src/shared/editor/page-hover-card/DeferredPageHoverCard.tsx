import { lazy } from 'react';

export const DeferredPageHoverCard = lazy(() => import('../PageHoverCard').then(module => ({ default: module.PageHoverCard })));
