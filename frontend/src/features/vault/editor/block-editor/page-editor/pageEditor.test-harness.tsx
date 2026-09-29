import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import { usePageEditorController, type PageEditorController } from './usePageEditorController';
import { PageEditorView } from './PageEditorView';
import type { PageEditorBodyProps, PageEditorProps, PageTable } from './types';
import type { PageViewModalProps } from '../../../view-config/page-view-modal/types';
import { resetApiTestStorage } from '../../../../../../tests/api-request';

const fixture = vi.hoisted(() => ({
  role: 'owner', t: (key: string) => key, planning: {},
  notifyError: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
export { fixture };
vi.mock('react-i18next', async original => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: fixture.t }) }));
vi.mock('../../../../../shared/api/use-api', () => ({ useApi: () => ({ role: fixture.role }) }));
vi.mock('../../../../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: () => false, getPluginSettings: () => fixture.planning }) }));
vi.mock('../../../../../shared/hooks/useTheme', () => ({ useTheme: () => ({ effectiveTheme: 'light' }) }));
vi.mock('../../../../../shared/i18n/useLocaleSettings', () => ({ useLocaleSettings: () => ({ numberLocale: 'en-US', dateLocale: 'en-US' }) }));
vi.mock('../../../../../shared/notifications/notifyError', () => ({ notifyError: fixture.notifyError, logError: vi.fn() }));
vi.mock('../../../../../shared/notifications/toast', () => ({ toast: fixture.toast }));
vi.mock('../../CollaborationPresence', () => ({ CollaborationPresence: () => null }));
vi.mock('../../PageHistory', () => ({ default: () => null }));
vi.mock('../../../view-config/PageViewModal', () => ({ PageViewModal: (props: PageViewModalProps) => {
  useLayoutEffect(() => { pageViewClose = props.onClose; });
  return null;
} }));
vi.mock('../../IconPicker', () => ({ IconPicker: () => null }));
vi.mock('../../CoverPicker', () => ({ CoverPicker: () => null }));
vi.mock('../../../../literature/records/MetadataLookupModal', () => ({ MetadataLookupModal: () => null }));
vi.mock('../../../content/InsertContentModal', () => ({ InsertContentModal: () => null }));
vi.mock('../MarkdownCodeEditor', () => ({ MarkdownCodeEditor: () => <div data-code-editor /> }));

interface RequestLog { path: string; method: string; body: unknown }
export let root: Root;
export let container: HTMLDivElement;
let controller: PageEditorController | undefined;
export let innerProps: PageEditorBodyProps | undefined;
export let requests: RequestLog[];
let patchResponse: (() => Promise<Response>) | undefined;
export let pageViewClose: PageViewModalProps['onClose'] | undefined;
const idToTitle = { outgoing: 'Outgoing page' };
export const initialMetadata = { title: 'Fixture page', tags: ['one'], custom: { preserve: true } };
const allTables: PageTable[] = [];
function createEditorComponents() {
  function Inner(props: PageEditorBodyProps) {
    useLayoutEffect(() => { innerProps = props; });
    return <div data-inner-editor data-editable={props.isEditable} />;
  }
  function Harness(props: PageEditorProps & { view?: boolean }) {
    const value = usePageEditorController(props);
    useLayoutEffect(() => { controller = value; });
    return props.view ? <PageEditorView context={value} /> : null;
  }
  return { Inner, Harness };
}
const { Inner, Harness } = createEditorComponents();
export function state() {
  if (!controller) throw new Error('Page controller not mounted');
  return controller;
}
export async function mount(props: Partial<PageEditorProps> & { view?: boolean } = {}) {
  await act(async () => {
    root.render(<MemoryRouter><Harness noteFilename="fixture" initialContent="[[outgoing]]" initialMetadata={initialMetadata} idToTitle={idToTitle} allTables={allTables} EditorInner={Inner} {...props} /></MemoryRouter>);
    await Promise.resolve();
  });
}
export async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
export function patches() { return requests.filter(request => request.method === 'PATCH'); }
export function element<T extends Element>(selector: string, type: { new(): T }): T {
  const node = container.querySelector(selector);
  if (!(node instanceof type)) throw new Error(`Missing ${selector}`);
  return node;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetApiTestStorage();
  fixture.role = 'owner';
  vi.clearAllMocks();
  controller = undefined;
  innerProps = undefined;
  requests = [];
  patchResponse = undefined;
  pageViewClose = undefined;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    const text = request.method === 'GET' ? '' : await request.clone().text();
    const body: unknown = text ? JSON.parse(text) : null;
    requests.push({ path, method: request.method, body });
    if (request.method === 'PATCH') return patchResponse ? patchResponse() : Response.json({ status: 'success' });
    if (path === '/api/vault/open-resource') return Response.json({ status: 'success' });
    if (path === '/api/vault/backlinks') return Response.json([
      { id: 'fixture', title: 'Self', kind: 'link' },
      { id: 'incoming', title: 'Shared title', kind: 'link' },
      { id: 'incoming', title: 'Duplicate', kind: 'link' },
      { id: 'related', title: 'Related', kind: 'relation' },
    ]);
    if (path === '/api/vault/outlinks') return Response.json({ links: [], relations: [{ id: 'related', title: 'Related' }, { id: 'second', title: 'Second' }], unresolved: [] });
    if (path === '/api/vault/unlinked-mentions') return Response.json([{ id: 'mention', title: 'Mention', count: 2, snippet: 'Fixture text' }]);
    if (path === '/api/vault/link-unlinked-mentions') return Response.json({ status: 'success', target_id: 'fixture', target_title: 'Fixture page', notes_changed: 1, total_replacements: 2, changed_notes: [{ id: 'mention', title: 'Mention', replacements: 2 }] });
    throw new Error(`Unexpected fixture request ${path}`);
  }));
});
afterEach(async () => {
  await act(async () => { root.unmount(); await Promise.resolve(); });
  container.remove();
  vi.useRealTimers();
  resetApiTestStorage();
  vi.unstubAllGlobals();
});

export function setPatchResponse(response: (() => Promise<Response>) | undefined) {
  patchResponse = response;
}
