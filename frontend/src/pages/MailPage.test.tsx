import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient } from '../shared/api/query-client';
import { dispatchWindowEvent } from '../shared/platform/browser-events';
import MailPage from './MailPage';
import type {
  MailAccount,
  MailComposeData,
  MailPageMessage,
  MailUndoExtra,
} from './mail-page/mailPageModel';


type FetchIntegrations = typeof import('../shared/api/integrations').fetchIntegrations;
type FetchMailCounts = typeof import('../shared/api/mail').fetchMailCounts;
type MoveMailMessage = typeof import('../shared/api/mail').moveMailMessage;
type ToastCall = (message: ReactNode, options?: unknown) => unknown;


interface MailSidebarMockProps {
  readonly accounts: readonly MailAccount[];
  readonly counts: Readonly<Record<string, { readonly unread: number } | undefined>>;
  readonly onCompose: () => void;
  readonly onSelectFolder: (folder: string) => void;
}


interface MailListMockProps {
  readonly onMessagesLoaded: (messages: readonly MailPageMessage[]) => void;
  readonly onRecordAction: (
    type: string,
    mailId: string,
    email: string,
    extra?: MailUndoExtra,
  ) => void;
  readonly onSelectMail: (mail: MailPageMessage | null) => void;
  readonly removedMailId: string | null;
}


interface MailViewerMockProps {
  readonly mail: MailPageMessage | null;
  readonly onActionDone: (
    mailId?: string,
    actionType?: string,
    email?: string,
    extra?: MailUndoExtra,
  ) => void;
  readonly onClose: () => void;
}


interface MailComposerMockProps extends MailComposeData {
  readonly accounts: readonly MailAccount[];
  readonly onClose: () => void;
}


const regularMail: MailPageMessage = {
  id: 'mail-1',
  subject: 'First message',
};
const adjacentMessage: MailPageMessage = {
  id: 'mail-2',
  subject: 'Second message',
};
const draftMail: MailPageMessage = {
  body_text: 'Draft body',
  cc: 'copy@example.test',
  id: 'draft-1',
  recipient: 'reader@example.test',
  source: 'vault',
  subject: '(Esborrany)',
  type: 'Draft',
};


const mocks = vi.hoisted(() => {
  const toast = Object.assign(vi.fn<ToastCall>(), {
    dismiss: vi.fn<(id?: string) => void>(),
    error: vi.fn<(message: unknown) => void>(),
    success: vi.fn<(message: unknown) => void>(),
  });
  return {
    compact: false,
    fetchIntegrations: vi.fn<FetchIntegrations>(),
    fetchMailCounts: vi.fn<FetchMailCounts>(),
    logError: vi.fn<(scope: string, error: unknown) => void>(),
    moveMailMessage: vi.fn<MoveMailMessage>(),
    toast,
  };
});


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string): string => fallback ?? key,
  }),
}));


vi.mock('../hooks/useMediaQuery', () => ({
  useMediaQuery: (): boolean => mocks.compact,
}));


vi.mock('../hooks/useMailTags', () => ({
  MailTagsProvider: ({ children }: { readonly children: ReactNode }) => children,
}));


vi.mock('../lib/notifyError', () => ({ logError: mocks.logError }));
vi.mock('../lib/toast', () => ({ toast: mocks.toast }));


vi.mock('../shared/api/integrations', () => ({
  fetchIntegrations: mocks.fetchIntegrations,
}));


vi.mock('../shared/api/mail', () => ({
  fetchMailCounts: mocks.fetchMailCounts,
  moveMailMessage: mocks.moveMailMessage,
}));


vi.mock('../components/AppHeader', () => ({
  AppHeader: ({
    children,
    title,
  }: {
    readonly children?: ReactNode;
    readonly title: string;
  }) => <header><span>{title}</span>{children}</header>,
}));


vi.mock('../components/Mail/MailSidebar', () => ({
  default: ({
    accounts,
    counts,
    onCompose,
    onSelectFolder,
  }: MailSidebarMockProps) => (
    <aside aria-label="mail-sidebar">
      <span>accounts:{String(accounts.length)}</span>
      <span>unread:{String(counts.INBOX?.unread ?? 0)}</span>
      <button type="button" onClick={onCompose}>compose</button>
      <button type="button" onClick={() => { onSelectFolder('SENT'); }}>sent</button>
    </aside>
  ),
}));


vi.mock('../components/Mail/MailList', () => ({
  default: ({
    onMessagesLoaded,
    onRecordAction,
    onSelectMail,
    removedMailId,
  }: MailListMockProps) => (
    <section aria-label="mail-list">
      <span>removed:{removedMailId ?? 'none'}</span>
      <button
        type="button"
        onClick={() => { onMessagesLoaded([regularMail, adjacentMessage]); }}
      >
        load messages
      </button>
      <button type="button" onClick={() => { onSelectMail(regularMail); }}>
        select regular
      </button>
      <button type="button" onClick={() => { onSelectMail(draftMail); }}>
        select draft
      </button>
      <button
        type="button"
        onClick={() => {
          onRecordAction('archive', 'mail-1', 'primary@example.test', {
            imap_folder: 'INBOX',
            imap_uid: '42',
          });
        }}
      >
        archive selected
      </button>
    </section>
  ),
}));


vi.mock('../components/Mail/MailViewer', () => ({
  default: ({ mail, onActionDone, onClose }: MailViewerMockProps) => (
    <section aria-label="mail-viewer">
      <span>viewer:{mail?.id ?? 'none'}</span>
      <button type="button" onClick={onClose}>close viewer</button>
      <button
        type="button"
        onClick={() => {
          onActionDone(mail?.id, 'archive', 'primary@example.test', {
            imap_folder: 'INBOX',
            imap_uid: '42',
          });
        }}
      >
        archive viewer
      </button>
    </section>
  ),
}));


vi.mock('../components/Mail/MailComposer', () => ({
  default: ({ accounts, initialBody, initialSubject, initialTo, onClose }: MailComposerMockProps) => (
    <section aria-label="mail-composer">
      <span>identities:{String(accounts.length)}</span>
      <span>to:{initialTo ?? ''}</span>
      <span>subject:{initialSubject ?? ''}</span>
      <span>body:{initialBody ?? ''}</span>
      <button type="button" onClick={onClose}>close composer</button>
    </section>
  ),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;


function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}


function buttonByLabel(label: string): HTMLButtonElement {
  const match = container.querySelector(`button[aria-label="${label}"]`);
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found by label: ${label}`);
  }
  return match;
}


async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}


async function renderPage(): Promise<void> {
  await act(async () => {
    root.render(<MailPage />);
    await settle();
  });
}


beforeEach(() => {
  queryClient.clear();
  mocks.compact = false;
  mocks.fetchIntegrations.mockReset();
  mocks.fetchMailCounts.mockReset();
  mocks.logError.mockReset();
  mocks.moveMailMessage.mockReset();
  mocks.toast.mockReset();
  mocks.toast.dismiss.mockReset();
  mocks.toast.error.mockReset();
  mocks.toast.success.mockReset();
  mocks.fetchIntegrations.mockResolvedValue({
    default_mail: 'primary@example.test',
    emails: [{ username: 'imap@example.test' }],
    mail_accounts: [{
      aliases: [{ display_name: 'Alias', email: 'alias@example.test' }],
      email: 'primary@example.test',
      subject_prefix: '[GNOSI] ',
    }, {
      email: 'PRIMARY@example.test',
    }],
  });
  mocks.fetchMailCounts.mockResolvedValue({
    INBOX: { total: 5, unread: 2 },
  });
  mocks.moveMailMessage.mockResolvedValue({ status: 'success' });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: mocks.compact && query === '(max-width: 767px)',
    }),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});


describe('MailPage', () => {
  it('loads, deduplicates, selects the default account, and composes with aliases', async () => {
    await renderPage();
    expect(container.textContent).toContain('accounts:2');
    expect(container.textContent).toContain('unread:2');

    act(() => {
      button('compose').click();
    });

    expect(container.textContent).toContain('identities:3');
    expect(container.textContent).toContain('subject:[GNOSI] ');
  });

  it('navigates to an adjacent message and undoes an archive with Command-Z', async () => {
    await renderPage();
    act(() => {
      button('load messages').click();
    });
    act(() => {
      button('select regular').click();
    });
    expect(container.textContent).toContain('viewer:mail-1');

    act(() => {
      button('archive viewer').click();
    });
    expect(container.textContent).toContain('viewer:mail-2');
    expect(container.textContent).toContain('removed:mail-1');

    await act(async () => {
      dispatchWindowEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'z',
        metaKey: true,
      }));
      await settle();
    });

    expect(mocks.moveMailMessage).toHaveBeenCalledTimes(1);
    const call = mocks.moveMailMessage.mock.calls[0];
    if (!call) throw new Error('Undo request was not captured');
    expect(call[0]).toBe('mail-1');
    expect(call[1]).toBe('primary@example.test');
    expect(call[2]).toEqual({
      imap_folder: 'INBOX',
      imap_uid: '42',
      target_folder: 'INBOX',
    });
  });

  it('opens Vault drafts in the composer and closes the viewer with Escape', async () => {
    await renderPage();
    act(() => {
      button('select draft').click();
    });
    expect(container.textContent).toContain('to:reader@example.test');
    expect(container.textContent).toContain('subject:');
    expect(container.textContent).toContain('body:Draft body');

    act(() => {
      button('close composer').click();
    });
    act(() => {
      button('select regular').click();
    });
    expect(container.textContent).toContain('viewer:mail-1');
    act(() => {
      dispatchWindowEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Escape',
      }));
    });
    expect(container.textContent).toContain('viewer:none');
  });

  it('opens the compact mailbox and closes it after folder navigation', async () => {
    mocks.compact = true;
    await renderPage();
    expect(container.querySelector('[aria-label="mail-sidebar"]')).toBeNull();

    act(() => {
      buttonByLabel('Show mailbox').click();
    });
    expect(container.querySelector('[aria-label="mail-sidebar"]')).not.toBeNull();
    act(() => {
      button('sent').click();
    });
    expect(container.querySelector('[aria-label="mail-sidebar"]')).toBeNull();
  });
});
