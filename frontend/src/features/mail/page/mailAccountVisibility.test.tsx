import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useMailPageController, type MailPageController } from './useMailPageController';
import { MailPageView } from './MailPageView';
import { defineStorageKey, removeStorage, stringStorageCodec } from '../../../shared/platform/browser-storage';
import type { MailListProps } from '../components/MailList';

const fixtures = vi.hoisted(() => ({
  accounts: [{ email: 'one@example.test' }, { username: 'two@example.test' }] as const,
  lists: [] as MailListProps[],
  disabledSelection: false,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/api/integrations', () => ({ fetchIntegrations: () => Promise.resolve(fixtures.disabledSelection
  ? { mail_accounts: [{ ...fixtures.accounts[0], enabled: false }], default_mail: fixtures.accounts[0].email }
  : { mail_accounts: fixtures.accounts }) }));
vi.mock('../../../shared/api/query-client', () => ({ queryClient: { query: ({ queryFn }: { queryFn: (options: {signal: AbortSignal}) => unknown }) => queryFn({signal: new AbortController().signal}) } }));
vi.mock('../../../shared/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('../../../shared/api/mail', () => ({ fetchMailCounts: () => Promise.resolve({ INBOX: { unread: 2, total: 3 } }), moveMailMessage: vi.fn() }));
vi.mock('../../../shared/ui/layout/AppHeader', () => ({ AppHeader: () => <header /> }));
vi.mock('../hooks/useMailTags', () => ({ useMailTags: () => ({ tags: [] }) }));
vi.mock('../hooks/useMailViews', () => ({ useMailViews: () => ({ views: [] }) }));
vi.mock('../components/MailViewEditor', () => ({ default: () => null }));
vi.mock('../components/MailViewer', () => ({ default: () => <article>Selected message</article> }));
vi.mock('../components/MailList', () => ({ default: (props: MailListProps) => { fixtures.lists.push(props); return <div data-list />; } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let current: MailPageController;
function Harness() {
  const controller = useMailPageController();
  useEffect(() => { current = controller; });
  return <MailPageView controller={controller} />;
}
async function update(operation: () => void) {
  await act(async () => { operation(); await Promise.resolve(); });
}
const visibilityKey = defineStorageKey('mail.hiddenAccounts', stringStorageCodec);
afterEach(() => { removeStorage(visibilityKey); fixtures.lists.length = 0; fixtures.disabledSelection = false; });

it('applies persistent visibility to every list scope, counts and detail, including all accounts off', async () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  const host = document.createElement('div'); document.body.append(host);
  let root = createRoot(host);
  const mount = async () => {
    await update(() => { root.render(<Harness />); });
    await update(() => { host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click(); });
  };
  const toggle = async (index: number) => { await update(() => { (host.querySelectorAll('[role=switch]')[index] as HTMLElement).click(); }); };
  const list = () => {
    const value = fixtures.lists.at(-1);
    if (!value) throw new Error('Mail list has not rendered');
    return value;
  };
  try {
    await mount();
    expect(host.querySelectorAll('[role=switch]')).toHaveLength(2);
    expect(list().accounts).toHaveLength(2);
    expect(current.counts.INBOX?.unread).toBe(4);
    for (const folder of ['INBOX', 'STARRED', 'all', 'SENT', 'DRAFTS', 'TRASH', 'SPAM']) {
      await update(() => { current.handleSelectFolder(folder); });
      await toggle(0);
      expect(list().accounts).toMatchObject([fixtures.accounts[1]]);
      expect(list().folder).toBe(folder);
      expect(current.counts.INBOX?.unread).toBe(2);
      await toggle(0);
    }
    await update(() => {
      current.handleSelectCategory('personal');
      current.handleSelectTag('research');
      current.setSearchQuery('agenda');
      current.setSelectedMail({ id: 'message', account: 'one@example.test' });
    });
    await toggle(0);
    expect(current.selectedMail).toBeNull();
    expect(list().category).toBe('personal');
    expect(list().activeTagId).toBe('research');
    expect(list().searchQuery).toBe('agenda');
    await update(() => { current.handleSelectView({
      id: 'saved', name: 'Saved', actions: [], created_at: null, updated_at: null,
      fields: [], filter_logic: 'AND', filters: [], group_by: 'none', sort_by: 'date', sort_dir: 'desc',
    }); });
    expect(list().activeView?.id).toBe('saved');
    expect(list().accounts).toMatchObject([fixtures.accounts[1]]);
    await toggle(1);
    expect(list().accounts).toEqual([]);
    expect(list().account).toBeNull();
    expect(current.counts).toEqual({});
    expect(current.identities).toHaveLength(2);
    act(() => { root.unmount(); }); root = createRoot(host);
    await mount();
    expect(list().accounts).toEqual([]);
    expect([...host.querySelectorAll('[role=switch]')].every(item => item.getAttribute('aria-checked') === 'false')).toBe(true);
    await toggle(1);
    expect(list().accounts).toMatchObject([fixtures.accounts[1]]);
    await update(() => { current.setSelectedAccount(fixtures.accounts[0]); });
    expect(list().accounts).toEqual([]);
    await toggle(0);
    expect(list().accounts).toMatchObject([fixtures.accounts[0]]);
  } finally { act(() => { root.unmount(); }); host.remove(); }
});


it('preserves explicit selection of an account with synchronization disabled while honoring its visibility', async () => {
  fixtures.disabledSelection = true;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const latest = () => {
    const value = fixtures.lists.at(-1);
    if (!value) throw new Error('Mail list has not rendered');
    return value;
  };
  const toggle = async () => {
    await update(() => { host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click(); });
    await update(() => {
      const control = host.querySelector<HTMLElement>('[role=switch]');
      if (!control) throw new Error('Account visibility switch is missing');
      control.click();
    });
  };
  try {
    await update(() => { root.render(<Harness />); });
    expect(latest().account?.email).toBe('one@example.test');
    expect(current.counts.INBOX?.unread).toBe(2);
    await toggle();
    expect(latest().account).toBeNull();
    expect(latest().accounts).toEqual([]);
    expect(current.counts).toEqual({});
    await toggle();
    expect(latest().account?.email).toBe('one@example.test');
    expect(latest().account?.enabled).toBe(false);
    expect(current.counts.INBOX?.unread).toBe(2);
  } finally { act(() => { root.unmount(); }); host.remove(); }
});
