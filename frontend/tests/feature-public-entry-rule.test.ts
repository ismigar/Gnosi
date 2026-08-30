// @vitest-environment node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lint = new ESLint({ cwd: frontend, overrideConfig: tseslint.configs.disableTypeChecked });

async function errors(code: string, filePath = 'tests/feature-public-entry-rule.test.ts') {
  const results = await lint.lintText(code, { filePath });
  expect(results.flatMap(result => result.messages).filter(message => message.fatal)).toEqual([]);
  return results.flatMap(result => result.messages)
    .filter(message => message.ruleId === 'gnosi/feature-boundaries')
    .map(message => message.messageId);
}

describe('reviewed feature public modules', () => {
  it.each([
    "import '@/features/calendar/components/DigitalBrainCalendar';",
    "export { DigitalBrainCalendar } from '@/features/calendar/components/DigitalBrainCalendar.tsx';",
    "const calendar = import('@/features/calendar/components/DigitalBrainCalendar.js');",
    "vi.mock('@/features/calendar/components/DigitalBrainCalendar', () => ({}));",
    "import type { CalendarProps } from '@/features/calendar/components/DigitalBrainCalendar';",
  ])('allows only explicitly reviewed public entry: %s', async code => {
    expect(await errors(code)).toEqual([]);
  });

  it.each([
    "import '@/features/calendar/components/private';",
    "export * from '@/features/calendar/components/DigitalBrainCalendar/internal';",
    "const hidden = import('@/features/calendar/components/digital-brain-calendar/useCalendarController');",
    "vi.mock('@/features/calendar/components/private', () => ({}));",
    "const hidden = await vi.importActual('@/features/calendar/components/private');",
    "jest.doMock('@/features/calendar/components/private');",
    "type Hidden = import('@/features/calendar/components/private').Hidden;",
  ])('keeps unlisted neighboring modules private: %s', async code => {
    expect(await errors(code)).toEqual(['privateFeature']);
  });

  it('never permits shared code to import a public feature', async () => {
    expect(await errors("import '@/features/calendar/components/DigitalBrainCalendar';", 'src/shared/ui/TestWidget.tsx'))
      .toEqual(['sharedDependency']);
  });

  it('keeps own feature internals accessible without public registration', async () => {
    expect(await errors("import './private';", 'src/features/calendar/components/TestWidget.tsx')).toEqual([]);
  });
});
