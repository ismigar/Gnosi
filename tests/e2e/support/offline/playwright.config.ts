import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '../../tests/disposable', testMatch: 'offline-companion.spec.ts',
    outputDir: '../../../../.tmp/gauntlet/obsidian-parity/offline-browser/results',
    workers: 1, fullyParallel: false, timeout: 60_000, reporter: 'line',
    use: { baseURL: 'http://127.0.0.1:5198', browserName: 'chromium', locale: 'en-GB',
        viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', trace: 'retain-on-failure' },
    webServer: { command: 'node server.mjs', cwd: import.meta.dirname, url: 'http://127.0.0.1:5198/offline.html', reuseExistingServer: false },
});
