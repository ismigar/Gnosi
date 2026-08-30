// @vitest-environment node
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { runtimeHarness } from './runtime-test-support';

describe('production sandbox serialization', () => {
  it('executes the actual Vite-minified runtime without capturing host helpers', async () => {
    const result = await build({
      configFile: false, logLevel: 'silent',
      build: {
        write: false, minify: true, emptyOutDir: false,
        lib: { entry: fileURLToPath(new URL('./document.ts', import.meta.url)), name: 'PluginSandboxFixture', formats: ['iife'] },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const output = outputs.find(item => 'output' in item);
    if (!output || !('output' in output)) throw new Error('Vite did not return a bundle');
    const chunk = output.output.find(item => item.type === 'chunk' && item.isEntry);
    if (!chunk || chunk.type !== 'chunk') throw new Error('Vite did not emit the entry chunk');
    const source: unknown = runInNewContext(`${chunk.code}; PluginSandboxFixture.sandboxRuntimeSource();`, {}, { timeout: 1000 });
    if (typeof source !== 'string') throw new Error('Minified runtime source is missing');
    const { api, deliver, postMessage } = runtimeHarness(source);
    const request = api.settings.get();
    deliver({ __gnosi_host: true, type: 'host-result', id: 'c1', ok: true, result: { accent: 'blue' } });
    await expect(request).resolves.toEqual({ accent: 'blue' });
    expect(postMessage.mock.calls).toEqual([
      [{ __gnosi: true, type: 'ready' }, '*'],
      [{ __gnosi: true, type: 'host-call', id: 'c1', method: 'settings.get', args: {} }, '*'],
    ]);
  }, 30000);
});
