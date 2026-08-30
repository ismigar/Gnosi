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
    const imports = ['./App.tsx', './routes.tsx', '../features/notebooks/index.ts', '../features/mail/index.ts'].flatMap(name => collect(source(name), node => {
      if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined;
      const target = node.arguments[0];
      return target && ts.isStringLiteral(target)
        ? new URL(target.text, new URL(name, import.meta.url)).pathname.slice(sourceRoot.length)
        : undefined;
    }));
    expect(imports.sort()).toEqual([
      'components/AgentChat', 'components/MeetingRecorder', 'components/MeetingReminderWatcher',
      'components/Vault/ZoteroReaderTab', 'features/mail/MailPage', 'features/notebooks/NotebooksPage',
      'features/notebooks/create/NotebookCreateDialog',
      'pages/CalendarPage', 'pages/ComposerPage', 'pages/ContactsPage', 'pages/Dashboard',
      'pages/GraphPage', 'pages/LiteraturePage', 'pages/MediaCenter',
      'pages/ProjectPlanningPage', 'pages/ReaderDashboard',
      'pages/SchedulerPage', 'pages/SharedPage', 'pages/SocialDashboard', 'pages/VaultDashboard',
    ]);
    const eager = collect(source('./routes.tsx'), node => ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined);
    expect(eager).toContain('../pages/HomePage');
    expect(eager.filter(path => path.startsWith('../pages/'))).toEqual(['../pages/HomePage']);
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
