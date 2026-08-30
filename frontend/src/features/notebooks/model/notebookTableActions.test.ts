import { describe, expect, it } from 'vitest';

import { canCreateNotebookFromTable } from './notebookTableActions';


describe('canCreateNotebookFromTable', () => {
  it('uses only the configured References table identity', () => {
    expect(canCreateNotebookFromTable('configured-table', 'configured-table')).toBe(true);
    expect(canCreateNotebookFromTable('configured-table', 'Recursos')).toBe(false);
    expect(canCreateNotebookFromTable('', 'configured-table')).toBe(false);
    expect(canCreateNotebookFromTable('configured-table', '')).toBe(false);
  });
});
