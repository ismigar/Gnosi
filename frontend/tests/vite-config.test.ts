// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile, type ConfigEnv } from 'vite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const configPath = fileURLToPath(new URL('../vite.config.js', import.meta.url));
let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'gnosi-vite-config-'));
  // Evaluate the real config without loading checkout/user env files or certs.
  vi.spyOn(process, 'cwd').mockReturnValue(temporaryDirectory);
  vi.stubEnv('VITE_BASE_PATH', undefined);
  vi.stubEnv('VITE_DEV_HTTPS', 'false');
  vi.stubEnv('__GNOSI_DEV_HTTPS_CACHE', undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function configuredBase(environment: ConfigEnv): Promise<string | undefined> {
  const result = await loadConfigFromFile(
    environment, configPath, temporaryDirectory, 'silent', undefined, 'native',
  );
  if (!result) throw new Error('Expected the real frontend configuration');
  return result.config.base;
}

const environments: ConfigEnv[] = [
  { command: 'build', mode: 'production' },
  { command: 'serve', mode: 'development' },
  { command: 'serve', mode: 'production', isPreview: true },
];

for (const environment of environments) {
  it(`uses origin-root assets for ${environment.command}/${environment.mode}/${String(environment.isPreview)}`, async () => {
    expect(await configuredBase(environment)).toBe('/');
    vi.stubEnv('VITE_BASE_PATH', '');
    expect(await configuredBase(environment)).toBe('/');
  });
}

it.each(['./', '/gnosi-assets/', 'https://static.example.invalid/gnosi/'])(
  'preserves explicit asset base %s without implying a router basename', async base => {
    vi.stubEnv('VITE_BASE_PATH', base);
    expect(await configuredBase({ command: 'build', mode: 'production' })).toBe(base);
  },
);

it('retains process-over-local-file precedence for explicit asset bases', async () => {
  writeFileSync(join(temporaryDirectory, '.env'), 'VITE_BASE_PATH=/fixture-assets/\n');
  expect(await configuredBase({ command: 'build', mode: 'production' })).toBe('/fixture-assets/');
  vi.stubEnv('VITE_BASE_PATH', '/process-assets/');
  expect(await configuredBase({ command: 'build', mode: 'production' })).toBe('/process-assets/');
});
