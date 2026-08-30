import { emitAppEvent, subscribeAppSignal } from '../../../shared/platform/app-events';
// These are the existing editor signals; ownership stays within the embed domain.
declare module '../../../shared/platform/app-events' {
    interface AppEventMap {
        readonly 'gnosi:open-view-tools': null;
        readonly 'gnosi:toggle-focus-mode': null;
        readonly 'gnosi:records-deleted': { readonly ids: readonly string[]; };
    }
}
export { emitAppEvent, subscribeAppSignal };
