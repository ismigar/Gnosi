import { currentRequestContext, type RequestContext } from '../../shared/api/request-context';
import { useLayoutEffect } from 'react';

export type AutosaveEntry = { pending: boolean; flush: () => Promise<boolean> };
export type RegisterAutosave = (key: string, value: AutosaveEntry | null) => void;

export function useAutosaveRegistration(register: RegisterAutosave | undefined, key: string, pending: boolean, flush: () => Promise<boolean>) {
  useLayoutEffect(() => {
    register?.(key, { pending, flush });
    return () => { register?.(key, null); };
  }, [register, key, pending, flush]);
}

/** Finish the edited vault's write on navigation, without borrowing another account. */
export function autosaveRequest<T>(context: RequestContext, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const current = currentRequestContext();
  if (context.userId !== current.userId || context.userEmail !== current.userEmail || context.workspaceId !== current.workspaceId) return Promise.reject(new Error('Website account changed'));
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); };
    const abort = () => { if (settled) return; settled = true; cleanup(); reject(new Error('Website autosave expired')); };
    const timer = setTimeout(() => { controller.abort(); }, 65_000);
    controller.signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve().then(() => operation(controller.signal)).then(value => {
      if (settled) return; settled = true; cleanup(); resolve(value);
    }).catch((error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error instanceof Error ? error : new Error('Website autosave failed')); });
  });
}
