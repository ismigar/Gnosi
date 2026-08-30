import { describe, expect, it } from 'vitest';

import {
  prepareFeedBody,
  resolveVaultFeedSettings,
  splitFeedHighlight,
} from './vaultFeedModel';


describe('vaultFeedModel', () => {
  it('removes complete and truncated file embeds while preserving line breaks', () => {
    expect(prepareFeedBody('Before<br><file src="asset">after</file>'))
      .toBe('Before\nafter');
    expect(prepareFeedBody('Text <file src="truncated'))
      .toBe('Text');
  });

  it('splits accent-preserving visible matches without losing punctuation', () => {
    expect(splitFeedHighlight('Project Alpha, ready', 'alpha ready')).toEqual([
      { highlighted: false, text: 'Project ' },
      { highlighted: true, text: 'Alpha' },
      { highlighted: false, text: ', ' },
      { highlighted: true, text: 'ready' },
    ]);
  });

  it('normalizes legacy and current feed view settings', () => {
    expect(resolveVaultFeedSettings({
      excerpt_lines: '8',
      feed_focus: true,
      pill_limit: 3,
      summary_model: 'local/model',
    })).toEqual({
      excerptLines: 8,
      feedFocus: true,
      pillLimit: 3,
      summaryModel: 'local/model',
    });
  });
});
