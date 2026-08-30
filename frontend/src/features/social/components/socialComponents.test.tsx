import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  interactSocialPost,
  type SocialPost,
  type SocialStream,
} from '../../../shared/api/social';
import AddStreamModal from './AddStreamModal';
import Composer from './Composer';
import PostCard from './PostCard';
import Scheduler from './Scheduler';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string,
      values: Record<string, string | number> = {},
    ) => Object.entries(values).reduce(
      (message, [name, value]) => message.replaceAll(
        `{{${name}}}`,
        typeof value === 'number' ? String(value) : value,
      ),
      fallback ?? key,
    ),
  }),
}));


vi.mock('../../../hooks/useModalKeyboard', () => ({
  useModalKeyboard: vi.fn(),
}));


vi.mock('../../../shared/api/social', () => ({
  interactSocialPost: vi.fn(),
}));


const composerMocks = vi.hoisted(() => ({
  createPost: vi.fn(),
  schedulePosts: vi.fn(),
  toastSuccess: vi.fn(),
}));


vi.mock('../../../shared/api/useSocialData', () => ({
  useCreateSocialPost: () => ({
    isPending: false,
    mutateAsync: composerMocks.createPost,
  }),
  useScheduleSocialPosts: () => ({
    isPending: false,
    mutateAsync: composerMocks.schedulePosts,
  }),
  useSocialNetworks: () => ({
    data: [
      {
        char_limit: 500,
        enabled: true,
        icon: 'M',
        id: 'mastodon',
        name: 'Mastodon',
      },
      {
        char_limit: 300,
        enabled: true,
        icon: 'B',
        id: 'bluesky',
        name: 'Bluesky',
      },
    ],
  }),
}));


vi.mock('../../../lib/toast', () => ({
  toast: {
    error: vi.fn(),
    success: composerMocks.toastSuccess,
  },
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.resetAllMocks();
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});


function buttonWithText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}


function setInputValue(input: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  );
  const boundSetter = descriptor?.set?.bind(input);
  if (!boundSetter) throw new Error('Native textarea setter is unavailable');
  boundSetter(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}


describe('social controls', () => {
  it('turns a quick schedule option into the same local date and time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 29, 10, 0, 0));
    const onSchedule = vi.fn<(scheduledAt: Date) => void>();
    act(() => {
      root.render(<Scheduler onCancel={vi.fn()} onSchedule={onSchedule} />);
    });

    act(() => {
      buttonWithText('+1 hour').click();
    });
    act(() => {
      buttonWithText('Confirm').click();
    });

    expect(onSchedule).toHaveBeenCalledWith(new Date(2026, 7, 29, 11, 0, 0));
  });

  it('publishes a typed like interaction and updates the count', async () => {
    const post: SocialPost = {
      author: 'Ada',
      avatar: null,
      cid: 'cid-1',
      content: 'Research update',
      favourited: false,
      favourites_count: 2,
      handle: '@ada',
      id: 'post-1',
      is_reblog: false,
      network: 'bluesky',
      reblog_by: null,
      reblogged: false,
      reblogs_count: 1,
      replies_count: 0,
      timestamp: '2026-08-29T08:00:00Z',
      url: null,
    };
    vi.mocked(interactSocialPost).mockResolvedValue({
      action: 'like',
      post_id: 'post-1',
      status: 'success',
    });
    act(() => {
      root.render(<PostCard post={post} />);
    });

    const likeButton = container.querySelector('button[aria-label="Like"]');
    if (!(likeButton instanceof HTMLButtonElement)) {
      throw new Error('Like button was not rendered');
    }
    await act(async () => {
      likeButton.click();
      await Promise.resolve();
    });

    expect(interactSocialPost).toHaveBeenCalledWith({
      action: 'like',
      cid: 'cid-1',
      network: 'bluesky',
      post_id: 'post-1',
    });
    expect(likeButton.textContent).toContain('3');
  });

  it('creates the default stream and closes the modal', () => {
    const onAdd = vi.fn<(stream: SocialStream) => void>();
    const onClose = vi.fn<() => void>();
    act(() => {
      root.render(
        <AddStreamModal isOpen onAdd={onAdd} onClose={onClose} />,
      );
    });

    act(() => {
      buttonWithText('Add stream').click();
    });

    expect(onAdd).toHaveBeenCalledWith({
      icon: '🐘',
      id: 'mastodon-home',
      network: 'mastodon',
      title: 'Mastodon Home Timeline',
      type: 'home',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('publishes composer content to every enabled network', async () => {
    composerMocks.createPost.mockResolvedValue({ status: 'published' });
    act(() => {
      root.render(<Composer />);
    });
    const textarea = container.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('Composer textarea was not rendered');
    }
    act(() => {
      setInputValue(textarea, 'A typed social update');
    });
    expect(container.textContent).toContain('21 / 300 characters');

    await act(async () => {
      buttonWithText('Publish Now').click();
      await Promise.resolve();
    });

    expect(composerMocks.createPost).toHaveBeenCalledWith({
      content: 'A typed social update',
      networks: ['mastodon', 'bluesky'],
    });
    expect(composerMocks.toastSuccess).toHaveBeenCalledOnce();
  });
});
