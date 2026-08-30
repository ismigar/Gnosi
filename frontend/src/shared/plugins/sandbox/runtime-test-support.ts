import { runInNewContext } from 'node:vm';
import { vi } from 'vitest';
import type { SandboxMessage, SandboxScope } from './contracts';
import { sandboxRuntimeSource } from './document';

/** Execute serialized code in a separate realm with only the iframe's native port. */
export function runtimeHarness(source = sandboxRuntimeSource()) {
  const postMessage = vi.fn<(message: Readonly<Record<string, unknown>>, targetOrigin: string) => void>();
  const parent = { postMessage };
  let listener: ((event: SandboxMessage) => void) | undefined;
  const scope: SandboxScope = {
    parent,
    addEventListener: (_type, callback) => { listener = callback; },
  };
  runInNewContext(source, { window: scope }, { timeout: 1000 });
  const api = scope.gnosi;
  if (!api) throw new Error('Sandbox did not expose API v2');
  const deliver = (data: unknown, source: unknown = parent): void => {
    if (!listener) throw new Error('Sandbox did not subscribe to messages');
    listener({ data, source });
  };
  return { api, deliver, parent, postMessage, scope };
}
