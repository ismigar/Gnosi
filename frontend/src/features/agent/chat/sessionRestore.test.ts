import { describe, expect, it } from 'vitest';
import { checkpointIdentities, parseStoredSessions, restoreChatSessions, type RestoreSessionOptions } from './sessionRestore';
import { createChatSession } from './sessionModel';

const makeSession = (id: string, agentId = 'agent') => createChatSession('New conversation', agentId, { randomId: () => id, now: () => 1 });
const restore = (options: Partial<RestoreSessionOptions> = {}) => restoreChatSessions({
  value: [], defaultTitle: 'Nova conversa', agentId: 'agent', activeId: null,
  legacyId: null, forcedSessionId: '', embedded: false, ...options,
});

describe('scoped session restoration', () => {
  it('recovers corrupt stored JSON and malformed checkpoint queue records', () => {
    expect(parseStoredSessions('{broken')).toEqual([]);
    expect(checkpointIdentities([null, {}, { agentId: 1, id: 'a' }, { agentId: 'agent', id: 'a' }])).toEqual([{ agentId: 'agent', id: 'a' }]);
    expect(restore({ value: [null, {}] }).active.agentId).toBe('agent');
  });
  it('gives the current active key precedence over the legacy session key', () => {
    const result = restore({ value: [makeSession('one'), makeSession('two')], activeId: 'two', legacyId: 'one' });
    expect(result.active.id).toBe('two');
  });
  it('uses the legacy key when no active key exists', () => {
    expect(restore({ value: [makeSession('one'), makeSession('two')], legacyId: 'two' }).active.id).toBe('two');
  });
  it('isolates agents and prefers an unarchived session when the saved selection is missing', () => {
    const result = restore({ value: [{ ...makeSession('old'), archived: true }, makeSession('live'), makeSession('foreign', 'other')], activeId: 'foreign' });
    expect(result.active.id).toBe('live');
    expect(result.sessions).toHaveLength(3);
  });
  it('creates a session for an agent without deleting other agents history', () => {
    const result = restore({ value: [makeSession('foreign', 'other')] });
    expect(result.active.agentId).toBe('agent');
    expect(result.sessions.some((session) => session.id === 'foreign')).toBe(true);
  });
  it('localizes only empty historical default titles', () => {
    const result = restore({ value: [makeSession('empty'), { ...makeSession('used'), messages: [{ role: 'user', content: 'question' }] }] });
    expect(result.sessions.find((session) => session.id === 'empty')?.title).toBe('Nova conversa');
    expect(result.sessions.find((session) => session.id === 'used')?.title).toBe('New conversation');
  });
  it('uses the forced notebook session without evicting unrelated persisted sessions', () => {
    const result = restore({ value: [makeSession('existing')], embedded: true, forcedSessionId: 'notebook' });
    expect(result.sessions.map((session) => session.id)).toEqual(['notebook']);
    expect(result.evicted).toEqual([]);
  });
  it('retains 20 recent sessions and identifies exactly the evicted checkpoint', () => {
    const value = Array.from({ length: 21 }, (_, index) => ({ ...makeSession(String(index)), updatedAt: index }));
    const result = restore({ value });
    expect(result.sessions).toHaveLength(20);
    expect(result.evicted).toEqual([{ id: '0', agentId: 'agent' }]);
  });
});
