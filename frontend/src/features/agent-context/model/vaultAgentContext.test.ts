import { describe, expect, it } from 'vitest';

import { vaultAgentContextRefs, vaultPageViewIds } from './vaultAgentContext';


describe('Vault assistant turn context', () => {
  it('attaches the active record and its table without persisting either', () => {
    expect(vaultAgentContextRefs({
      page: { id: 'page-1', title: 'Accessibility' },
      table: { id: 'resources', name: 'Resources' },
      view: { id: 'my-resources', name: 'My resources' },
    })).toEqual([
      {
        id: 'vault-page:page-1',
        type: 'page',
        ref: 'page-1',
        label: 'Accessibility',
      },
      {
        id: 'vault-table:resources',
        type: 'table',
        ref: 'resources',
        label: 'Resources',
        scope: {
          view_id: 'my-resources',
          view_name: 'My resources',
        },
      },
    ]);
  });

  it('attaches the whole active Vault when no narrower target is open', () => {
    expect(vaultAgentContextRefs()).toEqual([{
      id: 'route-vault',
      type: 'vault',
      ref: 'active-vault',
      label: 'Knowledge',
    }]);
  });
});


describe('Vault dashboard view context', () => {
  it('extracts unique valid view ids from dashboard markers', () => {
    expect(vaultPageViewIds({
      content: [
        '<!-- gnosi-view:def {"view_id":"view-author"} -->',
        '<!-- gnosi-view:def {"view_id":"view-author"} -->',
        '<!-- gnosi-view:def {"view_id":"view-recent"} -->',
        '<!-- gnosi-view:def {invalid} -->',
      ].join('\n'),
    })).toEqual(['view-author', 'view-recent']);
  });

  it('returns no ids when a page has no embedded view', () => {
    expect(vaultPageViewIds({ content: '# Notes' })).toEqual([]);
  });
});
