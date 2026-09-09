import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MailPageView } from './MailPageView';
import type { MailPageController } from './useMailPageController';

const deferred = vi.hoisted(() => {
  let resolveComposer!: () => void;
  let resolveViewer!: () => void;
  return {
    composer: new Promise<void>(resolve => { resolveComposer = resolve; }),
    viewer: new Promise<void>(resolve => { resolveViewer = resolve; }),
    finishComposer: () => { resolveComposer(); },
    finishViewer: () => { resolveViewer(); },
    composerImport: vi.fn(),
    viewerImport: vi.fn(),
  };
});

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string, fallback?: string) => fallback ?? key})}));
vi.mock('../../../shared/ui/layout/AppHeader', () => ({AppHeader: () => <header>Mail</header>}));
vi.mock('../components/MailSidebar', () => ({default: ({onCompose}: {onCompose: () => void}) => <button onClick={onCompose}>Compose</button>}));
vi.mock('../components/MailList', () => ({default: ({onSelectMail}: {onSelectMail: (mail: {id: string}) => void}) => (
  <section aria-label="Inbox"><p>First message</p><button onClick={() => { onSelectMail({id: 'test-message'}); }}>Read</button></section>
)}));
vi.mock('../components/MailComposer', async () => {
  deferred.composerImport();
  await deferred.composer;
  return {default: ({initialSubject}: {initialSubject: string}) => <input aria-label="Subject" defaultValue={initialSubject} />};
});
vi.mock('../components/MailViewer', async () => {
  deferred.viewerImport();
  await deferred.viewer;
  return {default: ({mail}: {mail: {id: string}}) => <article>{mail.id}</article>};
});

function Harness() {
  const [selectedMail, setSelectedMail] = useState<MailPageController['selectedMail']>(null);
  const [isComposing, setIsComposing] = useState(false);
  const controller: MailPageController = {
    accounts: [], identities: [], selectedAccount: null, selectedMail, setSelectedMail,
    isComposing, showMailboxSidebar: true, composeData: {initialSubject: 'Saved draft'},
    handleCompose: () => { setIsComposing(true); },
    closeComposer: () => { setIsComposing(false); }, handleMailSelected: setSelectedMail,
    accountsLoading: false, activeCategory: null, activeFolder: 'INBOX', activeTagId: null,
    activeView: null, counts: {}, countStatuses: [], isCompact: false, listRefreshToken: 0, messages: [],
    readMail: null, removedMail: null, searchQuery: '', setIsComposing,
    handleActionDone: vi.fn(), handleMailMoved: vi.fn(), handleMailRead: vi.fn(),
    handleOpenComposer: vi.fn(), handleRecordAction: vi.fn(), handleSelectCategory: vi.fn(),
    handleSelectFolder: vi.fn(), handleSelectTag: vi.fn(), handleSelectView: vi.fn(),
    refreshCounts: vi.fn(), setListRefreshToken: vi.fn(), setMessages: vi.fn(),
    setSearchQuery: vi.fn(), setSelectedAccount: vi.fn(), setShowMailboxSidebar: vi.fn(),
  };
  return <MailPageView controller={controller} />;
}

it('keeps the inbox usable and cancels a detail pane while its code is loading', async () => {
  (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  let root = createRoot(container);
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    await act(async () => { button.click(); await Promise.resolve(); });
  };
  try {
    act(() => { root.render(<Harness />); });
    expect(deferred.composerImport).not.toHaveBeenCalled();
    expect(deferred.viewerImport).not.toHaveBeenCalled();
    expect(container.textContent).toContain('mail.select_mail_hint');

    await click('Compose');
    expect(container.querySelector('[role=status]')).not.toBeNull();
    expect(container.querySelector('[aria-label=Inbox]')?.textContent).toContain('First message');
    await click('Close');
    await act(async () => { deferred.finishComposer(); await vi.dynamicImportSettled(); });
    expect(container.querySelector('[aria-label=Subject]')).toBeNull();
    await click('Compose');
    expect(container.querySelector<HTMLInputElement>('[aria-label=Subject]')?.value).toBe('Saved draft');

    act(() => { root.unmount(); });
    // A separate mount also verifies the still-unloaded reader boundary.
    root = createRoot(container);
    act(() => { root.render(<Harness />); });
    await click('Read');
    expect(container.querySelector('[role=status]')).not.toBeNull();
    await click('Close');
    await act(async () => { deferred.finishViewer(); await vi.dynamicImportSettled(); });
    expect(container.querySelector('article')).toBeNull();
    await click('Read');
    expect(container.querySelector('article')?.textContent).toBe('test-message');
  } finally {
    deferred.finishComposer(); deferred.finishViewer();
    act(() => { root.unmount(); });
    container.remove();
  }
});
