import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SocialDashboard from './SocialDashboard';


const socialState = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  refetch: vi.fn().mockResolvedValue(undefined),
}));


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));


vi.mock('../../shared/api/useSocialData', () => ({
  useSocialFeeds: () => [{
    data: [],
    isLoading: false,
    refetch: socialState.refetch,
  }],
  useSocialStreams: () => ({
    data: [{
      icon: '🐘',
      id: 'mastodon-home',
      network: 'mastodon',
      title: 'Mastodon Home',
    }],
    isLoading: false,
  }),
  useUpdateSocialStreams: () => ({ mutateAsync: socialState.mutateAsync }),
}));


vi.mock('../../shared/ui/layout/AppHeader', () => ({
  AppHeader: ({ children, title }: {
    readonly children?: ReactNode;
    readonly title: ReactNode;
  }) => <header>{title}{children}</header>,
}));


vi.mock('../../components/Vault/PublishSocialModal', () => ({
  PublishSocialModal: () => null,
}));


vi.mock('./components/AddStreamModal', () => ({ default: () => null }));
vi.mock('./components/Column', () => ({
  default: ({ title }: { readonly title: ReactNode }) => <div>{title}</div>,
}));
vi.mock('./components/Composer', () => ({ default: () => <div>Composer</div> }));
vi.mock('./ContentCalendar', () => ({ default: () => <div>Calendar content</div> }));
vi.mock('./PostHistory', () => ({ default: () => <div>History content</div> }));


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
});


afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});


function buttonWithText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}


describe('SocialDashboard', () => {
  it('renders stream data and switches between calendar and history tabs', () => {
    act(() => {
      root.render(<SocialDashboard />);
    });
    expect(container.textContent).toContain('Mastodon Home');

    act(() => {
      buttonWithText('Calendari').click();
    });
    expect(container.textContent).toContain('Calendar content');

    act(() => {
      buttonWithText('Historial').click();
    });
    expect(container.textContent).toContain('History content');
  });
});
