// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./NotebooksPage', () => { loaded('page'); return { default: () => null }; });
vi.mock('./create/NotebookCreateDialog', () => { loaded('dialog'); return { default: () => null }; });

import { NotebookCreateDialog, NotebooksPage } from './index';

describe('notebook feature public entry', () => {
  it('exposes independent lazy screens without evaluating either implementation', () => {
    expect(NotebooksPage).toBeDefined();
    expect(NotebookCreateDialog).toBeDefined();
    expect(NotebooksPage).not.toBe(NotebookCreateDialog);
    expect(loaded).not.toHaveBeenCalled();
  });
});
