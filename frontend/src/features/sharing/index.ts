import { lazy } from 'react';

export const SharedPage = lazy(() => import('./SharedPage'));
export { isPublicationPath } from './publishing/publicEntry';
export const loadPublication = () => import('./publishing/publicBootstrap');
