import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { RELEASES } from '../lib/releaseNotes';
import { ReleaseNotesDialog } from './ReleaseNotesDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'en' },
    t: (key, values = {}) => {
      if (key === 'release_notes.title') return "What's new in Gnosi";
      if (key === 'release_notes.published_on') return `Published ${values.date}`;
      return key;
    },
  }),
}));

let root;
let container;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderDialog(props = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(
    <ReleaseNotesDialog open onClose={vi.fn()} {...props} />,
  ));
}

describe('ReleaseNotesDialog', () => {
  it('shows the requested version first and keeps the full history visible', async () => {
    await renderDialog({ initialVersion: '0.3.0-rc.1' });
    const headings = [...container.querySelectorAll('h3')].map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Gnosi 0.3.0-rc.1',
      ...RELEASES
        .filter((release) => release.version !== '0.3.0-rc.1')
        .map((release) => `Gnosi ${release.version}`),
    ]);
  });

  it('closes from its accessible close button', async () => {
    const onClose = vi.fn();
    await renderDialog({ onClose });
    await act(async () => container.querySelector('button[aria-label="release_notes.close"]').click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not link versions without published downloads', async () => {
    await renderDialog();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent.match(/release_notes.download_unavailable/g)).toHaveLength(RELEASES.length);
  });

  it('uses only the verified download URL stored in the release catalog', async () => {
    RELEASES[0].downloadUrl = 'https://github.com/ismigar/Gnosi/releases/tag/v1.0.0-rc.2';
    try {
      await renderDialog();
      expect(container.querySelector('a').href).toBe(RELEASES[0].downloadUrl);
    } finally {
      delete RELEASES[0].downloadUrl;
    }
  });
});
