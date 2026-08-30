import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VaultViewPage } from '../../hooks/useVaultViewData';
import { mountTestComponent } from '../../test/mount-react';
import { VaultFeed } from './VaultFeed';
import type { VaultViewBodyProps } from './VaultViewBody';
import type { VaultFeedUpdate } from './vaultFeedTypes';

const fixture = vi.hoisted(() => ({
  t: (key: string, options?: string | Readonly<Record<string, unknown>>) => {
    if (typeof options === 'string') return options;
    return typeof options?.defaultValue === 'string' ? options.defaultValue : key;
  },
  locale: { currencyCode: 'EUR', dateFormat: 'locale', dateLocale: 'en', decimalSymbol: '.', numberLocale: 'en' },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fixture.t, i18n: { language: 'en' } }) }));
vi.mock('../../hooks/useLocaleSettings', () => ({ useLocaleSettings: () => fixture.locale }));
vi.mock('../../shared/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('./useTitlePreview', () => ({ useTitlePreview: () => ({ getTitleProps: () => ({}), preview: null }) }));
vi.mock('./VaultMarkdown', () => ({ VaultMarkdown: ({ md }: { readonly md: string }) => <p>{md}</p> }));
vi.mock('../../shared/api/vault-summary', () => ({ fetchVaultSummarySettings: vi.fn(), summarizeVaultRecord: vi.fn(), updateVaultSummarySettings: vi.fn() }));
vi.mock('../../lib/notifyError', () => ({ logError: vi.fn() }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const activeView = { id: 'feed-dom', summaryModel: 'fixture/model' };

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(item => item.textContent === text);
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}

function selectFirst(container: HTMLElement): void {
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!checkbox) throw new Error('Missing feed selection checkbox');
  act(() => { checkbox.click(); });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('VaultFeed direct renderer contract', () => {
  it('renders actual Body inputs, open/null metadata and scalar/absent titles without a callback', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const notes: readonly VaultViewPage[] = [
      { id: 'number', title: 42, metadata: { opaque: cycle }, last_modified: new Date(0) },
      { id: 'bigint', title: 9n, metadata: null, last_modified: 0 },
      { id: 'boolean', title: true, metadata: {} },
      { id: 'absent', metadata: null },
    ];
    const props: Pick<VaultViewBodyProps, 'notes' | 'allNotes' | 'activeView' | 'onNoteSelect' | 'onUpdateNote'> = {
      notes, allNotes: notes, activeView: { ...activeView, extension: cycle },
    };
    const { container } = mountTestComponent(<VaultFeed {...props} />);
    expect(container.querySelectorAll('article').length).toBe(4);
    for (const title of ['42', '9', 'true', 'Untitled']) {
      expect(container.querySelector(`button[aria-label="Open page: ${title}"]`)).not.toBeNull();
    }
    const open = container.querySelector<HTMLButtonElement>('button[aria-label="Open page: 42"]');
    if (!open) throw new Error('Missing title button');
    act(() => { open.click(); });
    expect(container.querySelector('[data-feed-note-id="number"]')?.classList.contains('is-read')).toBe(true);
    const preview = container.querySelector<HTMLButtonElement>('[data-feed-note-id="bigint"] button[aria-label="Open reading pane"]');
    if (!preview) throw new Error('Missing preview button');
    act(() => { preview.click(); });
    expect(container.querySelector('aside h2')?.textContent).toBe('9');
    expect(container.querySelector('aside')?.textContent).toContain('This record has no excerpt yet.');
    expect(notes[0]?.metadata?.opaque).toBe(cycle);
  });

  it.each([
    { density: 'compact', groupMode: 'date', compact: true, adaptive: false, groups: 1 },
    { density: 'adaptive', groupMode: 'none', compact: false, adaptive: true, groups: 0 },
    { density: 'future-saved-density', groupMode: 'future-saved-group', compact: false, adaptive: false, groups: 0 },
    { density: '', groupMode: '', compact: false, adaptive: false, groups: 0 },
  ])('preserves comparison/CSS semantics for $density / $groupMode', input => {
    const { container } = mountTestComponent(<VaultFeed
      activeView={activeView}
      notes={[{ id: 'a', title: 'Alpha', last_modified: Date.now(), metadata: null }]}
      density={input.density}
      groupMode={input.groupMode}
    />);
    const card = container.querySelector('article');
    expect(card?.classList.contains('vault-feed-card--compact')).toBe(input.compact);
    expect(card?.classList.contains('vault-feed-card--adaptive')).toBe(input.adaptive);
    expect(container.querySelectorAll('.vault-feed-date-group').length).toBe(input.groups);
  });

  it('renders unknown pill values with native coercion and scalar related titles', () => {
    const state = { toString() { return 'Imported status'; } };
    const metadata = { Status: state, Tags: [7n, state], Ref: ['related'] };
    const { container } = mountTestComponent(<VaultFeed
      activeView={activeView}
      notes={[{ id: 'a', title: 'Alpha', metadata }]}
      allNotes={[{ id: 'related', title: 88, metadata: { table_id: 'related-table' } }]}
      schema={{ Status: 'status', Tags: 'multi_select', Ref: 'relation', Ref_config: { relation_database_id: 'related-table' } }}
    />);
    expect(container.textContent).toContain('Imported status');
    expect(container.textContent).toContain('7');
    expect(container.querySelector('[data-relation-item="related"]')?.textContent).toBe('88');
    expect(metadata.Status).toBe(state);
  });

  it('emits a mutable Set for the real template confirmation and clears selection', async () => {
    const onApplyTemplate = vi.fn((ids: Set<string>, templateId: string) => { ids.add(templateId); });
    const template = { id: 'template', title: 'Imported template', extension: new Map() };
    const { container } = mountTestComponent(<VaultFeed
      activeView={activeView} notes={[{ id: 'a', metadata: null }]}
      templates={[template]} onApplyTemplate={onApplyTemplate}
    />);
    selectFirst(container);
    act(() => { button(container, 'Apply template').click(); });
    act(() => { button(container, 'Imported template').click(); });
    await act(async () => { button(container, 'bulk_actions.confirm_apply_template').click(); await Promise.resolve(); });
    expect(onApplyTemplate.mock.calls[0]?.[0]).toBeInstanceOf(Set);
    expect(onApplyTemplate.mock.calls[0]?.[0]).toEqual(new Set(['a', 'template']));
    expect(onApplyTemplate.mock.calls[0]?.[1]).toBe('template');
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  });

  it('executes the visible batch review/save/undo flow with an opaque previous value and sync return', async () => {
    const previous = { toString() { return 'Original'; }, opaque: new Map([['a', 9n]]) };
    const onUpdateNote = vi.fn<(id: string, patch: VaultFeedUpdate) => unknown>(() => new Set(['saved']));
    const { container } = mountTestComponent(<VaultFeed
      activeView={activeView} notes={[{ id: 'a', title: 'Alpha', metadata: { Status: previous } }]}
      schema={{ Status: 'status', Status_config: { options: ['Done'] } }} onUpdateNote={onUpdateNote}
    />);
    selectFirst(container);
    const select = container.querySelector<HTMLSelectElement>('select');
    if (!select) throw new Error('Missing batch field control');
    act(() => { select.value = 'Status::Done'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelector('[aria-label="Confirm batch update"]')).not.toBeNull();
    await act(async () => { button(container, 'Apply changes').click(); await Promise.resolve(); });
    expect(onUpdateNote.mock.calls[0]).toEqual(['a', { metadata: { Status: 'Done' } }]);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Changes saved');
    await act(async () => { button(container, 'Undo').click(); await Promise.resolve(); });
    expect(onUpdateNote.mock.calls[1]?.[1].metadata.Status).toBe(previous);
    expect(container.querySelector('[aria-label="Confirm batch update"]')).toBeNull();
  });

  it('retains optional empty-view actions and forwards clicks without inventing new actions', () => {
    const onClearSearch = vi.fn();
    const onOpenConfig = vi.fn();
    const onCreateRecord = vi.fn();
    const { container } = mountTestComponent(<VaultFeed
      activeView={activeView} notes={[]} searchTerm="missing"
      onClearSearch={onClearSearch} onOpenConfig={onOpenConfig} onCreateRecord={onCreateRecord}
    />);
    expect(container.textContent).toContain('No records match this search.');
    act(() => {
      button(container, 'Clear search').click();
      button(container, 'Adjust view').click();
      button(container, 'Create record').click();
    });
    expect(onClearSearch).toHaveBeenCalledOnce();
    expect(onOpenConfig).toHaveBeenCalledOnce();
    expect(onCreateRecord).toHaveBeenCalledOnce();
  });
});
