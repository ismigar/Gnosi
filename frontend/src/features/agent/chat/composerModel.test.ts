import { describe, expect, it } from 'vitest';
import { catalogMentions, EMPTY_MENTION_MENU, insertChatMention, MAX_CHAT_ATTACHMENT_SIZE, mentionMenuReducer, pickChatAttachments, queryMentionMenu } from './composerModel';
import { enabledChatAgents } from './useChatConfiguration';

describe('typed mention composer model', () => {
  it('preserves title/name precedence and database search aliases', () => {
    expect(catalogMentions([{ id: 1, title: 'Page title', name: 'Other' }], 'page', 'Page')[0]).toMatchObject({ id: '1', label: 'Page title', search: 'page page title 1' });
    expect(catalogMentions([{ id: 't', title: 'Other', name: 'Tasks' }], 'table', 'Table')[0]?.label).toBe('Tasks');
    expect(catalogMentions([{ id: 'db', title: 'Research' }], 'database', 'DB')[0]?.search).toBe('database bd research db');
  });
  it('matches an active mention case-insensitively and limits results to eight', () => {
    const catalog = catalogMentions(Array.from({ length: 12 }, (_, id) => ({ id, title: 'Research' })), 'page', 'Page');
    const menu = queryMentionMenu('See @RE', 7, catalog);
    expect(menu).toMatchObject({ open: true, anchor: 4 });
    expect(menu.results).toHaveLength(8);
  });
  it('does not treat an email or an overlong query as a mention', () => {
    expect(queryMentionMenu('a@example.org', 13, [])).toBe(EMPTY_MENTION_MENU);
    expect(queryMentionMenu(`@${'x'.repeat(41)}`, 42, [])).toBe(EMPTY_MENTION_MENU);
  });
  it('inserts a visible token at the caret without changing the remaining text', () => {
    const item = catalogMentions([{ id: 'id', title: 'Reunió 🧠' }], 'page', 'Page')[0];
    if (!item) throw new Error('Missing fixture mention');
    const result = insertChatMention('See @Re after', 7, 4, item);
    expect(result?.value).toBe('See @Reunió 🧠  after');
    expect(result?.mention).toEqual({ id: 'id', type: 'page', label: 'Reunió 🧠', token: '@Reunió 🧠' });
    expect(insertChatMention('text', 4, -1, item)).toBeNull();
  });
  it('changes the coupled menu state atomically and closes it after selection', () => {
    const state = mentionMenuReducer(EMPTY_MENTION_MENU, { type: 'query', value: { anchor: 3, results: [], open: true } });
    expect(mentionMenuReducer(state, { type: 'open', value: false })).toMatchObject({ anchor: 3, open: false });
    expect(mentionMenuReducer(state, { type: 'clear' })).toBe(EMPTY_MENTION_MENU);
  });
  it('keeps file size and count limits and counts every skipped file', () => {
    const small = new File(['small'], 'small.txt');
    const large = new File([], 'large.pdf');
    Object.defineProperty(large, 'size', { value: MAX_CHAT_ATTACHMENT_SIZE + 1 });
    expect(pickChatAttachments([large, small, small], 7)).toEqual({ valid: [small], skipped: 2 });
    expect(pickChatAttachments([small], 8)).toEqual({ valid: [], skipped: 1 });
  });
});

describe('enabled agent profile boundary', () => {
  it('excludes only disabled or unidentified profiles and preserves custom fields', () => {
    const result = enabledChatAgents([{ id: 'hidden', enabled: false }, { name: 'missing id' }, { id: 'agent', name: 'Research', model: 'model', provider: 'provider', plugin: { custom: true } }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'agent', name: 'Research', model: 'model', plugin: { custom: true } });
  });
  it('does not supply an unrelated model for a newly created unconfigured agent', () => {
    const result = enabledChatAgents([{ id: 'new', enabled: true, model: null, provider: null }]);
    expect(result[0]?.model).toBeUndefined();
    expect(result[0]?.provider).toBeUndefined();
  });
});
