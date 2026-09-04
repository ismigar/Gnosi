// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function source(name: string): ts.SourceFile {
  return ts.createSourceFile(name, readFileSync(new URL(name, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function collect<T>(file: ts.SourceFile, select: (node: ts.Node) => T | undefined): T[] {
  const result: T[] = [];
  function visit(node: ts.Node): void {
    const value = select(node);
    if (value !== undefined) result.push(value);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}

describe('application composition extraction contracts', () => {
  it('preserves every route, wrapper, permission gate and source order from a8f9d76f0', () => {
    const file = source('./routes.tsx');
    const printer = ts.createPrinter({ removeComments: true });
    const routes = collect(file, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'Route'
      ? printer.printNode(ts.EmitHint.Unspecified, node, file) : undefined);
    expect(routes).toHaveLength(32);
    expect(createHash('sha256').update(JSON.stringify(routes)).digest('hex'))
      .toBe('e224a66814a7d55998fabd012f35fc4fb496d2a35e7a7e66a070ec2482d2224d');
  });

  it('keeps the twenty optional imports deferred and the Home page eager', () => {
    const sourceRoot = new URL('../', import.meta.url).pathname;
    const entries = ['automations', 'calendar', 'contacts', 'control-center', 'graph', 'literature', 'mail', 'media', 'meetings', 'notebooks', 'planning', 'reader', 'sharing', 'social'];
    const files = ['./App.tsx', '../features/agent/AgentChatLauncher.tsx', './routes.tsx', './routePreload.ts', ...entries.map(feature => `../features/${feature}/index.ts`)];
    const imports = [...new Set(files.flatMap(name => collect(source(name), node => {
      if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined;
      const target = node.arguments[0];
      return target && ts.isStringLiteral(target)
        ? new URL(target.text, new URL(name, import.meta.url)).pathname.slice(sourceRoot.length)
        : undefined;
    })))];
    expect(imports.sort()).toEqual([
      'features/reader/zotero/ZoteroReaderTab', 'features/agent/AgentChat', 'features/automations/SchedulerPage',
      'features/calendar/CalendarPage', 'features/contacts/ContactsPage',
      'features/control-center/Dashboard', 'features/graph/GraphPage', 'features/literature/LiteraturePage',
      'features/mail/MailPage', 'features/media/MediaCenter', 'features/notebooks/NotebooksPage',
      'features/meetings/MeetingRecorder', 'features/meetings/MeetingReminderWatcher',
      'features/notebooks/create/NotebookCreateDialog',
      'features/planning/ProjectPlanningPage', 'features/reader/ReaderDashboard',
      'features/sharing/SharedPage', 'features/social/ComposerPage', 'features/social/SocialDashboard',
      'features/vault/VaultDashboard',
    ].sort());
    const eager = collect(source('./routes.tsx'), node => ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined);
    expect(eager).toContain('./HomePage');
    expect(eager.filter(path => path.startsWith('../pages/'))).toEqual([]);
  });

  it('keeps the original provider order and renders App before the tooltip', () => {
    const providers = source('./AppProviders.tsx');
    expect(collect(providers, node => ts.isJsxOpeningElement(node) ? node.tagName.getText(providers) : undefined))
      .toEqual(['StrictMode', 'ApiProvider', 'BrowserRouter', 'AuthProvider']);
    const bootstrap = source('./bootstrap.tsx');
    expect(collect(bootstrap, node => ts.isJsxSelfClosingElement(node) ? node.tagName.getText(bootstrap) : undefined))
      .toEqual(['App', 'GlobalTooltip']);
  });
});
