import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  interactSocialPost,
  type SocialPost,
  type SocialStream,
} from '../../shared/api/social';
import AddStreamModal from './AddStreamModal';
import PostCard from './PostCard';
import Scheduler from './Scheduler';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


vi.mock('../../hooks/useModalKeyboard', () => ({
  useModalKeyboard: vi.fn(),
}));


vi.mock('../../shared/api/social', () => ({
  interactSocialPost: vi.fn(),
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
});
