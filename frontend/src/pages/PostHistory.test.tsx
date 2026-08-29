import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SocialPostHistoryItem } from '../shared/api/social';
import PostHistory from './PostHistory';


const historyState = vi.hoisted(() => ({
  data: [] as SocialPostHistoryItem[],
  isFetching: false,
  isLoading: false,
  refetch: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
}));


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


vi.mock('../i18n', () => ({ default: { language: 'en' } }));


vi.mock('../shared/api/useSocialData', () => ({
  useSocialPostHistory: () => historyState,
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
  historyState.refetch.mockClear();
  historyState.data = [
    {
      content: 'Newest publication',
      id: 'post-2',
      networks: ['bluesky'],
      published_at: '2026-08-29T10:00:00Z',
      status: 'success',
    },
    {
      content: 'Oldest publication',
      id: 'post-1',
      networks: ['mastodon'],
      published_at: '',
      status: 'pending',
    },
  ];
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});


describe('PostHistory', () => {
  it('keeps chronological display, safe empty dates, and refresh behavior', () => {
    act(() => {
      root.render(<PostHistory />);
    });

    const text = container.textContent;
    expect(text.indexOf('Oldest publication')).toBeLessThan(
      text.indexOf('Newest publication'),
    );
    expect(text).toContain('—');
    const refresh = container.querySelector('button[title="Refresh"]');
    if (!(refresh instanceof HTMLButtonElement)) {
      throw new Error('Refresh button was not rendered');
    }
    act(() => {
      refresh.click();
    });
    expect(historyState.refetch).toHaveBeenCalledOnce();
  });
});
