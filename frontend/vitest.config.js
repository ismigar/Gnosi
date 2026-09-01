import { defineConfig } from 'vitest/config';

// Unit tests for the connector scripts under public/. They are plain browser
// scripts, not modules: `taskpane.js` is an IIFE and `popup.js` declares
// globals, so neither can be imported. The suites load them into a jsdom
// document instead and drive them through the DOM and stubbed host APIs
// (Office.js, chrome.*), which is also closer to how they actually run.
//
// Keep discovery limited to explicit unit-test files. Application modules can
// opt in without requiring a global React provider setup.
export default defineConfig({
    test: {
        environment: 'jsdom',
        include: [
            'tests/**/*.test.{js,ts}',
            'src/**/*.test.{js,jsx,ts,tsx}',
        ],
        restoreMocks: true,
    },
});
