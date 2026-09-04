import { availableParallelism } from 'node:os';
import process from 'node:process';
import { defineConfig } from 'vitest/config';

const DEFAULT_MAX_WORKERS = 2;
const POSITIVE_INTEGER = /^[1-9]\d*$/u;

function resolveMaxWorkers() {
    const cpuCount = Math.max(1, availableParallelism());
    const override = process.env.GNOSI_VITEST_MAX_WORKERS;
    if (override && POSITIVE_INTEGER.test(override)) {
        return Math.min(Number.parseInt(override, 10), cpuCount);
    }

    // jsdom workers load the complete React application graph. Keeping one CPU
    // free and at most two workers avoids memory-pressure timeouts on developer
    // machines and small build VMs while preserving parallel file execution.
    return Math.min(DEFAULT_MAX_WORKERS, Math.max(1, cpuCount - 1));
}

// Unit tests for the connector scripts under public/. They are plain browser
// scripts, not modules: `taskpane.js` is an IIFE and `popup.js` declares
// globals, so neither can be imported. The suites load them into a jsdom
// document instead and drive them through the DOM and stubbed host APIs
// (Office.js, chrome.*), which is also closer to how they actually run.
//
// Keep discovery limited to explicit unit-test files. Application modules can
// opt in without requiring a global React provider setup.
export default defineConfig(() => ({
    test: {
        environment: 'jsdom',
        include: [
            'tests/**/*.test.{js,ts}',
            'src/**/*.test.{js,jsx,ts,tsx}',
        ],
        maxWorkers: resolveMaxWorkers(),
        restoreMocks: true,
    },
}));
