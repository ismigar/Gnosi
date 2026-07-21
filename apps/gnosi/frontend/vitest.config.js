import { defineConfig } from 'vitest/config';

// Unit tests for the connector scripts under public/. They are plain browser
// scripts, not modules: `taskpane.js` is an IIFE and `popup.js` declares
// globals, so neither can be imported. The suites load them into a jsdom
// document instead and drive them through the DOM and stubbed host APIs
// (Office.js, chrome.*), which is also closer to how they actually run.
//
// Deliberately narrow: `include` covers only these suites. Widening it to the
// React app would pull in a much larger setup (providers, i18n, router) and is
// a separate decision — the point here was to unblock connector testing, which
// had none at all.
export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.js'],
        restoreMocks: true,
    },
});
