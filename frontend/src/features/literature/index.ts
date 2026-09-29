import { lazy } from 'react';

export const LiteraturePage = lazy(() => import('./LiteraturePage'));

export { ResourceProcessingMonitor } from './records/process-resource/ResourceProcessingMonitor';
export { getResourceProcessingTasks, subscribeResourceProcessingTasks } from './records/process-resource/resourceProcessingTasks';
