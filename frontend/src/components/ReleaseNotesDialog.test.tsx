import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { RELEASES } from '../lib/releaseNotes';
import {
  ReleaseNotesDialog,
  type ReleaseNotesDialogProps,
} from './ReleaseNotesDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'en' },
    t: (key: string, values: Readonly<Record<string, string>> = {}) => {
      if (key === 'release_notes.title') return "What's new in Gnosi";
      if (key === 'release_notes.published_on') {
        return `Published ${values.date ?? ''}`;
      }
      return key;
    },
  }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  const mountedRoot = root;
  if (mountedRoot) {
    act(() => {
      mountedRoot.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

function renderDialog(props: Partial<ReleaseNotesDialogProps> = {}): void {
  const nextContainer = document.createElement('div');
  document.body.appendChild(nextContainer);
  container = nextContainer;
  const nextRoot = createRoot(nextContainer);
  root = nextRoot;
  act(() => {
    nextRoot.render(<ReleaseNotesDialog open onClose={vi.fn()} {...props} />);
  });
}

function findReleaseArticle(version: string): HTMLElement | null {
  if (!container) throw new Error('Expected a mounted release notes dialog.');
  const heading = [...container.querySelectorAll('h3')]
    .find((candidate) => candidate.textContent === `Gnosi ${version}`);
  return heading?.closest<HTMLElement>('article') ?? null;
}

describe('ReleaseNotesDialog', () => {
  it('shows the requested version first and keeps the full history visible', () => {
    renderDialog({ initialVersion: '0.3.0-rc.1' });
    const headings = [...(container?.querySelectorAll('h3') ?? [])]
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Gnosi 0.3.0-rc.1',
      ...RELEASES
        .filter((release) => release.version !== '0.3.0-rc.1')
        .map((release) => `Gnosi ${release.version}`),
    ]);
  });

  it('closes from its accessible close button', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    const closeButton = container?.querySelector(
      'button[aria-label="release_notes.close"]',
    );
    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new Error('Expected the release notes close button.');
    }
    act(() => {
      closeButton.click();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not render download links when downloadUrl is omitted', () => {
    const release = RELEASES[0];
    if (!release) throw new Error('Expected at least one release.');
    const downloadUrl = release.downloadUrl;
    Reflect.deleteProperty(release, 'downloadUrl');
    try {
      renderDialog();
      expect(findReleaseArticle(release.version)?.querySelector('a')).toBeNull();
    } finally {
      Reflect.set(release, 'downloadUrl', downloadUrl);
    }
  });

  it('renders download links only when downloadUrl is provided', () => {
    const release = RELEASES[0];
    if (!release) throw new Error('Expected at least one release.');
    renderDialog();
    const downloadLink = findReleaseArticle(release.version)?.querySelector('a');
    expect(downloadLink?.href).toBe(release.downloadUrl);
  });
});
