// @vitest-environment node
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile, type ConfigEnv } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const configPath = fileURLToPath(new URL('../vitest.config.js', import.meta.url));
const frontendRoot = dirname(configPath);
const environment: ConfigEnv = { command: 'serve', mode: 'test' };

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${label} to be an object`);
  }
  return value as Record<string, unknown>;
}

async function loadTestConfig(
  maxWorkersOverride?: string,
): Promise<Record<string, unknown>> {
  vi.stubEnv('GNOSI_VITEST_MAX_WORKERS', maxWorkersOverride);
  const loaded = await loadConfigFromFile(
    environment,
    configPath,
    frontendRoot,
    'silent',
  );
  if (!loaded) throw new Error('Expected the real Vitest configuration');
  const config = requireRecord(loaded.config, 'loaded configuration');
  return requireRecord(config.test, 'Vitest test configuration');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Vitest worker policy', () => {
  it('uses a conservative CPU-aware default without weakening failure gates', async () => {
    const test = await loadTestConfig();

    expect(test.maxWorkers).toBe(
      Math.min(2, Math.max(1, availableParallelism() - 1)),
    );
    expect(test).not.toHaveProperty('testTimeout');
    expect(test).not.toHaveProperty('hookTimeout');
    expect(test).not.toHaveProperty('retry');
    expect(test.fileParallelism).not.toBe(false);
  });

  it('accepts a measured positive-integer override without oversubscribing CPUs', async () => {
    const test = await loadTestConfig('3');

    expect(test.maxWorkers).toBe(Math.min(3, availableParallelism()));
  });

  it.each(['0', '-1', '2.5', 'many'])(
    'falls back to the safe default for malformed override %s',
    async override => {
      const test = await loadTestConfig(override);
      expect(test.maxWorkers).toBe(
        Math.min(2, Math.max(1, availableParallelism() - 1)),
      );
    },
  );
});
