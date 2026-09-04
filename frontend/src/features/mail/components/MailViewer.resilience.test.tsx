import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailMessage } from '../../../shared/api/mail';
import MailViewer from './MailViewer';


const mocks = vi.hoisted(() => ({
  extractEntities: vi.fn<typeof import('../../../shared/api/mail').extractMailEntities>(),
  fetchMessage: vi.fn<typeof import('../../../shared/api/mail').fetchMailMessage>(),
  fetchThread: vi.fn<typeof import('../../../shared/api/mail').fetchMailThread>(),
  getTags: vi.fn<() => Promise<string[]>>(),
  logError: vi.fn(),
  markRead: vi.fn<typeof import('../../../shared/api/mail').markMailRead>(),
  toastError: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown): string => (
      typeof fallback === 'string' ? fallback : key
    ),
  }),
}));
vi.mock('./MailPdfViewer', () => ({ MailPdfViewer: () => null }));
vi.mock('../../../shared/notifications/notifyError', () => ({
  logError: mocks.logError,
}));
vi.mock('../../../shared/notifications/toast', () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));
vi.mock('../hooks/useMailTags', () => ({
  useMailTags: () => ({
    getMessageTags: mocks.getTags,
    tags: [],
  }),
}));
vi.mock('../../../shared/api/mail', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../shared/api/mail')>(),
  extractMailEntities: mocks.extractEntities,
  fetchMailMessage: mocks.fetchMessage,
  fetchMailThread: mocks.fetchThread,
  markMailRead: mocks.markRead,
}));


let container: HTMLDivElement;
let root: Root;

function message(id: string, extra: Partial<MailMessage> = {}): MailMessage {
  return {
    account: 'reader@example.test',
    body_text: 'Message body',
    date: '2026-09-03',
    has_attachments: false,
    id,
    imap_folder: 'INBOX',
    imap_uid: '42',
    is_read: true,
    is_starred: false,
    recipient: 'reader@example.test',
    sender: 'Fixture <sender@example.test>',
    subject: `Subject ${id}`,
    thread_id: id,
    timestamp: 0,
    ...extra,
  };
}

function action(title: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((item) => item.title === title);
  if (!button) throw new Error(`Missing mail action: ${title}`);
  return button;
}

beforeAll(() => {
  const testGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchThread.mockResolvedValue({ messages: [] });
  mocks.getTags.mockResolvedValue([]);
  mocks.markRead.mockResolvedValue({ status: 'success' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});


describe('MailViewer preview resilience', () => {
  it('keeps the preview usable when explicit analysis is unavailable', async () => {
    let rejectAnalysis: (error: Error) => void = () => undefined;
    mocks.fetchMessage.mockResolvedValue(message('analysis-unavailable'));
    mocks.extractEntities.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectAnalysis = reject;
    }));
    await act(async () => {
      root.render(<MailViewer mail={message('analysis-unavailable')} />);
      await Promise.resolve();
    });

    await act(async () => {
      action('Smart analysis').click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Message body');
    expect(action('Smart analysis').disabled).toBe(true);

    await act(async () => {
      rejectAnalysis(new Error('synthetic provider unavailable'));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Message body');
    expect(container.querySelector(
      '[data-mail-analysis-status="temporarily_unavailable"]',
    )).not.toBeNull();
    expect(action('Smart analysis').disabled).toBe(false);
    expect(mocks.logError).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('uses hydrated message identity for inline images in aggregate mail', async () => {
    const selected = message('inline-image', {
      account: null,
      body_text: null,
      imap_folder: null,
      snippet: 'Synthetic preview',
    });
    mocks.fetchMessage.mockResolvedValue(message('inline-image', {
      account: 'hydrated@example.test',
      body_html: '<img alt="Inline logo" src="cid:logo">',
      imap_folder: 'Archive',
    }));
    await act(async () => {
      root.render(<MailViewer account={null} mail={selected} />);
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.querySelector('iframe')).not.toBeNull();
    });
    const source = container.querySelector('iframe')?.srcdoc || '';
    expect(source).toContain('/api/mail/messages/inline-image/cid/logo');
    expect(source).toContain('email=hydrated%40example.test');
    expect(source).toContain('folder=Archive');
    expect(source).toContain('data-gnosi-local-image="pending"');
  });
});
